import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { CatalogRepository } from './repository.js'
import { emptyCatalog } from './repository.js'
import type { CatalogSnapshot } from './types.js'
import { validateCatalogSnapshot } from './validation.js'

export class JsonCatalogRepository implements CatalogRepository {
  private writes: Promise<void> = Promise.resolve()

  constructor(readonly filePath: string) {}

  async read(): Promise<CatalogSnapshot> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown
      return validateCatalogSnapshot(parsed)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyCatalog()
      throw error
    }
  }

  async write(snapshot: CatalogSnapshot): Promise<void> {
    const checked = validateCatalogSnapshot(snapshot)
    this.writes = this.writes.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true })
      const temporary = `${this.filePath}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify(checked, null, 2)}\n`, 'utf8')
      await rename(temporary, this.filePath)
    })
    return this.writes
  }
}
