import { randomUUID } from 'node:crypto'
import type {
  ShopifyFulfillment,
  ShopifyListingInput,
  ShopifyProductRef,
  ShopifyStore,
} from './types.js'

function now(): string {
  return new Date().toISOString()
}

function fixtureId(kind: 'Product' | 'Variant' | 'Fulfillment', sku: string): string {
  const slug = sku.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'
  return `gid://shopify/${kind}/fixture-${slug}`
}

export class FixtureShopifyStore implements ShopifyStore {
  readonly kind = 'fixture' as const
  private readonly fulfillments = new Map<string, ShopifyFulfillment>()

  async upsertListing(input: ShopifyListingInput): Promise<ShopifyProductRef> {
    return {
      shopifyProductId: input.existingProductId ?? fixtureId('Product', input.sku),
      shopifyVariantId: input.existingVariantId ?? fixtureId('Variant', input.sku),
    }
  }

  async createFulfillment(input: {
    shopifyOrderId: string
    trackingNumber: string
    trackingCompany: string
  }): Promise<ShopifyFulfillment> {
    const existing = this.fulfillments.get(input.shopifyOrderId)
    if (existing) {
      if (existing.trackingNumber !== input.trackingNumber) {
        throw new Error(`shopify order ${input.shopifyOrderId} is already fulfilled`)
      }
      return existing
    }
    const record: ShopifyFulfillment = {
      shopifyOrderId: input.shopifyOrderId,
      shopifyFulfillmentId: fixtureId('Fulfillment', `${input.shopifyOrderId}-${randomUUID()}`),
      trackingNumber: input.trackingNumber,
      trackingCompany: input.trackingCompany,
      fulfilledAt: now(),
    }
    this.fulfillments.set(input.shopifyOrderId, record)
    return record
  }

  async getFulfillment(shopifyOrderId: string): Promise<ShopifyFulfillment | undefined> {
    return this.fulfillments.get(shopifyOrderId)
  }
}

type AdminShopifyOptions = {
  shop: string
  accessToken: string
  apiVersion?: string
}

function shopHost(shop: string): string {
  return shop.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

function numericId(value: string): string {
  const match = /(\d+)\s*$/.exec(value)
  return match?.[1] ?? value
}

export class AdminShopifyStore implements ShopifyStore {
  readonly kind = 'admin' as const
  private readonly fulfillments = new Map<string, ShopifyFulfillment>()
  private readonly host: string
  private readonly token: string
  private readonly apiVersion: string

  constructor(options: AdminShopifyOptions) {
    this.host = shopHost(options.shop)
    this.token = options.accessToken
    this.apiVersion = options.apiVersion ?? '2024-10'
  }

  async upsertListing(input: ShopifyListingInput): Promise<ShopifyProductRef> {
    if (input.existingProductId && input.existingVariantId) {
      return { shopifyProductId: input.existingProductId, shopifyVariantId: input.existingVariantId }
    }
    const payload = await this.request<{ product?: { id?: number; variants?: Array<{ id?: number }> } }>('/products.json', {
      method: 'POST',
      body: JSON.stringify({
        product: {
          title: input.title,
          status: 'draft',
          variants: [{ sku: input.sku, price: input.price.toFixed(2), requires_shipping: true }],
        },
      }),
    })
    const productId = payload.product?.id
    const variantId = payload.product?.variants?.[0]?.id
    if (!productId || !variantId) throw new Error('Shopify product create did not return ids')
    return {
      shopifyProductId: `gid://shopify/Product/${productId}`,
      shopifyVariantId: `gid://shopify/ProductVariant/${variantId}`,
    }
  }

  async createFulfillment(input: {
    shopifyOrderId: string
    trackingNumber: string
    trackingCompany: string
  }): Promise<ShopifyFulfillment> {
    if (input.shopifyOrderId.startsWith('sim-') || input.shopifyOrderId.includes('/fixture-')) {
      const local = new FixtureShopifyStore()
      const record = await local.createFulfillment(input)
      this.fulfillments.set(input.shopifyOrderId, record)
      return record
    }
    const existing = this.fulfillments.get(input.shopifyOrderId)
    if (existing) return existing
    const orderId = numericId(input.shopifyOrderId)
    const open = await this.request<{ fulfillment_orders?: Array<{ id?: number; status?: string }> }>(
      `/orders/${orderId}/fulfillment_orders.json`,
    )
    const fulfillmentOrder = (open.fulfillment_orders ?? []).find((item) => item.status === 'open' || item.status === 'in_progress')
    if (!fulfillmentOrder?.id) throw new Error(`no open Shopify fulfillment order for ${input.shopifyOrderId}`)
    const created = await this.request<{ fulfillment?: { id?: number } }>('/fulfillments.json', {
      method: 'POST',
      body: JSON.stringify({
        fulfillment: {
          line_items_by_fulfillment_order: [{ fulfillment_order_id: fulfillmentOrder.id }],
          tracking_info: { number: input.trackingNumber, company: input.trackingCompany },
          notify_customer: false,
        },
      }),
    })
    const record: ShopifyFulfillment = {
      shopifyOrderId: input.shopifyOrderId,
      shopifyFulfillmentId: created.fulfillment?.id
        ? `gid://shopify/Fulfillment/${created.fulfillment.id}`
        : `gid://shopify/Fulfillment/${randomUUID()}`,
      trackingNumber: input.trackingNumber,
      trackingCompany: input.trackingCompany,
      fulfilledAt: now(),
    }
    this.fulfillments.set(input.shopifyOrderId, record)
    return record
  }

  async getFulfillment(shopifyOrderId: string): Promise<ShopifyFulfillment | undefined> {
    return this.fulfillments.get(shopifyOrderId)
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`https://${this.host}/admin/api/${this.apiVersion}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'X-Shopify-Access-Token': this.token,
        ...init.headers,
      },
    })
    const body = await response.json() as T & { errors?: unknown }
    if (!response.ok) {
      throw new Error(`Shopify Admin API ${response.status}: ${JSON.stringify(body.errors ?? body)}`)
    }
    return body
  }
}

export function createShopifyStore(env: NodeJS.ProcessEnv = process.env): ShopifyStore {
  const shop = env.SHOPIFY_SHOP?.trim()
  const token = env.SHOPIFY_ACCESS_TOKEN?.trim()
  if (shop && token) {
    return new AdminShopifyStore({
      shop,
      accessToken: token,
      apiVersion: env.SHOPIFY_API_VERSION?.trim() || '2024-10',
    })
  }
  return new FixtureShopifyStore()
}
