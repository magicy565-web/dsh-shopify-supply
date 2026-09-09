import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
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
import type { AgentRuntime } from '@dsh-supply/agent-runtime'
import {
  AGENT_INTERNAL_TOKEN_ENV,
  DSH_TOOL_NAMES,
  DSH_DEFAULT_MODEL,
  DSH_DEFAULT_PROVIDER,
  agentApprovalTimeoutMs,
  agentSessionIdleTtlMs,
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
  pendingApprovals: Set<string>
  harness: DeepSeekHarness
  harnessAlive: boolean
  toolNames: Map<string, string>
  busy: boolean
  idleTimer?: ReturnType<typeof setTimeout>
}

function now(): string {
  return new Date().toISOString()
}

function failed(sessionId: string, code: AgentErrorCode, message: string): AgentEvent {
  return { type: 'agent.failed', sessionId, ts: now(), message, code }
}

export type DeepSeekHarnessRuntimeOptions = {
  workspaceRoot?: string
  provider?: string
  model?: string
  internalToken?: string
  approvalTtlMs?: number
  idleTtlMs?: number
}

export class DeepSeekHarnessRuntime implements AgentRuntime {
  private readonly workspaceRoot: string
  private readonly provider: string
  private readonly model: string
  private readonly internalToken: string
  private readonly idleTtlMs: number
  private readonly bridge: ApprovalBridge
  private readonly sessions = new Map<string, LiveSession>()
  private patchFile: string | undefined
  private started = false

  constructor(options: DeepSeekHarnessRuntimeOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? findWorkspaceRoot()
    this.provider = options.provider ?? process.env.DSH_PROVIDER ?? DSH_DEFAULT_PROVIDER
    this.model = options.model ?? process.env.DSH_MODEL ?? DSH_DEFAULT_MODEL
    this.internalToken = options.internalToken
      ?? process.env[AGENT_INTERNAL_TOKEN_ENV]
      ?? randomUUID()
    this.idleTtlMs = options.idleTtlMs ?? agentSessionIdleTtlMs()
    this.bridge = new ApprovalBridge({
      token: this.internalToken,
      timeoutMs: options.approvalTtlMs ?? agentApprovalTimeoutMs(),
    })
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
      pendingApprovals: new Set(),
      harness,
      harnessAlive: true,
      toolNames: new Map(),
      busy: false,
    })
    this.scheduleIdle(id)
    return { id, createdAt }
  }

  async getSession(sessionId: string): Promise<SessionState> {
    const session = this.require(sessionId)
    const ids = [...session.pendingApprovals]
    return {
      id: session.id,
      status: session.status,
      pendingApprovalId: ids[0],
      pendingApprovalIds: ids,
      tools: [...DSH_TOOL_NAMES],
    }
  }

  async approve(
    sessionId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<void> {
    const session = this.require(sessionId)
    if (!session.pendingApprovals.has(approvalId)) {
      throw new AgentError('approval.unknown', `no pending approval ${approvalId} on ${sessionId}`)
    }
    this.bridge.resolve(sessionId, approvalId, decision)
    session.pendingApprovals.delete(approvalId)
  }

  async abort(sessionId: string): Promise<void> {
    const session = this.require(sessionId)
    this.clearIdle(session)
    session.status = 'aborted'
    session.pendingApprovals.clear()
    this.bridge.cancelSession(sessionId)
    await this.stopHarness(session)
  }

  async resume(sessionId: string): Promise<void> {
    const session = this.require(sessionId)
    if (session.status === 'closed') {
      throw new AgentError('session.closed', `session ${sessionId} is closed`)
    }
    if (session.status !== 'aborted' && session.harnessAlive) return
    await this.revive(session)
  }

  async close(sessionId: string): Promise<void> {
    const session = this.require(sessionId)
    this.clearIdle(session)
    session.status = 'closed'
    session.busy = false
    session.pendingApprovals.clear()
    this.bridge.cancelSession(sessionId)
    await this.stopHarness(session)
  }

  async shutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      this.clearIdle(session)
      this.bridge.cancelSession(session.id)
      try {
        await this.stopHarness(session)
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
    if (session.status === 'closed') {
      yield failed(sessionId, 'session.closed', `session is closed`)
      return
    }
    if (session.busy) {
      yield failed(sessionId, 'session.busy', `session ${sessionId} is already running`)
      return
    }
    if (session.status === 'aborted' || !session.harnessAlive) {
      await this.revive(session)
    }
    this.clearIdle(session)
    session.busy = true
    session.status = 'running'
    const client = session.harness.client
    const handle = session.harness.session(sessionId)
    const subscription = client.subscribeSessionTree(handle.id)
    try {
      const messageId = await client.prompt(handle.id, [{ type: 'text', text: message.text }])
      let received = false
      let failedTurn = false
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
          if (event.type === 'agent.completed' && failedTurn) continue
          if (event.type === 'approval.requested') {
            session.status = 'waiting_approval'
            session.pendingApprovals.add(event.approvalId)
            this.bridge.bindApproval(sessionId, event.approvalId, event.toolCallId)
          }
          if (event.type === 'approval.resolved') {
            session.pendingApprovals.delete(event.approvalId)
            if (session.status === 'waiting_approval' && session.pendingApprovals.size === 0) {
              session.status = 'running'
            }
          }
          if (event.type === 'agent.completed') {
            this.settleIdle(session)
          }
          if (event.type === 'agent.failed') {
            this.settleIdle(session)
            failedTurn = true
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
      this.settleIdle(session)
      if (error instanceof AgentError) {
        yield failed(sessionId, error.code, error.message)
      } else {
        yield {
          type: 'agent.failed',
          sessionId,
          ts: now(),
          message: error instanceof Error ? error.message : String(error),
        }
      }
    } finally {
      subscription.close()
      session.busy = false
      this.scheduleIdle(sessionId)
    }
  }

  private settleIdle(session: LiveSession): void {
    if (session.status === 'aborted' || session.status === 'closed') return
    session.status = 'idle'
  }

  private async revive(session: LiveSession): Promise<void> {
    this.clearIdle(session)
    this.bridge.cancelSession(session.id)
    if (session.harnessAlive) {
      try {
        await session.harness.close()
      } catch {
        // Replace a dead or aborted subprocess.
      }
    }
    session.harness = this.createHarness()
    await session.harness.start()
    session.harnessAlive = true
    session.status = 'idle'
    session.pendingApprovals.clear()
    session.toolNames.clear()
  }

  private async stopHarness(session: LiveSession): Promise<void> {
    if (!session.harnessAlive) return
    session.harnessAlive = false
    await session.harness.close()
  }

  private scheduleIdle(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || this.idleTtlMs <= 0) return
    this.clearIdle(session)
    session.idleTimer = setTimeout(() => {
      void this.hibernate(sessionId)
    }, this.idleTtlMs)
    session.idleTimer.unref()
  }

  private clearIdle(session: LiveSession): void {
    if (session.idleTimer) clearTimeout(session.idleTimer)
    session.idleTimer = undefined
  }

  private async hibernate(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || session.busy || session.status !== 'idle') return
    try {
      await this.stopHarness(session)
    } catch {
      session.harnessAlive = false
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
          [AGENT_INTERNAL_TOKEN_ENV]: this.internalToken,
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
    if (!session) throw new AgentError('session.unknown', `unknown session ${sessionId}`)
    return session
  }
}
