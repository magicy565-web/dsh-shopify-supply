import type { AgentErrorCode, AgentEvent } from '@dsh-supply/agent-contracts'

const gateway = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:8787'
export const TOKEN_KEY = 'supply.community.token'

export function readToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

export function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* Session token is optional if storage is blocked. */ }
}

export class GatewayError extends Error {
  readonly code?: AgentErrorCode | string
  readonly status?: number

  constructor(message: string, code?: AgentErrorCode | string, status?: number) {
    super(message)
    this.name = 'GatewayError'
    this.code = code
    this.status = status
  }
}

export function isRecoverableSessionError(error: unknown): boolean {
  const code = error instanceof GatewayError ? error.code : undefined
  return code === 'session.unknown' || code === 'session.closed' || code === 'session.aborted'
}

export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = {}
  const token = typeof window !== 'undefined' ? readToken() : null
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${gateway}${path}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), signal: signal ?? AbortSignal.timeout(30000) })
  const data = await response.json() as { error?: string | { message?: string }; code?: string }
  if (!response.ok) {
    const message = typeof data.error === 'string' ? data.error : data.error?.message ?? `请求失败（${response.status}）`
    throw new GatewayError(message, data.code, response.status)
  }
  return data as T
}

export async function streamMessage(session: string, text: string, onEvent: (event: AgentEvent) => void, signal: AbortSignal, launch = false) {
  const path = launch ? `/v1/launch/runs/${encodeURIComponent(session)}/start` : `/v1/sessions/${encodeURIComponent(session)}/messages`
  const token = readToken()
  const response = await fetch(`${gateway}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ text }), signal })
  if (!response.ok || !response.body) {
    let code: string | undefined
    try {
      const data = await response.json() as { error?: string; code?: string }
      code = data.code
      throw new GatewayError(data.error ?? '暂时无法开始分析，请稍后重试。', code, response.status)
    } catch (error) {
      if (error instanceof GatewayError) throw error
      throw new GatewayError('暂时无法开始分析，请稍后重试。', code, response.status)
    }
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  function consume(frame: string) {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (!data) return
    const event = JSON.parse(data) as AgentEvent
    if (event.type === 'agent.failed') {
      throw new GatewayError(event.message, event.code)
    }
    onEvent(event)
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() ?? ''
      frames.forEach(consume)
      if (done) { if (buffer.trim()) consume(buffer); break }
    }
  } finally { reader.releaseLock() }
}
