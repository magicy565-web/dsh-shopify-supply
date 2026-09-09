import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  defaultCapabilities,
  emptyArtifacts,
  emptyCampaign,
  emptyStages,
  now,
} from './helpers.js'
import type { LaunchCampaign, LaunchRun, LaunchStage, LaunchStageId } from './types.js'
import { LaunchInputError, LaunchNotFoundError } from './types.js'

function isRun(value: unknown): value is LaunchRun {
  if (!value || typeof value !== 'object') return false
  const run = value as LaunchRun
  return typeof run.id === 'string' && typeof run.goal === 'string' && Array.isArray(run.stages) && run.campaign && typeof run.campaign === 'object'
}

export class JsonLaunchRepository {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async read(): Promise<LaunchRun[]> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown
      const items = parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : Array.isArray(parsed) ? parsed : []
      return items.filter(isRun)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  async write(items: LaunchRun[]): Promise<void> {
    this.queue = this.queue.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true })
      const temp = `${this.filePath}.${process.pid}.tmp`
      await writeFile(temp, `${JSON.stringify({ items }, null, 2)}\n`, 'utf8')
      await rename(temp, this.filePath)
    })
    await this.queue
  }
}

export class LaunchService {
  private queue: Promise<unknown> = Promise.resolve()
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(work)
    this.queue = next
    return next
  }
  constructor(private readonly repository: JsonLaunchRepository) {}

  async list(): Promise<LaunchRun[]> {
    const items = await this.repository.read()
    return items.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async get(id: string): Promise<LaunchRun> {
    const found = (await this.repository.read()).find((item) => item.id === id)
    if (!found) throw new LaunchNotFoundError('发布任务不存在')
    return structuredClone(found)
  }

  async create(goal: string, sessionId: string): Promise<LaunchRun> {
    return this.serial(async () => {
    const trimmed = goal.trim()
    if (trimmed.length < 4) throw new LaunchInputError('请用一句话说明你想做的产品')
    const id = `local-${randomUUID()}`
    const timestamp = now()
    const run: LaunchRun = {
      id,
      sessionId,
      goal: trimmed.slice(0, 2000),
      status: 'idle',
      currentStage: 'define',
      resumeStep: 0,
      activity: '等待开始',
      error: '',
      flow: 'agent',
      capabilities: defaultCapabilities(),
      stages: emptyStages(),
      campaign: emptyCampaign(id),
      artifacts: emptyArtifacts(),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const items = await this.repository.read()
    items.unshift(run)
    await this.repository.write(items)
    return structuredClone(run)
    })
  }

  async mutate(id: string, fn: (run: LaunchRun) => void): Promise<LaunchRun> {
    return this.serial(async () => {
    const items = await this.repository.read()
    const run = items.find((item) => item.id === id)
    if (!run) throw new LaunchNotFoundError('发布任务不存在')
    fn(run)
    run.updatedAt = now()
    await this.repository.write(items)
    return structuredClone(run)
    })
  }

  async saveCampaign(id: string, campaign: LaunchCampaign): Promise<LaunchRun> {
    const d = campaign?.draft, c = campaign?.content
    if (!d || !c || !['name','tagline','category','stage','creator','city','image','story','highlights','goal'].every(k => typeof (d as unknown as Record<string, unknown>)[k] === 'string') || !Array.isArray(d.needs) || !d.needs.every(v => typeof v === 'string') || !['video','audience','milestones','participation','team','risks'].every(k => typeof (c as unknown as Record<string, unknown>)[k] === 'string') || !Array.isArray(c.gallery) || !c.gallery.every(v => typeof v === 'string')) throw new LaunchInputError('Incomplete campaign draft schema')
    return this.mutate(id, (run) => {
      run.campaign = {
        ...campaign,
        id: run.id,
        published: null,
        status: 'draft',
        updatedAt: now(),
      }
    })
  }

  async recordStage(id: string, stage: LaunchStage): Promise<LaunchRun> {
    if (!stage || !['define','research','supply','draft','review'].includes(stage.id) || !['pending','running','done','failed','skipped'].includes(stage.status) || typeof stage.title !== 'string' || typeof stage.summary !== 'string' || !Array.isArray(stage.evidence) || !stage.evidence.every(e => e && ['fact','inference','missing'].includes(e.kind) && typeof e.text === 'string') || !Array.isArray(stage.questions) || !stage.questions.every(q => typeof q === 'string')) throw new LaunchInputError('Invalid stage evidence')
    return this.mutate(id, (run) => {
      run.stages = run.stages.map((item) => item.id === stage.id ? stage : item)
      run.currentStage = stage.id
    })
  }

  async setCapability(id: string, capabilityId: string, status: LaunchRun['capabilities'][number]['status'], detail: string): Promise<LaunchRun> {
    return this.mutate(id, (run) => {
      run.capabilities = run.capabilities.map((item) => item.id === capabilityId ? { ...item, status, detail } : item)
    })
  }

  async bindSession(id: string, sessionId: string): Promise<LaunchRun> {
    return this.mutate(id, (run) => {
      run.sessionId = sessionId
    })
  }
}
