import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-supply-catalog-tools'
export const inject = ['tools']

function apiBase(): string {
  return (process.env.CATALOG_API_URL ?? `http://127.0.0.1:${process.env.AGENT_GATEWAY_PORT ?? '8787'}`).replace(/\/$/, '')
}

async function api(path: string, init?: RequestInit): Promise<JsonValue> {
  const response = await fetch(`${apiBase()}${path}`, init)
  const body = await response.json() as unknown
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'error' in body
      ? String((body as { error: unknown }).error)
      : `catalog API failed with ${response.status}`
    throw new Error(message)
  }
  return body as JsonValue
}

function renderJson(value: unknown): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'search_catalog',
    description: 'Search the private product catalog. Use commercial filters when the buyer gives price, MOQ, or lead-time limits.',
    parameters: {
      query: { type: 'string', description: 'Product name, SKU, category, or tag' },
      category: { type: 'string', description: 'Exact product category' },
      maxUnitPrice: { type: 'number', description: 'Maximum supplier unit price' },
      maxMoq: { type: 'integer', description: 'Maximum minimum-order quantity' },
      maxLeadTimeDays: { type: 'integer', description: 'Maximum supplier lead time in days' },
      limit: { type: 'integer', description: 'Maximum products to return, from 1 to 100' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      const query = new URLSearchParams()
      for (const [key, value] of Object.entries(args)) {
        if (value !== undefined) query.set(key, String(value))
      }
      return api(`/v1/catalog/products?${query.toString()}`, { signal: exec.signal })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'get_product',
    description: 'Get one private-catalog product with variants and current supplier offers by product ID or SKU.',
    parameters: {
      id: { type: 'string', required: true, description: 'Product ID or SKU' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      return api(`/v1/catalog/products/${encodeURIComponent(args.id)}`, { signal: exec.signal })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'compare_offers',
    description: 'Compare active supplier offers for catalog products at a requested quantity. Totals do not include destination-specific duties or unlisted shipping.',
    parameters: {
      productIds: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'Product IDs or SKUs to compare',
      },
      quantity: { type: 'integer', required: true, description: 'Buyer requested quantity' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      return api('/v1/catalog/compare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args),
        signal: exec.signal,
      })
    },
  }))
}
