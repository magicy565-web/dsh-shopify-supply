import type { LaunchCampaign, LaunchContent, LaunchDraft, LaunchRun, LaunchStage } from './types.js'
import { LAUNCH_STAGE_IDS, STAGE_TITLES } from './types.js'

export function now(): string {
  return new Date().toISOString()
}

export function emptyDraft(): LaunchDraft {
  return {
    name: '',
    tagline: '',
    category: '产品设计',
    stage: '概念探索',
    creator: '',
    city: '',
    image: '',
    story: '',
    highlights: '',
    needs: ['用户反馈'],
    goal: '100',
  }
}

export function emptyContent(): LaunchContent {
  return { gallery: [], video: '', audience: '', milestones: '', participation: '', team: '', risks: '' }
}

export function emptyCampaign(id: string): LaunchCampaign {
  return {
    id,
    draft: emptyDraft(),
    content: emptyContent(),
    published: null,
    step: 0,
    status: 'draft',
    updatedAt: now(),
    feedback: '',
  }
}

export function emptyStages(): LaunchStage[] {
  return LAUNCH_STAGE_IDS.map((id) => ({
    id,
    title: STAGE_TITLES[id],
    status: 'pending',
    summary: '',
    evidence: [],
    questions: [],
  }))
}

export function emptyArtifacts(): LaunchRun['artifacts'] {
  return { catalog: [], comparisons: [], web: [] }
}

export function defaultCapabilities(modelConnected = false): LaunchRun['capabilities'] {
  return [
    { id: 'catalog', label: '私有供货目录', status: 'connected', detail: '可查询商品、报价并比较供应条件。' },
    { id: 'web_search', label: '公开网页检索', status: 'connected', detail: '将请求 Wikipedia 与 DuckDuckGo Instant Answer。失败时会标记为缺失，不会编造来源。' },
    { id: 'draft_write', label: '项目草稿写入', status: 'connected', detail: '经你确认后，把已核实内容写入项目草稿。' },
    {
      id: 'model_reasoning',
      label: '模型推理与自主规划',
      status: modelConnected ? 'connected' : 'missing',
      detail: modelConnected
        ? 'DeepSeek Harness 会规划步骤并选择工具。'
        : '当前为 in-memory 运行时，不会做模型推理，只按已接通工具执行。设置 AGENT_RUNTIME=dsh 后由模型规划。',
    },
    { id: 'image_gen', label: '产品图片生成', status: 'missing', detail: '没有接通图片生成。封面需你上传，不会用示例图冒充产品照片。' },
    { id: 'quote_send', label: '向供应商发送询价', status: 'missing', detail: '目录报价不是供应商确认件，也不会自动外发。' },
    { id: 'community_review', label: '真实审核与公开发布', status: 'missing', detail: '账号、审核后台和公开分享可随后补齐。模拟审核不属于正式流程。' },
    { id: 'payment', label: '收款与支付', status: 'missing', detail: '支付继续跳过，草稿不得承诺已收款或众筹到账。' },
  ]
}

export function catalogQueryForText(text: string): string {
  const term = text.toLowerCase()
  const maps: Array<[RegExp, string]> = [
    [/宠物|pet|dog|猫|饮水/, 'pet'],
    [/灯|照明|light|lamp|氛围灯|台灯/, 'lamp'],
    [/包|bag|背包|canvas|托特|sleeve/, 'bag'],
    [/杯|瓶|bottle|咖啡|coffee|drink|手冲/, 'bottle'],
    [/户外|outdoor/, 'outdoor'],
  ]
  return maps.find(([match]) => match.test(term))?.[1] ?? text.trim().slice(0, 80)
}

export function extractName(goal: string): string {
  const trimmed = goal.replace(/\s+/g, ' ').trim()
  const product = /(?:做一款|做个|做|开发|设计)\s*([^，。,.!！？?]{2,30})/.exec(trimmed)
  const raw = (product?.[1] ?? trimmed.replace(/^我想/, '')).replace(/帮我.*$/, '').replace(/准备发布/, '').trim()
  return raw.slice(0, 50) || trimmed.slice(0, 50)
}

export function mentioned(goal: string, pattern: RegExp): string {
  const match = pattern.exec(goal)
  return match?.[1]?.trim() || ''
}

export function isDshRuntime(kind: string | undefined): boolean {
  const value = (kind ?? '').toLowerCase()
  return value === 'dsh' || value === 'deepseek'
}
