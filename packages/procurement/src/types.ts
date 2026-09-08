import type { CatalogProduct } from '@dsh-supply/catalog'

export type SourcingCaseStatus = 'draft' | 'researching' | 'shortlisted' | 'approved' | 'closed'
export type QuoteRequestStatus = 'draft' | 'approved' | 'sent' | 'responded' | 'cancelled'

export type SourcingRequirements = {
  query: string
  quantity: number
  destinationCountry: string
  targetUnitPrice?: number
  maxLeadTimeDays?: number
}

export type SourcingCase = {
  id: string
  title: string
  status: SourcingCaseStatus
  requirements: SourcingRequirements
  createdAt: string
  updatedAt: string
}

export type SourcingCandidate = {
  sourcingCaseId: string
  productId: string
  rationale: string
  addedAt: string
}

export type QuoteRequest = {
  id: string
  sourcingCaseId: string
  supplierId: string
  status: QuoteRequestStatus
  createdAt: string
  updatedAt: string
}

export type QuoteRequestItem = {
  quoteRequestId: string
  offerId: string
  quantity: number
}

export type ProcurementDecision = {
  id: string
  sourcingCaseId: string
  offerId: string
  decision: 'selected' | 'rejected'
  reason: string
  decidedBy: string
  decidedAt: string
}

export type ProcurementSnapshot = {
  version: 1
  cases: SourcingCase[]
  candidates: SourcingCandidate[]
  quoteRequests: QuoteRequest[]
  quoteRequestItems: QuoteRequestItem[]
  decisions: ProcurementDecision[]
}

export type SourcingCandidateView = SourcingCandidate & { product: CatalogProduct }
export type QuoteRequestView = QuoteRequest & { items: QuoteRequestItem[] }
export type SourcingCaseView = SourcingCase & {
  candidates: SourcingCandidateView[]
  quoteRequests: QuoteRequestView[]
  decisions: ProcurementDecision[]
}

export type CreateSourcingCaseInput = {
  title: string
  requirements: SourcingRequirements
}

export type DraftQuoteRequestInput = {
  supplierId: string
  offerIds: string[]
  quantity: number
}

export type SourcingCaseData = {
  item: SourcingCase
  candidates: SourcingCandidate[]
  quoteRequests: QuoteRequest[]
  quoteRequestItems: QuoteRequestItem[]
  decisions: ProcurementDecision[]
}
