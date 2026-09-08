import type {
  CatalogRepository,
  CatalogSnapshot,
  Product,
  ProductVariant,
  Supplier,
  SupplierOffer,
} from '@dsh-supply/catalog'
import { validateCatalogSnapshot } from '@dsh-supply/catalog'
import type { PostgresClient } from './client.js'

export class PostgresCatalogRepository implements CatalogRepository {
  constructor(private readonly sql: PostgresClient) {}

  async read(): Promise<CatalogSnapshot> {
    const [productRows, variantRows, supplierRows, offerRows] = await Promise.all([
      this.sql`SELECT id, sku, title, description, category, status, tags, images, created_at::text AS "createdAt", updated_at::text AS "updatedAt" FROM products`,
      this.sql`SELECT id, product_id AS "productId", sku, attributes, weight_grams AS "weightGrams" FROM product_variants`,
      this.sql`SELECT id, code, name, country, status FROM suppliers`,
      this.sql`SELECT id, product_id AS "productId", variant_id AS "variantId", supplier_id AS "supplierId", currency, unit_price::float8 AS "unitPrice", moq, lead_time_days AS "leadTimeDays", stock, shipping_flat::float8 AS "shippingFlat", status, updated_at::text AS "updatedAt" FROM supplier_offers`,
    ])
    return validateCatalogSnapshot({
      version: 1,
      products: productRows.map(productFromRow),
      variants: variantRows.map(variantFromRow),
      suppliers: supplierRows.map(supplierFromRow),
      offers: offerRows.map(offerFromRow),
    })
  }

  async write(snapshot: CatalogSnapshot): Promise<void> {
    const checked = validateCatalogSnapshot(snapshot)
    await this.sql.begin(async (tx) => {
      await tx`UPDATE supplier_offers SET status = 'inactive' WHERE status = 'active'`
      await tx`UPDATE products SET status = 'inactive' WHERE status = 'active'`
      await tx`UPDATE suppliers SET status = 'inactive' WHERE status = 'active'`
      for (const item of checked.products) {
        await tx`
          INSERT INTO products (id, sku, title, description, category, status, tags, images, created_at, updated_at)
          VALUES (${item.id}, ${item.sku}, ${item.title}, ${item.description}, ${item.category}, ${item.status}, ${tx.array(item.tags)}, ${tx.array(item.images)}, ${item.createdAt}, ${item.updatedAt})
          ON CONFLICT (id) DO UPDATE SET sku = EXCLUDED.sku, title = EXCLUDED.title, description = EXCLUDED.description,
            category = EXCLUDED.category, status = EXCLUDED.status, tags = EXCLUDED.tags, images = EXCLUDED.images, updated_at = EXCLUDED.updated_at`
      }
      for (const item of checked.suppliers) {
        await tx`
          INSERT INTO suppliers (id, code, name, country, status)
          VALUES (${item.id}, ${item.code}, ${item.name}, ${item.country}, ${item.status})
          ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, country = EXCLUDED.country, status = EXCLUDED.status`
      }
      for (const item of checked.variants) {
        await tx`
          INSERT INTO product_variants (id, product_id, sku, attributes, weight_grams)
          VALUES (${item.id}, ${item.productId}, ${item.sku}, ${tx.json(item.attributes)}, ${item.weightGrams ?? null})
          ON CONFLICT (id) DO UPDATE SET product_id = EXCLUDED.product_id, sku = EXCLUDED.sku,
            attributes = EXCLUDED.attributes, weight_grams = EXCLUDED.weight_grams`
      }
      for (const item of checked.offers) {
        await tx`
          INSERT INTO supplier_offers (id, product_id, variant_id, supplier_id, currency, unit_price, moq, lead_time_days, stock, shipping_flat, status, updated_at)
          VALUES (${item.id}, ${item.productId}, ${item.variantId ?? null}, ${item.supplierId}, ${item.currency}, ${item.unitPrice}, ${item.moq}, ${item.leadTimeDays}, ${item.stock ?? null}, ${item.shippingFlat ?? null}, ${item.status}, ${item.updatedAt})
          ON CONFLICT (id) DO UPDATE SET product_id = EXCLUDED.product_id, variant_id = EXCLUDED.variant_id,
            supplier_id = EXCLUDED.supplier_id, currency = EXCLUDED.currency, unit_price = EXCLUDED.unit_price,
            moq = EXCLUDED.moq, lead_time_days = EXCLUDED.lead_time_days, stock = EXCLUDED.stock,
            shipping_flat = EXCLUDED.shipping_flat, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at`
      }
    })
  }
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function productFromRow(row: Record<string, unknown>): Product {
  return {
    id: String(row.id),
    sku: String(row.sku),
    title: String(row.title),
    description: String(row.description ?? ''),
    category: String(row.category),
    status: row.status as Product['status'],
    tags: textList(row.tags),
    images: textList(row.images),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  }
}

function variantFromRow(row: Record<string, unknown>): ProductVariant {
  return {
    id: String(row.id),
    productId: String(row.productId),
    sku: String(row.sku),
    attributes: (row.attributes ?? {}) as ProductVariant['attributes'],
    weightGrams: optionalNumber(row.weightGrams),
  }
}

function supplierFromRow(row: Record<string, unknown>): Supplier {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    country: String(row.country),
    status: row.status as Supplier['status'],
  }
}

function offerFromRow(row: Record<string, unknown>): SupplierOffer {
  return {
    id: String(row.id),
    productId: String(row.productId),
    variantId: row.variantId == null ? undefined : String(row.variantId),
    supplierId: String(row.supplierId),
    currency: String(row.currency),
    unitPrice: Number(row.unitPrice),
    moq: Number(row.moq),
    leadTimeDays: Number(row.leadTimeDays),
    stock: optionalNumber(row.stock),
    shippingFlat: optionalNumber(row.shippingFlat),
    status: row.status as SupplierOffer['status'],
    updatedAt: String(row.updatedAt),
  }
}
