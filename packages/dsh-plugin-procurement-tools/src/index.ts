import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-supply-procurement-tools'
export const inject = ['tools']

function base(): string {
  return (process.env.CATALOG_API_URL ?? `http://127.0.0.1:${process.env.AGENT_GATEWAY_PORT ?? '8787'}`).replace(/\/$/, '')
}

async function post(path: string, body: unknown, signal: AbortSignal): Promise<JsonValue> {
  const response = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const value = await response.json() as JsonValue
  if (!response.ok) {
    const message = typeof value === 'object' && value !== null && !Array.isArray(value) && 'error' in value
      ? String(value.error)
      : `procurement API failed with ${response.status}`
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
    name: 'create_sourcing_case',
    description: 'Create a persistent sourcing case from confirmed buyer requirements. This is a write action and requires operator approval.',
    parameters: {
      title: { type: 'string', required: true },
      query: { type: 'string', required: true, description: 'Product requirement' },
      quantity: { type: 'integer', required: true },
      destinationCountry: { type: 'string', required: true, description: 'Two-letter destination country code' },
      targetUnitPrice: { type: 'number' },
      maxLeadTimeDays: { type: 'integer' },
    },
    output: jsonOutput,
    async execute(args, exec) {
      return post('/v1/sourcing/cases', args, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'add_sourcing_candidate',
    description: 'Add one private-catalog product to a sourcing case shortlist. This is a write action and requires operator approval.',
    parameters: {
      caseId: { type: 'string', required: true },
      productId: { type: 'string', required: true },
      rationale: { type: 'string' },
    },
    output: jsonOutput,
    async execute(args, exec) {
      return post(`/v1/sourcing/cases/${encodeURIComponent(args.caseId)}/candidates`, {
        productId: args.productId,
        rationale: args.rationale,
      }, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'draft_quote_request',
    description: 'Create a quote-request draft for offers from one supplier. It does not send anything externally. This write action requires operator approval.',
    parameters: {
      caseId: { type: 'string', required: true },
      supplierId: { type: 'string', required: true },
      offerIds: { type: 'array', required: true, items: { type: 'string' } },
      quantity: { type: 'integer', required: true },
    },
    output: jsonOutput,
    async execute(args, exec) {
      return post(`/v1/sourcing/cases/${encodeURIComponent(args.caseId)}/quote-requests`, {
        supplierId: args.supplierId,
        offerIds: args.offerIds,
        quantity: args.quantity,
      }, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'approve_quote_request',
    description: 'Record final human approval of a quote-request draft and lock the sourcing case. This action requires explicit operator approval.',
    parameters: {
      caseId: { type: 'string', required: true },
      quoteRequestId: { type: 'string', required: true },
      reason: { type: 'string' },
    },
    output: jsonOutput,
    async execute(args, exec) {
      return post(`/v1/sourcing/cases/${encodeURIComponent(args.caseId)}/quote-requests/${encodeURIComponent(args.quoteRequestId)}/approve`, {
        decidedBy: 'operator-via-agent-approval',
        reason: args.reason,
      }, exec.signal)
    },
  }))
}
