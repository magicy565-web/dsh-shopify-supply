import type {
  CatalogSnapshot,
  Product,
  ProductVariant,
  Supplier,
  SupplierOffer,
} from './types.js'

export class CatalogValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid catalog: ${issues.join('; ')}`)
    this.name = 'CatalogValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function nonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function unique(values: string[], label: string, issues: string[]): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) issues.push(`${label} contains duplicate ${value}`)
    seen.add(value)
  }
}

export function validateCatalogSnapshot(value: unknown): CatalogSnapshot {
  if (!isRecord(value) || value.version !== 1) {
    throw new CatalogValidationError(['version must be 1'])
  }
  const issues: string[] = []
  const records = <T>(input: unknown, label: string): T[] => {
    if (!Array.isArray(input)) {
      issues.push(`${label} must be an array`)
      return []
    }
    const result = input.filter(isRecord) as T[]
    if (result.length !== input.length) issues.push(`${label} must contain only objects`)
    return result
  }
  const products = records<Product>(value.products, 'products')
  const variants = records<ProductVariant>(value.variants, 'variants')
  const suppliers = records<Supplier>(value.suppliers, 'suppliers')
  const offers = records<SupplierOffer>(value.offers, 'offers')

  unique(products.map((item) => item.id).filter(text), 'products.id', issues)
  unique(products.map((item) => item.sku).filter(text).map((item) => item.toLowerCase()), 'products.sku', issues)
  unique(variants.map((item) => item.id).filter(text), 'variants.id', issues)
  unique(variants.map((item) => item.sku).filter(text).map((item) => item.toLowerCase()), 'variants.sku', issues)
  unique(suppliers.map((item) => item.id).filter(text), 'suppliers.id', issues)
  unique(suppliers.map((item) => item.code).filter(text).map((item) => item.toLowerCase()), 'suppliers.code', issues)
  unique(offers.map((item) => item.id).filter(text), 'offers.id', issues)
  unique(offers.map((item) => `${item.supplierId}:${item.productId}:${item.variantId ?? ''}`), 'offers commercial identity', issues)

  const productIds = new Set(products.map((item) => item.id))
  const variantIds = new Set(variants.map((item) => item.id))
  const variantById = new Map(variants.map((item) => [item.id, item]))
  const supplierIds = new Set(suppliers.map((item) => item.id))

  for (const item of products) {
    if (!text(item.id) || !text(item.sku) || !text(item.title) || !text(item.category) || !text(item.createdAt) || !text(item.updatedAt)) {
      issues.push(`product ${item.id || '<missing>'} requires id, sku, title and category`)
    }
    if (typeof item.description !== 'string') issues.push(`product ${item.id} description must be a string`)
    if (item.status !== 'active' && item.status !== 'inactive') issues.push(`product ${item.id} has invalid status`)
    if (!Array.isArray(item.tags) || !Array.isArray(item.images)) issues.push(`product ${item.id} tags and images must be arrays`)
    else if (![...item.tags, ...item.images].every((entry) => typeof entry === 'string')) issues.push(`product ${item.id} tags and images must contain strings`)
  }
  for (const item of variants) {
    if (!text(item.id) || !text(item.sku) || !productIds.has(item.productId)) issues.push(`variant ${item.id} has invalid product reference`)
    if (!isRecord(item.attributes)) issues.push(`variant ${item.id} attributes must be an object`)
    else if (!Object.values(item.attributes).every((entry) => typeof entry === 'string')) issues.push(`variant ${item.id} attributes must contain strings`)
    if (item.weightGrams !== undefined && !positive(item.weightGrams)) issues.push(`variant ${item.id} weightGrams must be positive`)
  }
  for (const item of suppliers) {
    if (!text(item.id) || !text(item.code) || !text(item.name) || !text(item.country)) issues.push(`supplier ${item.id || '<missing>'} is incomplete`)
    if (item.status !== 'active' && item.status !== 'inactive') issues.push(`supplier ${item.id} has invalid status`)
  }
  for (const item of offers) {
    if (!text(item.id) || !productIds.has(item.productId)) issues.push(`offer ${item.id} has invalid product reference`)
    if (!supplierIds.has(item.supplierId)) issues.push(`offer ${item.id} has invalid supplier reference`)
    if (item.variantId !== undefined && !variantIds.has(item.variantId)) issues.push(`offer ${item.id} has invalid variant reference`)
    if (item.variantId !== undefined && variantById.get(item.variantId)?.productId !== item.productId) issues.push(`offer ${item.id} variant belongs to another product`)
    if (!text(item.currency) || !positive(item.unitPrice) || !positive(item.moq) || !nonNegative(item.leadTimeDays)) issues.push(`offer ${item.id} has invalid commercial terms`)
    if (item.shippingFlat !== undefined && !nonNegative(item.shippingFlat)) issues.push(`offer ${item.id} shippingFlat must be non-negative`)
    if (item.stock !== undefined && !nonNegative(item.stock)) issues.push(`offer ${item.id} stock must be non-negative`)
    if (item.status !== 'active' && item.status !== 'inactive') issues.push(`offer ${item.id} has invalid status`)
  }

  if (issues.length > 0) throw new CatalogValidationError(issues)
  return structuredClone({ version: 1, products, variants, suppliers, offers })
}
