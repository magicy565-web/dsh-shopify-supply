import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isAgentError, type AgentEvent, type ApprovalDecision } from '@dsh-supply/agent-contracts'
import { CommunityService, JsonCommunityRepository } from '@dsh-supply/community'
import type { AgentRuntime } from '@dsh-supply/agent-runtime'
import {
  JsonLaunchRepository,
  LaunchService,
  searchPublicWeb,
} from '@dsh-supply/launch'
import { InspirationService } from './inspiration.js'
import { handleCommunityRequest } from './community-http.js'
import { handleLaunchRequest, launchErrorStatus } from './launch-http.js'
import { IdempotencyConflictError, IdempotencyStore, stableJson } from './idempotency.js'
import {
  CatalogInputError,
  CatalogService,
  parseCatalogCsv,
} from '@dsh-supply/catalog'
import {
  CommerceService,
} from '@dsh-supply/commerce'
import {
  ProcurementInputError,
  ProcurementService,
} from '@dsh-supply/procurement'

export type StorageKind = 'json' | 'postgres'

export type GatewayApp = {
  storage: StorageKind
  catalog: CatalogService
  procurement: ProcurementService
  commerce: CommerceService
  inspiration: InspirationService
  community: CommunityService
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>
}

export function createGatewayApp(options: {
  runtime: AgentRuntime
  catalog: CatalogService
  procurement: ProcurementService
  commerce: CommerceService
  inspiration?: InspirationService
  community?: CommunityService
  storage: StorageKind
  origin: string
  catalogImportEnabled?: boolean
  runtimeKind?: string
  internalToken?: string
  idempotency?: IdempotencyStore
  launch?: LaunchService
}): GatewayApp {
  const catalogImportEnabled = options.catalogImportEnabled === true
  const inspiration = options.inspiration ?? new InspirationService(join(tmpdir(), `inspiration-${randomUUID()}.json`))
  const community = options.community ?? new CommunityService(
    new JsonCommunityRepository(join(tmpdir(), `community-${randomUUID()}.json`)),
    join(tmpdir(), `uploads-${randomUUID()}`),
    { email: `admin-${randomUUID()}@test.local`, password: 'test-admin-password', name: '测试管理员' },
  )
  const idempotency = options.idempotency ?? new IdempotencyStore()
  const launch = options.launch ?? new LaunchService(new JsonLaunchRepository(join(tmpdir(), `launch-${randomUUID()}.json`)))

  async function ensureSession(sessionId: string): Promise<void> {
    try {
      const state = await options.runtime.getSession(sessionId)
      if (state.status === 'aborted') await options.runtime.resume(sessionId)
      else if (state.status === 'closed') await options.runtime.createSession({ id: sessionId })
    } catch (error) {
      if (isAgentError(error) && error.code === 'session.unknown') {
        await options.runtime.createSession({ id: sessionId })
        return
      }
      throw error
    }
  }

  async function write(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    body: Record<string, unknown>,
    run: () => Promise<{ status: number; body: unknown }>,
  ): Promise<void> {
    const key = headerValue(req, 'idempotency-key')
    if (key && key.length > 256) {
      json(res, 400, { error: 'idempotency-key is too long' })
      return
    }
    try {
      const result = await idempotency.execute(key, `${req.method}:${path}:${stableJson(body)}`, run)
      json(res, result.status, result.body)
    } catch (error) {
      if (error instanceof IdempotencyConflictError || (error instanceof Error && error.name === 'IdempotencyConflictError')) {
        json(res, 409, { error: error instanceof Error ? error.message : 'idempotency key conflict', code: 'idempotency.conflict' })
        return
      }
      throw error
    }
  }

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
      if (!authorizePlugin(req, options.internalToken)) {
        json(res, 401, { error: 'unauthorized', code: 'auth.unauthorized' })
        return
      }

      if (req.method === 'GET' && path === '/health') {
        json(res, 200, {
          ok: true,
          runtime: options.runtimeKind ?? 'in-memory',
          storage: options.storage,
          shopify: options.commerce.shopify.kind,
          community: 'json',
          launch: { modelConfigured: ['dsh', 'deepseek'].includes(options.runtimeKind ?? '') && Boolean(process.env.DEEPSEEK_API_KEY), mode: 'agent' },
        })
        return
      }

      if (path.startsWith('/v1/launch/') || path.startsWith('/v1/sessions/')) {
        const plugin = headerValue(req, 'x-dsh-plugin') === '1'
        const token = /^Bearer\s+(\S+)$/i.exec(headerValue(req, 'authorization') ?? '')?.[1]
        const user = plugin ? null : await community.actor(token)
        const sessionId = /^\/v1\/sessions\/([^/]+)/.exec(path)?.[1]
        const ownedRun = sessionId ? (await launch.list()).find(r => r.sessionId === decodeURIComponent(sessionId)) : undefined
        if (ownedRun && !plugin && ownedRun.ownerId !== user?.id) { json(res, 403, { error: '无权操作此任务' }); return }
        if (await handleLaunchRequest(req, res, req.method ?? 'GET', path, { runtime: options.runtime, launch, runtimeKind: options.runtimeKind, searchWeb: searchPublicWeb, userId: user?.id }, { json, readJson, writeSse, origin: options.origin })) return
      }

      if (await handleCommunityRequest(req, res, req.method ?? 'GET', path, community, {
        json,
        readJson,
        bearer: (incoming) => {
          const match = /^Bearer\s+(\S+)$/i.exec(headerValue(incoming, 'authorization') ?? '')
          return match?.[1]
        },
        sendMedia: (outgoing, mime, bytes) => {
          outgoing.statusCode = 200
          outgoing.setHeader('content-type', mime)
          outgoing.setHeader('cache-control', 'public, max-age=31536000, immutable')
          outgoing.end(bytes)
        },
      })) return

      if (req.method === 'GET' && path === '/v1/inspiration/projects') {         json(res, 200, { items: await inspiration.list() }); return }
      const inspirationMatch = /^\/v1\/inspiration\/projects\/([^/]+)$/.exec(path)
      if (req.method === 'GET' && inspirationMatch) { const id = decodeURIComponent(inspirationMatch[1] ?? ''); json(res, 200, { project: await inspiration.get(id), viewer: await inspiration.viewerState(id) }); return }
      if (req.method === 'POST' && path === '/v1/inspiration/projects') { json(res, 201, { project: await inspiration.create(await readJson(req)) }); return }
      if (req.method === 'POST' && inspirationMatch) {
        const id = decodeURIComponent(inspirationMatch[1] ?? ''), body = await readJson(req)
        if (body.action === 'delete') { json(res, 200, await inspiration.remove(id)); return }
        if (body.action === 'save' || body.action === 'follow') { json(res, 200, await inspiration.toggle(id, body.action === 'save' ? 'saved' : 'following')); return }
        if (body.action === 'comment') { json(res, 201, { comment: await inspiration.comment(id, stringField(body, 'text')) }); return }
        if (body.action === 'update') { json(res, 201, { project: await inspiration.updateProgress(id, stringField(body, 'title'), stringField(body, 'body')) }); return }
        json(res, 200, { project: await inspiration.update(id, body) }); return
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
        await write(req, res, path, body, async () => ({
          status: 201,
          body: await options.procurement.createCase({
            title: stringField(body, 'title'),
            requirements: {
              query: stringField(body, 'query'),
              quantity: numberField(body, 'quantity'),
              destinationCountry: stringField(body, 'destinationCountry'),
              targetUnitPrice: optionalNumberField(body, 'targetUnitPrice'),
              maxLeadTimeDays: optionalNumberField(body, 'maxLeadTimeDays'),
            },
          }),
        }))
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
        const caseId = decodeURIComponent(candidateMatch[1] ?? '')
        await write(req, res, path, body, async () => ({
          status: 201,
          body: await options.procurement.addCandidate(
            caseId,
            stringField(body, 'productId'),
            typeof body.rationale === 'string' ? body.rationale : '',
          ),
        }))
        return
      }

      const quoteMatch = /^\/v1\/sourcing\/cases\/([^/]+)\/quote-requests$/.exec(path)
      if (req.method === 'POST' && quoteMatch) {
        const body = await readJson(req)
        const caseId = decodeURIComponent(quoteMatch[1] ?? '')
        await write(req, res, path, body, async () => ({
          status: 201,
          body: await options.procurement.draftQuoteRequest(caseId, {
            supplierId: stringField(body, 'supplierId'),
            offerIds: stringArrayField(body, 'offerIds'),
            quantity: numberField(body, 'quantity'),
          }),
        }))
        return
      }

      const approveQuoteMatch = /^\/v1\/sourcing\/cases\/([^/]+)\/quote-requests\/([^/]+)\/approve$/.exec(path)
      if (req.method === 'POST' && approveQuoteMatch) {
        const body = await readJson(req)
        const caseId = decodeURIComponent(approveQuoteMatch[1] ?? '')
        const quoteId = decodeURIComponent(approveQuoteMatch[2] ?? '')
        await write(req, res, path, body, async () => ({
          status: 200,
          body: await options.procurement.approveQuoteRequest(
            caseId,
            quoteId,
            stringField(body, 'decidedBy'),
            typeof body.reason === 'string' ? body.reason : '',
          ),
        }))
        return
      }

      if (req.method === 'GET' && path === '/v1/commerce/listings') {
        json(res, 200, { items: await options.commerce.listListings() })
        return
      }

      if (req.method === 'POST' && path === '/v1/commerce/listings') {
        const body = await readJson(req)
        await write(req, res, path, body, async () => ({
          status: 201,
          body: {
            items: await options.commerce.createListingsFromCase({
              sourcingCaseId: stringField(body, 'sourcingCaseId'),
              merchantId: typeof body.merchantId === 'string' ? body.merchantId : undefined,
              unitPrice: optionalNumberField(body, 'unitPrice'),
            }),
          },
        }))
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
        await write(req, res, path, body, async () => ({
          status: 201,
          body: await options.commerce.simulateShopifyOrder(
            stringField(body, 'listingId'),
            numberField(body, 'quantity'),
            typeof body.destinationCountry === 'string' ? body.destinationCountry : undefined,
          ),
        }))
        return
      }

      if (req.method === 'POST' && path === '/v1/commerce/shopify/webhooks/orders-create') {
        const body = await readJson(req)
        await write(req, res, path, body, async () => ({
          status: 201,
          body: await options.commerce.ingestOrder(options.commerce.parseShopifyOrderWebhook(body)),
        }))
        return
      }

      const orderMatch = /^\/v1\/commerce\/orders\/([^/]+)$/.exec(path)
      if (req.method === 'GET' && orderMatch) {
        json(res, 200, await options.commerce.getOrder(decodeURIComponent(orderMatch[1] ?? '')))
        return
      }

      const confirmPoMatch = /^\/v1\/commerce\/orders\/([^/]+)\/purchase-orders\/([^/]+)\/confirm$/.exec(path)
      if (req.method === 'POST' && confirmPoMatch) {
        const orderId = decodeURIComponent(confirmPoMatch[1] ?? '')
        const purchaseOrderId = decodeURIComponent(confirmPoMatch[2] ?? '')
        await write(req, res, path, {}, async () => ({
          status: 200,
          body: await options.commerce.confirmPurchaseOrder(orderId, purchaseOrderId),
        }))
        return
      }

      const shipPoMatch = /^\/v1\/commerce\/orders\/([^/]+)\/purchase-orders\/([^/]+)\/ship$/.exec(path)
      if (req.method === 'POST' && shipPoMatch) {
        const body = await readJson(req)
        const orderId = decodeURIComponent(shipPoMatch[1] ?? '')
        const purchaseOrderId = decodeURIComponent(shipPoMatch[2] ?? '')
        await write(req, res, path, body, async () => ({
          status: 200,
          body: await options.commerce.shipPurchaseOrder(
            orderId,
            purchaseOrderId,
            stringField(body, 'trackingNumber'),
            typeof body.trackingCompany === 'string' ? body.trackingCompany : 'Other',
          ),
        }))
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
        await ensureSession(sessionId)
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
            ...(isAgentError(error) ? { code: error.code } : {}),
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

      const closeMatch = /^\/v1\/sessions\/([^/]+)\/close$/.exec(path)
      if (req.method === 'POST' && closeMatch) {
        await options.runtime.close(decodeURIComponent(closeMatch[1] ?? ''))
        json(res, 200, { ok: true })
        return
      }

      json(res, 404, { error: 'not found' })
    } catch (error) {
      if (isAgentError(error)) {
        const status = error.code === 'session.unknown' || error.code === 'approval.unknown'
          ? 404
          : error.code === 'auth.unauthorized'
            ? 401
            : 409
        json(res, status, { error: error.message, code: error.code })
        return
      }
      const status = launchErrorStatus(error) ?? httpStatusForDomainError(error)
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
    inspiration,
    community,
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

const NOT_FOUND_ERROR_NAMES = new Set([
  'CatalogNotFoundError',
  'ProcurementNotFoundError',
  'CommerceNotFoundError',
  'InspirationNotFoundError',
  'CommunityNotFoundError',
])

const BAD_REQUEST_ERROR_NAMES = new Set([
  'CatalogInputError',
  'CatalogCsvError',
  'CatalogValidationError',
  'ProcurementInputError',
  'ProcurementValidationError',
  'CommerceInputError',
  'CommerceValidationError',
  'InspirationInputError',
  'CommunityInputError',
])

function httpStatusForDomainError(error: unknown): number {
  const name = error instanceof Error ? error.name : ''
  if (name === 'CommunityUnauthorizedError') return 401
  if (name === 'CommunityForbiddenError') return 403
  if (NOT_FOUND_ERROR_NAMES.has(name)) return 404
  if (BAD_REQUEST_ERROR_NAMES.has(name)) return 400
  return 500
}

function cors(res: ServerResponse, origin: string): void {
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, X-DSH-Plugin')
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

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  const trimmed = typeof value === 'string' ? value.trim() : undefined
  return trimmed ? trimmed : undefined
}

function tokensEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function authorizePlugin(req: IncomingMessage, token: string | undefined): boolean {
  if (!token) return true
  const plugin = headerValue(req, 'x-dsh-plugin')
  if (plugin !== '1') return true
  const authorization = headerValue(req, 'authorization')
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')
  return Boolean(match?.[1] && tokensEqual(match[1], token))
}
