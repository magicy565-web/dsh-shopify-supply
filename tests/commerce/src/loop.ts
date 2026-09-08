import assert from 'node:assert/strict'
import { CatalogService, InMemoryCatalogRepository, parseCatalogCsv } from '@dsh-supply/catalog'
import {
  CommerceInputError,
  CommerceService,
  FixtureShopifyStore,
  InMemoryCommerceRepository,
  JsonCommerceRepository,
} from '@dsh-supply/commerce'
import { InMemoryProcurementRepository, ProcurementService } from '@dsh-supply/procurement'
import type { SalesOrderView } from '@dsh-supply/commerce'

export const SAMPLE_CATALOG_CSV = `product_sku,title,description,category,tags,variant_sku,variant_options,supplier_code,supplier_name,supplier_country,currency,unit_price,moq,lead_time_days,stock,shipping_flat
WB-100,Insulated Bottle,Steel bottle,Drinkware,bottle,WB-100-BLK,Color=Black,SUP-A,Supplier A,CN,USD,4.20,24,7,480,38
WB-100,Insulated Bottle,Steel bottle,Drinkware,bottle,WB-100-BLK,Color=Black,SUP-B,Supplier B,CN,USD,3.95,50,11,1200,52
LB-210,Laptop Sleeve,Canvas sleeve,Bags,laptop,LB-210-NAT,Color=Natural,SUP-C,Supplier C,CN,USD,5.80,20,9,260,45`

export function sampleCatalog() {
  return parseCatalogCsv(SAMPLE_CATALOG_CSV)
}

export function memoryStack(shopify = new FixtureShopifyStore()): {
  catalog: CatalogService
  procurement: ProcurementService
  commerce: CommerceService
} {
  const catalog = new CatalogService(new InMemoryCatalogRepository(sampleCatalog()))
  const procurement = new ProcurementService(new InMemoryProcurementRepository(), catalog)
  const commerce = new CommerceService(new InMemoryCommerceRepository(), catalog, procurement, shopify)
  return { catalog, procurement, commerce }
}

export async function approveBottleCase(procurement: ProcurementService): Promise<string> {
  const created = await procurement.createCase({
    title: 'US bottle launch',
    requirements: { query: 'bottle', quantity: 25, destinationCountry: 'US' },
  })
  await procurement.addCandidate(created.id, 'WB-100', 'Dropship candidate')
  const quoted = await procurement.draftQuoteRequest(created.id, {
    supplierId: 'supplier-sup-a',
    offerIds: ['offer-wb-100-sup-a-wb-100-blk'],
    quantity: 25,
  })
  await procurement.approveQuoteRequest(created.id, quoted.quoteRequests[0]!.id, 'operator@example.test')
  return created.id
}

export async function assertCommerceClosedLoop(commerce: CommerceService, sourcingCaseId: string): Promise<SalesOrderView> {
  const listings = await commerce.createListingsFromCase({ sourcingCaseId })
  assert.equal(listings.length, 1)
  assert.equal(listings[0]?.sku, 'WB-100-BLK')
  assert.equal(listings[0]?.shopifyProductId?.includes('fixture'), true)
  assert.equal(listings[0]?.offer.supplier.code, 'SUP-A')

  const again = await commerce.createListingsFromCase({ sourcingCaseId })
  assert.equal(again[0]?.id, listings[0]?.id)

  await assert.rejects(
    () => commerce.ingestOrder({
      shopifyOrderId: 'sim-unknown-sku',
      lines: [{ sku: 'NOT-A-LISTING', quantity: 1 }],
    }),
    CommerceInputError,
  )

  const order = await commerce.simulateShopifyOrder(listings[0]!.id, 1, 'US')
  assert.equal(order.status, 'routed')
  assert.equal(order.purchaseOrders.length, 1)
  assert.equal(order.purchaseOrders[0]?.status, 'created')
  assert.equal(order.lines[0]?.sku, 'WB-100-BLK')
  assert.match(order.purchaseOrders[0]?.warnings[0] ?? '', /MOQ/)

  const confirmed = await commerce.confirmPurchaseOrder(order.id, order.purchaseOrders[0]!.id)
  assert.equal(confirmed.purchaseOrders[0]?.status, 'confirmed')

  const shipped = await commerce.shipPurchaseOrder(order.id, order.purchaseOrders[0]!.id, '1Z999AA10123456784', 'UPS')
  assert.equal(shipped.status, 'fulfilled')
  assert.equal(shipped.purchaseOrders[0]?.status, 'shipped')
  assert.equal(shipped.purchaseOrders[0]?.trackingNumber, '1Z999AA10123456784')
  assert.equal(shipped.shopifyFulfillment?.trackingNumber, '1Z999AA10123456784')
  assert.equal(await commerce.shopify.getFulfillment(shipped.shopifyOrderId).then((item) => item?.trackingCompany), 'UPS')

  await assert.rejects(
    () => commerce.shipPurchaseOrder(order.id, order.purchaseOrders[0]!.id, 'OTHER', 'UPS'),
    CommerceInputError,
  )

  const duplicate = await commerce.ingestOrder({
    shopifyOrderId: shipped.shopifyOrderId,
    lines: [{ listingId: listings[0]!.id, quantity: 1 }],
  })
  assert.equal(duplicate.id, shipped.id)
  return shipped
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

export async function assertCommerceClosedLoopHttp(baseUrl: string, sourcingCaseId: string): Promise<SalesOrderView> {
  const health = await requestJson<{ ok: boolean; shopify: string }>(baseUrl, 'GET', '/health')
  assert.equal(health.ok, true)
  assert.equal(health.shopify, 'fixture')

  const listed = await requestJson<{ items: Array<{ id: string; sku: string }> }>(baseUrl, 'POST', '/v1/commerce/listings', {
    sourcingCaseId,
  })
  assert.equal(listed.items.length, 1)

  await assert.rejects(
    () => requestJson(baseUrl, 'POST', '/v1/commerce/shopify/webhooks/orders-create', {
      id: 'webhook-unknown',
      line_items: [{ sku: 'NOT-A-LISTING', quantity: 1 }],
      shipping_address: { country_code: 'US' },
    }),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  )

  const order = await requestJson<SalesOrderView>(baseUrl, 'POST', '/v1/commerce/orders/simulate', {
    listingId: listed.items[0]!.id,
    quantity: 1,
    destinationCountry: 'US',
  })
  assert.equal(order.status, 'routed')

  const shipped = await requestJson<SalesOrderView>(
    baseUrl,
    'POST',
    `/v1/commerce/orders/${order.id}/purchase-orders/${order.purchaseOrders[0]!.id}/ship`,
    { trackingNumber: '1Z999AA10123456784', trackingCompany: 'UPS' },
  )
  assert.equal(shipped.status, 'fulfilled')
  assert.equal(shipped.shopifyFulfillment?.trackingNumber, '1Z999AA10123456784')
  return shipped
}

export function jsonCommerce(filePath: string, catalog: CatalogService, procurement: ProcurementService): CommerceService {
  return new CommerceService(new JsonCommerceRepository(filePath), catalog, procurement, new FixtureShopifyStore())
}
