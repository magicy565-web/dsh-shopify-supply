import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export type InspirationProject = {
  id: string; name: string; tagline: string; category: string; stage: string; creator: string; city: string; image: string
  story: string; highlights: string[]; needs: string[]; supporters: number; goal: number; date: string
  updates: Array<{ date: string; title: string; body: string }>; demo: boolean
}
export type InspirationComment = { id: string; projectId: string; text: string; date: string; author: string }
export type InspirationSnapshot = { projects: InspirationProject[]; saved: Record<string, string[]>; following: Record<string, string[]>; comments: InspirationComment[] }
export class InspirationNotFoundError extends Error {}
export class InspirationInputError extends Error {}

const empty = (): InspirationSnapshot => ({ projects: [], saved: {}, following: {}, comments: [] })
const clean = (value: unknown, max = 6000) => typeof value === 'string' ? value.trim().slice(0, max) : ''
function validProject(value: unknown): value is InspirationProject {
  if (!value || typeof value !== 'object') return false
  const p = value as InspirationProject
  return typeof p.id === 'string' && p.id.startsWith('local-') && clean(p.name, 60).length > 0 && clean(p.tagline, 120).length > 0 && clean(p.creator, 80).length > 0 && clean(p.city, 80).length > 0 && clean(p.story).length >= 40 && typeof p.image === 'string' && p.image.length <= 2_000_000 && Array.isArray(p.highlights) && p.highlights.length > 0 && p.highlights.every(x => typeof x === 'string') && Array.isArray(p.needs) && p.needs.every(x => typeof x === 'string') && Number.isSafeInteger(p.goal) && p.goal > 0 && Number.isSafeInteger(p.supporters) && p.supporters >= 0 && Array.isArray(p.updates) && p.demo === false
}
function validate(value: unknown): InspirationSnapshot {
  if (!value || typeof value !== 'object') return empty()
  const raw = value as Partial<InspirationSnapshot>
  return {
    projects: Array.isArray(raw.projects) ? raw.projects.filter(validProject) : [],
    saved: raw.saved && typeof raw.saved === 'object' ? raw.saved as Record<string, string[]> : {},
    following: raw.following && typeof raw.following === 'object' ? raw.following as Record<string, string[]> : {},
    comments: Array.isArray(raw.comments) ? raw.comments.filter(c => c && typeof c.id === 'string' && typeof c.projectId === 'string' && typeof c.text === 'string') as InspirationComment[] : [],
  }
}

export class InspirationService {
  private queue: Promise<void> = Promise.resolve()
  constructor(private readonly filePath: string) {}
  private async read() { try { return validate(JSON.parse(await readFile(this.filePath, 'utf8'))) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return empty(); throw e } }
  private async write(snapshot: InspirationSnapshot) { await mkdir(dirname(this.filePath), { recursive: true }); const temp = `${this.filePath}.${process.pid}.tmp`; await writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8'); await rename(temp, this.filePath) }
  private async mutate<T>(fn: (snapshot: InspirationSnapshot) => T | Promise<T>) { let result!: T; this.queue = this.queue.then(async () => { const snapshot = await this.read(); result = await fn(snapshot); await this.write(snapshot) }); await this.queue; return result }
  async list() { const snapshot = await this.read(); return snapshot.projects.slice().sort((a, b) => b.date.localeCompare(a.date)) }
  async get(id: string) { const p = (await this.read()).projects.find(item => item.id === id); if (!p) throw new InspirationNotFoundError('灵感项目不存在'); return p }
  async create(input: Partial<InspirationProject>) { return this.mutate(snapshot => { const p: InspirationProject = { id: `local-${randomUUID()}`, name: clean(input.name, 60), tagline: clean(input.tagline, 120), category: clean(input.category, 40), stage: clean(input.stage, 40), creator: clean(input.creator, 80), city: clean(input.city, 80), image: clean(input.image, 2_000_000), story: clean(input.story), highlights: Array.isArray(input.highlights) ? input.highlights.filter(x => typeof x === 'string').slice(0, 30) : [], needs: Array.isArray(input.needs) ? input.needs.filter(x => typeof x === 'string').slice(0, 20) : [], supporters: 0, goal: Number.isSafeInteger(input.goal) ? Number(input.goal) : 100, date: new Date().toISOString().slice(0, 10), updates: [], demo: false }; if (!validProject(p)) throw new InspirationInputError('项目内容不完整或不符合发布要求'); snapshot.projects.unshift(p); return p }) }
  async update(id: string, input: Partial<InspirationProject>) { return this.mutate(snapshot => { const index = snapshot.projects.findIndex(p => p.id === id); if (index < 0) throw new InspirationNotFoundError('灵感项目不存在'); const old = snapshot.projects[index]; const next = { ...old, ...input, id: old.id, supporters: old.supporters, demo: false }; if (!validProject(next)) throw new InspirationInputError('项目内容不完整或不符合发布要求'); snapshot.projects[index] = next; return next }) }
  async remove(id: string) { return this.mutate(snapshot => { const exists = snapshot.projects.some(p => p.id === id); if (!exists) throw new InspirationNotFoundError('灵感项目不存在'); snapshot.projects = snapshot.projects.filter(p => p.id !== id); for (const map of [snapshot.saved, snapshot.following]) for (const key of Object.keys(map)) map[key] = (map[key] ?? []).filter(x => x !== id); snapshot.comments = snapshot.comments.filter(c => c.projectId !== id); return { ok: true } }) }
  async toggle(id: string, kind: 'saved' | 'following', viewer = 'local') { return this.mutate(async snapshot => { if (!snapshot.projects.some(p => p.id === id)) throw new InspirationNotFoundError('灵感项目不存在'); const list = snapshot[kind][viewer] ?? []; const present = list.includes(id); snapshot[kind][viewer] = present ? list.filter(x => x !== id) : [...list, id]; if (kind === 'following') { const p = snapshot.projects.find(x => x.id === id)!; p.supporters = Math.max(0, p.supporters + (present ? -1 : 1)) } return { active: !present } }) }
  async commentsFor(id: string) { return (await this.read()).comments.filter(c => c.projectId === id).sort((a, b) => b.date.localeCompare(a.date)) }
  async comment(id: string, text: string, author = '本地用户') { return this.mutate(snapshot => { if (!snapshot.projects.some(p => p.id === id)) throw new InspirationNotFoundError('灵感项目不存在'); const c = { id: randomUUID(), projectId: id, text: clean(text, 1000), date: new Date().toISOString(), author }; if (c.text.length < 2) throw new InspirationInputError('反馈至少需要 2 个字'); snapshot.comments.unshift(c); return c }) }
  async updateProgress(id: string, title: string, body: string) { return this.mutate(snapshot => { const p = snapshot.projects.find(x => x.id === id); if (!p) throw new InspirationNotFoundError('灵感项目不存在'); if (clean(title, 80).length < 2 || clean(body, 2000).length < 8) throw new InspirationInputError('进展内容太短'); p.updates.unshift({ date: new Date().toISOString().slice(0, 10), title: clean(title, 80), body: clean(body, 2000) }); return p }) }
  async viewerState(id: string, viewer = 'local') { const s = await this.read(); return { saved: (s.saved[viewer] ?? []).includes(id), following: (s.following[viewer] ?? []).includes(id), comments: s.comments.filter(c => c.projectId === id) } }
}
