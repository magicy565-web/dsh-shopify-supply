import type { CommerceSnapshot } from './types.js'

export class CommerceValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid commerce data: ${issues.join('; ')}`)
    this.name = 'CommerceValidationError'
  }
}

export function validateCommerceSnapshot(value: unknown): CommerceSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || (value as { version?: unknown }).version !== 1) {
    throw new CommerceValidationError(['version must be 1'])
  }
  const record = value as Record<string, unknown>
  const names = ['merchants', 'listings', 'orders', 'orderLines', 'purchaseOrders'] as const
  const issues = names.filter((name) => !Array.isArray(record[name])).map((name) => `${name} must be an array`)
  if (issues.length > 0) throw new CommerceValidationError(issues)
  const snapshot = value as CommerceSnapshot
  const merchantIds = new Set(snapshot.merchants.map((item) => item.id))
  const listingIds = new Set(snapshot.listings.map((item) => item.id))
  const orderIds = new Set(snapshot.orders.map((item) => item.id))
  const duplicate = (values: string[], label: string): void => {
    if (new Set(values).size !== values.length) issues.push(`${label} contains duplicates`)
  }
  duplicate(snapshot.merchants.map((item) => item.id), 'merchants.id')
  duplicate(snapshot.listings.map((item) => item.id), 'listings.id')
  duplicate(snapshot.listings.map((item) => `${item.merchantId}:${item.offerId}`), 'listings.offer')
  duplicate(snapshot.listings.map((item) => `${item.merchantId}:${item.sku}`), 'listings.sku')
  duplicate(snapshot.orders.map((item) => item.id), 'orders.id')
  duplicate(snapshot.orders.map((item) => item.shopifyOrderId), 'orders.shopifyOrderId')
  duplicate(snapshot.purchaseOrders.map((item) => item.id), 'purchaseOrders.id')
  for (const item of snapshot.listings) if (!merchantIds.has(item.merchantId)) issues.push(`listing ${item.id} references unknown merchant`)
  for (const item of snapshot.orders) if (!merchantIds.has(item.merchantId)) issues.push(`order ${item.id} references unknown merchant`)
  for (const item of snapshot.orderLines) {
    if (!orderIds.has(item.orderId)) issues.push(`order line references unknown order ${item.orderId}`)
    if (!listingIds.has(item.listingId)) issues.push(`order line references unknown listing ${item.listingId}`)
  }
  for (const item of snapshot.purchaseOrders) {
    if (!orderIds.has(item.salesOrderId)) issues.push(`purchase order ${item.id} references unknown order`)
    if (!listingIds.has(item.listingId)) issues.push(`purchase order ${item.id} references unknown listing`)
  }
  if (issues.length > 0) throw new CommerceValidationError(issues)
  return structuredClone(snapshot)
}
