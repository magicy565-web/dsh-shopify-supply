import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  CatalogService,
  CatalogValidationError,
  InMemoryCatalogRepository,
  parseCatalogCsv,
  validateCatalogSnapshot,
} from '@dsh-supply/catalog'

const csv = `product_sku,title,description,category,tags,variant_sku,variant_options,supplier_code,supplier_name,supplier_country,currency,unit_price,moq,lead_time_days,stock,shipping_flat
WB-100,Insulated Bottle,Steel bottle,Drinkware,bottle|gift,WB-100-BLK,Color=Black,SUP-A,Supplier A,CN,USD,4.20,24,7,480,38
WB-100,Insulated Bottle,Steel bottle,Drinkware,bottle|gift,WB-100-BLK,Color=Black,SUP-B,Supplier B,CN,USD,3.95,50,11,1200,52
LB-210,Laptop Sleeve,Canvas sleeve,Bags,laptop,LB-210-NAT,Color=Natural,SUP-C,Supplier C,CN,USD,5.80,20,9,260,45`

test('CSV import keeps products, variants, suppliers, and offers separate', () => {
  const snapshot = parseCatalogCsv(csv, '2026-01-01T00:00:00.000Z')
  assert.equal(snapshot.products.length, 2)
  assert.equal(snapshot.variants.length, 2)
  assert.equal(snapshot.suppliers.length, 3)
  assert.equal(snapshot.offers.length, 3)
  assert.equal(snapshot.offers.filter((offer) => offer.productId === 'product-wb-100').length, 2)
})

test('catalog search applies commercial filters to supplier offers', async () => {
  const service = new CatalogService(new InMemoryCatalogRepository(parseCatalogCsv(csv)))
  const result = await service.search({ query: 'bottle', maxMoq: 30, maxLeadTimeDays: 8 })
  assert.equal(result.total, 1)
  assert.equal(result.items[0]?.sku, 'WB-100')
  assert.deepEqual(result.items[0]?.offers.map((offer) => offer.supplier.code), ['SUP-A'])
})

test('offer comparison includes MOQ uplift, shipping, and warnings', async () => {
  const service = new CatalogService(new InMemoryCatalogRepository(parseCatalogCsv(csv)))
  const result = await service.compareOffers({ productIds: ['WB-100'], quantity: 25 })
  assert.equal(result.length, 2)
  assert.equal(result[0]?.supplierName, 'Supplier A')
  assert.equal(result[0]?.estimatedTotal, 143)
  assert.equal(result[1]?.orderQuantity, 50)
  assert.match(result[1]?.warnings[0] ?? '', /MOQ/)
})

test('catalog validation rejects broken supplier references', () => {
  const snapshot = parseCatalogCsv(csv)
  snapshot.offers[0]!.supplierId = 'missing'
  assert.throws(() => validateCatalogSnapshot(snapshot), CatalogValidationError)
})

test('catalog validation reports malformed imports without crashing', () => {
  assert.throws(() => validateCatalogSnapshot({
    version: 1,
    products: [null],
    variants: [],
    suppliers: [],
    offers: [],
  }), CatalogValidationError)
})

test('repository fixture is parseable by the production CSV importer', async () => {
  const fixture = await readFile(join(process.cwd(), '..', '..', 'data', 'catalog.sample.csv'), 'utf8')
  const snapshot = parseCatalogCsv(fixture)
  assert.equal(snapshot.products.length, 3)
  assert.equal(snapshot.offers.length, 4)
})
