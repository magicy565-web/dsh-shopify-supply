import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { emptyProcurement, SnapshotProcurementRepository } from './repository.js'
import type { ProcurementSnapshot } from './types.js'
import { validateProcurementSnapshot } from './validation.js'

export class JsonProcurementRepository extends SnapshotProcurementRepository {
  constructor(readonly filePath: string) { super() }

  protected async load(): Promise<ProcurementSnapshot> {
    try {
      return validateProcurementSnapshot(JSON.parse(await readFile(this.filePath, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyProcurement()
      throw error
    }
  }

  protected async save(snapshot: ProcurementSnapshot): Promise<void> {
    const checked = validateProcurementSnapshot(snapshot)
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(checked, null, 2)}\n`, 'utf8')
    await rename(temporary, this.filePath)
  }
}
