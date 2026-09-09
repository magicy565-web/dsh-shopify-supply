export class IdempotencyConflictError extends Error {
  constructor(key: string) {
    super(`idempotency key conflict: ${key}`)
    this.name = 'IdempotencyConflictError'
  }
}

type Stored = {
  fingerprint: string
  status: number
  body: unknown
}

type InFlight = {
  fingerprint: string
  waiters: Array<(result: { status: number; body: unknown } | { error: unknown }) => void>
}

export class IdempotencyStore {
  private readonly done = new Map<string, Stored>()
  private readonly pending = new Map<string, InFlight>()

  async execute(
    key: string | undefined,
    fingerprint: string,
    run: () => Promise<{ status: number; body: unknown }>,
  ): Promise<{ status: number; body: unknown }> {
    if (!key) return run()

    const stored = this.done.get(key)
    if (stored) {
      if (stored.fingerprint !== fingerprint) throw new IdempotencyConflictError(key)
      return { status: stored.status, body: stored.body }
    }

    const inFlight = this.pending.get(key)
    if (inFlight) {
      if (inFlight.fingerprint !== fingerprint) throw new IdempotencyConflictError(key)
      return new Promise((resolve, reject) => {
        inFlight.waiters.push((result) => {
          if ('error' in result) reject(result.error)
          else resolve(result)
        })
      })
    }

    const waiters: InFlight['waiters'] = []
    this.pending.set(key, { fingerprint, waiters })
    try {
      const result = await run()
      this.done.set(key, { fingerprint, status: result.status, body: result.body })
      this.pending.delete(key)
      for (const waiter of waiters) waiter(result)
      return result
    } catch (error) {
      this.pending.delete(key)
      for (const waiter of waiters) waiter({ error })
      throw error
    }
  }
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(',')}}`
}
