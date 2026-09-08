import { join } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { findWorkspaceRoot } from '@dsh-supply/config'
import { applyPostgresMigrations, createPostgresClient } from '@dsh-supply/storage-postgres'

const root = findWorkspaceRoot()
loadEnv({ path: join(root, '.env') })
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to run migrations')
const sql = createPostgresClient(process.env.DATABASE_URL)

try {
  const applied = await applyPostgresMigrations(sql, join(root, 'database', 'migrations'))
  if (applied.length === 0) process.stdout.write('No pending migrations\n')
  for (const name of applied) process.stdout.write(`Applied ${name}\n`)
} finally {
  await sql.end()
}
