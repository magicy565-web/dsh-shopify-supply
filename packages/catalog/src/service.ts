import type { CatalogRepository } from './repository.js'
import type {
  CatalogProduct,
  CatalogSearchInput,
  CatalogSearchResult,
  CatalogSnapshot,
  CompareOffersInput,
  HydratedOffer,
  OfferComparison,
  Product,
} from './types.js'
import { validateCatalogSnapshot } from './validation.js'

export class CatalogNotFoundError extends Error {
  constructor(identifier: string) {
    super(`Catalog product not found: ${identifier}`)
    this.name = 'CatalogNotFoundError'
  }
}

export class CatalogInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CatalogInputError'
  }
}

function finiteOptional(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new CatalogInputError(`${label} must be non-negative`)
}

function score(product: Product, query: string): number {
  if (!query) return 1
  const sku = product.sku.toLowerCase()
  const title = product.title.toLowerCase()
  if (sku === query) return 100
  if (sku.startsWith(query)) return 80
  if (title.startsWith(query)) return 60
  if (title.includes(query)) return 40
  return 20
}

export class CatalogService {
  constructor(private readonly repository: CatalogRepository) {}

  async importSnapshot(snapshot: CatalogSnapshot): Promise<CatalogSnapshot> {
    const checked = validateCatalogSnapshot(snapshot)
    await this.repository.write(checked)
    return checked
  }

  async search(input: CatalogSearchInput = {}): Promise<CatalogSearchResult> {
    finiteOptional(input.maxUnitPrice, 'maxUnitPrice')
    finiteOptional(input.maxMoq, 'maxMoq')
    finiteOptional(input.maxLeadTimeDays, 'maxLeadTimeDays')
    const snapshot = await this.repository.read()
    const query = input.query?.trim().toLowerCase() ?? ''
    const category = input.category?.trim().toLowerCase()
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? 20), 1), 100)

    const matches = snapshot.products
      .filter((product) => product.status === 'active')
      .filter((product) => !category || product.category.toLowerCase() === category)
      .filter((product) => {
        if (!query) return true
        const variantSkus = snapshot.variants.filter((variant) => variant.productId === product.id).map((variant) => variant.sku)
        return [product.sku, product.title, product.description, product.category, ...product.tags, ...variantSkus]
          .some((value) => value.toLowerCase().includes(query))
      })
      .map((product) => this.hydrate(snapshot, product))
      .map((product) => ({
        ...product,
        offers: product.offers.filter((offer) => (
          (input.maxUnitPrice === undefined || offer.unitPrice <= input.maxUnitPrice)
          && (input.maxMoq === undefined || offer.moq <= input.maxMoq)
          && (input.maxLeadTimeDays === undefined || offer.leadTimeDays <= input.maxLeadTimeDays)
        )),
      }))
      .filter((product) => {
        const hasCommercialFilter = input.maxUnitPrice !== undefined || input.maxMoq !== undefined || input.maxLeadTimeDays !== undefined
        return !hasCommercialFilter || product.offers.length > 0
      })
      .sort((left, right) => score(right, query) - score(left, query) || left.title.localeCompare(right.title))

    return { items: matches.slice(0, limit), total: matches.length }
  }

  async getProduct(identifier: string): Promise<CatalogProduct> {
    const normalized = identifier.trim().toLowerCase()
    const snapshot = await this.repository.read()
    const product = snapshot.products.find((item) => item.id === identifier || item.sku.toLowerCase() === normalized)
    if (!product) throw new CatalogNotFoundError(identifier)
    return this.hydrate(snapshot, product)
  }

  async compareOffers(input: CompareOffersInput): Promise<OfferComparison[]> {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new CatalogInputError('quantity must be a positive integer')
    const productIds = [...new Set(input.productIds)]
    if (productIds.length === 0) throw new CatalogInputError('productIds must not be empty')
    const products = await Promise.all(productIds.map((id) => this.getProduct(id)))
    const comparisons = products.flatMap((product) => product.offers.map((offer) => {
      const orderQuantity = Math.max(input.quantity, offer.moq)
      const merchandiseTotal = Number((orderQuantity * offer.unitPrice).toFixed(2))
      const shippingFlat = offer.shippingFlat ?? 0
      const estimatedTotal = Number((merchandiseTotal + shippingFlat).toFixed(2))
      const warnings: string[] = []
      if (input.quantity < offer.moq) warnings.push(`MOQ requires ordering ${offer.moq - input.quantity} extra units`)
      if (offer.stock !== undefined && orderQuantity > offer.stock) warnings.push(`requested order exceeds reported stock by ${orderQuantity - offer.stock}`)
      return {
        offerId: offer.id,
        productId: product.id,
        productSku: product.sku,
        productTitle: product.title,
        variantSku: offer.variant?.sku,
        supplierId: offer.supplierId,
        supplierName: offer.supplier.name,
        currency: offer.currency,
        requestedQuantity: input.quantity,
        orderQuantity,
        moq: offer.moq,
        unitPrice: offer.unitPrice,
        merchandiseTotal,
        shippingFlat,
        estimatedTotal,
        effectiveUnitPrice: Number((estimatedTotal / orderQuantity).toFixed(4)),
        leadTimeDays: offer.leadTimeDays,
        stock: offer.stock,
        warnings,
      }
    }))

    return comparisons.sort((left, right) => {
      if (left.currency === right.currency) return left.estimatedTotal - right.estimatedTotal || left.leadTimeDays - right.leadTimeDays
      return left.currency.localeCompare(right.currency) || left.estimatedTotal - right.estimatedTotal
    })
  }

  private hydrate(snapshot: CatalogSnapshot, product: Product): CatalogProduct {
    const variants = snapshot.variants.filter((variant) => variant.productId === product.id)
    const variantById = new Map(variants.map((variant) => [variant.id, variant]))
    const supplierById = new Map(snapshot.suppliers.filter((supplier) => supplier.status === 'active').map((supplier) => [supplier.id, supplier]))
    const offers: HydratedOffer[] = snapshot.offers
      .filter((offer) => offer.productId === product.id && offer.status === 'active')
      .flatMap((offer) => {
        const supplier = supplierById.get(offer.supplierId)
        if (!supplier) return []
        const variant = offer.variantId ? variantById.get(offer.variantId) : undefined
        return [{
          ...offer,
          supplier: { id: supplier.id, code: supplier.code, name: supplier.name, country: supplier.country },
          variant: variant ? { id: variant.id, sku: variant.sku, attributes: variant.attributes } : undefined,
        }]
      })
    return { ...product, variants, offers }
  }
}
