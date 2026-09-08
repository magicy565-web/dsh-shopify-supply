import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { emptyCommerce, SnapshotCommerceRepository } from './repository.js'
import type { CommerceSnapshot } from './types.js'
import { validateCommerceSnapshot } from './validation.js'

export class JsonCommerceRepository extends SnapshotCommerceRepository {
  constructor(readonly filePath: string) { super() }

  protected async load(): Promise<CommerceSnapshot> {
    try {
      return validateCommerceSnapshot(JSON.parse(await readFile(this.filePath, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyCommerce()
      throw error
    }
  }

  protected async save(snapshot: CommerceSnapshot): Promise<void> {
    const checked = validateCommerceSnapshot(snapshot)
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(checked, null, 2)}\n`, 'utf8')
    await rename(temporary, this.filePath)
  }
}
