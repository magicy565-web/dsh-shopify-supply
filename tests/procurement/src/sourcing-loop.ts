import assert from 'node:assert/strict'
import { CatalogService, InMemoryCatalogRepository, parseCatalogCsv } from '@dsh-supply/catalog'
import {
  InMemoryProcurementRepository,
  ProcurementInputError,
  ProcurementService,
  type SourcingCaseView,
} from '@dsh-supply/procurement'

export const SAMPLE_CATALOG_CSV = `product_sku,title,description,category,tags,variant_sku,variant_options,supplier_code,supplier_name,supplier_country,currency,unit_price,moq,lead_time_days,stock,shipping_flat
WB-100,Insulated Bottle,Steel bottle,Drinkware,bottle,WB-100-BLK,Color=Black,SUP-A,Supplier A,CN,USD,4.20,24,7,480,38
WB-100,Insulated Bottle,Steel bottle,Drinkware,bottle,WB-100-BLK,Color=Black,SUP-B,Supplier B,CN,USD,3.95,50,11,1200,52
LB-210,Laptop Sleeve,Canvas sleeve,Bags,laptop,LB-210-NAT,Color=Natural,SUP-C,Supplier C,CN,USD,5.80,20,9,260,45`

export const IN_SCOPE_OFFER_ID = 'offer-wb-100-sup-a-wb-100-blk'
export const OUT_OF_SCOPE_OFFER_ID = 'offer-lb-210-sup-c-lb-210-nat'
export const IN_SCOPE_SUPPLIER_ID = 'supplier-sup-a'
export const OUT_OF_SCOPE_SUPPLIER_ID = 'supplier-sup-c'

export function sampleCatalog(): ReturnType<typeof parseCatalogCsv> {
  return parseCatalogCsv(SAMPLE_CATALOG_CSV)
}

export function memoryProcurement(): { catalog: CatalogService; procurement: ProcurementService } {
  const catalog = new CatalogService(new InMemoryCatalogRepository(sampleCatalog()))
  return { catalog, procurement: new ProcurementService(new InMemoryProcurementRepository(), catalog) }
}

export async function assertSourcingClosedLoop(procurement: ProcurementService): Promise<SourcingCaseView> {
  const created = await procurement.createCase({
    title: 'US bottle launch',
    requirements: { query: 'bottle', quantity: 25, destinationCountry: 'us', maxLeadTimeDays: 10 },
  })
  assert.equal(created.status, 'draft')
  assert.equal(created.requirements.destinationCountry, 'US')

  const shortlisted = await procurement.addCandidate(created.id, 'WB-100', 'Best match for requested category')
  assert.equal(shortlisted.status, 'shortlisted')
  assert.equal(shortlisted.candidates.length, 1)
  assert.equal(shortlisted.candidates[0]?.product.sku, 'WB-100')

  await assert.rejects(() => procurement.draftQuoteRequest(created.id, {
    supplierId: OUT_OF_SCOPE_SUPPLIER_ID,
    offerIds: [OUT_OF_SCOPE_OFFER_ID],
    quantity: 25,
  }), ProcurementInputError)

  const withQuote = await procurement.draftQuoteRequest(created.id, {
    supplierId: IN_SCOPE_SUPPLIER_ID,
    offerIds: [IN_SCOPE_OFFER_ID],
    quantity: 25,
  })
  assert.equal(withQuote.quoteRequests.length, 1)
  assert.equal(withQuote.quoteRequests[0]?.status, 'draft')

  const approved = await procurement.approveQuoteRequest(
    created.id,
    withQuote.quoteRequests[0]!.id,
    'operator@example.test',
    'Approved after MOQ and lead-time review',
  )
  assert.equal(approved.status, 'approved')
  assert.equal(approved.quoteRequests[0]?.status, 'approved')
  assert.equal(approved.decisions[0]?.decision, 'selected')

  await assert.rejects(() => procurement.addCandidate(created.id, 'LB-210'), ProcurementInputError)
  await assert.rejects(() => procurement.draftQuoteRequest(created.id, {
    supplierId: IN_SCOPE_SUPPLIER_ID,
    offerIds: [IN_SCOPE_OFFER_ID],
    quantity: 25,
  }), ProcurementInputError)

  const locked = await procurement.getCase(created.id)
  assert.equal(locked.status, 'approved')
  return locked
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

export async function requestJson<T>(baseUrl: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const value = await response.json() as { error?: string } & T
  if (!response.ok) throw new HttpError(response.status, value.error ?? `HTTP ${response.status}`)
  return value
}

export async function assertSourcingClosedLoopHttp(baseUrl: string): Promise<SourcingCaseView> {
  const health = await requestJson<{ ok: boolean; storage: string }>(baseUrl, 'GET', '/health')
  assert.equal(health.ok, true)
  assert.ok(health.storage === 'json' || health.storage === 'postgres')

  const created = await requestJson<SourcingCaseView>(baseUrl, 'POST', '/v1/sourcing/cases', {
    title: 'US bottle launch',
    query: 'bottle',
    quantity: 25,
    destinationCountry: 'us',
    maxLeadTimeDays: 10,
  })
  assert.equal(created.status, 'draft')
  assert.equal(created.requirements.destinationCountry, 'US')

  const shortlisted = await requestJson<SourcingCaseView>(baseUrl, 'POST', `/v1/sourcing/cases/${created.id}/candidates`, {
    productId: 'WB-100',
    rationale: 'Best match for requested category',
  })
  assert.equal(shortlisted.status, 'shortlisted')
  assert.equal(shortlisted.candidates.length, 1)

  await assert.rejects(
    () => requestJson(baseUrl, 'POST', `/v1/sourcing/cases/${created.id}/quote-requests`, {
      supplierId: OUT_OF_SCOPE_SUPPLIER_ID,
      offerIds: [OUT_OF_SCOPE_OFFER_ID],
      quantity: 25,
    }),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  )

  const withQuote = await requestJson<SourcingCaseView>(baseUrl, 'POST', `/v1/sourcing/cases/${created.id}/quote-requests`, {
    supplierId: IN_SCOPE_SUPPLIER_ID,
    offerIds: [IN_SCOPE_OFFER_ID],
    quantity: 25,
  })
  assert.equal(withQuote.quoteRequests[0]?.status, 'draft')

  const approved = await requestJson<SourcingCaseView>(
    baseUrl,
    'POST',
    `/v1/sourcing/cases/${created.id}/quote-requests/${withQuote.quoteRequests[0]!.id}/approve`,
    { decidedBy: 'operator@example.test', reason: 'Approved after MOQ and lead-time review' },
  )
  assert.equal(approved.status, 'approved')
  assert.equal(approved.quoteRequests[0]?.status, 'approved')

  await assert.rejects(
    () => requestJson(baseUrl, 'POST', `/v1/sourcing/cases/${created.id}/candidates`, { productId: 'LB-210' }),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  )

  const locked = await requestJson<SourcingCaseView>(baseUrl, 'GET', `/v1/sourcing/cases/${created.id}`)
  assert.equal(locked.status, 'approved')
  return locked
}
