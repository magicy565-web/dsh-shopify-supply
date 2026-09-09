export const LAUNCH_STAGE_IDS = ['define', 'research', 'supply', 'draft', 'review'] as const
export type LaunchStageId = (typeof LAUNCH_STAGE_IDS)[number]

export type LaunchRunStatus =
  | 'idle'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'aborted'

export type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export type EvidenceKind = 'fact' | 'inference' | 'missing'

export type LaunchEvidence = {
  kind: EvidenceKind
  text: string
  source?: { title: string; url?: string; tool?: string }
}

export type LaunchStage = {
  id: LaunchStageId
  title: string
  status: StageStatus
  summary: string
  evidence: LaunchEvidence[]
  questions: string[]
}

export type LaunchCapability = {
  id: string
  label: string
  status: 'connected' | 'missing' | 'failed'
  detail: string
}

export type LaunchDraft = {
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

export type LaunchContent = {
  gallery: string[]
  video: string
  audience: string
  milestones: string
  participation: string
  team: string
  risks: string
}

export type LaunchCampaign = {
  id: string
  draft: LaunchDraft
  content: LaunchContent
  published: null
  step: number
  status: 'draft'
  updatedAt: string
  feedback: string
}

export type WebSearchHit = {
  title: string
  snippet: string
  url: string
  provider: string
}

export type WebSearchResult = {
  query: string
  hits: WebSearchHit[]
  error?: string
}

export type LaunchArtifacts = {
  catalog: unknown[]
  comparisons: unknown[]
  web: WebSearchHit[]
  webError?: string
}

export type LaunchRun = {
  ownerId?: string
  events?: import('@dsh-supply/agent-contracts').AgentEvent[]
  id: string
  sessionId: string
  goal: string
  status: LaunchRunStatus
  currentStage: LaunchStageId
  resumeStep: number
  activity: string
  error: string
  flow: 'agent' | 'simulated'
  capabilities: LaunchCapability[]
  stages: LaunchStage[]
  campaign: LaunchCampaign
  artifacts: LaunchArtifacts
  createdAt: string
  updatedAt: string
}

export class LaunchInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LaunchInputError'
  }
}

export class LaunchNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LaunchNotFoundError'
  }
}

export const STAGE_TITLES: Record<LaunchStageId, string> = {
  define: '产品定义',
  research: '公开调研',
  supply: '供应可行性',
  draft: '发布草稿',
  review: '缺口与确认',
}

export const WORKBENCH_STAGE: Record<number, LaunchStageId | undefined> = {
  0: 'define',
  1: undefined,
  2: 'draft',
  3: 'draft',
  4: 'define',
  5: 'review',
  6: 'review',
}
