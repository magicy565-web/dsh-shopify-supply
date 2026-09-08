import type { Context } from '@deepseek-ai/cordis'
import { ASK_TOOL_NAMES } from '@dsh-supply/config'

export const name = 'dsh-supply-policy'
export const inject = ['tools', 'approval']

type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

type ToolExec = {
  name?: string
  toolName?: string
  agent?: { session?: { id?: string } }
  callId?: string
  signal?: AbortSignal
}

type ApprovalReq = {
  toolName?: string
  callId?: string
  reason?: string
  signal?: AbortSignal
  agent?: { session?: { id?: unknown } }
}

function toolNameOf(exec: ToolExec): string {
  return exec.name ?? exec.toolName ?? ''
}

function sessionIdOf(value: { agent?: { session?: { id?: unknown } } }): string | undefined {
  const id = value.agent?.session?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

async function waitForProductDecision(req: ApprovalReq): Promise<ApprovalOutcome> {
  const base = process.env.AGENT_APPROVAL_BRIDGE_URL
  if (!base) return 'unavailable'

  const sessionId = sessionIdOf(req)
  const body = {
    sessionId,
    toolName: req.toolName,
    callId: req.callId,
    reason: req.reason,
  }

  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/wait`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: req.signal,
    })
    if (!response.ok) return 'unavailable'
    const json = (await response.json()) as { outcome?: string }
    if (json.outcome === 'allowed-once' || json.outcome === 'rejected') return json.outcome
    if (json.outcome === 'cancelled') return 'cancelled'
    return 'unavailable'
  } catch {
    return 'unavailable'
  }
}

/**
 * Declares which tools must ask, then answers Harness `approval/request`
 * by waiting on the product approval bridge (not a second permission engine).
 */
export function apply(ctx: Context): void {
  const ask = new Set<string>(ASK_TOOL_NAMES)
  const events = ctx as unknown as {
    on(event: string, listener: (...args: never[]) => unknown): void
  }

  events.on('tools/pre-execute', (async (exec: ToolExec, next: () => Promise<{ kind: string }>) => {
    const name = toolNameOf(exec)
    if (ask.has(name)) {
      return { kind: 'ask', reason: `${name} requires operator approval` }
    }
    return next()
  }) as never)

  events.on('approval/request', (async (
    req: ApprovalReq,
    next: () => Promise<ApprovalOutcome>,
  ): Promise<ApprovalOutcome> => {
    if (!process.env.AGENT_APPROVAL_BRIDGE_URL) return next()
    return waitForProductDecision(req)
  }) as never)
}
