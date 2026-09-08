import type { CatalogProduct, HydratedOffer } from '@dsh-supply/catalog'

export const LOCAL_MERCHANT_ID = 'merchant-local'

export type ListingStatus = 'active' | 'inactive'
export type SalesOrderStatus = 'received' | 'routed' | 'fulfilled' | 'failed'
export type PurchaseOrderStatus = 'created' | 'confirmed' | 'shipped'
export type ShopifyStoreKind = 'fixture' | 'admin'

export type Merchant = {
  id: string
  name: string
  destinationCountry: string
  shopifyShop?: string
  createdAt: string
  updatedAt: string
}

export type Listing = {
  id: string
  merchantId: string
  sourcingCaseId: string
  quoteRequestId: string
  offerId: string
  productId: string
  variantId?: string
  supplierId: string
  sku: string
  title: string
  currency: string
  unitPrice: number
  status: ListingStatus
  shopifyProductId?: string
  shopifyVariantId?: string
  createdAt: string
  updatedAt: string
}

export type SalesOrder = {
  id: string
  merchantId: string
  shopifyOrderId: string
  status: SalesOrderStatus
  destinationCountry: string
  createdAt: string
  updatedAt: string
}

export type SalesOrderLine = {
  orderId: string
  listingId: string
  sku: string
  quantity: number
  unitPrice: number
}

export type PurchaseOrder = {
  id: string
  salesOrderId: string
  listingId: string
  supplierId: string
  offerId: string
  status: PurchaseOrderStatus
  quantity: number
  currency: string
  unitCost: number
  warnings: string[]
  trackingNumber?: string
  trackingCompany?: string
  shopifyFulfillmentId?: string
  createdAt: string
  updatedAt: string
}

export type ShopifyFulfillment = {
  shopifyOrderId: string
  shopifyFulfillmentId: string
  trackingNumber: string
  trackingCompany: string
  fulfilledAt: string
}

export type ShopifyListingInput = {
  title: string
  sku: string
  price: number
  currency: string
  existingProductId?: string
  existingVariantId?: string
}

export type ShopifyProductRef = {
  shopifyProductId: string
  shopifyVariantId: string
}

export type ShopifyStore = {
  readonly kind: ShopifyStoreKind
  upsertListing(input: ShopifyListingInput): Promise<ShopifyProductRef>
  createFulfillment(input: {
    shopifyOrderId: string
    trackingNumber: string
    trackingCompany: string
  }): Promise<ShopifyFulfillment>
  getFulfillment(shopifyOrderId: string): Promise<ShopifyFulfillment | undefined>
}

export type CommerceSnapshot = {
  version: 1
  merchants: Merchant[]
  listings: Listing[]
  orders: SalesOrder[]
  orderLines: SalesOrderLine[]
  purchaseOrders: PurchaseOrder[]
}

export type OrderData = {
  item: SalesOrder
  lines: SalesOrderLine[]
  purchaseOrders: PurchaseOrder[]
}

export type ListingView = Listing & {
  product: CatalogProduct
  offer: HydratedOffer
}

export type SalesOrderView = SalesOrder & {
  lines: Array<SalesOrderLine & { listing: ListingView }>
  purchaseOrders: PurchaseOrder[]
  shopifyFulfillment?: ShopifyFulfillment
}

export type CreateListingInput = {
  sourcingCaseId: string
  merchantId?: string
  unitPrice?: number
}

export type IngestOrderLineInput = {
  listingId?: string
  sku?: string
  quantity: number
}

export type IngestOrderInput = {
  shopifyOrderId: string
  merchantId?: string
  destinationCountry?: string
  lines: IngestOrderLineInput[]
}
