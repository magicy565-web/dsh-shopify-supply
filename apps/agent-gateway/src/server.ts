import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { InMemoryAgentRuntime, type AgentRuntime } from '@dsh-supply/agent-runtime'
import { DeepSeekHarnessRuntime } from '@dsh-supply/agent-runtime-dsh'
import { CatalogService, JsonCatalogRepository } from '@dsh-supply/catalog'
import { AGENT_INTERNAL_TOKEN_ENV, findWorkspaceRoot } from '@dsh-supply/config'
import {
  CommerceService,
  createShopifyStore,
  JsonCommerceRepository,
} from '@dsh-supply/commerce'
import { JsonProcurementRepository, ProcurementService } from '@dsh-supply/procurement'
import {
  createPostgresClient,
  PostgresCatalogRepository,
  PostgresCommerceRepository,
  PostgresProcurementRepository,
} from '@dsh-supply/storage-postgres'
import { CommunityService, JsonCommunityRepository } from '@dsh-supply/community'
import { createGatewayApp } from './app.js'
import { InspirationService } from './inspiration.js'
import { LaunchService, JsonLaunchRepository } from '@dsh-supply/launch'

const workspaceRoot = findWorkspaceRoot()
loadEnv({ path: join(workspaceRoot, '.env') })

const internalToken = process.env[AGENT_INTERNAL_TOKEN_ENV] || randomUUID()
process.env[AGENT_INTERNAL_TOKEN_ENV] = internalToken

function createRuntime(): AgentRuntime {
  const kind = (process.env.AGENT_RUNTIME ?? 'dsh').toLowerCase()
  if (kind === 'dsh' || kind === 'deepseek') return new DeepSeekHarnessRuntime({ internalToken })
  return new InMemoryAgentRuntime()
}

const runtime = createRuntime()
const database = process.env.DATABASE_URL ? createPostgresClient(process.env.DATABASE_URL) : undefined
const catalogRepository = database
  ? new PostgresCatalogRepository(database)
  : new JsonCatalogRepository(process.env.CATALOG_DATA_FILE || join(workspaceRoot, 'data', 'catalog.json'))
const catalog = new CatalogService(catalogRepository)
const procurementRepository = database
  ? new PostgresProcurementRepository(database)
  : new JsonProcurementRepository(process.env.PROCUREMENT_DATA_FILE || join(workspaceRoot, 'data', 'procurement.json'))
const procurement = new ProcurementService(procurementRepository, catalog)
const commerceRepository = database
  ? new PostgresCommerceRepository(database)
  : new JsonCommerceRepository(process.env.COMMERCE_DATA_FILE || join(workspaceRoot, 'data', 'commerce.json'))
const commerce = new CommerceService(commerceRepository, catalog, procurement, createShopifyStore())
const inspiration = new InspirationService(process.env.INSPIRATION_DATA_FILE || join(workspaceRoot, 'data', 'inspiration.json'))
const community = new CommunityService(
  new JsonCommunityRepository(process.env.COMMUNITY_DATA_FILE || join(workspaceRoot, 'data', 'community.json')),
  process.env.COMMUNITY_MEDIA_DIR || join(workspaceRoot, 'data', 'uploads'),
  {
    email: process.env.COMMUNITY_ADMIN_EMAIL,
    password: process.env.COMMUNITY_ADMIN_PASSWORD,
    name: process.env.COMMUNITY_ADMIN_NAME,
  },
)
const origin = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3000'
const port = Number(process.env.AGENT_GATEWAY_PORT ?? 8787)
const app = createGatewayApp({
  runtime,
  catalog,
  procurement,
  commerce,
  inspiration,
  community,
  storage: database ? 'postgres' : 'json',
  origin,
  catalogImportEnabled: process.env.CATALOG_IMPORT_ENABLED === 'true',
  runtimeKind: process.env.AGENT_RUNTIME ?? 'dsh',
  internalToken,
  launch: new LaunchService(new JsonLaunchRepository(process.env.LAUNCH_DATA_FILE || join(workspaceRoot, 'data', 'launch.json'))),
})

const server = createServer((req, res) => {
  void app.handle(req, res)
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`agent-gateway listening on http://127.0.0.1:${port} storage=${app.storage} shopify=${commerce.shopify.kind}\n`)
})

let shuttingDown = false
async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  const serverClosed = new Promise<void>((resolve) => server.close(() => resolve()))
  const managed = runtime as AgentRuntime & { shutdown?: () => Promise<void> }
  await managed.shutdown?.()
  await database?.end()
  await serverClosed
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
