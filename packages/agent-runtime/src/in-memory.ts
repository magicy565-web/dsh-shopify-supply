import { randomUUID } from 'node:crypto'
import type {
  AgentEvent,
  AgentMessage,
  AgentSession,
  ApprovalDecision,
  CreateSessionInput,
  SessionState,
  SessionStatus,
} from '@dsh-supply/agent-contracts'
import {
  ASK_TOOL_NAMES,
  DEV_TOOL_NAMES,
  DSH_TOOL_NAMES,
  ECHO_THROW_TOKEN,
} from '@dsh-supply/config'
import type { AgentRuntime } from './types.js'

type PendingApproval = {
  approvalId: string
  toolName: string
  toolCallId: string
  resolve: (decision: ApprovalDecision) => void
}

type MemorySession = {
  id: string
  createdAt: string
  status: SessionStatus
  pending?: PendingApproval
  abort: AbortController
}

function now(): string {
  return new Date().toISOString()
}

function eventBase(sessionId: string) {
  return { sessionId, ts: now() }
}

function parseCall(text: string): { toolName: string; arg: string } | undefined {
  const match = /^(?:CALL|call)\s+(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!match) return undefined
  return { toolName: match[1] ?? '', arg: (match[2] ?? '').trim() }
}

/**
 * Deterministic AgentRuntime used by contract tests and local UI.
 * Tool calls are invoked with `CALL <tool> <args>` so tests never need a model.
 */
export class InMemoryAgentRuntime implements AgentRuntime {
  private readonly sessions = new Map<string, MemorySession>()

  async createSession(input: CreateSessionInput = {}): Promise<AgentSession> {
    const id = input.id ?? `session-${randomUUID()}`
    const existing = this.sessions.get(id)
    if (existing && existing.status !== 'closed') {
      return { id: existing.id, createdAt: existing.createdAt }
    }
    const createdAt = now()
    this.sessions.set(id, {
      id,
      createdAt,
      status: 'idle',
      abort: new AbortController(),
    })
    return { id, createdAt }
  }

  async getSession(sessionId: string): Promise<SessionState> {
    const session = this.require(sessionId)
    return {
      id: session.id,
      status: session.status,
      pendingApprovalId: session.pending?.approvalId,
      tools: [...DSH_TOOL_NAMES],
    }
  }

  async approve(
    sessionId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<void> {
    const session = this.require(sessionId)
    const pending = session.pending
    if (!pending || pending.approvalId !== approvalId) {
      throw new Error(`no pending approval ${approvalId} on ${sessionId}`)
    }
    pending.resolve(decision)
  }

  async abort(sessionId: string): Promise<void> {
    const session = this.require(sessionId)
    session.status = 'aborted'
    session.abort.abort()
    if (session.pending) session.pending.resolve('deny')
  }

  async resume(sessionId: string): Promise<void> {
    const session = this.require(sessionId)
    if (session.status === 'closed') {
      throw new Error(`session ${sessionId} is closed`)
    }
    session.abort = new AbortController()
    session.status = 'idle'
    session.pending = undefined
  }

  async close(sessionId: string): Promise<void> {
    const session = this.require(sessionId)
    session.abort.abort()
    if (session.pending) session.pending.resolve('deny')
    session.status = 'closed'
    session.pending = undefined
  }

  async *sendMessage(sessionId: string, message: AgentMessage): AsyncIterable<AgentEvent> {
    const session = this.require(sessionId)
    if (session.status === 'closed' || session.status === 'aborted') {
      yield {
        ...eventBase(sessionId),
        type: 'agent.failed',
        message: `session is ${session.status}`,
      }
      return
    }
    session.status = 'running'
    session.abort = new AbortController()

    try {
      const call = parseCall(message.text)
      if (call) {
        yield* this.runTool(session, call.toolName, call.arg)
        return
      }

      if (session.abort.signal.aborted) {
        session.status = 'aborted'
        return
      }
      yield { ...eventBase(sessionId), type: 'message.delta', text: `echo: ${message.text}` }
      session.status = 'idle'
      yield { ...eventBase(sessionId), type: 'agent.completed' }
    } catch (error) {
      session.status = 'idle'
      yield {
        ...eventBase(sessionId),
        type: 'agent.failed',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async *runTool(
    session: MemorySession,
    toolName: string,
    arg: string,
  ): AsyncIterable<AgentEvent> {
    const sessionId = session.id
    const toolCallId = `call-${randomUUID()}`
    yield {
      ...eventBase(sessionId),
      type: 'tool.started',
      toolCallId,
      toolName,
      arguments: { text: arg },
    }

    if (session.abort.signal.aborted) {
      session.status = 'aborted'
      return
    }

    if (!(DEV_TOOL_NAMES as readonly string[]).includes(toolName)) {
      yield {
        ...eventBase(sessionId),
        type: 'tool.completed',
        toolCallId,
        toolName,
        isError: true,
        result: { error: `unknown tool ${toolName}` },
      }
      session.status = 'idle'
      yield { ...eventBase(sessionId), type: 'agent.completed' }
      return
    }

    if ((ASK_TOOL_NAMES as readonly string[]).includes(toolName)) {
      const approvalId = `approval-${randomUUID()}`
      const decisionPromise = this.beginApproval(session, {
        approvalId,
        toolName,
        toolCallId,
      })
      yield {
        ...eventBase(sessionId),
        type: 'approval.requested',
        approvalId,
        toolName,
        toolCallId,
        reason: `${toolName} requires operator approval`,
      }
      const decision = await decisionPromise
      yield {
        ...eventBase(sessionId),
        type: 'approval.resolved',
        approvalId,
        decision,
        outcome: decision === 'allow' ? 'allowed-once' : 'rejected',
      }
      if (decision !== 'allow' || session.abort.signal.aborted) {
        yield {
          ...eventBase(sessionId),
          type: 'tool.completed',
          toolCallId,
          toolName,
          isError: true,
          result: { error: 'denied' },
        }
        session.status = session.abort.signal.aborted ? 'aborted' : 'idle'
        if (session.status === 'idle') {
          yield { ...eventBase(sessionId), type: 'agent.completed' }
        }
        return
      }
      yield {
        ...eventBase(sessionId),
        type: 'tool.completed',
        toolCallId,
        toolName,
        isError: false,
        result: { ok: true, action: toolName },
      }
      session.status = 'idle'
      yield { ...eventBase(sessionId), type: 'agent.completed' }
      return
    }

    if (toolName === 'echo' && arg === ECHO_THROW_TOKEN) {
      yield {
        ...eventBase(sessionId),
        type: 'tool.completed',
        toolCallId,
        toolName,
        isError: true,
        result: { error: 'echo forced failure' },
      }
      session.status = 'idle'
      yield { ...eventBase(sessionId), type: 'agent.completed' }
      return
    }

    const result =
      toolName === 'read_test_data'
        ? { sku: 'TEST-SKU-1', title: 'Runtime fixture mug', moq: 1 }
        : { text: arg }

    yield {
      ...eventBase(sessionId),
      type: 'tool.completed',
      toolCallId,
      toolName,
      isError: false,
      result,
    }
    session.status = 'idle'
    yield { ...eventBase(sessionId), type: 'agent.completed' }
  }

  private beginApproval(
    session: MemorySession,
    pending: Omit<PendingApproval, 'resolve'>,
  ): Promise<ApprovalDecision> {
    session.status = 'waiting_approval'
    return new Promise((resolve) => {
      session.pending = {
        ...pending,
        resolve: (decision) => {
          session.pending = undefined
          if (session.status === 'waiting_approval') session.status = 'running'
          resolve(decision)
        },
      }
    })
  }

  private require(sessionId: string): MemorySession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`unknown session ${sessionId}`)
    return session
  }
}
