import type {
  ProcurementDecision,
  ProcurementRepository,
  QuoteRequest,
  QuoteRequestItem,
  SourcingCandidate,
  SourcingCase,
  SourcingCaseData,
} from '@dsh-supply/procurement'
import type { PostgresClient } from './client.js'

function sourcingCase(row: Record<string, unknown>): SourcingCase {
  return {
    id: String(row.id),
    title: String(row.title),
    status: row.status as SourcingCase['status'],
    requirements: row.requirements as SourcingCase['requirements'],
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  }
}

export class PostgresProcurementRepository implements ProcurementRepository {
  constructor(private readonly sql: PostgresClient) {}

  async listCases(): Promise<SourcingCase[]> {
    const rows = await this.sql`SELECT id, title, status, requirements, created_at::text AS "createdAt", updated_at::text AS "updatedAt" FROM sourcing_cases ORDER BY updated_at DESC`
    return rows.map(sourcingCase)
  }

  async getCase(caseId: string): Promise<SourcingCaseData | undefined> {
    const cases = await this.sql`SELECT id, title, status, requirements, created_at::text AS "createdAt", updated_at::text AS "updatedAt" FROM sourcing_cases WHERE id = ${caseId}`
    if (cases.length === 0) return undefined
    const [candidates, quotes, lines, decisions] = await Promise.all([
      this.sql`SELECT sourcing_case_id AS "sourcingCaseId", product_id AS "productId", rationale, added_at::text AS "addedAt" FROM sourcing_candidates WHERE sourcing_case_id = ${caseId}`,
      this.sql`SELECT id, sourcing_case_id AS "sourcingCaseId", supplier_id AS "supplierId", status, created_at::text AS "createdAt", updated_at::text AS "updatedAt" FROM quote_requests WHERE sourcing_case_id = ${caseId}`,
      this.sql`SELECT item.quote_request_id AS "quoteRequestId", item.offer_id AS "offerId", item.quantity FROM quote_request_items item JOIN quote_requests request ON request.id = item.quote_request_id WHERE request.sourcing_case_id = ${caseId}`,
      this.sql`SELECT id, sourcing_case_id AS "sourcingCaseId", offer_id AS "offerId", decision, reason, decided_by AS "decidedBy", decided_at::text AS "decidedAt" FROM procurement_decisions WHERE sourcing_case_id = ${caseId}`,
    ])
    return {
      item: sourcingCase(cases[0]!),
      candidates: candidates.map((row) => ({
        sourcingCaseId: String(row.sourcingCaseId),
        productId: String(row.productId),
        rationale: String(row.rationale ?? ''),
        addedAt: String(row.addedAt),
      })),
      quoteRequests: quotes.map((row) => ({
        id: String(row.id),
        sourcingCaseId: String(row.sourcingCaseId),
        supplierId: String(row.supplierId),
        status: row.status as QuoteRequest['status'],
        createdAt: String(row.createdAt),
        updatedAt: String(row.updatedAt),
      })),
      quoteRequestItems: lines.map((row) => ({
        quoteRequestId: String(row.quoteRequestId),
        offerId: String(row.offerId),
        quantity: Number(row.quantity),
      })),
      decisions: decisions.map((row) => ({
        id: String(row.id),
        sourcingCaseId: String(row.sourcingCaseId),
        offerId: String(row.offerId),
        decision: row.decision as ProcurementDecision['decision'],
        reason: String(row.reason ?? ''),
        decidedBy: String(row.decidedBy),
        decidedAt: String(row.decidedAt),
      })),
    }
  }

  async createCase(item: SourcingCase): Promise<void> {
    await this.sql`INSERT INTO sourcing_cases (id, title, status, requirements, created_at, updated_at) VALUES (${item.id}, ${item.title}, ${item.status}, ${this.sql.json(item.requirements)}, ${item.createdAt}, ${item.updatedAt})`
  }

  async saveCandidate(item: SourcingCase, candidate: SourcingCandidate): Promise<void> {
    await this.sql.begin(async (tx) => {
      const changed = await tx`UPDATE sourcing_cases SET status = ${item.status}, updated_at = ${item.updatedAt} WHERE id = ${item.id} AND status NOT IN ('approved', 'closed')`
      if (changed.count !== 1) throw new Error(`sourcing case ${item.id} can no longer be changed`)
      await tx`INSERT INTO sourcing_candidates (sourcing_case_id, product_id, rationale, added_at)
        VALUES (${candidate.sourcingCaseId}, ${candidate.productId}, ${candidate.rationale}, ${candidate.addedAt})
        ON CONFLICT (sourcing_case_id, product_id) DO UPDATE SET rationale = EXCLUDED.rationale`
    })
  }

  async createQuoteRequest(item: SourcingCase, quote: QuoteRequest, lines: QuoteRequestItem[]): Promise<void> {
    await this.sql.begin(async (tx) => {
      const changed = await tx`UPDATE sourcing_cases SET updated_at = ${item.updatedAt} WHERE id = ${item.id} AND status NOT IN ('approved', 'closed')`
      if (changed.count !== 1) throw new Error(`sourcing case ${item.id} can no longer be changed`)
      await tx`INSERT INTO quote_requests (id, sourcing_case_id, supplier_id, status, created_at, updated_at)
        VALUES (${quote.id}, ${quote.sourcingCaseId}, ${quote.supplierId}, ${quote.status}, ${quote.createdAt}, ${quote.updatedAt})`
      for (const line of lines) {
        await tx`INSERT INTO quote_request_items (quote_request_id, offer_id, quantity) VALUES (${line.quoteRequestId}, ${line.offerId}, ${line.quantity})`
      }
    })
  }

  async approveQuoteRequest(item: SourcingCase, quote: QuoteRequest, decisions: ProcurementDecision[]): Promise<void> {
    await this.sql.begin(async (tx) => {
      const changed = await tx`UPDATE quote_requests SET status = 'approved', updated_at = ${quote.updatedAt} WHERE id = ${quote.id} AND sourcing_case_id = ${item.id} AND status = 'draft'`
      if (changed.count !== 1) throw new Error(`quote request ${quote.id} is no longer a draft`)
      const caseChanged = await tx`UPDATE sourcing_cases SET status = 'approved', updated_at = ${item.updatedAt} WHERE id = ${item.id} AND status NOT IN ('approved', 'closed')`
      if (caseChanged.count !== 1) throw new Error(`sourcing case ${item.id} can no longer be approved`)
      for (const decision of decisions) {
        await tx`INSERT INTO procurement_decisions (id, sourcing_case_id, offer_id, decision, reason, decided_by, decided_at)
          VALUES (${decision.id}, ${decision.sourcingCaseId}, ${decision.offerId}, ${decision.decision}, ${decision.reason}, ${decision.decidedBy}, ${decision.decidedAt})`
      }
    })
  }
}
