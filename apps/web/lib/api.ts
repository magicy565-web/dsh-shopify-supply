import type { AgentEvent } from '@dsh-supply/agent-contracts'

const gateway = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:8787'
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${gateway}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: signal ?? AbortSignal.timeout(15000) })
  const data = await response.json()
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message ?? `请求失败（${response.status}）`)
  return data as T
}

export async function streamMessage(session: string, text: string, onEvent: (event: AgentEvent) => void, signal: AbortSignal) {
  const response = await fetch(`${gateway}/v1/sessions/${encodeURIComponent(session)}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal })
  if (!response.ok || !response.body) throw new Error('暂时无法开始分析，请稍后重试。')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  function consume(frame: string) {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (data) onEvent(JSON.parse(data) as AgentEvent)
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
