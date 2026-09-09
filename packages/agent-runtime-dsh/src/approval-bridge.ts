import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { ApprovalDecision } from '@dsh-supply/agent-contracts'
import { agentApprovalTimeoutMs } from '@dsh-supply/config'

export type Outcome = 'allowed-once' | 'rejected' | 'cancelled'

type Waiter = {
  id: string
  sessionId: string
  callId?: string
  approvalId?: string
  timer?: ReturnType<typeof setTimeout>
  resolve: (outcome: Outcome) => void
}

export type ApprovalBridgeOptions = {
  token?: string
  timeoutMs?: number
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk as Buffer))
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization
  if (typeof header !== 'string') return undefined
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return match?.[1]
}

function tokensEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Localhost HTTP seam between the DSH plugin answerer and product `approve()`.
 * This is not an approval engine — Harness still owns allow/deny/ask.
 */
export class ApprovalBridge {
  private server: Server | undefined
  private url: string | undefined
  private readonly token: string | undefined
  private readonly timeoutMs: number
  private readonly waiters = new Map<string, Waiter>()
  private readonly byApproval = new Map<string, string>()
  private readonly byCall = new Map<string, string>()
  private readonly buffered = new Map<string, Outcome>()
  private readonly pendingBinds = new Map<string, string[]>()

  constructor(options: ApprovalBridgeOptions = {}) {
    this.token = options.token
    this.timeoutMs = options.timeoutMs ?? agentApprovalTimeoutMs()
  }

  get listenUrl(): string | undefined {
    return this.url
  }

  async start(): Promise<string> {
    if (this.url) return this.url
    this.server = createServer((req, res) => {
      void this.handle(req, res)
    })
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject)
      this.server?.listen(0, '127.0.0.1', () => resolve())
    })
    const address = this.server.address()
    if (!address || typeof address === 'string') {
      throw new Error('approval bridge failed to bind')
    }
    this.url = `http://127.0.0.1:${address.port}`
    return this.url
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.url = undefined
    for (const waiter of this.waiters.values()) this.finish(waiter, 'cancelled')
    this.waiters.clear()
    this.byApproval.clear()
    this.byCall.clear()
    this.buffered.clear()
    this.pendingBinds.clear()
    if (!server) return
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }

  bindApproval(sessionId: string, approvalId: string, callId?: string): void {
    const waiter = this.findWaiter(sessionId, callId)
    if (waiter) {
      this.attach(waiter, approvalId)
      const buffered = this.buffered.get(approvalId)
      if (buffered) {
        this.buffered.delete(approvalId)
        this.finish(waiter, buffered)
      }
      return
    }
    const key = callId ? `${sessionId}:${callId}` : sessionId
    const queued = this.pendingBinds.get(key) ?? []
    queued.push(approvalId)
    this.pendingBinds.set(key, queued)
  }

  resolve(sessionId: string, approvalId: string, decision: ApprovalDecision): void {
    const outcome: Outcome = decision === 'allow' ? 'allowed-once' : 'rejected'
    const waiterId = this.byApproval.get(approvalId)
    const waiter = waiterId ? this.waiters.get(waiterId) : undefined
    if (waiter && waiter.sessionId === sessionId) {
      this.finish(waiter, outcome)
      return
    }
    this.buffered.set(approvalId, outcome)
  }

  cancelSession(sessionId: string): void {
    for (const waiter of [...this.waiters.values()]) {
      if (waiter.sessionId === sessionId) this.finish(waiter, 'cancelled')
    }
    for (const key of [...this.pendingBinds.keys()]) {
      if (key === sessionId || key.startsWith(`${sessionId}:`)) this.pendingBinds.delete(key)
    }
    for (const [approvalId, waiterId] of [...this.byApproval]) {
      if (this.waiters.get(waiterId)?.sessionId === sessionId) {
        this.byApproval.delete(approvalId)
        this.buffered.delete(approvalId)
      }
    }
  }

  private attach(waiter: Waiter, approvalId: string): void {
    waiter.approvalId = approvalId
    this.byApproval.set(approvalId, waiter.id)
  }

  private takePendingBind(sessionId: string, callId?: string): string | undefined {
    if (callId) {
      const exact = this.pendingBinds.get(`${sessionId}:${callId}`)
      const approvalId = exact?.shift()
      if (exact && exact.length === 0) this.pendingBinds.delete(`${sessionId}:${callId}`)
      if (approvalId) return approvalId
    }
    const queued = this.pendingBinds.get(sessionId)
    const approvalId = queued?.shift()
    if (queued && queued.length === 0) this.pendingBinds.delete(sessionId)
    return approvalId
  }

  private findWaiter(sessionId: string, callId?: string): Waiter | undefined {
    if (callId) {
      const id = this.byCall.get(`${sessionId}:${callId}`)
      if (id) return this.waiters.get(id)
    }
    return [...this.waiters.values()].find((waiter) => (
      waiter.sessionId === sessionId && waiter.approvalId === undefined
    ))
  }

  private finish(waiter: Waiter, outcome: Outcome): void {
    if (!this.waiters.has(waiter.id)) return
    if (waiter.timer) clearTimeout(waiter.timer)
    this.waiters.delete(waiter.id)
    if (waiter.approvalId) this.byApproval.delete(waiter.approvalId)
    if (waiter.callId) this.byCall.delete(`${waiter.sessionId}:${waiter.callId}`)
    waiter.resolve(outcome)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host ?? '127.0.0.1'
    const url = new URL(req.url ?? '/', `http://${host}`)
    res.setHeader('content-type', 'application/json')

    if (req.method === 'GET' && url.pathname === '/health') {
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (req.method === 'POST' && url.pathname === '/wait') {
      if (this.token) {
        const provided = bearerToken(req)
        if (!provided || !tokensEqual(provided, this.token)) {
          res.statusCode = 401
          res.end(JSON.stringify({ error: 'unauthorized', outcome: 'unavailable' }))
          return
        }
      }
      const body = await readJson(req)
      const sessionId = typeof body.sessionId === 'string' && body.sessionId.length > 0
        ? body.sessionId
        : `anon-${randomUUID()}`
      const callId = typeof body.callId === 'string' && body.callId.length > 0 ? body.callId : undefined
      const approvalId = typeof body.approvalId === 'string' && body.approvalId.length > 0
        ? body.approvalId
        : undefined

      const claimed = approvalId ?? this.takePendingBind(sessionId, callId)
      if (claimed) {
        const buffered = this.buffered.get(claimed)
        if (buffered) {
          this.buffered.delete(claimed)
          res.end(JSON.stringify({ outcome: buffered }))
          return
        }
      }

      const outcome = await new Promise<Outcome>((resolve) => {
        const waiter: Waiter = {
          id: randomUUID(),
          sessionId,
          callId,
          approvalId: claimed,
          resolve,
        }
        this.waiters.set(waiter.id, waiter)
        if (callId) this.byCall.set(`${sessionId}:${callId}`, waiter.id)
        if (claimed) this.byApproval.set(claimed, waiter.id)
        if (this.timeoutMs > 0) {
          waiter.timer = setTimeout(() => this.finish(waiter, 'cancelled'), this.timeoutMs)
          waiter.timer.unref()
        }
        if (claimed) {
          const buffered = this.buffered.get(claimed)
          if (buffered) {
            this.buffered.delete(claimed)
            this.finish(waiter, buffered)
          }
        }
      })
      res.end(JSON.stringify({ outcome }))
      return
    }

    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  }
}
