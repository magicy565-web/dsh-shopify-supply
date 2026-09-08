import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-supply-commerce-tools'
export const inject = ['tools']

function base(): string {
  return (process.env.CATALOG_API_URL ?? `http://127.0.0.1:${process.env.AGENT_GATEWAY_PORT ?? '8787'}`).replace(/\/$/, '')
}

async function api(path: string, init: RequestInit): Promise<JsonValue> {
  const response = await fetch(`${base()}${path}`, init)
  const value = await response.json() as JsonValue
  if (!response.ok) {
    const message = typeof value === 'object' && value !== null && !Array.isArray(value) && 'error' in value
      ? String(value.error)
      : `commerce API failed with ${response.status}`
    throw new Error(message)
  }
  return value
}

const jsonOutput = {
  schema: { type: 'json' as const },
  render: (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'list_listings',
    description: 'List active dropship listings that bind a private-catalog offer to a merchant sales SKU.',
    parameters: {},
    output: jsonOutput,
    async execute(_args, exec) {
      return api('/v1/commerce/listings', { signal: exec.signal })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'get_sales_order',
    description: 'Get one routed Shopify sales order with purchase orders and tracking.',
    parameters: {
      orderId: { type: 'string', required: true },
    },
    output: jsonOutput,
    async execute(args, exec) {
      return api(`/v1/commerce/orders/${encodeURIComponent(args.orderId)}`, { signal: exec.signal })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'create_dropship_listing',
    description: 'Turn an approved sourcing case into dropship listings. This write action requires operator approval. The platform is not the merchant of record.',
    parameters: {
      sourcingCaseId: { type: 'string', required: true },
      merchantId: { type: 'string' },
      unitPrice: { type: 'number', description: 'Optional merchant sell price; defaults to supplier unit cost' },
    },
    output: jsonOutput,
    async execute(args, exec) {
      return api('/v1/commerce/listings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args),
        signal: exec.signal,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'simulate_shopify_order',
    description: 'Ingest a local fixture Shopify order against a listing and create supplier purchase orders. Use only for the local closed loop. Requires operator approval.',
    parameters: {
      listingId: { type: 'string', required: true },
      quantity: { type: 'integer', required: true },
      destinationCountry: { type: 'string' },
    },
    output: jsonOutput,
    async execute(args, exec) {
      return api('/v1/commerce/orders/simulate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args),
        signal: exec.signal,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'confirm_purchase_order',
    description: 'Mark a supplier purchase order as confirmed. Requires operator approval.',
    parameters: {
      orderId: { type: 'string', required: true },
      purchaseOrderId: { type: 'string', required: true },
    },
    output: jsonOutput,
    async execute(args, exec) {
      return api(`/v1/commerce/orders/${encodeURIComponent(args.orderId)}/purchase-orders/${encodeURIComponent(args.purchaseOrderId)}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        signal: exec.signal,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'ship_purchase_order',
    description: 'Record supplier tracking and write it back to the Shopify fulfillment adapter. Requires operator approval.',
    parameters: {
      orderId: { type: 'string', required: true },
      purchaseOrderId: { type: 'string', required: true },
      trackingNumber: { type: 'string', required: true },
      trackingCompany: { type: 'string' },
    },
    output: jsonOutput,
    async execute(args, exec) {
      return api(`/v1/commerce/orders/${encodeURIComponent(args.orderId)}/purchase-orders/${encodeURIComponent(args.purchaseOrderId)}/ship`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          trackingNumber: args.trackingNumber,
          trackingCompany: args.trackingCompany,
        }),
        signal: exec.signal,
      })
    },
  }))
}
