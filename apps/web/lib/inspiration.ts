export const categories = ['全部灵感', '产品设计', '智能硬件', '家居生活', '户外装备', '可持续设计', '生活方式'] as const
export const stages = ['概念探索', '原型开发', '寻找合作', '准备发布'] as const
export type Project = {
  id: string; name: string; tagline: string; category: string; stage: string; creator: string; city: string; image: string;
  story: string; highlights: string[]; needs: string[]; supporters: number; goal: number; date: string;
  updates: Array<{ date: string; title: string; body: string }>; demo: boolean;
}
export const examples: Project[] = [
  { id: 'relight', name: 'RE:LIGHT', tagline: '一盏可以陪你很久的灯。', category: '可持续设计', stage: '原型开发', creator: '慢物研究所', city: '杭州', image: '/inspiration/relight.png', supporters: 328, goal: 500, date: '2026-09-06', demo: true,
    story: '我们想重新思考一盏灯的寿命。\n\n当电池老化或某个零件损坏，为什么必须丢掉整个产品？RE:LIGHT 从可拆卸的结构出发，探索让灯罩、光源和电池独立更换的可能。\n\n它可以待在书桌上，也可以跟你去阳台。温润的灯罩和克制的金属轮廓，希望让它成为日常里安静、长久的陪伴。当前展示的是概念效果图，材料、性能与最终结构仍需要原型验证。',
    highlights: ['模块化结构，让维修成为一种选择', '室内外随行的便携照明概念', '用更少的零件，留下更多使用时间'], needs: ['用户反馈', '结构设计', '供应链合作'],
    updates: [{ date: '2026-09-06', title: '从一个问题，到第一版概念', body: '我们整理了第一版模块结构与外观方向，接下来希望听到大家对日常照明和维修体验的真实想法。' }, { date: '2026-09-01', title: '项目开始：让好东西用得更久', body: '这一阶段聚焦可维修性研究，具体性能会在后续原型测试后公布。' }] },
  { id: 'field', name: 'FIELD 65', tagline: '把每一次敲击，变成一件小小的乐事。', category: '智能硬件', stage: '概念探索', creator: 'OFF / ON Studio', city: '深圳', image: '/inspiration/field.png', supporters: 216, goal: 400, date: '2026-09-07', demo: true,
    story: '每天陪伴我们最久的工具，也值得被认真设计。\n\nFIELD 65 探索紧凑布局、触感与可定制之间的平衡。我们保留常用的方向键，在铝制外壳中加入一枚旋钮，让桌面工具既好用，也有自己的性格。\n\n项目目前处于概念阶段，希望与键盘爱好者一起讨论布局、手感和可维修设计。图片为概念示意，并非已量产的商品。', highlights: ['紧凑布局，留出更多桌面空间', '旋钮与配色的个性化探索', '面向长期使用的结构设计'], needs: ['测试用户', '用户反馈'], updates: [{ date: '2026-09-07', title: '第一版设计方向发布', body: '我们正在收集大家对布局与桌面使用习惯的反馈。' }] },
  { id: 'roam', name: 'ROAM / 漫游', tagline: '一个背包，装下城市之外的可能。', category: '户外装备', stage: '寻找合作', creator: '山野之间', city: '成都', image: '/inspiration/roam.png', supporters: 184, goal: 300, date: '2026-09-05', demo: true,
    story: '出门前，我们不想再为每一种旅程换一个包。\n\nROAM 探索模块化收纳：日常轻装上班，周末带上需要的外挂口袋，走进自然。我们希望它兼顾耐用与舒适，减少不必要的功能堆叠。\n\n目前正在寻找面料与打样伙伴。关于再生材料、耐候性和负重表现，都会以实际测试为准。', highlights: ['可拆卸的收纳模块', '兼顾城市通勤与轻户外', '探索更耐用的面料与制作方式'], needs: ['供应链合作', '打样支持', '测试用户'], updates: [{ date: '2026-09-05', title: '寻找一起做出原型的伙伴', body: '希望与有背包打样经验的伙伴交流结构与材料选择。' }] },
  { id: 'slow', name: 'SLOW MORNING', tagline: '慢一点，好咖啡和好日子都值得等。', category: '家居生活', stage: '准备发布', creator: '一间器物', city: '景德镇', image: '/inspiration/slow.png', supporters: 142, goal: 200, date: '2026-09-04', demo: true,
    story: '一杯手冲咖啡，是留给自己的十分钟。\n\nSLOW MORNING 希望用陶土、玻璃与木材，把冲煮工具变成愿意每天拿起的器物。它的灵感来自早餐桌上的日光，和缓慢醒来的城市。\n\n我们正在整理设计故事和使用反馈。展示内容是平台演示项目，图片为概念效果图，不接受商品购买。', highlights: ['陶土与玻璃的温润搭配', '简洁而有仪式感的手冲体验', '为日常使用设计的器物组合'], needs: ['用户反馈', '内容共创'], updates: [{ date: '2026-09-04', title: '留给清晨的一点仪式感', body: '我们希望听到你的咖啡习惯，一起打磨更从容的使用体验。' }] },
]
export type Draft = { name: string; tagline: string; category: string; stage: string; creator: string; city: string; image: string; story: string; highlights: string; needs: string[]; goal: string }
export const freshDraft = (): Draft => ({ name: '', tagline: '', category: '产品设计', stage: '概念探索', creator: '', city: '', image: '', story: '', highlights: '', needs: ['用户反馈'], goal: '100' })
export const LOCAL_PROJECTS = 'supply.inspiration.projects.v1'
export const LOCAL_SAVED = 'supply.inspiration.saved.v1'
export const LOCAL_FOLLOWING = 'supply.inspiration.following.v1'
export const LOCAL_DRAFT = 'supply.inspiration.draft.v1'

export function safeImage(value: unknown): value is string { return typeof value === 'string' && (/^\/inspiration\/(relight|field|roam|slow)\.png$/.test(value) || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) }
export function isProject(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false
  const p = value as Project
  return typeof p.id === 'string' && p.id.startsWith('local-') && typeof p.name === 'string' && typeof p.tagline === 'string' && typeof p.creator === 'string' && typeof p.city === 'string' && typeof p.story === 'string' && typeof p.date === 'string' && categories.some(c => c === p.category) && stages.some(s => s === p.stage) && safeImage(p.image) && Array.isArray(p.highlights) && p.highlights.every(s => typeof s === 'string') && Array.isArray(p.needs) && p.needs.every(s => typeof s === 'string') && Array.isArray(p.updates) && p.updates.every(u => typeof u?.date === 'string' && typeof u.title === 'string' && typeof u.body === 'string') && Number.isSafeInteger(p.goal) && p.goal > 0 && Number.isSafeInteger(p.supporters) && p.supporters >= 0 && p.demo === false
}
export function draftProject(draft: Draft, existing?: Project): Project {
  return {
    id: existing?.id ?? 'preview',
    name: draft.name || '你的产品名称',
    tagline: draft.tagline || '用一句话，让大家记住你的想法。',
    category: draft.category,
    stage: draft.stage,
    creator: draft.creator || '你的创作者名称',
    city: draft.city || '所在地',
    image: draft.image,
    story: draft.story,
    highlights: draft.highlights.split('\n').map(s => s.trim()).filter(Boolean),
    needs: draft.needs,
    supporters: existing?.supporters ?? 0,
    goal: Number(draft.goal) || 100,
    date: existing?.date ?? new Date().toISOString().slice(0, 10),
    updates: existing?.updates ?? [],
    demo: false,
  }
}
export function projectToDraft(project: Project): Draft {
  return { name: project.name, tagline: project.tagline, category: project.category, stage: project.stage, creator: project.creator, city: project.city, image: project.image, story: project.story, highlights: project.highlights.join('\n'), needs: project.needs, goal: String(project.goal) }
}
export function relatedProjects(project: Project, all: Project[], limit = 3) {
  const others = all.filter(item => item.id !== project.id)
  const byCreator = others.filter(item => item.creator === project.creator)
  const byCategory = others.filter(item => item.category === project.category && item.creator !== project.creator)
  const rest = others.filter(item => item.creator !== project.creator && item.category !== project.category)
  return [...byCreator, ...byCategory, ...rest].slice(0, limit)
}
export function workspaceHref(project: Pick<Project, 'id' | 'name' | 'needs'>) {
  const params = new URLSearchParams({ idea: project.name, from: project.id })
  if (project.needs.length) params.set('need', project.needs.join('、'))
  return `/workspace?${params.toString()}`
}
export function creatorHref(name: string) { return `#creator/${encodeURIComponent(name)}` }
