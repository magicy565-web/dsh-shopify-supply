import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DSH_PROFILE, findWorkspaceRoot } from '@dsh-supply/config'

export { DSH_PROFILE }

const require = createRequire(import.meta.url)

export function dshRuntimeProjectDir(workspaceRoot = findWorkspaceRoot()): string {
  return join(workspaceRoot, 'apps', 'dsh-runtime')
}

export function defaultDshHome(workspaceRoot = findWorkspaceRoot()): string {
  return join(workspaceRoot, '.dsh-home')
}

export function resolveJsonrpcAgentBin(): string {
  const pkg = require.resolve('@deepseek-ai/dsh-sdk-jsonrpc-demo/package.json')
  return join(dirname(pkg), 'lib', 'bin.js')
}

function pluginEntry(workspaceRoot: string, pkg: string): string {
  return pathToFileURL(
    join(workspaceRoot, 'packages', pkg, 'dist', 'index.js'),
  ).href
}

/** Full SDK runtime composition. Loaded by `dsh-jsonrpc-agent`, not `dsh web`. */
export function writeRuntimeConfig(workspaceRoot = findWorkspaceRoot()): string {
  const home = defaultDshHome(workspaceRoot)
  // The demo runtime resolves bare packages relative to the config project.
  // Keeping the generated file below apps/dsh-runtime lets Node walk up to that
  // workspace package's node_modules while DSH_HOME remains isolated elsewhere.
  const generatedDir = join(dshRuntimeProjectDir(workspaceRoot), '.generated')
  mkdirSync(generatedDir, { recursive: true })
  mkdirSync(home, { recursive: true })
  const outFile = join(generatedDir, 'cordis.yml')
  const sessionRoot = join(home, 'sessions').replaceAll('\\', '/')
  const tools = pluginEntry(workspaceRoot, 'dsh-plugin-dev-tools')
  const catalogTools = pluginEntry(workspaceRoot, 'dsh-plugin-catalog-tools')
  const procurementTools = pluginEntry(workspaceRoot, 'dsh-plugin-procurement-tools')
  const commerceTools = pluginEntry(workspaceRoot, 'dsh-plugin-commerce-tools')
  const policy = pluginEntry(workspaceRoot, 'dsh-plugin-policy')
  const yaml = `# Generated SDK JSON-RPC composition. stdout is reserved for JSON-RPC.
- id: sdk-jsonrpc-server
  name: '@deepseek-ai/dsh-sdk-jsonrpc-server'
  config:
    maxTokensAsSuccess: false

- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY
    streamIdleTimeoutMs: 172800000

- id: approval
  name: '@deepseek-ai/dsh-user-approval'

- id: agent-spine
  name: '@deepseek-ai/dsh-agent-spine-demo'
  config:
    includeHarnessIdentity: false
    includeRuntimeContext: false
    persona: You are a sourcing and dropship assistant for a private product catalog. Use search_catalog, get_product, and compare_offers for research. Use sourcing-case tools only after the buyer confirms requirements. After a case is approved, use create_dropship_listing to bind the awarded offer to a merchant SKU. Use simulate_shopify_order only for the local fixture loop. Use ship_purchase_order to write tracking back. Never claim catalog data came from Alibaba. Never claim a draft was sent to a supplier. Never claim the platform collected payment or is the merchant of record. When asked to use echo, read_test_data, or dangerous_test_action, call that tool.
    workspaceContext: false
    skills:
      enabled: false
    toolBash: false
    toolJobs: false

- id: sessions
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: ${JSON.stringify(sessionRoot)}
    compression: none

- id: dsh-supply-dev-tools
  name: ${JSON.stringify(tools)}

- id: dsh-supply-catalog-tools
  name: ${JSON.stringify(catalogTools)}

- id: dsh-supply-procurement-tools
  name: ${JSON.stringify(procurementTools)}

- id: dsh-supply-commerce-tools
  name: ${JSON.stringify(commerceTools)}

- id: dsh-supply-policy
  name: ${JSON.stringify(policy)}
`
  writeFileSync(outFile, yaml, 'utf8')
  return outFile
}

export function thisDir(): string {
  return dirname(fileURLToPath(import.meta.url))
}
