import type {
  CommerceRepository,
  Listing,
  Merchant,
  OrderData,
  PurchaseOrder,
  SalesOrder,
  SalesOrderLine,
} from '@dsh-supply/commerce'
import type { PostgresClient } from './client.js'

function merchantFromRow(row: Record<string, unknown>): Merchant {
  return {
    id: String(row.id),
    name: String(row.name),
    destinationCountry: String(row.destinationCountry),
    shopifyShop: row.shopifyShop == null ? undefined : String(row.shopifyShop),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  }
}

function listingFromRow(row: Record<string, unknown>): Listing {
  return {
    id: String(row.id),
    merchantId: String(row.merchantId),
    sourcingCaseId: String(row.sourcingCaseId),
    quoteRequestId: String(row.quoteRequestId),
    offerId: String(row.offerId),
    productId: String(row.productId),
    variantId: row.variantId == null ? undefined : String(row.variantId),
    supplierId: String(row.supplierId),
    sku: String(row.sku),
    title: String(row.title),
    currency: String(row.currency),
    unitPrice: Number(row.unitPrice),
    status: row.status as Listing['status'],
    shopifyProductId: row.shopifyProductId == null ? undefined : String(row.shopifyProductId),
    shopifyVariantId: row.shopifyVariantId == null ? undefined : String(row.shopifyVariantId),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  }
}

function orderFromRow(row: Record<string, unknown>): SalesOrder {
  return {
    id: String(row.id),
    merchantId: String(row.merchantId),
    shopifyOrderId: String(row.shopifyOrderId),
    status: row.status as SalesOrder['status'],
    destinationCountry: String(row.destinationCountry),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  }
}

function lineFromRow(row: Record<string, unknown>): SalesOrderLine {
  return {
    orderId: String(row.orderId),
    listingId: String(row.listingId),
    sku: String(row.sku),
    quantity: Number(row.quantity),
    unitPrice: Number(row.unitPrice),
  }
}

function purchaseOrderFromRow(row: Record<string, unknown>): PurchaseOrder {
  return {
    id: String(row.id),
    salesOrderId: String(row.salesOrderId),
    listingId: String(row.listingId),
    supplierId: String(row.supplierId),
    offerId: String(row.offerId),
    status: row.status as PurchaseOrder['status'],
    quantity: Number(row.quantity),
    currency: String(row.currency),
    unitCost: Number(row.unitCost),
    warnings: Array.isArray(row.warnings) ? row.warnings.map((item) => String(item)) : [],
    trackingNumber: row.trackingNumber == null ? undefined : String(row.trackingNumber),
    trackingCompany: row.trackingCompany == null ? undefined : String(row.trackingCompany),
    shopifyFulfillmentId: row.shopifyFulfillmentId == null ? undefined : String(row.shopifyFulfillmentId),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  }
}

export class PostgresCommerceRepository implements CommerceRepository {
  constructor(private readonly sql: PostgresClient) {}

  async listMerchants(): Promise<Merchant[]> {
    const rows = await this.sql`SELECT id, name, destination_country AS "destinationCountry", shopify_shop AS "shopifyShop", created_at::text AS "createdAt", updated_at::text AS "updatedAt" FROM merchants ORDER BY name`
    return rows.map(merchantFromRow)
  }

  async getMerchant(merchantId: string): Promise<Merchant | undefined> {
    const rows = await this.sql`SELECT id, name, destination_country AS "destinationCountry", shopify_shop AS "shopifyShop", created_at::text AS "createdAt", updated_at::text AS "updatedAt" FROM merchants WHERE id = ${merchantId}`
    return rows[0] ? merchantFromRow(rows[0]) : undefined
  }

  async createMerchant(item: Merchant): Promise<void> {
    await this.sql`INSERT INTO merchants (id, name, destination_country, shopify_shop, created_at, updated_at)
      VALUES (${item.id}, ${item.name}, ${item.destinationCountry}, ${item.shopifyShop ?? null}, ${item.createdAt}, ${item.updatedAt})
      ON CONFLICT (id) DO NOTHING`
  }

  async listListings(): Promise<Listing[]> {
    const rows = await this.sql`
      SELECT id, merchant_id AS "merchantId", sourcing_case_id AS "sourcingCaseId", quote_request_id AS "quoteRequestId",
        offer_id AS "offerId", product_id AS "productId", variant_id AS "variantId", supplier_id AS "supplierId", sku, title, currency,
        unit_price::float8 AS "unitPrice", status, shopify_product_id AS "shopifyProductId", shopify_variant_id AS "shopifyVariantId",
        created_at::text AS "createdAt", updated_at::text AS "updatedAt"
      FROM listings ORDER BY updated_at DESC`
    return rows.map(listingFromRow)
  }

  async getListing(listingId: string): Promise<Listing | undefined> {
    const rows = await this.sql`
      SELECT id, merchant_id AS "merchantId", sourcing_case_id AS "sourcingCaseId", quote_request_id AS "quoteRequestId",
        offer_id AS "offerId", product_id AS "productId", variant_id AS "variantId", supplier_id AS "supplierId", sku, title, currency,
        unit_price::float8 AS "unitPrice", status, shopify_product_id AS "shopifyProductId", shopify_variant_id AS "shopifyVariantId",
        created_at::text AS "createdAt", updated_at::text AS "updatedAt"
      FROM listings WHERE id = ${listingId}`
    return rows[0] ? listingFromRow(rows[0]) : undefined
  }

  async findListingByOffer(merchantId: string, offerId: string): Promise<Listing | undefined> {
    const rows = await this.sql`
      SELECT id, merchant_id AS "merchantId", sourcing_case_id AS "sourcingCaseId", quote_request_id AS "quoteRequestId",
        offer_id AS "offerId", product_id AS "productId", variant_id AS "variantId", supplier_id AS "supplierId", sku, title, currency,
        unit_price::float8 AS "unitPrice", status, shopify_product_id AS "shopifyProductId", shopify_variant_id AS "shopifyVariantId",
        created_at::text AS "createdAt", updated_at::text AS "updatedAt"
      FROM listings WHERE merchant_id = ${merchantId} AND offer_id = ${offerId}`
    return rows[0] ? listingFromRow(rows[0]) : undefined
  }

  async findListingBySku(merchantId: string, sku: string): Promise<Listing | undefined> {
    const rows = await this.sql`
      SELECT id, merchant_id AS "merchantId", sourcing_case_id AS "sourcingCaseId", quote_request_id AS "quoteRequestId",
        offer_id AS "offerId", product_id AS "productId", variant_id AS "variantId", supplier_id AS "supplierId", sku, title, currency,
        unit_price::float8 AS "unitPrice", status, shopify_product_id AS "shopifyProductId", shopify_variant_id AS "shopifyVariantId",
        created_at::text AS "createdAt", updated_at::text AS "updatedAt"
      FROM listings WHERE merchant_id = ${merchantId} AND lower(sku) = lower(${sku})`
    return rows[0] ? listingFromRow(rows[0]) : undefined
  }

  async createListing(item: Listing): Promise<void> {
    await this.sql`
      INSERT INTO listings (id, merchant_id, sourcing_case_id, quote_request_id, offer_id, product_id, variant_id, supplier_id, sku, title, currency, unit_price, status, shopify_product_id, shopify_variant_id, created_at, updated_at)
      VALUES (${item.id}, ${item.merchantId}, ${item.sourcingCaseId}, ${item.quoteRequestId}, ${item.offerId}, ${item.productId}, ${item.variantId ?? null}, ${item.supplierId}, ${item.sku}, ${item.title}, ${item.currency}, ${item.unitPrice}, ${item.status}, ${item.shopifyProductId ?? null}, ${item.shopifyVariantId ?? null}, ${item.createdAt}, ${item.updatedAt})`
  }

  async listOrders(): Promise<SalesOrder[]> {
    const rows = await this.sql`
      SELECT id, merchant_id AS "merchantId", shopify_order_id AS "shopifyOrderId", status, destination_country AS "destinationCountry",
        created_at::text AS "createdAt", updated_at::text AS "updatedAt"
      FROM sales_orders ORDER BY updated_at DESC`
    return rows.map(orderFromRow)
  }

  async getOrder(orderId: string): Promise<OrderData | undefined> {
    const rows = await this.sql`
      SELECT id, merchant_id AS "merchantId", shopify_order_id AS "shopifyOrderId", status, destination_country AS "destinationCountry",
        created_at::text AS "createdAt", updated_at::text AS "updatedAt"
      FROM sales_orders WHERE id = ${orderId}`
    if (!rows[0]) return undefined
    return this.composeOrder(orderFromRow(rows[0]))
  }

  async findOrderByShopifyId(shopifyOrderId: string): Promise<OrderData | undefined> {
    const rows = await this.sql`
      SELECT id, merchant_id AS "merchantId", shopify_order_id AS "shopifyOrderId", status, destination_country AS "destinationCountry",
        created_at::text AS "createdAt", updated_at::text AS "updatedAt"
      FROM sales_orders WHERE shopify_order_id = ${shopifyOrderId}`
    if (!rows[0]) return undefined
    return this.composeOrder(orderFromRow(rows[0]))
  }

  async ingestOrder(order: SalesOrder, lines: SalesOrderLine[], purchaseOrders: PurchaseOrder[]): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`INSERT INTO sales_orders (id, merchant_id, shopify_order_id, status, destination_country, created_at, updated_at)
        VALUES (${order.id}, ${order.merchantId}, ${order.shopifyOrderId}, ${order.status}, ${order.destinationCountry}, ${order.createdAt}, ${order.updatedAt})`
      for (const line of lines) {
        await tx`INSERT INTO sales_order_lines (order_id, listing_id, sku, quantity, unit_price)
          VALUES (${line.orderId}, ${line.listingId}, ${line.sku}, ${line.quantity}, ${line.unitPrice})`
      }
      for (const item of purchaseOrders) {
        await tx`INSERT INTO purchase_orders (id, sales_order_id, listing_id, supplier_id, offer_id, status, quantity, currency, unit_cost, warnings, created_at, updated_at)
          VALUES (${item.id}, ${item.salesOrderId}, ${item.listingId}, ${item.supplierId}, ${item.offerId}, ${item.status}, ${item.quantity}, ${item.currency}, ${item.unitCost}, ${tx.array(item.warnings)}, ${item.createdAt}, ${item.updatedAt})`
      }
    })
  }

  async confirmPurchaseOrder(order: SalesOrder, purchaseOrder: PurchaseOrder): Promise<void> {
    await this.sql.begin(async (tx) => {
      const changed = await tx`UPDATE purchase_orders SET status = ${purchaseOrder.status}, updated_at = ${purchaseOrder.updatedAt}
        WHERE id = ${purchaseOrder.id} AND status <> 'shipped'`
      if (changed.count !== 1) throw new Error(`purchase order ${purchaseOrder.id} can no longer be confirmed`)
      await tx`UPDATE sales_orders SET updated_at = ${order.updatedAt} WHERE id = ${order.id}`
    })
  }

  async shipPurchaseOrder(order: SalesOrder, purchaseOrder: PurchaseOrder): Promise<void> {
    await this.sql.begin(async (tx) => {
      const changed = await tx`UPDATE purchase_orders
        SET status = 'shipped', tracking_number = ${purchaseOrder.trackingNumber ?? null}, tracking_company = ${purchaseOrder.trackingCompany ?? null},
          shopify_fulfillment_id = ${purchaseOrder.shopifyFulfillmentId ?? null}, updated_at = ${purchaseOrder.updatedAt}
        WHERE id = ${purchaseOrder.id} AND status <> 'shipped'`
      if (changed.count !== 1) throw new Error(`purchase order ${purchaseOrder.id} is already shipped`)
      await tx`UPDATE sales_orders SET status = ${order.status}, updated_at = ${order.updatedAt} WHERE id = ${order.id}`
    })
  }

  private async composeOrder(item: SalesOrder): Promise<OrderData> {
    const [lines, purchaseOrders] = await Promise.all([
      this.sql`SELECT order_id AS "orderId", listing_id AS "listingId", sku, quantity, unit_price::float8 AS "unitPrice" FROM sales_order_lines WHERE order_id = ${item.id}`,
      this.sql`
        SELECT id, sales_order_id AS "salesOrderId", listing_id AS "listingId", supplier_id AS "supplierId", offer_id AS "offerId",
          status, quantity, currency, unit_cost::float8 AS "unitCost", warnings, tracking_number AS "trackingNumber",
          tracking_company AS "trackingCompany", shopify_fulfillment_id AS "shopifyFulfillmentId",
          created_at::text AS "createdAt", updated_at::text AS "updatedAt"
        FROM purchase_orders WHERE sales_order_id = ${item.id}`,
    ])
    return {
      item,
      lines: lines.map(lineFromRow),
      purchaseOrders: purchaseOrders.map(purchaseOrderFromRow),
    }
  }
}
