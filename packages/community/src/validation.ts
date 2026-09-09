import { CommunityInputError } from './errors.js'
import {
  COMMUNITY_CATEGORIES,
  COMMUNITY_NEEDS,
  COMMUNITY_STAGES,
  SAMPLE_IMAGES,
  emptyCommunity,
  emptyContent,
  emptyDraft,
  type Campaign,
  type CampaignContent,
  type CampaignDraft,
  type CampaignStatus,
  type CommunitySnapshot,
  type PublishedProject,
} from './types.js'

const MEDIA_PATH = /^\/media\/m-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATA_IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function clean(value: unknown, max = 6000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function normalizeEmail(value: unknown): string {
  return clean(value, 120).toLowerCase()
}

export function isSafeImage(value: unknown): value is string {
  return typeof value === 'string' && (
    (SAMPLE_IMAGES as readonly string[]).includes(value)
    || MEDIA_PATH.test(value)
    || DATA_IMAGE.test(value)
  )
}

export function isStoredImage(value: unknown): value is string {
  return typeof value === 'string' && ((SAMPLE_IMAGES as readonly string[]).includes(value) || MEDIA_PATH.test(value))
}

export function parseEmail(value: unknown): string {
  const email = normalizeEmail(value)
  if (!EMAIL.test(email)) throw new CommunityInputError('请填写有效的邮箱地址')
  return email
}

export function parsePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 200) {
    throw new CommunityInputError('密码至少 8 个字符')
  }
  return value
}

export function parseName(value: unknown): string {
  const name = clean(value, 40)
  if (name.length < 1) throw new CommunityInputError('请填写显示名称')
  return name
}

export function videoUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export function sanitizeDraft(input: Partial<CampaignDraft> | undefined, fallback = emptyDraft()): CampaignDraft {
  const next = { ...fallback }
  if (!input) return next
  for (const key of ['name', 'tagline', 'creator', 'city', 'story', 'highlights', 'goal'] as const) {
    if (typeof input[key] === 'string') next[key] = clean(input[key], key === 'story' ? 6000 : key === 'highlights' ? 1000 : 120)
  }
  if (typeof input.category === 'string' && (COMMUNITY_CATEGORIES as readonly string[]).includes(input.category)) next.category = input.category
  if (typeof input.stage === 'string' && (COMMUNITY_STAGES as readonly string[]).includes(input.stage)) next.stage = input.stage
  if (input.image === '' || isSafeImage(input.image)) next.image = input.image ?? ''
  if (Array.isArray(input.needs)) next.needs = input.needs.filter((item): item is string => typeof item === 'string' && (COMMUNITY_NEEDS as readonly string[]).includes(item)).slice(0, 8)
  return next
}

export function sanitizeContent(input: Partial<CampaignContent> | undefined, fallback = emptyContent()): CampaignContent {
  const next = { ...fallback, gallery: [...fallback.gallery] }
  if (!input) return next
  for (const key of ['video', 'audience', 'milestones', 'participation', 'team', 'risks'] as const) {
    if (typeof input[key] === 'string') next[key] = clean(input[key], 4000)
  }
  if (Array.isArray(input.gallery)) next.gallery = input.gallery.filter(isSafeImage).slice(0, 6)
  return next
}

export function campaignIssues(draft: CampaignDraft, content: CampaignContent): string[] {
  return [
    !draft.name.trim() || !draft.tagline.trim() || !draft.creator.trim() || !draft.city.trim() ? '请填写名称、介绍、创作者和所在地' : '',
    !isStoredImage(draft.image) ? '请选择项目封面，图片需先上传到云端' : content.video && !videoUrl(content.video) ? '视频链接须为完整的 HTTPS 地址' : '',
    draft.story.trim().length < 40 || !draft.highlights.trim() || !content.audience.trim() ? '请填写至少 40 字的故事、产品亮点和目标用户' : '',
    !content.milestones.trim() ? '请说明已有成果和下一步计划' : '',
    !draft.needs.length || !content.participation.trim() || !Number.isSafeInteger(Number(draft.goal)) || Number(draft.goal) < 1 || Number(draft.goal) > 100000 ? '请选择合作需求、说明参与方式，并填写 1–100000 的关注目标' : '',
    !content.team.trim() || !content.risks.trim() ? '请介绍团队和仍需验证的风险' : '',
  ]
}

export function assertReadyToSubmit(draft: CampaignDraft, content: CampaignContent): void {
  const issue = campaignIssues(draft, content).find(Boolean)
  if (issue) throw new CommunityInputError(issue)
  if (draft.image.startsWith('data:') || content.gallery.some(item => item.startsWith('data:'))) {
    throw new CommunityInputError('请先将图片上传到云端后再提交')
  }
}

export function toPublishedProject(campaign: Campaign, supporters: number, previous?: PublishedProject | null): PublishedProject {
  const highlights = campaign.draft.highlights.split('\n').map(item => item.trim()).filter(Boolean)
  return {
    id: campaign.id,
    ownerId: campaign.ownerId,
    name: campaign.draft.name.trim(),
    tagline: campaign.draft.tagline.trim(),
    category: campaign.draft.category,
    stage: campaign.draft.stage,
    creator: campaign.draft.creator.trim(),
    city: campaign.draft.city.trim(),
    image: campaign.draft.image,
    story: campaign.draft.story.trim(),
    highlights,
    needs: [...campaign.draft.needs],
    supporters,
    goal: Number(campaign.draft.goal) || 100,
    date: previous?.date ?? new Date().toISOString().slice(0, 10),
    updates: previous?.updates ?? [],
    demo: false,
    campaign: { ...campaign.content, gallery: [...campaign.content.gallery] },
  }
}

const STATUSES: CampaignStatus[] = ['draft', 'review', 'changes', 'approved', 'published', 'archived']

function isCampaign(value: unknown): value is Campaign {
  if (!value || typeof value !== 'object') return false
  const item = value as Campaign
  return typeof item.id === 'string' && typeof item.ownerId === 'string' && STATUSES.includes(item.status)
}

export function validateCommunitySnapshot(value: unknown): CommunitySnapshot {
  if (!value || typeof value !== 'object') return emptyCommunity()
  const raw = value as Partial<CommunitySnapshot>
  const snapshot = emptyCommunity()
  if (Array.isArray(raw.users)) {
    snapshot.users = raw.users.filter(user => user && typeof user.id === 'string' && typeof user.email === 'string' && typeof user.passwordHash === 'string')
  }
  if (Array.isArray(raw.sessions)) {
    snapshot.sessions = raw.sessions.filter(session => session && typeof session.tokenHash === 'string' && typeof session.userId === 'string')
  }
  if (Array.isArray(raw.campaigns)) snapshot.campaigns = raw.campaigns.filter(isCampaign)
  if (Array.isArray(raw.comments)) {
    snapshot.comments = raw.comments.filter(item => item && typeof item.id === 'string' && typeof item.projectId === 'string' && typeof item.text === 'string')
  }
  if (Array.isArray(raw.applications)) {
    snapshot.applications = raw.applications.filter(item => item && typeof item.id === 'string' && typeof item.projectId === 'string')
  }
  if (Array.isArray(raw.notifications)) {
    snapshot.notifications = raw.notifications.filter(item => item && typeof item.id === 'string' && typeof item.userId === 'string')
  }
  if (Array.isArray(raw.media)) {
    snapshot.media = raw.media.filter(item => item && typeof item.id === 'string' && typeof item.ownerId === 'string')
  }
  if (raw.saved && typeof raw.saved === 'object') snapshot.saved = raw.saved as Record<string, string[]>
  if (raw.following && typeof raw.following === 'object') snapshot.following = raw.following as Record<string, string[]>
  return snapshot
}

export function parseDataImage(value: unknown): { mime: 'image/png' | 'image/jpeg' | 'image/webp'; bytes: Buffer } {
  if (typeof value !== 'string') throw new CommunityInputError('请上传图片')
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(value.replace(/\s/g, ''))
  if (!match || !match[1] || !match[2]) throw new CommunityInputError('仅支持 JPG、PNG、WebP 图片')
  const bytes = Buffer.from(match[2], 'base64')
  if (bytes.length === 0) throw new CommunityInputError('图片内容为空')
  if (bytes.length > 750 * 1024) throw new CommunityInputError('每张图片不超过 750 KB')
  return { mime: match[1] as 'image/png' | 'image/jpeg' | 'image/webp', bytes }
}
