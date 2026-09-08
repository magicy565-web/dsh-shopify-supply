import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import type {
  AgentEvent,
  AgentMessage,
  AgentSession,
  ApprovalDecision,
  CreateSessionInput,
  SessionState,
  SessionStatus,
} from '@dsh-supply/agent-contracts'
import type { AgentRuntime } from '@dsh-supply/agent-runtime'
import {
  DSH_TOOL_NAMES,
  DSH_DEFAULT_MODEL,
  DSH_DEFAULT_PROVIDER,
  findWorkspaceRoot,
} from '@dsh-supply/config'
import {
  defaultDshHome,
  dshRuntimeProjectDir,
  resolveJsonrpcAgentBin,
  writeRuntimeConfig,
} from '@dsh-supply/dsh-runtime'
import { ApprovalBridge } from './approval-bridge.js'
import { isInboxReceipt, mapNotification } from './map-event.js'

type LiveSession = {
  id: string
  createdAt: string
  status: SessionStatus
  pendingApprovalId?: string
  harness: DeepSeekHarness
  toolNames: Map<string, string>
}

function now(): string {
  return new Date().toISOString()
}

export type DeepSeekHarnessRuntimeOptions = {
  workspaceRoot?: string
  provider?: string
  model?: string
}

export class DeepSeekHarnessRuntime implements AgentRuntime {
  private readonly workspaceRoot: string
  private readonly provider: string
  private readonly model: string
  private readonly bridge = new ApprovalBridge()
  private readonly sessions = new Map<string, LiveSession>()
  private patchFile: string | undefined
  private started = false

  constructor(options: DeepSeekHarnessRuntimeOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? findWorkspaceRoot()
    this.provider = options.provider ?? process.env.DSH_PROVIDER ?? DSH_DEFAULT_PROVIDER
    this.model = options.model ?? process.env.DSH_MODEL ?? DSH_DEFAULT_MODEL
  }

  async boot(): Promise<void> {
    if (this.started) return
    mkdirSync(defaultDshHome(this.workspaceRoot), { recursive: true })
    this.patchFile = writeRuntimeConfig(this.workspaceRoot)
    await this.bridge.start()
    this.started = true
  }

  async createSession(input: CreateSessionInput = {}): Promise<AgentSession> {
    await this.boot()
    const id = input.id ?? `session-${randomUUID()}`
    const existing = this.sessions.get(id)
    if (existing && existing.status !== 'closed') {
      return { id: existing.id, createdAt: existing.createdAt }
    }
    const harness = this.createHarness()
    await harness.start()
    const createdAt = now()
    this.sessions.set(id, {
      id,
      createdAt,
      status: 'idle',
      harness,
      toolNames: new Map(),
    })
    return { id, createdAt }
  }

  async getSession(sessionId: string): Promise<SessionState> {
    const session = this.require(sessionId)
    return {
      id: session.id,
      status: session.status,
      pendingApprovalId: session.pendingApprovalId,
      tools: [...DSH_TOOL_NAMES],
    }
  }

  async approve(
    sessionId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<void> {
    const session = this.require(sessionId)
    if (session.pendingApprovalId !== approvalId) {
      throw new Error(`no pending approval ${approvalId} on ${sessionId}`)
    }
    this.bridge.resolve(sessionId, approvalId, decision)
    session.pendingApprovalId = undefined
  }

  async abort(sessionId: string): Promise<void> {
    const session = this.require(sessionId)
    session.status = 'aborted'
    session.pendingApprovalId = undefined
    this.bridge.cancelSession(sessionId)
    await session.harness.close()
  }

  async resume(sessionId: string): Promise<void> {
    const session = this.require(sessionId)
    if (session.status === 'closed') {
      throw new Error(`session ${sessionId} is closed`)
    }
    if (session.status !== 'aborted') return
    session.harness = this.createHarness()
    await session.harness.start()
    session.status = 'idle'
    session.pendingApprovalId = undefined
    session.toolNames.clear()
  }

  async close(sessionId: string): Promise<void> {
    const session = this.require(sessionId)
    session.status = 'closed'
    session.pendingApprovalId = undefined
    this.bridge.cancelSession(sessionId)
    await session.harness.close()
  }

  async shutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      this.bridge.cancelSession(session.id)
      try {
        await session.harness.close()
      } catch {
        // Best-effort teardown of every child runtime.
      }
    }
    this.sessions.clear()
    await this.bridge.stop()
    this.started = false
  }

  async *sendMessage(sessionId: string, message: AgentMessage): AsyncIterable<AgentEvent> {
    const session = this.require(sessionId)
    if (session.status === 'closed' || session.status === 'aborted') {
      yield {
        type: 'agent.failed',
        sessionId,
        ts: now(),
        message: `session is ${session.status}`,
      }
      return
    }
    session.status = 'running'
    const client = session.harness.client
    const handle = session.harness.session(sessionId)
    const subscription = client.subscribeSessionTree(handle.id)
    try {
      const messageId = await client.prompt(handle.id, [{ type: 'text', text: message.text }])
      let received = false
      let failed = false
      for (;;) {
        const notification = await subscription.next()
        if (!received) {
          if (
            notification.method !== 'session.event'
            || notification.params.sessionId !== sessionId
            || !isInboxReceipt(notification.params.event, messageId)
          ) {
            continue
          }
          received = true
        }

        const mapped = mapNotification(notification, sessionId, session.toolNames)
        for (const event of mapped) {
          if (event.type === 'agent.completed' && failed) continue
          if (event.type === 'approval.requested') {
            session.status = 'waiting_approval'
            session.pendingApprovalId = event.approvalId
            this.bridge.bindApproval(sessionId, event.approvalId)
          }
          if (event.type === 'approval.resolved') {
            session.pendingApprovalId = undefined
            if (session.status === 'waiting_approval') session.status = 'running'
          }
          if (event.type === 'agent.completed') {
            session.status = 'idle'
          }
          if (event.type === 'agent.failed') {
            session.status = 'idle'
            failed = true
          }
          yield event
        }

        if (
          notification.method === 'session.status'
          && notification.params.sessionId === sessionId
          && notification.params.status === 'idle'
        ) {
          break
        }
      }
    } catch (error) {
      session.status = 'idle'
      yield {
        type: 'agent.failed',
        sessionId,
        ts: now(),
        message: error instanceof Error ? error.message : String(error),
      }
    } finally {
      subscription.close()
    }
  }

  private createHarness(): DeepSeekHarness {
    const url = this.bridge.listenUrl
    if (!url || !this.patchFile) {
      throw new Error('DeepSeekHarnessRuntime.boot() must run first')
    }
    return new DeepSeekHarness({
      launch: {
        command: process.execPath,
        args: [resolveJsonrpcAgentBin(), this.patchFile],
        cwd: dshRuntimeProjectDir(this.workspaceRoot),
        env: {
          ...process.env,
          AGENT_APPROVAL_BRIDGE_URL: url,
          DSH_CORDIS_CONFIG: this.patchFile,
          DSH_HOME: defaultDshHome(this.workspaceRoot),
          DSH_CWD: this.workspaceRoot,
          DSH_SESSION_ROOT: join(defaultDshHome(this.workspaceRoot), 'sessions'),
        },
      },
      cwd: this.workspaceRoot,
      provider: this.provider,
      model: this.model,
    })
  }

  private require(sessionId: string): LiveSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`unknown session ${sessionId}`)
    return session
  }
}
