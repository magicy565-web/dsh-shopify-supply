import { randomUUID } from 'node:crypto'
import type { CatalogService, HydratedOffer } from '@dsh-supply/catalog'
import type { ProcurementRepository } from './repository.js'
import type {
  CreateSourcingCaseInput,
  DraftQuoteRequestInput,
  ProcurementDecision,
  QuoteRequest,
  SourcingCandidate,
  SourcingCase,
  SourcingCaseData,
  SourcingCaseView,
} from './types.js'

export class ProcurementInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProcurementInputError'
  }
}

export class ProcurementNotFoundError extends Error {
  constructor(kind: string, id: string) {
    super(`${kind} not found: ${id}`)
    this.name = 'ProcurementNotFoundError'
  }
}

function now(): string {
  return new Date().toISOString()
}

function required(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new ProcurementInputError(`${label} is required`)
  return normalized
}

export class ProcurementService {
  constructor(
    private readonly repository: ProcurementRepository,
    private readonly catalog: CatalogService,
  ) {}

  async createCase(input: CreateSourcingCaseInput): Promise<SourcingCaseView> {
    if (!Number.isInteger(input.requirements.quantity) || input.requirements.quantity <= 0) {
      throw new ProcurementInputError('quantity must be a positive integer')
    }
    const timestamp = now()
    const item: SourcingCase = {
      id: `sourcing-${randomUUID()}`,
      title: required(input.title, 'title'),
      status: 'draft',
      requirements: {
        ...input.requirements,
        query: required(input.requirements.query, 'query'),
        destinationCountry: required(input.requirements.destinationCountry, 'destinationCountry').toUpperCase(),
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await this.repository.createCase(item)
    return this.getCase(item.id)
  }

  async listCases(): Promise<SourcingCaseView[]> {
    return Promise.all((await this.repository.listCases())
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((item) => this.getCase(item.id)))
  }

  async getCase(caseId: string): Promise<SourcingCaseView> {
    const data = await this.repository.getCase(caseId)
    if (!data) throw new ProcurementNotFoundError('sourcing case', caseId)
    return this.hydrate(data)
  }

  async addCandidate(caseId: string, productId: string, rationale = ''): Promise<SourcingCaseView> {
    const product = await this.catalog.getProduct(required(productId, 'productId'))
    const data = await this.repository.getCase(caseId)
    if (!data) throw new ProcurementNotFoundError('sourcing case', caseId)
    const item = data.item
    if (item.status === 'closed' || item.status === 'approved') throw new ProcurementInputError(`cannot change a ${item.status} sourcing case`)
    const existing = data.candidates.find((entry) => entry.sourcingCaseId === caseId && entry.productId === product.id)
    let candidate: SourcingCandidate
    if (existing) existing.rationale = rationale.trim() || existing.rationale
    candidate = existing ?? { sourcingCaseId: caseId, productId: product.id, rationale: rationale.trim(), addedAt: now() }
    item.status = 'shortlisted'
    item.updatedAt = now()
    await this.repository.saveCandidate(item, candidate)
    return this.getCase(caseId)
  }

  async draftQuoteRequest(caseId: string, input: DraftQuoteRequestInput): Promise<SourcingCaseView> {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new ProcurementInputError('quantity must be a positive integer')
    if (input.offerIds.length === 0) throw new ProcurementInputError('offerIds must not be empty')
    const data = await this.repository.getCase(caseId)
    if (!data) throw new ProcurementNotFoundError('sourcing case', caseId)
    const item = data.item
    if (item.status === 'closed' || item.status === 'approved') throw new ProcurementInputError(`cannot change a ${item.status} sourcing case`)
    const offerIds = [...new Set(input.offerIds)]
    if (offerIds.length !== input.offerIds.length) throw new ProcurementInputError('offerIds must not contain duplicates')
    const offers = await this.offersForCandidates(data.candidates)
    const selected = offerIds.map((offerId) => {
      const offer = offers.get(offerId)
      if (!offer) throw new ProcurementInputError(`offer ${offerId} is not attached to a candidate product`)
      if (offer.supplierId !== input.supplierId) throw new ProcurementInputError(`offer ${offerId} does not belong to supplier ${input.supplierId}`)
      return offer
    })
    const timestamp = now()
    const quote: QuoteRequest = {
      id: `quote-${randomUUID()}`,
      sourcingCaseId: caseId,
      supplierId: required(input.supplierId, 'supplierId'),
      status: 'draft',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const lines = selected.map((offer) => ({ quoteRequestId: quote.id, offerId: offer.id, quantity: input.quantity }))
    item.updatedAt = timestamp
    await this.repository.createQuoteRequest(item, quote, lines)
    return this.getCase(caseId)
  }

  async approveQuoteRequest(caseId: string, quoteRequestId: string, decidedBy: string, reason = ''): Promise<SourcingCaseView> {
    const data = await this.repository.getCase(caseId)
    if (!data) throw new ProcurementNotFoundError('sourcing case', caseId)
    const item = data.item
    const quote = data.quoteRequests.find((entry) => entry.id === quoteRequestId && entry.sourcingCaseId === caseId)
    if (!quote) throw new ProcurementNotFoundError('quote request', quoteRequestId)
    if (quote.status !== 'draft') throw new ProcurementInputError(`quote request is already ${quote.status}`)
    const timestamp = now()
    quote.status = 'approved'
    quote.updatedAt = timestamp
    item.status = 'approved'
    item.updatedAt = timestamp
    const decisions: ProcurementDecision[] = data.quoteRequestItems
      .filter((entry) => entry.quoteRequestId === quote.id)
      .map((entry) => ({
        id: `decision-${randomUUID()}`,
        sourcingCaseId: caseId,
        offerId: entry.offerId,
        decision: 'selected',
        reason: reason.trim(),
        decidedBy: required(decidedBy, 'decidedBy'),
        decidedAt: timestamp,
      }))
    await this.repository.approveQuoteRequest(item, quote, decisions)
    return this.getCase(caseId)
  }

  private async offersForCandidates(candidates: SourcingCandidate[]): Promise<Map<string, HydratedOffer>> {
    const products = await Promise.all(candidates.map((candidate) => this.catalog.getProduct(candidate.productId)))
    return new Map(products.flatMap((product) => product.offers).map((offer) => [offer.id, offer]))
  }

  private async hydrate(data: SourcingCaseData): Promise<SourcingCaseView> {
    const candidates = await Promise.all(data.candidates.map(async (entry) => ({ ...entry, product: await this.catalog.getProduct(entry.productId) })))
    const quoteRequests = data.quoteRequests
      .map((entry) => ({ ...entry, items: data.quoteRequestItems.filter((line) => line.quoteRequestId === entry.id) }))
    return {
      ...data.item,
      candidates,
      quoteRequests,
      decisions: data.decisions,
    }
  }
}
