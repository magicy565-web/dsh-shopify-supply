import { randomUUID } from 'node:crypto'
import {
  AgentError,
  type AgentErrorCode,
  type AgentEvent,
  type AgentMessage,
  type AgentSession,
  type ApprovalDecision,
  type CreateSessionInput,
  type SessionState,
  type SessionStatus,
} from '@dsh-supply/agent-contracts'
import {
  ASK_TOOL_NAMES,
  DEV_TOOL_NAMES,
  DSH_TOOL_NAMES,
  ECHO_THROW_TOKEN,
  agentApprovalTimeoutMs,
} from '@dsh-supply/config'
import type { AgentRuntime, InMemoryAgentRuntimeOptions, MemoryToolHandler } from './types.js'

type PendingApproval = {
  approvalId: string
  toolName: string
  toolCallId: string
  arguments?: unknown
  timer?: ReturnType<typeof setTimeout>
  resolve: (decision: ApprovalDecision | 'timeout') => void
}

type MemorySession = {
  id: string
  createdAt: string
  status: SessionStatus
  pending: Map<string, PendingApproval>
  abort: AbortController
  busy: boolean
}

function now(): string {
  return new Date().toISOString()
}

function eventBase(sessionId: string) {
  return { sessionId, ts: now() }
}

function failed(
  sessionId: string,
  code: AgentErrorCode,
  message: string,
): AgentEvent {
  return { ...eventBase(sessionId), type: 'agent.failed', message, code }
}

function parseCall(text: string): { toolName: string; arg: string } | undefined {
  const match = /^(?:CALL|call)\s+(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!match) return undefined
  return { toolName: match[1] ?? '', arg: (match[2] ?? '').trim() }
}

function parseArgs(arg: string): Record<string, unknown> {
  if (!arg) return {}
  if (arg.startsWith('{') || arg.startsWith('[')) {
    try {
      const parsed = JSON.parse(arg) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
      return { value: parsed }
    } catch {
      return { text: arg }
    }
  }
  return { text: arg }
}

function pendingIds(session: MemorySession): string[] {
  return [...session.pending.keys()]
}

/**
 * Deterministic AgentRuntime used by contract tests and local UI.
 * Tool calls are invoked with `CALL <tool> <args>` so tests never need a model.
 */
export class InMemoryAgentRuntime implements AgentRuntime {
  private readonly sessions = new Map<string, MemorySession>()
  private readonly approvalTtlMs: number
  private readonly tools = new Map<string, MemoryToolHandler>()

  constructor(options: InMemoryAgentRuntimeOptions = {}) {
    this.approvalTtlMs = options.approvalTtlMs ?? agentApprovalTimeoutMs()
    if (options.tools) this.registerTools(options.tools)
  }

  registerTools(tools: Record<string, MemoryToolHandler>): void {
    for (const [name, handler] of Object.entries(tools)) this.tools.set(name, handler)
  }

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
      pending: new Map(),
      abort: new AbortController(),
      busy: false,
    })
    return { id, createdAt }
  }

  async getSession(sessionId: string): Promise<SessionState> {
    const session = this.require(sessionId)
    const ids = pendingIds(session)
    return {
      id: session.id,
      status: session.status,
      pendingApprovalId: ids[0],
      pendingApprovalIds: ids,
      tools: [...new Set([...DSH_TOOL_NAMES, ...this.tools.keys()])],
    }
  }

  async approve(
    sessionId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<void> {
    const session = this.require(sessionId)
    const pending = session.pending.get(approvalId)
    if (!pending) {
      throw new AgentError('approval.unknown', `no pending approval ${approvalId} on ${sessionId}`)
    }
    pending.resolve(decision)
  }

  async abort(sessionId: string): Promise<void> {
    const session = this.require(sessionId)
    session.status = 'aborted'
    session.abort.abort()
    this.rejectAll(session, 'deny')
  }

  async resume(sessionId: string): Promise<void> {
    const session = this.require(sessionId)
    if (session.status === 'closed') {
      throw new AgentError('session.closed', `session ${sessionId} is closed`)
    }
    if (session.status !== 'aborted') return
    session.abort = new AbortController()
    session.status = 'idle'
    this.rejectAll(session, 'timeout')
  }

  async close(sessionId: string): Promise<void> {
    const session = this.require(sessionId)
    session.abort.abort()
    this.rejectAll(session, 'deny')
    session.status = 'closed'
    session.busy = false
  }

  async *sendMessage(sessionId: string, message: AgentMessage): AsyncIterable<AgentEvent> {
    const session = this.require(sessionId)
    if (session.status === 'closed') {
      yield failed(sessionId, 'session.closed', `session is closed`)
      return
    }
    if (session.busy) {
      yield failed(sessionId, 'session.busy', `session ${sessionId} is already running`)
      return
    }
    if (session.status === 'aborted') {
      await this.resume(sessionId)
    }
    session.busy = true
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
      this.settleIdle(session)
      yield { ...eventBase(sessionId), type: 'agent.completed' }
    } catch (error) {
      this.settleIdle(session)
      if (error instanceof AgentError) {
        yield failed(sessionId, error.code, error.message)
        return
      }
      yield {
        ...eventBase(sessionId),
        type: 'agent.failed',
        message: error instanceof Error ? error.message : String(error),
      }
    } finally {
      session.busy = false
    }
  }

  private async *runTool(
    session: MemorySession,
    toolName: string,
    arg: string,
  ): AsyncIterable<AgentEvent> {
    const sessionId = session.id
    const toolCallId = `call-${randomUUID()}`
    const handler = this.tools.get(toolName)
    const toolArguments = handler ? parseArgs(arg) : { text: arg }
    yield {
      ...eventBase(sessionId),
      type: 'tool.started',
      toolCallId,
      toolName,
      arguments: toolArguments,
    }

    if (session.abort.signal.aborted) {
      session.status = 'aborted'
      return
    }

    const known = Boolean(handler) || (DEV_TOOL_NAMES as readonly string[]).includes(toolName)
    if (!known) {
      yield {
        ...eventBase(sessionId),
        type: 'tool.completed',
        toolCallId,
        toolName,
        isError: true,
        result: { error: `unknown tool ${toolName}` },
      }
      this.settleIdle(session)
      yield { ...eventBase(sessionId), type: 'agent.completed' }
      return
    }

    if ((ASK_TOOL_NAMES as readonly string[]).includes(toolName)) {
      const approvalId = `approval-${randomUUID()}`
      const decisionPromise = this.beginApproval(session, {
        approvalId,
        toolName,
        toolCallId,
        arguments: toolArguments,
      })
      yield {
        ...eventBase(sessionId),
        type: 'approval.requested',
        approvalId,
        toolName,
        toolCallId,
        reason: `${toolName} requires operator approval`,
        arguments: toolArguments,
      }
      const decision = await decisionPromise
      const outcome = decision === 'allow' ? 'allowed-once' : decision === 'timeout' ? 'cancelled' : 'rejected'
      yield {
        ...eventBase(sessionId),
        type: 'approval.resolved',
        approvalId,
        decision: decision === 'allow' ? 'allow' : 'deny',
        outcome,
      }
      if (decision !== 'allow' || session.abort.signal.aborted) {
        yield {
          ...eventBase(sessionId),
          type: 'tool.completed',
          toolCallId,
          toolName,
          isError: true,
          result: { error: decision === 'timeout' ? 'approval expired' : 'denied' },
        }
        if (session.abort.signal.aborted) session.status = 'aborted'
        else this.settleIdle(session)
        if (session.status === 'idle') {
          yield { ...eventBase(sessionId), type: 'agent.completed' }
        }
        return
      }
    }

    if (handler) {
      try {
        if (session.abort.signal.aborted) {
          session.status = 'aborted'
          return
        }
        const result = await handler(toolArguments, { signal: session.abort.signal, toolCallId })
        yield {
          ...eventBase(sessionId),
          type: 'tool.completed',
          toolCallId,
          toolName,
          isError: false,
          result,
        }
      } catch (error) {
        yield {
          ...eventBase(sessionId),
          type: 'tool.completed',
          toolCallId,
          toolName,
          isError: true,
          result: { error: error instanceof Error ? error.message : String(error) },
        }
      }
      this.settleIdle(session)
      yield { ...eventBase(sessionId), type: 'agent.completed' }
      return
    }

    if ((ASK_TOOL_NAMES as readonly string[]).includes(toolName)) {
      yield {
        ...eventBase(sessionId),
        type: 'tool.completed',
        toolCallId,
        toolName,
        isError: false,
        result: { ok: true, action: toolName },
      }
      this.settleIdle(session)
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
      this.settleIdle(session)
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
    this.settleIdle(session)
    yield { ...eventBase(sessionId), type: 'agent.completed' }
  }

  private beginApproval(
    session: MemorySession,
    pending: Omit<PendingApproval, 'resolve' | 'timer'>,
  ): Promise<ApprovalDecision | 'timeout'> {
    session.status = 'waiting_approval'
    return new Promise((resolve) => {
      const entry: PendingApproval = {
        ...pending,
        resolve: (decision) => {
          if (entry.timer) clearTimeout(entry.timer)
          session.pending.delete(pending.approvalId)
          if (session.status === 'waiting_approval' && session.pending.size === 0) {
            session.status = 'running'
          }
          resolve(decision)
        },
      }
      if (this.approvalTtlMs > 0) {
        entry.timer = setTimeout(() => entry.resolve('timeout'), this.approvalTtlMs)
        entry.timer.unref()
      }
      session.pending.set(pending.approvalId, entry)
    })
  }

  private settleIdle(session: MemorySession): void {
    if (session.status === 'aborted' || session.status === 'closed') return
    session.status = 'idle'
  }

  private rejectAll(session: MemorySession, decision: ApprovalDecision | 'timeout'): void {
    for (const pending of [...session.pending.values()]) pending.resolve(decision)
  }

  private require(sessionId: string): MemorySession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new AgentError('session.unknown', `unknown session ${sessionId}`)
    return session
  }
}
