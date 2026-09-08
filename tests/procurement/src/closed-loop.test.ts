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
  PostgresProcurementRepository,
} from '@dsh-supply/storage-postgres'
import {
  assertSourcingClosedLoop,
  assertSourcingClosedLoopHttp,
  memoryProcurement,
  sampleCatalog,
} from './sourcing-loop.js'

loadEnv({ path: join(findWorkspaceRoot(), '.env') })
const databaseUrl = process.env.DATABASE_URL?.trim() ?? ''

function commerceFor(catalog: CatalogService, procurement: ProcurementService): CommerceService {
  return new CommerceService(new InMemoryCommerceRepository(), catalog, procurement, new FixtureShopifyStore())
}

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

test('json file adapter runs the sourcing closed loop', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sourcing-json-'))
  try {
    const catalog = new CatalogService(new JsonCatalogRepository(join(directory, 'catalog.json')))
    await catalog.importSnapshot(sampleCatalog())
    const procurement = new ProcurementService(new JsonProcurementRepository(join(directory, 'procurement.json')), catalog)
    const approved = await assertSourcingClosedLoop(procurement)
    assert.equal(approved.status, 'approved')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('HTTP sourcing routes run create, candidate, reject, draft, and approve', async () => {
  const { catalog, procurement } = memoryProcurement()
  const app = createGatewayApp({
    runtime: new InMemoryAgentRuntime(),
    catalog,
    procurement,
    commerce: commerceFor(catalog, procurement),
    storage: 'json',
    origin: '*',
    runtimeKind: 'in-memory',
  })
  const server = await listen(app.handle)
  try {
    const approved = await assertSourcingClosedLoopHttp(server.url)
    assert.equal(approved.decisions[0]?.decidedBy, 'operator@example.test')
  } finally {
    await server.close()
  }
})

test('postgres adapter runs the sourcing closed loop in an isolated schema', {
  skip: databaseUrl ? false : 'DATABASE_URL is not set',
}, async () => {
  const schema = `sourcingloop${randomUUID().replaceAll('-', '')}`
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
    const approved = await assertSourcingClosedLoop(procurement)
    assert.equal(approved.status, 'approved')

    const httpApp = createGatewayApp({
      runtime: new InMemoryAgentRuntime(),
      catalog,
      procurement,
      commerce: new CommerceService(new InMemoryCommerceRepository(), catalog, procurement, new FixtureShopifyStore()),
      storage: 'postgres',
      origin: '*',
      runtimeKind: 'in-memory',
    })
    const server = await listen(httpApp.handle)
    try {
      const approvedHttp = await assertSourcingClosedLoopHttp(server.url)
      assert.equal(approvedHttp.status, 'approved')
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
