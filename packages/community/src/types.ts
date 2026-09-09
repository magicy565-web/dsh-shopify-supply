export const COMMUNITY_CATEGORIES = ['产品设计', '智能硬件', '家居生活', '户外装备', '可持续设计', '生活方式'] as const
export const COMMUNITY_STAGES = ['概念探索', '原型开发', '寻找合作', '准备发布'] as const
export const COMMUNITY_NEEDS = ['用户反馈', '测试用户', '供应链合作', '打样支持', '工业设计', '内容共创'] as const
export const SAMPLE_IMAGES = [
  '/inspiration/relight.png',
  '/inspiration/field.png',
  '/inspiration/roam.png',
  '/inspiration/slow.png',
] as const

export type UserRole = 'creator' | 'admin'
export type CampaignStatus = 'draft' | 'review' | 'changes' | 'approved' | 'published' | 'archived'
export type ApplicationKind = 'tester' | 'collab'
export type ApplicationStatus = 'pending' | 'accepted' | 'declined'
export type ReviewAction = 'submit' | 'withdraw' | 'approve' | 'return' | 'publish' | 'revise'

export type PublicUser = {
  id: string
  email: string
  name: string
  role: UserRole
}

export type UserRecord = PublicUser & {
  passwordHash: string
  createdAt: string
}

export type SessionRecord = {
  id: string
  tokenHash: string
  userId: string
  createdAt: string
  expiresAt: string
}

export type CampaignDraft = {
  name: string
  tagline: string
  category: string
  stage: string
  creator: string
  city: string
  image: string
  story: string
  highlights: string
  needs: string[]
  goal: string
}

export type CampaignContent = {
  gallery: string[]
  video: string
  audience: string
  milestones: string
  participation: string
  team: string
  risks: string
}

export type ProjectUpdate = { date: string; title: string; body: string }

export type PublishedProject = {
  id: string
  ownerId: string
  name: string
  tagline: string
  category: string
  stage: string
  creator: string
  city: string
  image: string
  story: string
  highlights: string[]
  needs: string[]
  supporters: number
  goal: number
  date: string
  updates: ProjectUpdate[]
  demo: false
  campaign: CampaignContent
}

export type ReviewLogEntry = {
  at: string
  actorId: string
  action: ReviewAction
  note: string
}

export type Campaign = {
  id: string
  ownerId: string
  sourceId: string
  draft: CampaignDraft
  content: CampaignContent
  published: PublishedProject | null
  step: number
  status: CampaignStatus
  createdAt: string
  updatedAt: string
  feedback: string
  reviewLog: ReviewLogEntry[]
}

export type ProjectComment = {
  id: string
  projectId: string
  authorId: string
  authorName: string
  text: string
  date: string
  parentId: string | null
}

export type ProjectApplication = {
  id: string
  projectId: string
  applicantId: string
  applicantName: string
  kind: ApplicationKind
  message: string
  status: ApplicationStatus
  createdAt: string
  response: string
}

export type CommunityNotification = {
  id: string
  userId: string
  title: string
  body: string
  href: string
  read: boolean
  createdAt: string
}

export type MediaAsset = {
  id: string
  ownerId: string
  mime: 'image/png' | 'image/jpeg' | 'image/webp'
  createdAt: string
}

export type CommunitySnapshot = {
  users: UserRecord[]
  sessions: SessionRecord[]
  campaigns: Campaign[]
  comments: ProjectComment[]
  applications: ProjectApplication[]
  notifications: CommunityNotification[]
  media: MediaAsset[]
  saved: Record<string, string[]>
  following: Record<string, string[]>
}

export type AuthResult = { user: PublicUser; token: string }

export type ViewerState = {
  saved: boolean
  following: boolean
  isOwner: boolean
  appliedTester: boolean
  appliedCollab: boolean
}

export type MigrateItemResult = {
  sourceId: string
  id?: string
  name: string
  outcome: 'imported' | 'skipped'
  reason?: string
}

export type MigrateResult = {
  imported: number
  skipped: number
  items: MigrateItemResult[]
}

export type CampaignSaveInput = {
  draft?: Partial<CampaignDraft>
  content?: Partial<CampaignContent>
  step?: number
}

export type CommunityAdminSeed = {
  email?: string
  password?: string
  name?: string
}

export function emptyCommunity(): CommunitySnapshot {
  return {
    users: [],
    sessions: [],
    campaigns: [],
    comments: [],
    applications: [],
    notifications: [],
    media: [],
    saved: {},
    following: {},
  }
}

export function emptyDraft(creator = ''): CampaignDraft {
  return {
    name: '',
    tagline: '',
    category: '产品设计',
    stage: '概念探索',
    creator,
    city: '',
    image: '',
    story: '',
    highlights: '',
    needs: ['用户反馈'],
    goal: '100',
  }
}

export function emptyContent(): CampaignContent {
  return { gallery: [], video: '', audience: '', milestones: '', participation: '', team: '', risks: '' }
}

export function publicUser(user: UserRecord): PublicUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role }
}
