import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AgentEvent, ApprovalDecision } from '@dsh-supply/agent-contracts'
import type { AgentRuntime } from '@dsh-supply/agent-runtime'
import { InspirationInputError, InspirationNotFoundError, type InspirationService } from './inspiration.js'
import {
  CatalogCsvError,
  CatalogInputError,
  CatalogNotFoundError,
  CatalogService,
  CatalogValidationError,
  parseCatalogCsv,
} from '@dsh-supply/catalog'
import {
  CommerceInputError,
  CommerceNotFoundError,
  CommerceService,
  CommerceValidationError,
} from '@dsh-supply/commerce'
import {
  ProcurementInputError,
  ProcurementNotFoundError,
  ProcurementService,
  ProcurementValidationError,
} from '@dsh-supply/procurement'

export type StorageKind = 'json' | 'postgres'

export type GatewayApp = {
  storage: StorageKind
  catalog: CatalogService
  procurement: ProcurementService
  commerce: CommerceService
  inspiration: InspirationService
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>
}

export function createGatewayApp(options: {
  runtime: AgentRuntime
  catalog: CatalogService
  procurement: ProcurementService
  commerce: CommerceService
  inspiration: InspirationService
  storage: StorageKind
  origin: string
  catalogImportEnabled?: boolean
  runtimeKind?: string
}): GatewayApp {
  const catalogImportEnabled = options.catalogImportEnabled === true

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    cors(res, options.origin)
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    const host = req.headers.host ?? '127.0.0.1'
    const url = new URL(req.url ?? '/', `http://${host}`)
    const path = url.pathname

    try {
      if (req.method === 'GET' && path === '/health') {
        json(res, 200, {
          ok: true,
          runtime: options.runtimeKind ?? 'in-memory',
          storage: options.storage,
          shopify: options.commerce.shopify.kind,
        })
        return
      }

      if (req.method === 'GET' && path === '/v1/inspiration/projects') { json(res, 200, { items: await options.inspiration.list() }); return }
      const inspirationMatch = /^\/v1\/inspiration\/projects\/([^/]+)$/.exec(path)
      if (req.method === 'GET' && inspirationMatch) { const id = decodeURIComponent(inspirationMatch[1] ?? ''); json(res, 200, { project: await options.inspiration.get(id), viewer: await options.inspiration.viewerState(id) }); return }
      if (req.method === 'POST' && path === '/v1/inspiration/projects') { json(res, 201, { project: await options.inspiration.create(await readJson(req)) }); return }
      if (req.method === 'POST' && inspirationMatch) {
        const id = decodeURIComponent(inspirationMatch[1] ?? ''), body = await readJson(req)
        if (body.action === 'delete') { json(res, 200, await options.inspiration.remove(id)); return }
        if (body.action === 'save' || body.action === 'follow') { json(res, 200, await options.inspiration.toggle(id, body.action === 'save' ? 'saved' : 'following')); return }
        if (body.action === 'comment') { json(res, 201, { comment: await options.inspiration.comment(id, stringField(body, 'text')) }); return }
        if (body.action === 'update') { json(res, 201, { project: await options.inspiration.updateProgress(id, stringField(body, 'title'), stringField(body, 'body')) }); return }
        json(res, 200, { project: await options.inspiration.update(id, body) }); return
      }

      if (req.method === 'GET' && path === '/v1/catalog/products') {
        const result = await options.catalog.search({
          query: url.searchParams.get('query') ?? undefined,
          category: url.searchParams.get('category') ?? undefined,
          maxUnitPrice: queryNumber(url, 'maxUnitPrice'),
          maxMoq: queryNumber(url, 'maxMoq'),
          maxLeadTimeDays: queryNumber(url, 'maxLeadTimeDays'),
          limit: queryNumber(url, 'limit'),
        })
        json(res, 200, result)
        return
      }

      const catalogProductMatch = /^\/v1\/catalog\/products\/([^/]+)$/.exec(path)
      if (req.method === 'GET' && catalogProductMatch) {
        const product = await options.catalog.getProduct(decodeURIComponent(catalogProductMatch[1] ?? ''))
        json(res, 200, product)
        return
      }

      if (req.method === 'POST' && path === '/v1/catalog/compare') {
        const body = await readJson(req)
        const productIds = Array.isArray(body.productIds)
          ? body.productIds.filter((item): item is string => typeof item === 'string')
          : []
        const result = await options.catalog.compareOffers({
          productIds,
          quantity: typeof body.quantity === 'number' ? body.quantity : Number.NaN,
        })
        json(res, 200, result)
        return
      }

      if (req.method === 'POST' && path === '/v1/catalog/import') {
        if (!catalogImportEnabled) {
          json(res, 403, { error: 'catalog import is disabled; use the seed command or explicitly enable imports' })
          return
        }
        const body = await readJson(req)
        if (typeof body.csv !== 'string') {
          json(res, 400, { error: 'csv must be a string' })
          return
        }
        const snapshot = await options.catalog.importSnapshot(parseCatalogCsv(body.csv))
        json(res, 201, {
          products: snapshot.products.length,
          variants: snapshot.variants.length,
          suppliers: snapshot.suppliers.length,
          offers: snapshot.offers.length,
        })
        return
      }

      if (req.method === 'GET' && path === '/v1/sourcing/cases') {
        json(res, 200, { items: await options.procurement.listCases() })
        return
      }

      if (req.method === 'POST' && path === '/v1/sourcing/cases') {
        const body = await readJson(req)
        const item = await options.procurement.createCase({
          title: stringField(body, 'title'),
          requirements: {
            query: stringField(body, 'query'),
            quantity: numberField(body, 'quantity'),
            destinationCountry: stringField(body, 'destinationCountry'),
            targetUnitPrice: optionalNumberField(body, 'targetUnitPrice'),
            maxLeadTimeDays: optionalNumberField(body, 'maxLeadTimeDays'),
          },
        })
        json(res, 201, item)
        return
      }

      const sourcingCaseMatch = /^\/v1\/sourcing\/cases\/([^/]+)$/.exec(path)
      if (req.method === 'GET' && sourcingCaseMatch) {
        json(res, 200, await options.procurement.getCase(decodeURIComponent(sourcingCaseMatch[1] ?? '')))
        return
      }

      const candidateMatch = /^\/v1\/sourcing\/cases\/([^/]+)\/candidates$/.exec(path)
      if (req.method === 'POST' && candidateMatch) {
        const body = await readJson(req)
        const item = await options.procurement.addCandidate(
          decodeURIComponent(candidateMatch[1] ?? ''),
          stringField(body, 'productId'),
          typeof body.rationale === 'string' ? body.rationale : '',
        )
        json(res, 201, item)
        return
      }

      const quoteMatch = /^\/v1\/sourcing\/cases\/([^/]+)\/quote-requests$/.exec(path)
      if (req.method === 'POST' && quoteMatch) {
        const body = await readJson(req)
        const item = await options.procurement.draftQuoteRequest(decodeURIComponent(quoteMatch[1] ?? ''), {
          supplierId: stringField(body, 'supplierId'),
          offerIds: stringArrayField(body, 'offerIds'),
          quantity: numberField(body, 'quantity'),
        })
        json(res, 201, item)
        return
      }

      const approveQuoteMatch = /^\/v1\/sourcing\/cases\/([^/]+)\/quote-requests\/([^/]+)\/approve$/.exec(path)
      if (req.method === 'POST' && approveQuoteMatch) {
        const body = await readJson(req)
        const item = await options.procurement.approveQuoteRequest(
          decodeURIComponent(approveQuoteMatch[1] ?? ''),
          decodeURIComponent(approveQuoteMatch[2] ?? ''),
          stringField(body, 'decidedBy'),
          typeof body.reason === 'string' ? body.reason : '',
        )
        json(res, 200, item)
        return
      }

      if (req.method === 'GET' && path === '/v1/commerce/listings') {
        json(res, 200, { items: await options.commerce.listListings() })
        return
      }

      if (req.method === 'POST' && path === '/v1/commerce/listings') {
        const body = await readJson(req)
        const items = await options.commerce.createListingsFromCase({
          sourcingCaseId: stringField(body, 'sourcingCaseId'),
          merchantId: typeof body.merchantId === 'string' ? body.merchantId : undefined,
          unitPrice: optionalNumberField(body, 'unitPrice'),
        })
        json(res, 201, { items })
        return
      }

      const listingMatch = /^\/v1\/commerce\/listings\/([^/]+)$/.exec(path)
      if (req.method === 'GET' && listingMatch) {
        json(res, 200, await options.commerce.getListing(decodeURIComponent(listingMatch[1] ?? '')))
        return
      }

      if (req.method === 'GET' && path === '/v1/commerce/orders') {
        json(res, 200, { items: await options.commerce.listOrders() })
        return
      }

      if (req.method === 'POST' && path === '/v1/commerce/orders/simulate') {
        const body = await readJson(req)
        const item = await options.commerce.simulateShopifyOrder(
          stringField(body, 'listingId'),
          numberField(body, 'quantity'),
          typeof body.destinationCountry === 'string' ? body.destinationCountry : undefined,
        )
        json(res, 201, item)
        return
      }

      if (req.method === 'POST' && path === '/v1/commerce/shopify/webhooks/orders-create') {
        const body = await readJson(req)
        const item = await options.commerce.ingestOrder(options.commerce.parseShopifyOrderWebhook(body))
        json(res, 201, item)
        return
      }

      const orderMatch = /^\/v1\/commerce\/orders\/([^/]+)$/.exec(path)
      if (req.method === 'GET' && orderMatch) {
        json(res, 200, await options.commerce.getOrder(decodeURIComponent(orderMatch[1] ?? '')))
        return
      }

      const confirmPoMatch = /^\/v1\/commerce\/orders\/([^/]+)\/purchase-orders\/([^/]+)\/confirm$/.exec(path)
      if (req.method === 'POST' && confirmPoMatch) {
        const item = await options.commerce.confirmPurchaseOrder(
          decodeURIComponent(confirmPoMatch[1] ?? ''),
          decodeURIComponent(confirmPoMatch[2] ?? ''),
        )
        json(res, 200, item)
        return
      }

      const shipPoMatch = /^\/v1\/commerce\/orders\/([^/]+)\/purchase-orders\/([^/]+)\/ship$/.exec(path)
      if (req.method === 'POST' && shipPoMatch) {
        const body = await readJson(req)
        const item = await options.commerce.shipPurchaseOrder(
          decodeURIComponent(shipPoMatch[1] ?? ''),
          decodeURIComponent(shipPoMatch[2] ?? ''),
          stringField(body, 'trackingNumber'),
          typeof body.trackingCompany === 'string' ? body.trackingCompany : 'Other',
        )
        json(res, 200, item)
        return
      }

      if (req.method === 'POST' && path === '/v1/sessions') {
        const body = await readJson(req)
        const session = await options.runtime.createSession({
          id: typeof body.id === 'string' ? body.id : undefined,
        })
        json(res, 201, session)
        return
      }

      const sessionMatch = /^\/v1\/sessions\/([^/]+)$/.exec(path)
      if (req.method === 'GET' && sessionMatch) {
        const state = await options.runtime.getSession(decodeURIComponent(sessionMatch[1] ?? ''))
        json(res, 200, state)
        return
      }

      const messageMatch = /^\/v1\/sessions\/([^/]+)\/messages$/.exec(path)
      if (req.method === 'POST' && messageMatch) {
        const sessionId = decodeURIComponent(messageMatch[1] ?? '')
        const body = await readJson(req)
        const text = typeof body.text === 'string' ? body.text : ''
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': options.origin,
        })
        try {
          for await (const event of options.runtime.sendMessage(sessionId, { role: 'user', text })) {
            writeSse(res, event)
          }
        } catch (error) {
          writeSse(res, {
            type: 'agent.failed',
            sessionId,
            ts: new Date().toISOString(),
            message: error instanceof Error ? error.message : String(error),
          })
        }
        res.end()
        return
      }

      const approveMatch = /^\/v1\/sessions\/([^/]+)\/approvals\/([^/]+)$/.exec(path)
      if (req.method === 'POST' && approveMatch) {
        const sessionId = decodeURIComponent(approveMatch[1] ?? '')
        const approvalId = decodeURIComponent(approveMatch[2] ?? '')
        const body = await readJson(req)
        if (body.decision !== 'allow' && body.decision !== 'deny') {
          json(res, 400, { error: 'decision must be allow or deny' })
          return
        }
        const decision: ApprovalDecision = body.decision
        await options.runtime.approve(sessionId, approvalId, decision)
        json(res, 200, { ok: true })
        return
      }

      const abortMatch = /^\/v1\/sessions\/([^/]+)\/abort$/.exec(path)
      if (req.method === 'POST' && abortMatch) {
        await options.runtime.abort(decodeURIComponent(abortMatch[1] ?? ''))
        json(res, 200, { ok: true })
        return
      }

      const resumeMatch = /^\/v1\/sessions\/([^/]+)\/resume$/.exec(path)
      if (req.method === 'POST' && resumeMatch) {
        await options.runtime.resume(decodeURIComponent(resumeMatch[1] ?? ''))
        json(res, 200, { ok: true })
        return
      }

      json(res, 404, { error: 'not found' })
    } catch (error) {
      const status = error instanceof CatalogNotFoundError || error instanceof ProcurementNotFoundError || error instanceof CommerceNotFoundError || error instanceof InspirationNotFoundError
        ? 404
        : error instanceof CatalogInputError
          || error instanceof CatalogCsvError
          || error instanceof CatalogValidationError
          || error instanceof ProcurementInputError
          || error instanceof ProcurementValidationError
          || error instanceof CommerceInputError
          || error instanceof CommerceValidationError
          || error instanceof InspirationInputError
          ? 400
          : 500
      json(res, status, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    storage: options.storage,
    catalog: options.catalog,
    procurement: options.procurement,
    commerce: options.commerce,
    inspiration: options.inspiration,
    handle,
  }
}

export function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
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

function cors(res: ServerResponse, origin: string): void {
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

function writeSse(res: ServerResponse, event: AgentEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

function stringField(body: Record<string, unknown>, name: string): string {
  if (typeof body[name] !== 'string') throw new ProcurementInputError(`${name} must be a string`)
  return body[name]
}

function numberField(body: Record<string, unknown>, name: string): number {
  if (typeof body[name] !== 'number') throw new ProcurementInputError(`${name} must be a number`)
  return body[name]
}

function optionalNumberField(body: Record<string, unknown>, name: string): number | undefined {
  if (body[name] === undefined || body[name] === null) return undefined
  return numberField(body, name)
}

function stringArrayField(body: Record<string, unknown>, name: string): string[] {
  const value = body[name]
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new ProcurementInputError(`${name} must be an array of strings`)
  }
  return value
}

function queryNumber(url: URL, name: string): number | undefined {
  const value = url.searchParams.get(name)
  if (value === null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new CatalogInputError(`${name} must be a number`)
  return parsed
}
