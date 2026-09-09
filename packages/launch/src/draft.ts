import type { CatalogProduct, OfferComparison } from '@dsh-supply/catalog'
import { extractName, mentioned } from './helpers.js'
import type { LaunchCampaign, LaunchContent, LaunchDraft, WebSearchHit } from './types.js'

const CATEGORIES = ['产品设计', '智能硬件', '家居生活', '户外装备', '可持续设计', '生活方式'] as const

export type DraftEvidence = {
  goal: string
  catalog: CatalogProduct[]
  comparisons: OfferComparison[]
  web: WebSearchHit[]
  webError?: string
}

function categoryOf(goal: string, products: CatalogProduct[]): string {
  if (/灯|照明|lamp|家居/.test(goal) || products.some((item) => /lamp|light|lighting/i.test(`${item.title} ${item.category}`))) return '家居生活'
  if (/包|bag/.test(goal)) return '户外装备'
  if (/可持续|维修|模块/.test(goal)) return '可持续设计'
  return '产品设计'
}

function money(value: number, currency: string): string {
  return `${currency} ${value.toFixed(2)}`
}

export function composeCampaign(id: string, evidence: DraftEvidence, updatedAt: string): LaunchCampaign {
  const { goal, catalog, comparisons, web, webError } = evidence
  const name = extractName(goal)
  const productLines = catalog.map((product) => {
    const offer = product.offers[0]
    const offerText = offer
      ? `目录单价 ${money(offer.unitPrice, offer.currency)}，MOQ ${offer.moq}，交期 ${offer.leadTimeDays} 天，供应商 ${offer.supplier.name}`
      : '当前没有有效报价'
    return `${product.title}（SKU ${product.sku}）：${product.description || '无描述'}。${offerText}。`
  })
  const compareLines = comparisons.slice(0, 4).map((row) => (
    `${row.productTitle} / ${row.supplierName}：按 ${row.orderQuantity} 件估算商品小计 ${money(row.merchandiseTotal, row.currency)}，目录运费 ${money(row.shippingFlat, row.currency)}，未含目的地税。${row.warnings.join(' ')}`
  ))
  const webLines = web.map((hit) => `${hit.title} — ${hit.snippet || '无摘要'}（${hit.url}）`)
  const storyParts = [
    `目标（来自你的原话，不是推测）：${goal}`,
    productLines.length
      ? `供货目录核实：\n${productLines.join('\n')}`
      : '供货目录核实：按当前关键词没有找到匹配商品。这不是“没有供应商”，只说明本目录此时没有命中。',
    compareLines.length ? `报价比较（目录记录，不是供应商确认件）：\n${compareLines.join('\n')}` : '',
    webLines.length
      ? `公开检索到的来源：\n${webLines.join('\n')}`
      : `公开检索未得到可用来源${webError ? `（${webError}）` : ''}。竞品评价、用户需求数据不得用模板句子代替。`,
    '未核实、不能写成承诺：可维修结构是否已验证、认证、量产时间、团队履历、目的地运费与税费、是否已向供应商询价。',
  ].filter(Boolean)

  const highlights = [
    ...catalog.slice(0, 3).map((product) => `目录商品：${product.title}`),
    ...comparisons.slice(0, 2).map((row) => `目录报价 ${money(row.unitPrice, row.currency)} · ${row.supplierName}`),
    web[0] ? `检索来源：${web[0].title}` : '',
  ].filter(Boolean)

  const audience = mentioned(goal, /(?:给|面向|目标用户[:：]?\s*)([^，。,.!！]{2,40})/) || ''
  const city = mentioned(goal, /(?:在|来自)\s*([\u4e00-\u9fa5]{2,6})/) || ''
  const draft: LaunchDraft = {
    name: name.slice(0, 50),
    tagline: goal.replace(/\s+/g, ' ').trim().slice(0, 100),
    category: CATEGORIES.includes(categoryOf(goal, catalog) as typeof CATEGORIES[number]) ? categoryOf(goal, catalog) : '产品设计',
    stage: '概念探索',
    creator: '',
    city,
    image: '',
    story: storyParts.join('\n\n').slice(0, 6000),
    highlights: (highlights.length ? highlights : ['尚未形成已核实亮点']).join('\n').slice(0, 1000),
    needs: /供应|打样|模具/.test(goal) ? ['供应链合作', '用户反馈'] : ['用户反馈', '测试用户'],
    goal: '100',
  }
  const content: LaunchContent = {
    gallery: [],
    video: '',
    audience: audience || '待你确认：谁会用、在什么场景用。当前没有独立用户研究数据源。',
    milestones: '待你补充已有成果与下一步验证。Agent 没有项目排期系统，不会编造里程碑日期。',
    participation: '当前不涉及付款。欢迎对使用场景和维修需求做反馈；供应链合作需另开询价草稿。',
    team: '团队介绍尚未提供。Agent 没有人员档案，不会填写虚构履历。',
    risks: [
      catalog.length ? '目录价格、库存和运费均未向供应商确认。' : '目录未命中相近商品，可行性仍未知。',
      web.length ? '公开检索只提供来源摘要，不能代替完整竞品拆解。' : '公开检索没有可用来源，竞品与需求证据不足。',
      '可维修、认证、材料与成本尚未被工具验证。',
      comparisons.some((row) => row.warnings.length > 0) ? comparisons.flatMap((row) => row.warnings).join(' ') : '',
    ].filter(Boolean).join('\n'),
  }
  return {
    id,
    draft,
    content,
    published: null,
    step: 6,
    status: 'draft',
    updatedAt,
    feedback: '',
  }
}

export function draftQuestions(campaign: LaunchCampaign): string[] {
  const questions: string[] = []
  if (!campaign.draft.creator.trim()) questions.push('创作者或工作室名称还空着，需要你填写。')
  if (!campaign.draft.city.trim()) questions.push('所在地未在目标里出现，需要你确认。')
  if (!campaign.draft.image) questions.push('没有接通图片生成，需要你上传封面。')
  if (campaign.content.audience.includes('待你确认')) questions.push('目标用户目前只是待确认说明，不是调研结论。')
  return questions
}
