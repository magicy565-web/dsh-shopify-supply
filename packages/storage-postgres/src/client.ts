import postgres from 'postgres'

export type PostgresClient = ReturnType<typeof postgres>

export type PostgresClientOptions = {
  max?: number
  searchPath?: string
  idleTimeout?: number
}

export function createPostgresClient(databaseUrl: string, options: PostgresClientOptions = {}): PostgresClient {
  if (!databaseUrl.trim()) throw new Error('DATABASE_URL is required')
  return postgres(databaseUrl, {
    max: options.max ?? Number(process.env.DATABASE_POOL_SIZE ?? 10),
    idle_timeout: options.idleTimeout ?? 20,
    connect_timeout: 10,
    ...(options.searchPath ? { connection: { search_path: options.searchPath } } : {}),
  })
}
