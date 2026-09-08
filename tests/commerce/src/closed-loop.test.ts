import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { config as loadEnv } from 'dotenv'
import { createGatewayApp } from '@dsh-supply/agent-gateway/app'
import { InMemoryAgentRuntime } from '@dsh-supply/agent-runtime'
import { CatalogService, JsonCatalogRepository } from '@dsh-supply/catalog'
import { findWorkspaceRoot } from '@dsh-supply/config'
import { CommerceService, FixtureShopifyStore, InMemoryCommerceRepository } from '@dsh-supply/commerce'
import { JsonProcurementRepository, ProcurementService } from '@dsh-supply/procurement'
import {
  applyPostgresMigrations,
  createPostgresClient,
  PostgresCatalogRepository,
  PostgresCommerceRepository,
  PostgresProcurementRepository,
} from '@dsh-supply/storage-postgres'
import {
  approveBottleCase,
  assertCommerceClosedLoop,
  assertCommerceClosedLoopHttp,
  jsonCommerce,
  memoryStack,
  sampleCatalog,
} from './loop.js'

loadEnv({ path: join(findWorkspaceRoot(), '.env') })
const databaseUrl = process.env.DATABASE_URL?.trim() ?? ''

async function listen(handle: ReturnType<typeof createGatewayApp>['handle']): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    void handle(req, res)
  })
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve())
    server.on('error', reject)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('expected TCP listen address')
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}

function gateway(catalog: CatalogService, procurement: ProcurementService, commerce: CommerceService, storage: 'json' | 'postgres' = 'json') {
  return createGatewayApp({
    runtime: new InMemoryAgentRuntime(),
    catalog,
    procurement,
    commerce,
    storage,
    origin: '*',
    runtimeKind: 'in-memory',
  })
}

test('json file adapter runs the dropship closed loop', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'commerce-json-'))
  try {
    const catalog = new CatalogService(new JsonCatalogRepository(join(directory, 'catalog.json')))
    await catalog.importSnapshot(sampleCatalog())
    const procurement = new ProcurementService(new JsonProcurementRepository(join(directory, 'procurement.json')), catalog)
    const commerce = jsonCommerce(join(directory, 'commerce.json'), catalog, procurement)
    const caseId = await approveBottleCase(procurement)
    const shipped = await assertCommerceClosedLoop(commerce, caseId)
    assert.equal(shipped.status, 'fulfilled')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('HTTP commerce routes list, reject unmapped SKU, simulate, and ship', async () => {
  const { catalog, procurement, commerce } = memoryStack()
  const caseId = await approveBottleCase(procurement)
  const server = await listen(gateway(catalog, procurement, commerce).handle)
  try {
    const shipped = await assertCommerceClosedLoopHttp(server.url, caseId)
    assert.equal(shipped.purchaseOrders[0]?.trackingCompany, 'UPS')
  } finally {
    await server.close()
  }
})

test('postgres adapter runs the dropship closed loop in an isolated schema', {
  skip: databaseUrl ? false : 'DATABASE_URL is not set',
}, async () => {
  const schema = `commerceloop${randomUUID().replaceAll('-', '')}`
  const admin = createPostgresClient(databaseUrl, { max: 1, idleTimeout: 5 })
  let isolated: ReturnType<typeof createPostgresClient> | undefined
  try {
    await admin.unsafe(`CREATE SCHEMA ${schema}`)
    isolated = createPostgresClient(databaseUrl, { max: 1, searchPath: schema, idleTimeout: 5 })
    await isolated`SELECT pg_catalog.set_config('search_path', ${schema}, false)`
    await applyPostgresMigrations(isolated, join(findWorkspaceRoot(), 'database', 'migrations'))
    const catalog = new CatalogService(new PostgresCatalogRepository(isolated))
    await catalog.importSnapshot(sampleCatalog())
    const procurement = new ProcurementService(new PostgresProcurementRepository(isolated), catalog)
    const commerce = new CommerceService(new PostgresCommerceRepository(isolated), catalog, procurement, new FixtureShopifyStore())
    const caseId = await approveBottleCase(procurement)
    const shipped = await assertCommerceClosedLoop(commerce, caseId)
    assert.equal(shipped.status, 'fulfilled')
    const server = await listen(gateway(catalog, procurement, commerce, 'postgres').handle)
    try {
      const listed = await (await fetch(`${server.url}/v1/commerce/listings`)).json() as { items: Array<{ id: string }> }
      assert.equal(listed.items.some((item) => item.id === shipped.lines[0]?.listingId), true)
    } finally {
      await server.close()
    }
  } finally {
    await isolated?.end({ timeout: 5 })
    try {
      await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    } finally {
      await admin.end({ timeout: 5 })
    }
  }
})
