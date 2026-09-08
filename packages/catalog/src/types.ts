export type CatalogStatus = 'active' | 'inactive'

export type Product = {
  id: string
  sku: string
  title: string
  description: string
  category: string
  status: CatalogStatus
  tags: string[]
  images: string[]
  createdAt: string
  updatedAt: string
}

export type ProductVariant = {
  id: string
  productId: string
  sku: string
  attributes: Record<string, string>
  weightGrams?: number
}

export type Supplier = {
  id: string
  code: string
  name: string
  country: string
  status: CatalogStatus
}

export type SupplierOffer = {
  id: string
  productId: string
  variantId?: string
  supplierId: string
  currency: string
  unitPrice: number
  moq: number
  leadTimeDays: number
  stock?: number
  shippingFlat?: number
  status: CatalogStatus
  updatedAt: string
}

export type CatalogSnapshot = {
  version: 1
  products: Product[]
  variants: ProductVariant[]
  suppliers: Supplier[]
  offers: SupplierOffer[]
}

export type HydratedOffer = SupplierOffer & {
  supplier: Pick<Supplier, 'id' | 'code' | 'name' | 'country'>
  variant?: Pick<ProductVariant, 'id' | 'sku' | 'attributes'>
}

export type CatalogProduct = Product & {
  variants: ProductVariant[]
  offers: HydratedOffer[]
}

export type CatalogSearchInput = {
  query?: string
  category?: string
  maxUnitPrice?: number
  maxMoq?: number
  maxLeadTimeDays?: number
  limit?: number
}

export type CatalogSearchResult = {
  items: CatalogProduct[]
  total: number
}

export type OfferComparison = {
  offerId: string
  productId: string
  productSku: string
  productTitle: string
  variantSku?: string
  supplierId: string
  supplierName: string
  currency: string
  requestedQuantity: number
  orderQuantity: number
  moq: number
  unitPrice: number
  merchandiseTotal: number
  shippingFlat: number
  estimatedTotal: number
  effectiveUnitPrice: number
  leadTimeDays: number
  stock?: number
  warnings: string[]
}

export type CompareOffersInput = {
  productIds: string[]
  quantity: number
}
