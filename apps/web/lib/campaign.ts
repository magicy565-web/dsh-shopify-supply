import { categories, stages, safeImage, freshDraft, draftProject, type Draft, type Project } from './inspiration'

export const CAMPAIGNS_KEY = 'supply.campaigns.v1'
export type CampaignStatus = 'draft' | 'review' | 'changes' | 'approved' | 'published' | 'archived'
export type CampaignContent = { gallery: string[]; video: string; audience: string; milestones: string; participation: string; team: string; risks: string }
export type Campaign = { id: string; ownerId?: string; draft: Draft; content: CampaignContent; published?: Project | null; step: number; status: CampaignStatus; updatedAt: string; feedback: string }
export const campaignSteps = ['基本信息', '产品展示', '产品故事', '进展计划', '参与方式', '团队与风险', '预览与提交']
export const statusLabels: Record<CampaignStatus, string> = { draft: '草稿', review: '待审核', changes: '需要修改', approved: '审核通过', published: '已发布', archived: '已归档' }
export function newCampaign(draft = freshDraft()): Campaign {
  return { id: `local-${crypto.randomUUID()}`, draft, content: { gallery: [], video: '', audience: '', milestones: '', participation: '', team: '', risks: '' }, step: 0, status: 'draft', updatedAt: new Date().toISOString(), feedback: '' }
}
export function videoUrl(value: string) { try { return new URL(value).protocol === 'https:' } catch { return false } }
export function campaignIssues(c: Campaign): string[] {
  const d = c.draft, x = c.content
  return [
    !d.name.trim() || !d.tagline.trim() || !d.creator.trim() || !d.city.trim() ? '请填写名称、介绍、创作者和所在地' : '',
    !safeImage(d.image) ? '请选择项目封面' : x.video && !videoUrl(x.video) ? '视频链接须为完整的 HTTPS 地址' : '',
    d.story.trim().length < 40 || !d.highlights.trim() || !x.audience.trim() ? '请填写至少 40 字的故事、产品亮点和目标用户' : '',
    !x.milestones.trim() ? '请说明已有成果和下一步计划' : '',
    !d.needs.length || !x.participation.trim() || !Number.isSafeInteger(Number(d.goal)) || Number(d.goal) < 1 || Number(d.goal) > 100000 ? '请选择合作需求、说明参与方式，并填写 1–100000 的关注目标' : '',
    !x.team.trim() || !x.risks.trim() ? '请介绍团队和仍需验证的风险' : '',
  ]
}
export function campaignProject(c: Campaign): Project { return { ...draftProject(c.draft), id: c.id, campaign: c.content } }
export function isCampaign(value: unknown): value is Campaign {
  if (!value || typeof value !== 'object') return false
  const c = value as Campaign, d = c.draft, x = c.content
  return typeof c.id === 'string' && /^(local-|p-)/.test(c.id) && Object.hasOwn(statusLabels, c.status) && Number.isInteger(c.step) && c.step >= 0 && c.step <= 6 && typeof c.updatedAt === 'string' && typeof c.feedback === 'string' && !!d && ['name','tagline','creator','city','story','highlights','goal'].every(k => typeof d[k as keyof Draft] === 'string') && categories.slice(1).some(v => v === d.category) && stages.some(v => v === d.stage) && (d.image === '' || safeImage(d.image)) && Array.isArray(d.needs) && d.needs.every(v => typeof v === 'string') && !!x && ['video','audience','milestones','participation','team','risks'].every(k => typeof x[k as keyof CampaignContent] === 'string') && Array.isArray(x.gallery) && x.gallery.length <= 6 && x.gallery.every(safeImage)
}
