import type {
  ProcurementDecision,
  ProcurementSnapshot,
  QuoteRequest,
  QuoteRequestItem,
  SourcingCandidate,
  SourcingCase,
  SourcingCaseData,
} from './types.js'

export interface ProcurementRepository {
  listCases(): Promise<SourcingCase[]>
  getCase(caseId: string): Promise<SourcingCaseData | undefined>
  createCase(item: SourcingCase): Promise<void>
  saveCandidate(item: SourcingCase, candidate: SourcingCandidate): Promise<void>
  createQuoteRequest(item: SourcingCase, quote: QuoteRequest, lines: QuoteRequestItem[]): Promise<void>
  approveQuoteRequest(item: SourcingCase, quote: QuoteRequest, decisions: ProcurementDecision[]): Promise<void>
}

export function emptyProcurement(): ProcurementSnapshot {
  return { version: 1, cases: [], candidates: [], quoteRequests: [], quoteRequestItems: [], decisions: [] }
}

function assertMutable(item: SourcingCase): void {
  if (item.status === 'approved' || item.status === 'closed') {
    throw new Error(`sourcing case ${item.id} can no longer be changed`)
  }
}

export abstract class SnapshotProcurementRepository implements ProcurementRepository {
  private mutations: Promise<void> = Promise.resolve()

  protected abstract load(): Promise<ProcurementSnapshot>
  protected abstract save(snapshot: ProcurementSnapshot): Promise<void>

  async listCases(): Promise<SourcingCase[]> {
    return structuredClone((await this.load()).cases)
  }

  async getCase(caseId: string): Promise<SourcingCaseData | undefined> {
    const snapshot = await this.load()
    const item = snapshot.cases.find((entry) => entry.id === caseId)
    if (!item) return undefined
    const quoteRequests = snapshot.quoteRequests.filter((entry) => entry.sourcingCaseId === caseId)
    const quoteIds = new Set(quoteRequests.map((entry) => entry.id))
    return structuredClone({
      item,
      candidates: snapshot.candidates.filter((entry) => entry.sourcingCaseId === caseId),
      quoteRequests,
      quoteRequestItems: snapshot.quoteRequestItems.filter((entry) => quoteIds.has(entry.quoteRequestId)),
      decisions: snapshot.decisions.filter((entry) => entry.sourcingCaseId === caseId),
    })
  }

  async createCase(item: SourcingCase): Promise<void> {
    return this.mutate((snapshot) => { snapshot.cases.push(item) })
  }

  async saveCandidate(item: SourcingCase, candidate: SourcingCandidate): Promise<void> {
    return this.mutate((snapshot) => {
      const caseIndex = snapshot.cases.findIndex((entry) => entry.id === item.id)
      if (caseIndex < 0) throw new Error(`sourcing case disappeared: ${item.id}`)
      assertMutable(snapshot.cases[caseIndex]!)
      snapshot.cases[caseIndex] = item
      const index = snapshot.candidates.findIndex((entry) => entry.sourcingCaseId === candidate.sourcingCaseId && entry.productId === candidate.productId)
      if (index < 0) snapshot.candidates.push(candidate)
      else snapshot.candidates[index] = candidate
    })
  }

  async createQuoteRequest(item: SourcingCase, quote: QuoteRequest, lines: QuoteRequestItem[]): Promise<void> {
    return this.mutate((snapshot) => {
      const caseIndex = snapshot.cases.findIndex((entry) => entry.id === item.id)
      if (caseIndex < 0) throw new Error(`sourcing case disappeared: ${item.id}`)
      assertMutable(snapshot.cases[caseIndex]!)
      snapshot.cases[caseIndex] = item
      snapshot.quoteRequests.push(quote)
      snapshot.quoteRequestItems.push(...lines)
    })
  }

  async approveQuoteRequest(item: SourcingCase, quote: QuoteRequest, decisions: ProcurementDecision[]): Promise<void> {
    return this.mutate((snapshot) => {
      const caseIndex = snapshot.cases.findIndex((entry) => entry.id === item.id)
      const quoteIndex = snapshot.quoteRequests.findIndex((entry) => entry.id === quote.id)
      if (caseIndex < 0 || quoteIndex < 0) throw new Error('sourcing case or quote request disappeared')
      assertMutable(snapshot.cases[caseIndex]!)
      if (snapshot.quoteRequests[quoteIndex]?.status !== 'draft') {
        throw new Error(`quote request ${quote.id} is no longer a draft`)
      }
      snapshot.cases[caseIndex] = item
      snapshot.quoteRequests[quoteIndex] = quote
      snapshot.decisions.push(...decisions)
    })
  }

  private async mutate(change: (snapshot: ProcurementSnapshot) => void): Promise<void> {
    this.mutations = this.mutations.catch(() => undefined).then(async () => {
      const snapshot = await this.load()
      change(snapshot)
      await this.save(snapshot)
    })
    return this.mutations
  }
}

export class InMemoryProcurementRepository extends SnapshotProcurementRepository {
  constructor(private snapshot: ProcurementSnapshot = emptyProcurement()) { super() }

  protected async load(): Promise<ProcurementSnapshot> {
    return structuredClone(this.snapshot)
  }

  protected async save(snapshot: ProcurementSnapshot): Promise<void> {
    this.snapshot = structuredClone(snapshot)
  }
}
