import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { ApprovalDecision } from '@dsh-supply/agent-contracts'

type Outcome = 'allowed-once' | 'rejected' | 'cancelled'

type Waiter = {
  sessionId: string
  approvalId?: string
  resolve: (outcome: Outcome) => void
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

/**
 * Localhost HTTP seam between the DSH plugin answerer and product `approve()`.
 * This is not an approval engine — Harness still owns allow/deny/ask.
 */
export class ApprovalBridge {
  private server: Server | undefined
  private url: string | undefined
  private readonly bySession = new Map<string, Waiter>()
  private readonly byApproval = new Map<string, string>()
  private readonly buffered = new Map<string, Outcome>()

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
    for (const waiter of this.bySession.values()) waiter.resolve('cancelled')
    this.bySession.clear()
    this.byApproval.clear()
    this.buffered.clear()
    if (!server) return
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }

  bindApproval(sessionId: string, approvalId: string): void {
    this.byApproval.set(approvalId, sessionId)
    const waiter = this.bySession.get(sessionId)
    if (waiter) waiter.approvalId = approvalId
  }

  resolve(sessionId: string, approvalId: string, decision: ApprovalDecision): void {
    if (this.byApproval.get(approvalId) !== sessionId) {
      throw new Error(`no pending approval ${approvalId} on ${sessionId}`)
    }
    const outcome: Outcome = decision === 'allow' ? 'allowed-once' : 'rejected'
    const waiter = this.bySession.get(sessionId)
    if (waiter) {
      this.bySession.delete(sessionId)
      this.byApproval.delete(approvalId)
      waiter.resolve(outcome)
      return
    }
    this.buffered.set(sessionId, outcome)
    this.buffered.set(approvalId, outcome)
  }

  cancelSession(sessionId: string): void {
    const waiter = this.bySession.get(sessionId)
    this.bySession.delete(sessionId)
    this.buffered.delete(sessionId)
    if (waiter?.approvalId) {
      this.byApproval.delete(waiter.approvalId)
      this.buffered.delete(waiter.approvalId)
    }
    for (const [approvalId, owner] of this.byApproval) {
      if (owner === sessionId) {
        this.byApproval.delete(approvalId)
        this.buffered.delete(approvalId)
      }
    }
    waiter?.resolve('cancelled')
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
      const body = await readJson(req)
      const sessionId = typeof body.sessionId === 'string' && body.sessionId.length > 0
        ? body.sessionId
        : `anon-${randomUUID()}`
      const buffered = this.buffered.get(sessionId)
      if (buffered) {
        this.buffered.delete(sessionId)
        const approvalId = [...this.byApproval].find(([, owner]) => owner === sessionId)?.[0]
        if (approvalId) {
          this.buffered.delete(approvalId)
          this.byApproval.delete(approvalId)
        }
        res.end(JSON.stringify({ outcome: buffered }))
        return
      }
      const outcome = await new Promise<Outcome>((resolve) => {
        this.bySession.set(sessionId, { sessionId, resolve })
      })
      res.end(JSON.stringify({ outcome }))
      return
    }

    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  }
}
