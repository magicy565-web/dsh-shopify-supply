import type {
  CommerceSnapshot,
  Listing,
  Merchant,
  OrderData,
  PurchaseOrder,
  SalesOrder,
  SalesOrderLine,
} from './types.js'
import { LOCAL_MERCHANT_ID } from './types.js'

export interface CommerceRepository {
  listMerchants(): Promise<Merchant[]>
  getMerchant(merchantId: string): Promise<Merchant | undefined>
  createMerchant(item: Merchant): Promise<void>
  listListings(): Promise<Listing[]>
  getListing(listingId: string): Promise<Listing | undefined>
  findListingByOffer(merchantId: string, offerId: string): Promise<Listing | undefined>
  findListingBySku(merchantId: string, sku: string): Promise<Listing | undefined>
  createListing(item: Listing): Promise<void>
  listOrders(): Promise<SalesOrder[]>
  getOrder(orderId: string): Promise<OrderData | undefined>
  findOrderByShopifyId(shopifyOrderId: string): Promise<OrderData | undefined>
  ingestOrder(order: SalesOrder, lines: SalesOrderLine[], purchaseOrders: PurchaseOrder[]): Promise<void>
  confirmPurchaseOrder(order: SalesOrder, purchaseOrder: PurchaseOrder): Promise<void>
  shipPurchaseOrder(order: SalesOrder, purchaseOrder: PurchaseOrder): Promise<void>
}

export function emptyCommerce(): CommerceSnapshot {
  const timestamp = '1970-01-01T00:00:00.000Z'
  return {
    version: 1,
    merchants: [{
      id: LOCAL_MERCHANT_ID,
      name: 'Local US Shopify',
      destinationCountry: 'US',
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    listings: [],
    orders: [],
    orderLines: [],
    purchaseOrders: [],
  }
}

export abstract class SnapshotCommerceRepository implements CommerceRepository {
  private mutations: Promise<void> = Promise.resolve()

  protected abstract load(): Promise<CommerceSnapshot>
  protected abstract save(snapshot: CommerceSnapshot): Promise<void>

  async listMerchants(): Promise<Merchant[]> {
    return structuredClone((await this.load()).merchants)
  }

  async getMerchant(merchantId: string): Promise<Merchant | undefined> {
    return structuredClone((await this.load()).merchants.find((item) => item.id === merchantId))
  }

  async createMerchant(item: Merchant): Promise<void> {
    return this.mutate((snapshot) => {
      if (snapshot.merchants.some((entry) => entry.id === item.id)) return
      snapshot.merchants.push(item)
    })
  }

  async listListings(): Promise<Listing[]> {
    return structuredClone((await this.load()).listings)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async getListing(listingId: string): Promise<Listing | undefined> {
    return structuredClone((await this.load()).listings.find((item) => item.id === listingId))
  }

  async findListingByOffer(merchantId: string, offerId: string): Promise<Listing | undefined> {
    return structuredClone((await this.load()).listings.find((item) => item.merchantId === merchantId && item.offerId === offerId))
  }

  async findListingBySku(merchantId: string, sku: string): Promise<Listing | undefined> {
    const normalized = sku.trim().toLowerCase()
    return structuredClone((await this.load()).listings.find((item) => (
      item.merchantId === merchantId && item.sku.toLowerCase() === normalized
    )))
  }

  async createListing(item: Listing): Promise<void> {
    return this.mutate((snapshot) => {
      if (snapshot.listings.some((entry) => entry.id === item.id || (entry.merchantId === item.merchantId && entry.offerId === item.offerId))) {
        throw new Error(`listing already exists for offer ${item.offerId}`)
      }
      snapshot.listings.push(item)
    })
  }

  async listOrders(): Promise<SalesOrder[]> {
    return structuredClone((await this.load()).orders)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async getOrder(orderId: string): Promise<OrderData | undefined> {
    return this.orderData(await this.load(), (item) => item.id === orderId)
  }

  async findOrderByShopifyId(shopifyOrderId: string): Promise<OrderData | undefined> {
    return this.orderData(await this.load(), (item) => item.shopifyOrderId === shopifyOrderId)
  }

  async ingestOrder(order: SalesOrder, lines: SalesOrderLine[], purchaseOrders: PurchaseOrder[]): Promise<void> {
    return this.mutate((snapshot) => {
      if (snapshot.orders.some((entry) => entry.shopifyOrderId === order.shopifyOrderId || entry.id === order.id)) {
        throw new Error(`sales order already exists: ${order.shopifyOrderId}`)
      }
      snapshot.orders.push(order)
      snapshot.orderLines.push(...lines)
      snapshot.purchaseOrders.push(...purchaseOrders)
    })
  }

  async confirmPurchaseOrder(order: SalesOrder, purchaseOrder: PurchaseOrder): Promise<void> {
    return this.mutate((snapshot) => {
      const current = snapshot.purchaseOrders.find((entry) => entry.id === purchaseOrder.id)
      if (!current) throw new Error(`purchase order disappeared: ${purchaseOrder.id}`)
      if (current.status === 'shipped') throw new Error(`purchase order ${purchaseOrder.id} is already shipped`)
      this.replaceOrder(snapshot, order)
      Object.assign(current, purchaseOrder)
    })
  }

  async shipPurchaseOrder(order: SalesOrder, purchaseOrder: PurchaseOrder): Promise<void> {
    return this.mutate((snapshot) => {
      const current = snapshot.purchaseOrders.find((entry) => entry.id === purchaseOrder.id)
      if (!current) throw new Error(`purchase order disappeared: ${purchaseOrder.id}`)
      if (current.status === 'shipped') throw new Error(`purchase order ${purchaseOrder.id} is already shipped`)
      this.replaceOrder(snapshot, order)
      Object.assign(current, purchaseOrder)
    })
  }

  private replaceOrder(snapshot: CommerceSnapshot, order: SalesOrder): void {
    const index = snapshot.orders.findIndex((entry) => entry.id === order.id)
    if (index < 0) throw new Error(`sales order disappeared: ${order.id}`)
    snapshot.orders[index] = order
  }

  private orderData(snapshot: CommerceSnapshot, match: (item: SalesOrder) => boolean): OrderData | undefined {
    const item = snapshot.orders.find(match)
    if (!item) return undefined
    return structuredClone({
      item,
      lines: snapshot.orderLines.filter((entry) => entry.orderId === item.id),
      purchaseOrders: snapshot.purchaseOrders.filter((entry) => entry.salesOrderId === item.id),
    })
  }

  private async mutate(change: (snapshot: CommerceSnapshot) => void): Promise<void> {
    this.mutations = this.mutations.catch(() => undefined).then(async () => {
      const snapshot = await this.load()
      change(snapshot)
      await this.save(snapshot)
    })
    return this.mutations
  }
}

export class InMemoryCommerceRepository extends SnapshotCommerceRepository {
  constructor(private snapshot: CommerceSnapshot = emptyCommerce()) { super() }

  protected async load(): Promise<CommerceSnapshot> {
    return structuredClone(this.snapshot)
  }

  protected async save(snapshot: CommerceSnapshot): Promise<void> {
    this.snapshot = structuredClone(snapshot)
  }
}
