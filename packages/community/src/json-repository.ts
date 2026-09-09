import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { emptyCommunity, type CommunitySnapshot } from './types.js'
import { validateCommunitySnapshot } from './validation.js'

export class JsonCommunityRepository {
  private writes: Promise<void> = Promise.resolve()

  constructor(readonly filePath: string) {}

  async read(): Promise<CommunitySnapshot> {
    try {
      return validateCommunitySnapshot(JSON.parse(await readFile(this.filePath, 'utf8')) as unknown)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyCommunity()
      throw error
    }
  }

  async write(snapshot: CommunitySnapshot): Promise<void> {
    this.writes = this.writes.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true })
      const temporary = `${this.filePath}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
      await rename(temporary, this.filePath)
    })
    return this.writes
  }
}
