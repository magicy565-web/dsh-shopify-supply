import type { CatalogSnapshot } from './types.js'

export interface CatalogRepository {
  read(): Promise<CatalogSnapshot>
  write(snapshot: CatalogSnapshot): Promise<void>
}

export function emptyCatalog(): CatalogSnapshot {
  return {
    version: 1,
    products: [],
    variants: [],
    suppliers: [],
    offers: [],
  }
}

export class InMemoryCatalogRepository implements CatalogRepository {
  constructor(private snapshot: CatalogSnapshot = emptyCatalog()) {}

  async read(): Promise<CatalogSnapshot> {
    return structuredClone(this.snapshot)
  }

  async write(snapshot: CatalogSnapshot): Promise<void> {
    this.snapshot = structuredClone(snapshot)
  }
}
