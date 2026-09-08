import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { CatalogService, JsonCatalogRepository, parseCatalogCsv } from '@dsh-supply/catalog'
import { findWorkspaceRoot } from '@dsh-supply/config'
import { createPostgresClient, PostgresCatalogRepository } from '@dsh-supply/storage-postgres'

const root = findWorkspaceRoot()
loadEnv({ path: join(root, '.env') })
const source = join(root, 'data', 'catalog.sample.csv')
const target = process.env.CATALOG_DATA_FILE || join(root, 'data', 'catalog.json')
const csv = await readFile(source, 'utf8')
const database = process.env.DATABASE_URL ? createPostgresClient(process.env.DATABASE_URL) : undefined
const service = new CatalogService(database ? new PostgresCatalogRepository(database) : new JsonCatalogRepository(target))

try {
  const snapshot = await service.importSnapshot(parseCatalogCsv(csv))
  const destination = database ? 'PostgreSQL' : target
  process.stdout.write(`Seeded ${snapshot.products.length} products and ${snapshot.offers.length} offers to ${destination}\n`)
} finally {
  await database?.end()
}
