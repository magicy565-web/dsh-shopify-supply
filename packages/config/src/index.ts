import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** npm train for `@deepseek-ai/dsh`, `@deepseek-ai/dsh-sdk-client`, and `@deepseek-ai/dsh-sdk-protocol`. */
export const DSH_PINNED_VERSION = '0.1.0-rc.6'

export const DSH_PROFILE = 'sdk'
export const DSH_DEFAULT_PROVIDER = 'deepseek-official'
export const DSH_DEFAULT_MODEL = 'deepseek-v4-flash'

export const DEV_TOOL_NAMES = [
  'echo',
  'read_test_data',
  'dangerous_test_action',
] as const

export const CATALOG_TOOL_NAMES = [
  'search_catalog',
  'get_product',
  'compare_offers',
] as const

export const PROCUREMENT_TOOL_NAMES = [
  'create_sourcing_case',
  'add_sourcing_candidate',
  'draft_quote_request',
  'approve_quote_request',
] as const

export const COMMERCE_READ_TOOL_NAMES = [
  'list_listings',
  'get_sales_order',
] as const

export const LAUNCH_TOOL_NAMES = [
  'search_public_web',
  'get_launch_run',
  'write_campaign_draft',
  'record_launch_stage',
] as const

export const COMMERCE_WRITE_TOOL_NAMES = ['create_dropship_listing', 'simulate_shopify_order', 'confirm_purchase_order', 'ship_purchase_order'] as const

export const DSH_TOOL_NAMES = [
  ...DEV_TOOL_NAMES,
  ...CATALOG_TOOL_NAMES,
  ...PROCUREMENT_TOOL_NAMES,
  ...COMMERCE_READ_TOOL_NAMES,
  ...COMMERCE_WRITE_TOOL_NAMES,
  ...LAUNCH_TOOL_NAMES,
] as const

export const ASK_TOOL_NAMES = [
  'dangerous_test_action',
  ...PROCUREMENT_TOOL_NAMES,
  ...COMMERCE_WRITE_TOOL_NAMES,
  'write_campaign_draft',
] as const

export const ECHO_THROW_TOKEN = '__THROW__'

export const AGENT_INTERNAL_TOKEN_ENV = 'AGENT_INTERNAL_TOKEN'
export const DEFAULT_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000
export const DEFAULT_SESSION_IDLE_TTL_MS = 15 * 60 * 1000

export function agentApprovalTimeoutMs(): number {
  return readMsEnv('AGENT_APPROVAL_TIMEOUT_MS', DEFAULT_APPROVAL_TIMEOUT_MS)
}

export function agentSessionIdleTtlMs(): number {
  return readMsEnv('AGENT_SESSION_IDLE_TTL_MS', DEFAULT_SESSION_IDLE_TTL_MS)
}

export function agentGatewayBaseUrl(): string {
  return (process.env.CATALOG_API_URL ?? `http://127.0.0.1:${process.env.AGENT_GATEWAY_PORT ?? '8787'}`).replace(/\/$/, '')
}

export function agentInternalHeaders(idempotencyKey?: string): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const token = process.env[AGENT_INTERNAL_TOKEN_ENV]
  if (token) {
    headers.authorization = `Bearer ${token}`
    headers['x-dsh-plugin'] = '1'
  }
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey
  return headers
}

export function toolCallIdOf(exec: { callId?: string; id?: string; toolCallId?: string }): string | undefined {
  for (const value of [exec.callId, exec.id, exec.toolCallId]) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function readMsEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export function findWorkspaceRoot(start = process.cwd()): string {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(`pnpm-workspace.yaml not found from ${start}`)
    }
    dir = parent
  }
}

export function thisPackageRoot(importMetaUrl: string): string {
  return dirname(fileURLToPath(importMetaUrl))
}
