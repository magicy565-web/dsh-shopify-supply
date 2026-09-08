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

export const COMMERCE_WRITE_TOOL_NAMES = [
  'create_dropship_listing',
  'simulate_shopify_order',
  'confirm_purchase_order',
  'ship_purchase_order',
] as const

export const DSH_TOOL_NAMES = [
  ...DEV_TOOL_NAMES,
  ...CATALOG_TOOL_NAMES,
  ...PROCUREMENT_TOOL_NAMES,
  ...COMMERCE_READ_TOOL_NAMES,
  ...COMMERCE_WRITE_TOOL_NAMES,
] as const

export const ASK_TOOL_NAMES = [
  'dangerous_test_action',
  ...PROCUREMENT_TOOL_NAMES,
  ...COMMERCE_WRITE_TOOL_NAMES,
] as const

export const ECHO_THROW_TOKEN = '__THROW__'

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
