import { randomUUID } from 'node:crypto'
import type { CatalogService } from '@dsh-supply/catalog'
import type { ProcurementService } from '@dsh-supply/procurement'
import type { CommerceRepository } from './repository.js'
import type {
  CreateListingInput,
  IngestOrderInput,
  Listing,
  ListingView,
  Merchant,
  PurchaseOrder,
  SalesOrder,
  SalesOrderLine,
  SalesOrderView,
  ShopifyStore,
} from './types.js'
import { LOCAL_MERCHANT_ID } from './types.js'

export class CommerceInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommerceInputError'
  }
}

export class CommerceNotFoundError extends Error {
  constructor(kind: string, id: string) {
    super(`${kind} not found: ${id}`)
    this.name = 'CommerceNotFoundError'
  }
}

function now(): string {
  return new Date().toISOString()
}

function required(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new CommerceInputError(`${label} is required`)
  return normalized
}

export class CommerceService {
  constructor(
    private readonly repository: CommerceRepository,
    private readonly catalog: CatalogService,
    private readonly procurement: ProcurementService,
    readonly shopify: ShopifyStore,
  ) {}

  async listMerchants(): Promise<Merchant[]> {
    return this.repository.listMerchants()
  }

  async listListings(): Promise<ListingView[]> {
    return Promise.all((await this.repository.listListings()).map((item) => this.hydrateListing(item)))
  }

  async getListing(listingId: string): Promise<ListingView> {
    const item = await this.repository.getListing(listingId)
    if (!item) throw new CommerceNotFoundError('listing', listingId)
    return this.hydrateListing(item)
  }

  async listOrders(): Promise<SalesOrderView[]> {
    return Promise.all((await this.repository.listOrders()).map((item) => this.getOrder(item.id)))
  }

  async getOrder(orderId: string): Promise<SalesOrderView> {
    const data = await this.repository.getOrder(orderId)
    if (!data) throw new CommerceNotFoundError('sales order', orderId)
    return this.hydrateOrder(data)
  }

  async createListingsFromCase(input: CreateListingInput): Promise<ListingView[]> {
    const merchantId = input.merchantId?.trim() || LOCAL_MERCHANT_ID
    const merchant = await this.repository.getMerchant(merchantId)
    if (!merchant) throw new CommerceNotFoundError('merchant', merchantId)
    const sourcing = await this.procurement.getCase(input.sourcingCaseId)
    if (sourcing.status !== 'approved') throw new CommerceInputError('only an approved sourcing case can be listed for dropship')
    const approved = sourcing.quoteRequests.filter((entry) => entry.status === 'approved')
    if (approved.length === 0) throw new CommerceInputError('approved sourcing case has no approved quote request')
    const offers = new Map(
      sourcing.candidates.flatMap((candidate) => candidate.product.offers.map((offer) => [offer.id, candidate.product.id] as const)),
    )
    const created: ListingView[] = []
    for (const quote of approved) {
      for (const line of quote.items) {
        const productId = offers.get(line.offerId)
        if (!productId) throw new CommerceInputError(`offer ${line.offerId} is not attached to a candidate product`)
        created.push(await this.createListingForOffer({
          merchantId,
          sourcingCaseId: sourcing.id,
          quoteRequestId: quote.id,
          productId,
          offerId: line.offerId,
          unitPrice: input.unitPrice,
        }))
      }
    }
    if (created.length === 0) throw new CommerceInputError('approved quote request has no offer lines')
    return created
  }

  async ingestOrder(input: IngestOrderInput): Promise<SalesOrderView> {
    const shopifyOrderId = required(input.shopifyOrderId, 'shopifyOrderId')
    const existing = await this.repository.findOrderByShopifyId(shopifyOrderId)
    if (existing) return this.hydrateOrder(existing)
    if (!Array.isArray(input.lines) || input.lines.length === 0) throw new CommerceInputError('order lines must not be empty')
    const merchantId = input.merchantId?.trim() || LOCAL_MERCHANT_ID
    const merchant = await this.repository.getMerchant(merchantId)
    if (!merchant) throw new CommerceNotFoundError('merchant', merchantId)
    const destinationCountry = (input.destinationCountry?.trim() || merchant.destinationCountry).toUpperCase()
    const timestamp = now()
    const order: SalesOrder = {
      id: `order-${randomUUID()}`,
      merchantId,
      shopifyOrderId,
      status: 'routed',
      destinationCountry,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const lines: SalesOrderLine[] = []
    const purchaseOrders: PurchaseOrder[] = []
    for (const line of input.lines) {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new CommerceInputError('quantity must be a positive integer')
      const listing = await this.resolveListing(merchantId, line.listingId, line.sku)
      if (listing.status !== 'active') throw new CommerceInputError(`listing ${listing.id} is not active`)
      const view = await this.hydrateListing(listing)
      lines.push({
        orderId: order.id,
        listingId: listing.id,
        sku: listing.sku,
        quantity: line.quantity,
        unitPrice: listing.unitPrice,
      })
      const warnings: string[] = []
      if (line.quantity < view.offer.moq) warnings.push(`dropship quantity ${line.quantity} is below offer MOQ ${view.offer.moq}`)
      purchaseOrders.push({
        id: `po-${randomUUID()}`,
        salesOrderId: order.id,
        listingId: listing.id,
        supplierId: listing.supplierId,
        offerId: listing.offerId,
        status: 'created',
        quantity: line.quantity,
        currency: view.offer.currency,
        unitCost: view.offer.unitPrice,
        warnings,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }
    try {
      await this.repository.ingestOrder(order, lines, purchaseOrders)
    } catch (error) {
      const raced = await this.repository.findOrderByShopifyId(shopifyOrderId)
      if (raced) return this.hydrateOrder(raced)
      throw error
    }
    return this.getOrder(order.id)
  }

  async simulateShopifyOrder(listingId: string, quantity: number, destinationCountry?: string): Promise<SalesOrderView> {
    return this.ingestOrder({
      shopifyOrderId: `sim-${randomUUID()}`,
      lines: [{ listingId, quantity }],
      destinationCountry,
    })
  }

  async confirmPurchaseOrder(orderId: string, purchaseOrderId: string): Promise<SalesOrderView> {
    const data = await this.repository.getOrder(orderId)
    if (!data) throw new CommerceNotFoundError('sales order', orderId)
    const purchaseOrder = data.purchaseOrders.find((entry) => entry.id === purchaseOrderId)
    if (!purchaseOrder) throw new CommerceNotFoundError('purchase order', purchaseOrderId)
    if (purchaseOrder.status === 'shipped') throw new CommerceInputError('cannot confirm a shipped purchase order')
    const timestamp = now()
    purchaseOrder.status = 'confirmed'
    purchaseOrder.updatedAt = timestamp
    data.item.updatedAt = timestamp
    await this.repository.confirmPurchaseOrder(data.item, purchaseOrder)
    return this.getOrder(orderId)
  }

  async shipPurchaseOrder(
    orderId: string,
    purchaseOrderId: string,
    trackingNumber: string,
    trackingCompany = 'Other',
  ): Promise<SalesOrderView> {
    const data = await this.repository.getOrder(orderId)
    if (!data) throw new CommerceNotFoundError('sales order', orderId)
    const purchaseOrder = data.purchaseOrders.find((entry) => entry.id === purchaseOrderId)
    if (!purchaseOrder) throw new CommerceNotFoundError('purchase order', purchaseOrderId)
    if (purchaseOrder.status === 'shipped') throw new CommerceInputError('purchase order is already shipped')
    const timestamp = now()
    const fulfillment = await this.shopify.createFulfillment({
      shopifyOrderId: data.item.shopifyOrderId,
      trackingNumber: required(trackingNumber, 'trackingNumber'),
      trackingCompany: required(trackingCompany, 'trackingCompany'),
    })
    purchaseOrder.status = 'shipped'
    purchaseOrder.trackingNumber = fulfillment.trackingNumber
    purchaseOrder.trackingCompany = fulfillment.trackingCompany
    purchaseOrder.shopifyFulfillmentId = fulfillment.shopifyFulfillmentId
    purchaseOrder.updatedAt = timestamp
    data.item.updatedAt = timestamp
    if (data.purchaseOrders.every((entry) => entry.id === purchaseOrder.id || entry.status === 'shipped')) {
      data.item.status = 'fulfilled'
    }
    await this.repository.shipPurchaseOrder(data.item, purchaseOrder)
    return this.getOrder(orderId)
  }

  parseShopifyOrderWebhook(body: Record<string, unknown>, merchantId = LOCAL_MERCHANT_ID): IngestOrderInput {
    const shopifyOrderId = body.admin_graphql_api_id ?? body.id
    if (shopifyOrderId === undefined || shopifyOrderId === null) throw new CommerceInputError('shopify order id is required')
    const shipping = (body.shipping_address ?? {}) as Record<string, unknown>
    const rawLines = Array.isArray(body.line_items) ? body.line_items : []
    const lines = rawLines.map((entry) => {
      const line = (entry ?? {}) as Record<string, unknown>
      const sku = typeof line.sku === 'string' ? line.sku : ''
      const quantity = Number(line.quantity)
      return { sku, quantity }
    })
    return {
      shopifyOrderId: String(shopifyOrderId),
      merchantId,
      destinationCountry: typeof shipping.country_code === 'string' ? shipping.country_code : undefined,
      lines,
    }
  }

  private async createListingForOffer(input: {
    merchantId: string
    sourcingCaseId: string
    quoteRequestId: string
    productId: string
    offerId: string
    unitPrice?: number
  }): Promise<ListingView> {
    const existing = await this.repository.findListingByOffer(input.merchantId, input.offerId)
    if (existing) return this.hydrateListing(existing)
    const product = await this.catalog.getProduct(input.productId)
    const offer = product.offers.find((item) => item.id === input.offerId)
    if (!offer) throw new CommerceInputError(`offer ${input.offerId} is not an active catalog offer`)
    const sku = offer.variant?.sku ?? product.sku
    const skuClash = await this.repository.findListingBySku(input.merchantId, sku)
    if (skuClash) throw new CommerceInputError(`merchant already lists SKU ${sku}`)
    if (input.unitPrice !== undefined && (!Number.isFinite(input.unitPrice) || input.unitPrice <= 0)) {
      throw new CommerceInputError('unitPrice must be a positive number')
    }
    const timestamp = now()
    const shopify = await this.shopify.upsertListing({
      title: product.title,
      sku,
      price: input.unitPrice ?? offer.unitPrice,
      currency: offer.currency,
    })
    const listing: Listing = {
      id: `listing-${randomUUID()}`,
      merchantId: input.merchantId,
      sourcingCaseId: input.sourcingCaseId,
      quoteRequestId: input.quoteRequestId,
      offerId: offer.id,
      productId: product.id,
      variantId: offer.variantId,
      supplierId: offer.supplierId,
      sku,
      title: product.title,
      currency: offer.currency,
      unitPrice: input.unitPrice ?? offer.unitPrice,
      status: 'active',
      shopifyProductId: shopify.shopifyProductId,
      shopifyVariantId: shopify.shopifyVariantId,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    try {
      await this.repository.createListing(listing)
    } catch (error) {
      const raced = await this.repository.findListingByOffer(input.merchantId, input.offerId)
      if (raced) return this.hydrateListing(raced)
      throw error
    }
    return this.hydrateListing(listing)
  }

  private async resolveListing(merchantId: string, listingId: string | undefined, sku: string | undefined): Promise<Listing> {
    if (listingId?.trim()) {
      const listing = await this.repository.getListing(listingId.trim())
      if (!listing || listing.merchantId !== merchantId) throw new CommerceNotFoundError('listing', listingId)
      return listing
    }
    if (sku?.trim()) {
      const listing = await this.repository.findListingBySku(merchantId, sku)
      if (!listing) throw new CommerceInputError(`no dropship listing mapped to SKU ${sku.trim()}`)
      return listing
    }
    throw new CommerceInputError('each order line needs listingId or sku')
  }

  private async hydrateListing(item: Listing): Promise<ListingView> {
    const product = await this.catalog.getProduct(item.productId)
    const offer = product.offers.find((entry) => entry.id === item.offerId)
    if (!offer) throw new CommerceInputError(`listing ${item.id} is missing its supplier offer`)
    return { ...item, product, offer }
  }

  private async hydrateOrder(data: { item: SalesOrder; lines: SalesOrderLine[]; purchaseOrders: PurchaseOrder[] }): Promise<SalesOrderView> {
    const lines = await Promise.all(data.lines.map(async (line) => {
      const listing = await this.getListing(line.listingId)
      return { ...line, listing }
    }))
    return {
      ...data.item,
      lines,
      purchaseOrders: data.purchaseOrders,
      shopifyFulfillment: await this.shopify.getFulfillment(data.item.shopifyOrderId),
    }
  }
}
