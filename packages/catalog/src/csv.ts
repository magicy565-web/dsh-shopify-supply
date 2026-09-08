import type { CatalogSnapshot, Product, ProductVariant, Supplier, SupplierOffer } from './types.js'
import { validateCatalogSnapshot } from './validation.js'

export class CatalogCsvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CatalogCsvError'
  }
}

function parseRows(csv: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index]
    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') quoted = false
      else field += char
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field.trim())
      field = ''
    } else if (char === '\n') {
      row.push(field.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') field += char
  }
  if (quoted) throw new CatalogCsvError('CSV contains an unclosed quote')
  row.push(field.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function number(value: string | undefined, label: string, defaultValue?: number): number {
  if (!value && defaultValue !== undefined) return defaultValue
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new CatalogCsvError(`${label} must be a number`)
  return parsed
}

function options(value: string | undefined): Record<string, string> {
  if (!value) return {}
  return Object.fromEntries(value.split('|').filter(Boolean).map((pair) => {
    const separator = pair.indexOf('=')
    if (separator < 1) throw new CatalogCsvError(`invalid variant option: ${pair}`)
    return [pair.slice(0, separator).trim(), pair.slice(separator + 1).trim()]
  }))
}

export function parseCatalogCsv(csv: string, now = new Date().toISOString()): CatalogSnapshot {
  const rows = parseRows(csv.replace(/^\uFEFF/, ''))
  if (rows.length < 2) throw new CatalogCsvError('CSV must contain a header and at least one data row')
  const headers = rows[0]!.map((header) => header.toLowerCase())
  const required = ['product_sku', 'title', 'category', 'supplier_code', 'supplier_name', 'unit_price', 'moq', 'lead_time_days']
  for (const header of required) if (!headers.includes(header)) throw new CatalogCsvError(`CSV is missing required column ${header}`)

  const products = new Map<string, Product>()
  const variants = new Map<string, ProductVariant>()
  const suppliers = new Map<string, Supplier>()
  const offers: SupplierOffer[] = []

  for (const [offset, values] of rows.slice(1).entries()) {
    const line = offset + 2
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
    const productSku = record.product_sku?.trim()
    const supplierCode = record.supplier_code?.trim()
    if (!productSku || !supplierCode) throw new CatalogCsvError(`CSV line ${line} requires product_sku and supplier_code`)
    const productId = `product-${slug(productSku)}`
    const supplierId = `supplier-${slug(supplierCode)}`
    const variantSku = record.variant_sku?.trim()
    const variantId = variantSku ? `variant-${slug(variantSku)}` : undefined

    products.set(productId, {
      id: productId,
      sku: productSku,
      title: record.title ?? '',
      description: record.description ?? '',
      category: record.category ?? '',
      status: 'active',
      tags: (record.tags ?? '').split('|').map((item) => item.trim()).filter(Boolean),
      images: (record.images ?? '').split('|').map((item) => item.trim()).filter(Boolean),
      createdAt: products.get(productId)?.createdAt ?? now,
      updatedAt: now,
    })
    suppliers.set(supplierId, {
      id: supplierId,
      code: supplierCode,
      name: record.supplier_name ?? '',
      country: record.supplier_country || 'CN',
      status: 'active',
    })
    if (variantId && variantSku) {
      variants.set(variantId, {
        id: variantId,
        productId,
        sku: variantSku,
        attributes: options(record.variant_options),
        weightGrams: record.weight_grams ? number(record.weight_grams, `line ${line} weight_grams`) : undefined,
      })
    }
    offers.push({
      id: `offer-${slug(productSku)}-${slug(supplierCode)}-${slug(variantSku || 'default')}`,
      productId,
      variantId,
      supplierId,
      currency: record.currency || 'USD',
      unitPrice: number(record.unit_price, `line ${line} unit_price`),
      moq: number(record.moq, `line ${line} moq`),
      leadTimeDays: number(record.lead_time_days, `line ${line} lead_time_days`),
      stock: record.stock ? number(record.stock, `line ${line} stock`) : undefined,
      shippingFlat: record.shipping_flat ? number(record.shipping_flat, `line ${line} shipping_flat`) : undefined,
      status: 'active',
      updatedAt: now,
    })
  }

  return validateCatalogSnapshot({
    version: 1,
    products: [...products.values()],
    variants: [...variants.values()],
    suppliers: [...suppliers.values()],
    offers,
  })
}
