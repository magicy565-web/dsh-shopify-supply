import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PostgresClient } from './client.js'

export async function applyPostgresMigrations(sql: PostgresClient, directory: string): Promise<string[]> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`
  const appliedRows = await sql`SELECT name FROM schema_migrations`
  const applied = new Set(appliedRows.map((row) => String(row.name)))
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()
  const newlyApplied: string[] = []
  for (const name of files) {
    if (applied.has(name)) continue
    const source = await readFile(join(directory, name), 'utf8')
    await sql.begin(async (tx) => {
      await tx.unsafe(source)
      await tx`INSERT INTO schema_migrations (name) VALUES (${name})`
    })
    newlyApplied.push(name)
  }
  return newlyApplied
}
