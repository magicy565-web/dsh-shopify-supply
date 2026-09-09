import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { hashPassword, hashToken, newToken, sessionExpiry, verifyPassword } from './auth.js'
import { CommunityForbiddenError, CommunityInputError, CommunityNotFoundError, CommunityUnauthorizedError } from './errors.js'
import type { JsonCommunityRepository } from './json-repository.js'
import {
  emptyContent,
  emptyDraft,
  publicUser,
  type ApplicationKind,
  type AuthResult,
  type Campaign,
  type CampaignSaveInput,
  type CommunityAdminSeed,
  type CommunityNotification,
  type CommunitySnapshot,
  type MediaAsset,
  type MigrateResult,
  type ProjectApplication,
  type ProjectComment,
  type PublicUser,
  type PublishedProject,
  type ViewerState,
} from './types.js'
import {
  assertReadyToSubmit,
  campaignIssues,
  clean,
  isSafeImage,
  normalizeEmail,
  parseDataImage,
  parseEmail,
  parseName,
  parsePassword,
  sanitizeContent,
  sanitizeDraft,
  toPublishedProject,
} from './validation.js'

const EDITABLE = new Set(['draft', 'changes'])
const SESSION_DAYS = 30

function now(): string {
  return new Date().toISOString()
}

function today(): string {
  return now().slice(0, 10)
}

function requireOwner(campaign: Campaign, userId: string): void {
  if (campaign.ownerId !== userId) throw new CommunityForbiddenError('只能管理自己的项目')
}

export class CommunityService {
  private queue: Promise<void> = Promise.resolve()
  private booted: Promise<void>

  constructor(
    private readonly repository: JsonCommunityRepository,
    private readonly mediaDir: string,
    private readonly admin: CommunityAdminSeed = {},
  ) {
    this.booted = this.ensureAdmin()
  }

  private async read(): Promise<CommunitySnapshot> {
    await this.booted
    return this.repository.read()
  }

  private async mutate<T>(fn: (snapshot: CommunitySnapshot) => T | Promise<T>): Promise<T> {
    let result!: T
    this.queue = this.queue.then(async () => {
      await this.booted
      const snapshot = await this.repository.read()
      result = await fn(snapshot)
      await this.repository.write(snapshot)
    })
    await this.queue
    return result
  }

  private async ensureAdmin(): Promise<void> {
    const email = parseEmail(this.admin.email || 'admin@supply.local')
    const password = this.admin.password || 'supply-admin-change-me'
    const name = parseName(this.admin.name || '平台管理员')
    const snapshot = await this.repository.read()
    const existing = snapshot.users.find(user => user.email === email)
    if (existing) {
      if (existing.role !== 'admin') {
        existing.role = 'admin'
        await this.repository.write(snapshot)
      }
      return
    }
    snapshot.users.push({
      id: `u-${randomUUID()}`,
      email,
      name,
      role: 'admin',
      passwordHash: await hashPassword(password),
      createdAt: now(),
    })
    await this.repository.write(snapshot)
  }

  async actor(token: string | undefined): Promise<PublicUser | null> {
    if (!token) return null
    const snapshot = await this.read()
    const session = snapshot.sessions.find(item => item.tokenHash === hashToken(token) && item.expiresAt > now())
    if (!session) return null
    const user = snapshot.users.find(item => item.id === session.userId)
    return user ? publicUser(user) : null
  }

  async requireUser(token: string | undefined): Promise<PublicUser> {
    const user = await this.actor(token)
    if (!user) throw new CommunityUnauthorizedError()
    return user
  }

  async requireAdmin(token: string | undefined): Promise<PublicUser> {
    const user = await this.requireUser(token)
    if (user.role !== 'admin') throw new CommunityForbiddenError('仅管理员可以审核项目')
    return user
  }

  async register(input: { email?: unknown; password?: unknown; name?: unknown }): Promise<AuthResult> {
    const email = parseEmail(input.email)
    const password = parsePassword(input.password)
    const name = parseName(input.name)
    return this.mutate(async snapshot => {
      if (snapshot.users.some(user => user.email === email)) throw new CommunityInputError('该邮箱已注册')
      const user = {
        id: `u-${randomUUID()}`,
        email,
        name,
        role: 'creator' as const,
        passwordHash: await hashPassword(password),
        createdAt: now(),
      }
      snapshot.users.push(user)
      return this.issueSession(snapshot, user)
    })
  }

  async login(input: { email?: unknown; password?: unknown }): Promise<AuthResult> {
    const email = parseEmail(input.email)
    const password = parsePassword(input.password)
    return this.mutate(async snapshot => {
      const user = snapshot.users.find(item => item.email === email)
      if (!user || !(await verifyPassword(password, user.passwordHash))) {
        throw new CommunityUnauthorizedError('邮箱或密码不正确')
      }
      snapshot.sessions = snapshot.sessions.filter(item => item.userId !== user.id || item.expiresAt > now())
      return this.issueSession(snapshot, user)
    })
  }

  async logout(token: string | undefined): Promise<{ ok: true }> {
    if (!token) return { ok: true }
    const tokenHash = hashToken(token)
    return this.mutate(snapshot => {
      snapshot.sessions = snapshot.sessions.filter(item => item.tokenHash !== tokenHash)
      return { ok: true as const }
    })
  }

  async me(token: string | undefined): Promise<PublicUser> {
    return this.requireUser(token)
  }

  private issueSession(snapshot: CommunitySnapshot, user: { id: string; email: string; name: string; role: 'creator' | 'admin'; passwordHash: string; createdAt: string }): AuthResult {
    const token = newToken()
    snapshot.sessions.push({
      id: `s-${randomUUID()}`,
      tokenHash: hashToken(token),
      userId: user.id,
      createdAt: now(),
      expiresAt: sessionExpiry(SESSION_DAYS),
    })
    return { user: publicUser(user), token }
  }

  mediaUrl(id: string): string {
    return `/media/${id}`
  }

  async uploadMedia(token: string | undefined, image: unknown): Promise<{ id: string; url: string }> {
    const user = await this.requireUser(token)
    const parsed = parseDataImage(image)
    const id = `m-${randomUUID()}`
    await mkdir(this.mediaDir, { recursive: true })
    await writeFile(join(this.mediaDir, id), parsed.bytes)
    await this.mutate(snapshot => {
      snapshot.media.push({ id, ownerId: user.id, mime: parsed.mime, createdAt: now() })
      return id
    })
    return { id, url: this.mediaUrl(id) }
  }

  async getMedia(id: string): Promise<{ mime: MediaAsset['mime']; bytes: Buffer } | null> {
    if (!/^m-[0-9a-f-]{36}$/i.test(id)) return null
    const snapshot = await this.read()
    const asset = snapshot.media.find(item => item.id === id)
    if (!asset) return null
    try {
      const bytes = await readFile(join(this.mediaDir, id))
      return { mime: asset.mime, bytes }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async persistCampaignImages(snapshot: CommunitySnapshot, ownerId: string, campaign: Campaign): Promise<void> {
    campaign.draft.image = await this.ingestImage(snapshot, ownerId, campaign.draft.image)
    campaign.content.gallery = (await Promise.all(campaign.content.gallery.map(item => this.ingestImage(snapshot, ownerId, item)))).filter(Boolean)
  }

  private async ingestImage(snapshot: CommunitySnapshot, ownerId: string, value: string): Promise<string> {
    if (!value) return ''
    if (value.startsWith('/media/') || value.startsWith('/inspiration/')) return value
    if (!isSafeImage(value)) return ''
    const parsed = parseDataImage(value)
    const id = `m-${randomUUID()}`
    await mkdir(this.mediaDir, { recursive: true })
    await writeFile(join(this.mediaDir, id), parsed.bytes)
    snapshot.media.push({ id, ownerId, mime: parsed.mime, createdAt: now() })
    return this.mediaUrl(id)
  }

  async createCampaign(token: string | undefined, input: CampaignSaveInput = {}, sourceId = ''): Promise<Campaign> {
    const user = await this.requireUser(token)
    return this.mutate(async snapshot => {
      const campaign = this.newCampaign(user, input, sourceId)
      await this.persistCampaignImages(snapshot, user.id, campaign)
      snapshot.campaigns.unshift(campaign)
      return structuredClone(campaign)
    })
  }

  private newCampaign(user: PublicUser, input: CampaignSaveInput, sourceId = ''): Campaign {
    const timestamp = now()
    return {
      id: `p-${randomUUID()}`,
      ownerId: user.id,
      sourceId,
      draft: sanitizeDraft(input.draft, emptyDraft(user.name)),
      content: sanitizeContent(input.content),
      published: null,
      step: Number.isInteger(input.step) ? Math.min(6, Math.max(0, Number(input.step))) : 0,
      status: 'draft',
      createdAt: timestamp,
      updatedAt: timestamp,
      feedback: '',
      reviewLog: [],
    }
  }

  async listMine(token: string | undefined): Promise<Campaign[]> {
    const user = await this.requireUser(token)
    const snapshot = await this.read()
    return snapshot.campaigns.filter(item => item.ownerId === user.id).map(item => structuredClone(item))
  }

  async getCampaign(token: string | undefined, id: string): Promise<Campaign> {
    const user = await this.requireUser(token)
    const snapshot = await this.read()
    const campaign = snapshot.campaigns.find(item => item.id === id)
    if (!campaign) throw new CommunityNotFoundError('项目不存在')
    if (campaign.ownerId !== user.id && user.role !== 'admin') throw new CommunityForbiddenError()
    return structuredClone(campaign)
  }

  async saveCampaign(token: string | undefined, id: string, input: CampaignSaveInput): Promise<Campaign> {
    const user = await this.requireUser(token)
    return this.mutate(async snapshot => {
      const campaign = this.findCampaign(snapshot, id)
      requireOwner(campaign, user.id)
      if (!EDITABLE.has(campaign.status)) throw new CommunityInputError('当前状态不可编辑。审核中、已通过或已归档的项目需先撤回或开始修订。')
      if (input.draft) campaign.draft = sanitizeDraft(input.draft, campaign.draft)
      if (input.content) campaign.content = sanitizeContent(input.content, campaign.content)
      if (Number.isInteger(input.step)) campaign.step = Math.min(6, Math.max(0, Number(input.step)))
      await this.persistCampaignImages(snapshot, user.id, campaign)
      campaign.updatedAt = now()
      return structuredClone(campaign)
    })
  }

  async submit(token: string | undefined, id: string): Promise<Campaign> {
    const user = await this.requireUser(token)
    return this.mutate(snapshot => {
      const campaign = this.findCampaign(snapshot, id)
      requireOwner(campaign, user.id)
      if (!EDITABLE.has(campaign.status)) throw new CommunityInputError('当前状态不能提交审核')
      assertReadyToSubmit(campaign.draft, campaign.content)
      campaign.status = 'review'
      campaign.feedback = ''
      campaign.updatedAt = now()
      campaign.reviewLog.unshift({ at: now(), actorId: user.id, action: 'submit', note: '' })
      for (const admin of snapshot.users.filter(item => item.role === 'admin')) {
        this.notify(snapshot, admin.id, '有项目待审核', `${user.name} 提交了「${campaign.draft.name}」`, '#review')
      }
      return structuredClone(campaign)
    })
  }

  async withdraw(token: string | undefined, id: string): Promise<Campaign> {
    const user = await this.requireUser(token)
    return this.mutate(snapshot => {
      const campaign = this.findCampaign(snapshot, id)
      requireOwner(campaign, user.id)
      if (campaign.status !== 'review') throw new CommunityInputError('只有审核中的项目可以撤回')
      campaign.status = 'draft'
      campaign.updatedAt = now()
      campaign.reviewLog.unshift({ at: now(), actorId: user.id, action: 'withdraw', note: '' })
      return structuredClone(campaign)
    })
  }

  async archive(token: string | undefined, id: string): Promise<Campaign> {
    const user = await this.requireUser(token)
    return this.mutate(snapshot => {
      const campaign = this.findCampaign(snapshot, id)
      requireOwner(campaign, user.id)
      if (!EDITABLE.has(campaign.status)) throw new CommunityInputError('当前状态不能归档')
      campaign.status = 'archived'
      campaign.updatedAt = now()
      return structuredClone(campaign)
    })
  }

  async restore(token: string | undefined, id: string): Promise<Campaign> {
    const user = await this.requireUser(token)
    return this.mutate(snapshot => {
      const campaign = this.findCampaign(snapshot, id)
      requireOwner(campaign, user.id)
      if (campaign.status !== 'archived') throw new CommunityInputError('只有已归档项目可以恢复')
      campaign.status = 'draft'
      campaign.updatedAt = now()
      return structuredClone(campaign)
    })
  }

  async publish(token: string | undefined, id: string): Promise<Campaign> {
    const user = await this.requireUser(token)
    return this.mutate(snapshot => {
      const campaign = this.findCampaign(snapshot, id)
      requireOwner(campaign, user.id)
      if (campaign.status !== 'approved') throw new CommunityInputError('只有审核通过的项目可以正式发布')
      assertReadyToSubmit(campaign.draft, campaign.content)
      campaign.published = toPublishedProject(campaign, this.supportersOf(snapshot, campaign.id), campaign.published)
      campaign.status = 'published'
      campaign.feedback = ''
      campaign.updatedAt = now()
      campaign.reviewLog.unshift({ at: now(), actorId: user.id, action: 'publish', note: '' })
      return structuredClone(campaign)
    })
  }

  async revise(token: string | undefined, id: string): Promise<Campaign> {
    const user = await this.requireUser(token)
    return this.mutate(snapshot => {
      const campaign = this.findCampaign(snapshot, id)
      requireOwner(campaign, user.id)
      if (campaign.status === 'approved') {
        campaign.status = 'draft'
        campaign.updatedAt = now()
        return structuredClone(campaign)
      }
      if (campaign.status !== 'published' || !campaign.published) throw new CommunityInputError('只有已发布项目可以开始修订')
      campaign.status = 'draft'
      campaign.updatedAt = now()
      campaign.reviewLog.unshift({ at: now(), actorId: user.id, action: 'revise', note: '' })
      return structuredClone(campaign)
    })
  }

  async listReviewQueue(token: string | undefined): Promise<Campaign[]> {
    await this.requireAdmin(token)
    const snapshot = await this.read()
    return snapshot.campaigns.filter(item => item.status === 'review').map(item => structuredClone(item))
  }

  async review(token: string | undefined, id: string, action: 'approve' | 'return', note: string): Promise<Campaign> {
    const admin = await this.requireAdmin(token)
    const trimmed = clean(note, 500)
    if (action === 'return' && trimmed.length < 2) throw new CommunityInputError('退回修改时请填写意见')
    return this.mutate(snapshot => {
      const campaign = this.findCampaign(snapshot, id)
      if (campaign.status !== 'review') throw new CommunityInputError('该项目当前不在待审核队列')
      campaign.status = action === 'approve' ? 'approved' : 'changes'
      campaign.feedback = trimmed
      campaign.updatedAt = now()
      campaign.reviewLog.unshift({ at: now(), actorId: admin.id, action, note: trimmed })
      this.notify(
        snapshot,
        campaign.ownerId,
        action === 'approve' ? '项目已通过审核' : '项目需要修改',
        action === 'approve' ? `「${campaign.draft.name}」已通过审核，可以正式发布。` : `「${campaign.draft.name}」已退回：${trimmed}`,
        `#projects?draft=${encodeURIComponent(campaign.id)}`,
      )
      return structuredClone(campaign)
    })
  }

  async listPublished(): Promise<PublishedProject[]> {
    const snapshot = await this.read()
    return snapshot.campaigns
      .filter(item => item.published)
      .map(item => this.hydratePublished(snapshot, item.published!))
      .sort((left, right) => right.date.localeCompare(left.date))
  }

  async getPublished(id: string, token?: string): Promise<{
    project: PublishedProject
    comments: ProjectComment[]
    viewer: ViewerState
    applications: ProjectApplication[]
    participants: { followers: PublicUser[]; saves: number }
  }> {
    const snapshot = await this.read()
    const campaign = snapshot.campaigns.find(item => item.id === id)
    if (!campaign?.published) throw new CommunityNotFoundError('项目尚未发布或不存在')
    const actor = await this.actor(token)
    const viewer = this.viewerOf(snapshot, campaign, actor)
    return {
      project: this.hydratePublished(snapshot, campaign.published),
      comments: snapshot.comments.filter(item => item.projectId === id).sort((left, right) => right.date.localeCompare(left.date)),
      viewer,
      applications: actor && (viewer.isOwner || actor.role === 'admin')
        ? snapshot.applications.filter(item => item.projectId === id)
        : actor
          ? snapshot.applications.filter(item => item.projectId === id && item.applicantId === actor.id)
          : [],
      participants: viewer.isOwner || actor?.role === 'admin' ? this.participantsOf(snapshot, id) : { followers: [], saves: 0 },
    }
  }

  async toggle(token: string | undefined, projectId: string, kind: 'saved' | 'following'): Promise<{ active: boolean; supporters: number }> {
    const user = await this.requireUser(token)
    return this.mutate(snapshot => {
      const campaign = this.publishedCampaign(snapshot, projectId)
      if (campaign.ownerId === user.id && kind === 'following') throw new CommunityInputError('不能关注自己的项目')
      const list = snapshot[kind][user.id] ?? []
      const present = list.includes(projectId)
      snapshot[kind][user.id] = present ? list.filter(item => item !== projectId) : [...list, projectId]
      if (kind === 'following' && !present) {
        this.notify(snapshot, campaign.ownerId, '有人关注了你的项目', `${user.name} 关注了「${campaign.published!.name}」`, `#project/${projectId}`)
      }
      return { active: !present, supporters: this.supportersOf(snapshot, projectId) }
    })
  }

  async addComment(token: string | undefined, projectId: string, text: unknown, parentId?: unknown): Promise<ProjectComment> {
    const user = await this.requireUser(token)
    const body = clean(text, 1000)
    if (body.length < 2) throw new CommunityInputError('评论至少需要 2 个字')
    const parent = typeof parentId === 'string' && parentId ? parentId : null
    return this.mutate(snapshot => {
      this.publishedCampaign(snapshot, projectId)
      if (parent && !snapshot.comments.some(item => item.id === parent && item.projectId === projectId)) {
        throw new CommunityNotFoundError('要回复的评论不存在')
      }
      const comment: ProjectComment = {
        id: `c-${randomUUID()}`,
        projectId,
        authorId: user.id,
        authorName: user.name,
        text: body,
        date: now(),
        parentId: parent,
      }
      snapshot.comments.unshift(comment)
      const campaign = snapshot.campaigns.find(item => item.id === projectId)!
      if (campaign.ownerId !== user.id) {
        this.notify(snapshot, campaign.ownerId, '收到新评论', `${user.name} 评论了「${campaign.published?.name ?? campaign.draft.name}」`, `#project/${projectId}`)
      }
      if (parent) {
        const original = snapshot.comments.find(item => item.id === parent)
        if (original && original.authorId !== user.id) {
          this.notify(snapshot, original.authorId, '有人回复了你', `${user.name} 回复了你在「${campaign.published?.name ?? campaign.draft.name}」的评论`, `#project/${projectId}`)
        }
      }
      return comment
    })
  }

  async apply(token: string | undefined, projectId: string, kind: ApplicationKind, message: unknown): Promise<ProjectApplication> {
    const user = await this.requireUser(token)
    if (kind !== 'tester' && kind !== 'collab') throw new CommunityInputError('请选择测试报名或合作申请')
    const body = clean(message, 1000)
    if (body.length < 8) throw new CommunityInputError('请用至少 8 个字说明你的参与方式')
    return this.mutate(snapshot => {
      const campaign = this.publishedCampaign(snapshot, projectId)
      if (campaign.ownerId === user.id) throw new CommunityInputError('不能申请参与自己的项目')
      const existing = snapshot.applications.find(item => item.projectId === projectId && item.applicantId === user.id && item.kind === kind)
      if (existing?.status === 'pending') throw new CommunityInputError('你已有一条待处理的同类申请')
      if (existing?.status === 'accepted') throw new CommunityInputError('该参与申请已被接受')
      const application: ProjectApplication = {
        id: `a-${randomUUID()}`,
        projectId,
        applicantId: user.id,
        applicantName: user.name,
        kind,
        message: body,
        status: 'pending',
        createdAt: now(),
        response: '',
      }
      snapshot.applications.unshift(application)
      this.notify(
        snapshot,
        campaign.ownerId,
        kind === 'tester' ? '收到测试报名' : '收到合作申请',
        `${user.name} 申请参与「${campaign.published!.name}」`,
        `#projects?draft=${encodeURIComponent(projectId)}`,
      )
      return application
    })
  }

  async respondApplication(token: string | undefined, applicationId: string, action: 'accept' | 'decline', response: unknown): Promise<ProjectApplication> {
    const user = await this.requireUser(token)
    const note = clean(response, 500)
    if (action !== 'accept' && action !== 'decline') throw new CommunityInputError('请选择接受或婉拒')
    return this.mutate(snapshot => {
      const application = snapshot.applications.find(item => item.id === applicationId)
      if (!application) throw new CommunityNotFoundError('申请不存在')
      const campaign = this.findCampaign(snapshot, application.projectId)
      requireOwner(campaign, user.id)
      if (application.status !== 'pending') throw new CommunityInputError('该申请已处理')
      application.status = action === 'accept' ? 'accepted' : 'declined'
      application.response = note
      this.notify(
        snapshot,
        application.applicantId,
        action === 'accept' ? '申请已通过' : '申请未通过',
        `你对「${campaign.published?.name ?? campaign.draft.name}」的${application.kind === 'tester' ? '测试报名' : '合作申请'}已${action === 'accept' ? '通过' : '被婉拒'}${note ? `：${note}` : ''}`,
        `#project/${application.projectId}`,
      )
      return structuredClone(application)
    })
  }

  async addUpdate(token: string | undefined, projectId: string, title: unknown, body: unknown): Promise<PublishedProject> {
    const user = await this.requireUser(token)
    const heading = clean(title, 80)
    const text = clean(body, 2000)
    if (heading.length < 2 || text.length < 8) throw new CommunityInputError('进展标题至少 2 个字，正文至少 8 个字')
    return this.mutate(snapshot => {
      const campaign = this.publishedCampaign(snapshot, projectId)
      requireOwner(campaign, user.id)
      campaign.published!.updates.unshift({ date: today(), title: heading, body: text })
      campaign.updatedAt = now()
      for (const [userId, ids] of Object.entries(snapshot.following)) {
        if (ids.includes(projectId) && userId !== user.id) {
          this.notify(snapshot, userId, '关注的项目有新进展', `「${campaign.published!.name}」发布了：${heading}`, `#project/${projectId}`)
        }
      }
      return this.hydratePublished(snapshot, campaign.published!)
    })
  }

  async listNotifications(token: string | undefined): Promise<CommunityNotification[]> {
    const user = await this.requireUser(token)
    const snapshot = await this.read()
    return snapshot.notifications.filter(item => item.userId === user.id).slice(0, 80)
  }

  async markNotification(token: string | undefined, id: string, all = false): Promise<{ ok: true }> {
    const user = await this.requireUser(token)
    return this.mutate(snapshot => {
      for (const item of snapshot.notifications) {
        if (item.userId === user.id && (all || item.id === id)) item.read = true
      }
      return { ok: true as const }
    })
  }

  async viewerState(token: string | undefined): Promise<{ saved: string[]; following: string[] }> {
    const user = await this.actor(token)
    if (!user) return { saved: [], following: [] }
    const snapshot = await this.read()
    return {
      saved: snapshot.saved[user.id] ?? [],
      following: snapshot.following[user.id] ?? [],
    }
  }

  async migrate(token: string | undefined, payload: { campaigns?: unknown; studioDraft?: unknown; projects?: unknown }): Promise<MigrateResult> {
    const user = await this.requireUser(token)
    return this.mutate(async snapshot => {
      const result: MigrateResult = { imported: 0, skipped: 0, items: [] }
      const campaigns = Array.isArray(payload.campaigns) ? payload.campaigns : []
      for (const raw of campaigns) {
        const item = await this.importLocalCampaign(snapshot, user, raw)
        result.items.push(item)
        if (item.outcome === 'imported') result.imported += 1
        else result.skipped += 1
      }
      if (payload.studioDraft && typeof payload.studioDraft === 'object') {
        const draft = sanitizeDraft(payload.studioDraft as Partial<CampaignDraftLike>)
        if (draft.name.trim() || draft.story.trim()) {
          const sourceId = 'studio-draft'
          if (snapshot.campaigns.some(item => item.ownerId === user.id && item.sourceId === sourceId)) {
            result.items.push({ sourceId, name: draft.name || '工作室草稿', outcome: 'skipped', reason: '已迁移过工作室草稿' })
            result.skipped += 1
          } else {
            draft.image = await this.ingestImage(snapshot, user.id, draft.image)
            const campaign = this.newCampaign(user, { draft }, sourceId)
            snapshot.campaigns.unshift(campaign)
            result.items.push({ sourceId, id: campaign.id, name: campaign.draft.name || '工作室草稿', outcome: 'imported' })
            result.imported += 1
          }
        }
      }
      const projects = Array.isArray(payload.projects) ? payload.projects : []
      for (const raw of projects) {
        const item = await this.importLocalProject(snapshot, user, raw)
        result.items.push(item)
        if (item.outcome === 'imported') result.imported += 1
        else result.skipped += 1
      }
      return result
    })
  }

  campaignIssues(campaign: Campaign): string[] {
    return campaignIssues(campaign.draft, campaign.content)
  }

  private findCampaign(snapshot: CommunitySnapshot, id: string): Campaign {
    const campaign = snapshot.campaigns.find(item => item.id === id)
    if (!campaign) throw new CommunityNotFoundError('项目不存在')
    return campaign
  }

  private publishedCampaign(snapshot: CommunitySnapshot, id: string): Campaign {
    const campaign = this.findCampaign(snapshot, id)
    if (!campaign.published) throw new CommunityNotFoundError('项目尚未正式发布')
    return campaign
  }

  private supportersOf(snapshot: CommunitySnapshot, projectId: string): number {
    return Object.values(snapshot.following).filter(ids => ids.includes(projectId)).length
  }

  private hydratePublished(snapshot: CommunitySnapshot, project: PublishedProject): PublishedProject {
    return { ...project, supporters: this.supportersOf(snapshot, project.id), campaign: { ...project.campaign, gallery: [...project.campaign.gallery] }, highlights: [...project.highlights], needs: [...project.needs], updates: [...project.updates] }
  }

  private viewerOf(snapshot: CommunitySnapshot, campaign: Campaign, actor: PublicUser | null): ViewerState {
    const applications = actor ? snapshot.applications.filter(item => item.projectId === campaign.id && item.applicantId === actor.id) : []
    return {
      saved: Boolean(actor && (snapshot.saved[actor.id] ?? []).includes(campaign.id)),
      following: Boolean(actor && (snapshot.following[actor.id] ?? []).includes(campaign.id)),
      isOwner: Boolean(actor && campaign.ownerId === actor.id),
      appliedTester: applications.some(item => item.kind === 'tester' && item.status !== 'declined'),
      appliedCollab: applications.some(item => item.kind === 'collab' && item.status !== 'declined'),
    }
  }

  private participantsOf(snapshot: CommunitySnapshot, projectId: string): { followers: PublicUser[]; saves: number } {
    const followers: PublicUser[] = []
    for (const [userId, ids] of Object.entries(snapshot.following)) {
      if (!ids.includes(projectId)) continue
      const user = snapshot.users.find(item => item.id === userId)
      if (user) followers.push(publicUser(user))
    }
    let saves = 0
    for (const ids of Object.values(snapshot.saved)) if (ids.includes(projectId)) saves += 1
    return { followers, saves }
  }

  private notify(snapshot: CommunitySnapshot, userId: string, title: string, body: string, href: string): void {
    snapshot.notifications.unshift({
      id: `n-${randomUUID()}`,
      userId,
      title,
      body,
      href,
      read: false,
      createdAt: now(),
    })
    const keep = new Set<string>()
    const counts = new Map<string, number>()
    for (const item of snapshot.notifications) {
      const seen = counts.get(item.userId) ?? 0
      if (seen < 200) {
        keep.add(item.id)
        counts.set(item.userId, seen + 1)
      }
    }
    snapshot.notifications = snapshot.notifications.filter(item => keep.has(item.id))
  }

  private async importLocalCampaign(snapshot: CommunitySnapshot, user: PublicUser, raw: unknown): Promise<MigrateResult['items'][number]> {
    if (!raw || typeof raw !== 'object') return { sourceId: 'unknown', name: '无效记录', outcome: 'skipped', reason: '数据无法识别' }
    const value = raw as { id?: unknown; draft?: Partial<CampaignDraftLike>; content?: Partial<CampaignContentLike>; step?: unknown; status?: unknown }
    const sourceId = typeof value.id === 'string' ? value.id : `anon-${randomUUID()}`
    const name = typeof value.draft?.name === 'string' ? value.draft.name : '未命名项目'
    if (snapshot.campaigns.some(item => item.ownerId === user.id && item.sourceId === sourceId)) {
      return { sourceId, name, outcome: 'skipped', reason: '该本地项目已迁移到当前账号' }
    }
    const draft = sanitizeDraft(value.draft, emptyDraft(user.name))
    const content = sanitizeContent(value.content)
    draft.image = await this.ingestImage(snapshot, user.id, draft.image)
    content.gallery = (await Promise.all(content.gallery.map(item => this.ingestImage(snapshot, user.id, item)))).filter(Boolean)
    if (draft.image && !content.gallery.includes(draft.image) && content.gallery.length < 6) content.gallery.unshift(draft.image)
    const campaign = this.newCampaign(user, { draft, content, step: typeof value.step === 'number' ? value.step : 0 }, sourceId)
    const localStatus = value.status
    if (localStatus === 'published') {
      try {
        assertReadyToSubmit(campaign.draft, campaign.content)
        campaign.published = toPublishedProject(campaign, 0)
        campaign.status = 'published'
      } catch {
        campaign.status = 'draft'
      }
    } else if (localStatus === 'review' || localStatus === 'approved') {
      const issue = campaignIssues(campaign.draft, campaign.content).find(Boolean)
      campaign.status = issue ? 'draft' : 'review'
      if (campaign.status === 'review') {
        campaign.reviewLog.unshift({ at: now(), actorId: user.id, action: 'submit', note: '从本地草稿迁移后进入真实审核' })
      }
    } else if (localStatus === 'archived' || localStatus === 'changes') {
      campaign.status = localStatus
    }
    snapshot.campaigns.unshift(campaign)
    return { sourceId, id: campaign.id, name: campaign.draft.name || name, outcome: 'imported' }
  }

  private async importLocalProject(snapshot: CommunitySnapshot, user: PublicUser, raw: unknown): Promise<MigrateResult['items'][number]> {
    if (!raw || typeof raw !== 'object') return { sourceId: 'unknown', name: '无效发布', outcome: 'skipped', reason: '数据无法识别' }
    const value = raw as Record<string, unknown>
    const sourceId = typeof value.id === 'string' ? `project:${value.id}` : `project-${randomUUID()}`
    const name = typeof value.name === 'string' ? value.name : '本地发布'
    if (snapshot.campaigns.some(item => item.ownerId === user.id && (item.sourceId === sourceId || item.sourceId === value.id))) {
      return { sourceId, name, outcome: 'skipped', reason: '对应项目已在账号中' }
    }
    const highlights = Array.isArray(value.highlights) ? value.highlights.filter((item): item is string => typeof item === 'string').join('\n') : ''
    const draft = sanitizeDraft({
      name: typeof value.name === 'string' ? value.name : '',
      tagline: typeof value.tagline === 'string' ? value.tagline : '',
      category: typeof value.category === 'string' ? value.category : '',
      stage: typeof value.stage === 'string' ? value.stage : '',
      creator: typeof value.creator === 'string' ? value.creator : user.name,
      city: typeof value.city === 'string' ? value.city : '',
      image: typeof value.image === 'string' ? value.image : '',
      story: typeof value.story === 'string' ? value.story : '',
      highlights,
      needs: Array.isArray(value.needs) ? value.needs.filter((item): item is string => typeof item === 'string') : [],
      goal: typeof value.goal === 'number' ? String(value.goal) : '100',
    }, emptyDraft(user.name))
    const extra = value.campaign && typeof value.campaign === 'object' ? value.campaign as Partial<CampaignContentLike> : {}
    const content = sanitizeContent(extra)
    draft.image = await this.ingestImage(snapshot, user.id, draft.image)
    content.gallery = (await Promise.all(content.gallery.map(item => this.ingestImage(snapshot, user.id, item)))).filter(Boolean)
    const campaign = this.newCampaign(user, { draft, content, step: 6 }, sourceId)
    try {
      assertReadyToSubmit(campaign.draft, campaign.content)
      campaign.published = toPublishedProject(campaign, 0)
      campaign.status = 'published'
      if (Array.isArray(value.updates)) {
        campaign.published.updates = value.updates.filter((item): item is { date: string; title: string; body: string } => !!item && typeof item === 'object' && typeof (item as { title?: unknown }).title === 'string')
      }
    } catch {
      campaign.status = 'draft'
    }
    snapshot.campaigns.unshift(campaign)
    return { sourceId, id: campaign.id, name: campaign.draft.name || name, outcome: 'imported' }
  }
}

type CampaignDraftLike = {
  name?: string
  tagline?: string
  category?: string
  stage?: string
  creator?: string
  city?: string
  image?: string
  story?: string
  highlights?: string
  needs?: string[]
  goal?: string
}

type CampaignContentLike = {
  gallery?: string[]
  video?: string
  audience?: string
  milestones?: string
  participation?: string
  team?: string
  risks?: string
}

export { campaignIssues }
