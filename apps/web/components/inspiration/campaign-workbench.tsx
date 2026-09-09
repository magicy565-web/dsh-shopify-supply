'use client'

import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { CAMPAIGNS_KEY, campaignSteps, statusLabels, isCampaign, campaignIssues, type Campaign, type CampaignContent } from '../../lib/campaign'
import { categories, stages, examples, LOCAL_DRAFT, LOCAL_PROJECTS, type Draft } from '../../lib/inspiration'
import type { SessionUser } from '../../lib/session'
import { CampaignOps } from './campaign-ops'

function fail(error: unknown) {
  return error instanceof Error ? error.message : '请求失败'
}

function hasLocalData() {
  try {
    const campaigns = JSON.parse(localStorage.getItem(CAMPAIGNS_KEY) || '[]') as unknown
    const draft = JSON.parse(localStorage.getItem(LOCAL_DRAFT) || 'null') as { name?: string; story?: string } | null
    const projects = JSON.parse(localStorage.getItem(LOCAL_PROJECTS) || '[]') as unknown
    return (Array.isArray(campaigns) && campaigns.length > 0) || (Array.isArray(projects) && projects.length > 0) || Boolean(draft && (draft.name || draft.story))
  } catch {
    return false
  }
}

export function CampaignWorkbench({
  session,
  initialDraft,
  onNotice,
  onAskLogin,
}: {
  session: SessionUser | null
  initialDraft: Draft
  onNotice: (text: string) => void
  onAskLogin: () => void
}) {
  const [items, setItems] = useState<Campaign[]>([])
  const [activeId, setActiveId] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [filter, setFilter] = useState('all')
  const [consent, setConsent] = useState(false)
  const [mobile, setMobile] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [ops, setOps] = useState(false)
  const [migrateOpen, setMigrateOpen] = useState(false)
  const [migrateResult, setMigrateResult] = useState<{ imported: number; skipped: number; items: Array<{ name: string; outcome: string; reason?: string }> } | null>(null)
  const latest = useRef(items)
  const dirty = useRef(false)
  const uploadVersion = useRef(0)
  const c = items.find(item => item.id === activeId)
  const issues = c ? campaignIssues(c) : []
  const locked = c && ['review', 'approved', 'archived'].includes(c.status)
  latest.current = items

  useEffect(() => {
    if (!session) { setLoaded(true); setItems([]); return }
    let cancelled = false
    void api<{ items: Campaign[] }>('/v1/community/campaigns').then(result => {
      if (cancelled) return
      latest.current = result.items
      setItems(result.items)
      setSaved('已从账号同步项目')
      setLoaded(true)
      setMigrateOpen(hasLocalData())
      const requested = new URLSearchParams(window.location.hash.split('?')[1] || '').get('draft')
      if (requested && result.items.some(item => item.id === requested)) setActiveId(requested)
    }).catch(err => {
      if (!cancelled) { setError(fail(err)); setLoaded(true) }
    })
    const navigate = () => {
      const requested = new URLSearchParams(window.location.hash.split('?')[1] || '').get('draft') || ''
      uploadVersion.current++; setUploading(false); setConsent(false); setOps(false)
      setActiveId(latest.current.some(item => item.id === requested) ? requested : '')
    }
    window.addEventListener('hashchange', navigate)
    return () => { cancelled = true; uploadVersion.current++; window.removeEventListener('hashchange', navigate) }
  }, [session])

  useEffect(() => {
    if (!session || !c || !dirty.current || !['draft', 'changes'].includes(c.status)) return
    const current = c
    const timer = window.setTimeout(() => {
      void api<{ campaign: Campaign }>(`/v1/community/campaigns/${encodeURIComponent(current.id)}`, { draft: current.draft, content: current.content, step: current.step })
        .then(({ campaign }) => {
          dirty.current = false
          replace(campaign)
          setSaved('已保存到账号，换设备登录后可以继续')
          setError('')
        })
        .catch(err => { setError(fail(err)); setSaved('尚未同步到云端') })
    }, 800)
    return () => window.clearTimeout(timer)
  }, [c, session])

  function replace(campaign: Campaign) {
    const next = latest.current.map(item => item.id === campaign.id ? campaign : item)
    latest.current = next
    setItems(next)
  }

  function patch(change: Partial<Campaign>) {
    if (!c) return
    dirty.current = true
    const next = latest.current.map(item => item.id === c.id ? { ...item, ...change, updatedAt: new Date().toISOString() } : item)
    latest.current = next
    setItems(next)
    setConsent(false)
  }

  function draft<K extends keyof Draft>(key: K, value: Draft[K]) { if (c) patch({ draft: { ...c.draft, [key]: value } }) }
  function content<K extends keyof CampaignContent>(key: K, value: CampaignContent[K]) { if (c) patch({ content: { ...c.content, [key]: value } }) }
  function open(id: string) {
    uploadVersion.current++; setUploading(false); setActiveId(id); setConsent(false); setOps(false)
    history.replaceState(null, '', id ? `#projects?draft=${encodeURIComponent(id)}` : '#projects')
  }

  async function create(imported = false) {
    if (!session) { onAskLogin(); return }
    try {
      const { campaign } = await api<{ campaign: Campaign }>('/v1/community/campaigns', imported ? { draft: initialDraft } : { draft: { creator: session.name } })
      latest.current = [campaign, ...latest.current]
      setItems(latest.current)
      open(campaign.id)
      onNotice('已在账号中创建项目')
    } catch (err) {
      setError(fail(err))
    }
  }

  async function run(id: string, action: string) {
    try {
      const { campaign } = await api<{ campaign: Campaign }>(`/v1/community/campaigns/${encodeURIComponent(id)}`, { action })
      dirty.current = false
      replace(campaign)
      setError('')
      return campaign
    } catch (err) {
      setError(fail(err))
      return null
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length || !c) return
    const selected = Array.from(files)
    if (c.content.gallery.length + selected.length > 6 || selected.some(file => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 750 * 1024)) {
      setError('最多 6 张图片，每张不超过 750 KB，支持 JPG、PNG、WebP。')
      return
    }
    const version = ++uploadVersion.current
    const id = c.id
    setUploading(true)
    try {
      const images: string[] = []
      for (const file of selected) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
        const uploaded = await api<{ url: string }>('/v1/community/media', { image: dataUrl })
        images.push(uploaded.url)
      }
      if (version !== uploadVersion.current) return
      const current = latest.current.find(item => item.id === id)!
      dirty.current = true
      const next = latest.current.map(item => item.id === id ? {
        ...current,
        draft: { ...current.draft, image: current.draft.image || images[0] || '' },
        content: { ...current.content, gallery: [...current.content.gallery, ...images] },
        updatedAt: new Date().toISOString(),
      } : item)
      latest.current = next
      setItems(next)
    } catch (err) {
      setError(fail(err))
    } finally {
      if (version === uploadVersion.current) setUploading(false)
    }
  }

  async function submit() {
    const missing = issues.findIndex(Boolean)
    if (missing >= 0) { patch({ step: missing }); setError(issues[missing] ?? ''); return }
    if (!consent || !c) { setError('请确认内容真实，并了解当前不涉及付款。'); return }
    const campaign = await run(c.id, 'submit')
    if (campaign) onNotice('已提交审核，管理员通过后即可公开发布。')
  }

  async function migrate() {
    try {
      const campaigns = JSON.parse(localStorage.getItem(CAMPAIGNS_KEY) || '[]') as unknown
      const studioDraft = JSON.parse(localStorage.getItem(LOCAL_DRAFT) || 'null') as unknown
      const projects = JSON.parse(localStorage.getItem(LOCAL_PROJECTS) || '[]') as unknown
      const result = await api<{ imported: number; skipped: number; items: Array<{ name: string; outcome: string; reason?: string }> }>('/v1/community/migrate', {
        campaigns: Array.isArray(campaigns) ? campaigns : [],
        studioDraft,
        projects: Array.isArray(projects) ? projects : [],
      }, AbortSignal.timeout(60000))
      setMigrateResult(result)
      const mine = await api<{ items: Campaign[] }>('/v1/community/campaigns')
      latest.current = mine.items
      setItems(mine.items)
      onNotice(`迁移完成：导入 ${result.imported} 项，跳过 ${result.skipped} 项。`)
    } catch (err) {
      setError(fail(err))
    }
  }

  const field = (key: keyof Omit<CampaignContent, 'gallery'>, label: string, placeholder: string) => (
    <label>{label}<textarea rows={5} maxLength={4000} value={c!.content[key]} onChange={e => content(key, e.target.value)} placeholder={placeholder} /></label>
  )

  if (!session) {
    return (
      <section className="cw ip-container cw-welcome">
        <div className="cw-breadcrumb">工作空间 <span>/</span> 我的项目</div>
        <div className="cw-welcome-hero">
          <div className="cw-welcome-copy"><span className="ip-eyebrow">A SPACE FOR WHAT'S NEXT</span><h1>让好想法，<br />有一个开始。</h1><p>从一闪而过的灵感，到值得被看见的产品。<br />和 Agent 一起研究、打磨，走好创作的每一步。</p><div className="cw-welcome-actions"><button className="ip-btn green" onClick={onAskLogin}>开启我的工作空间 <span>↗</span></button><a href="#agent">先认识产品 Agent →</a></div><small>登录后保存项目，随时回来继续。</small></div>
          <div className="cw-welcome-art"><img src="/inspiration/relight.png" alt="可维修照明概念设计示例" /><div className="cw-art-caption"><span>CONCEPT / 001</span><strong>为日常，创造一点不同。</strong><small>AI 概念示意</small></div></div>
        </div>
        <div className="cw-workflow-intro"><h2>你负责想象，<span>我们一起往前。</span></h2><p>一个工作空间，连接从想法到发布的过程。</p></div>
        <div className="cw-journey">{[['01','说出你的想法','让 Agent 帮你梳理目标用户、需求与产品方向。','#agent','探索 Agent'],['02','把想法变具体','汇集调研来源、供应方案和需要验证的问题。','#studio','打开创作工作室'],['03','准备好被看见','整理产品故事与进展，确认内容后再提交发布。','#discover','看看大家的灵感']].map(([n,title,body,href,label]) => <a href={href} key={n}><span>{n} /</span><h3>{title}</h3><p>{body}</p><strong>{label} <span>↗</span></strong></a>)}</div>
        {hasLocalData() && <p className="cw-disclaimer">此浏览器里还有第一期填写的资料。登录后可迁移到账号。</p>}
      </section>
    )
  }

  if (!c) {
    const visible = items.filter(item => filter === 'all' || (filter === 'published' ? item.status === 'published' || item.published : filter === 'draft' ? ['draft', 'changes', 'approved'].includes(item.status) : item.status === filter))
    return (
      <section className="cw ip-container">
        <header className="cw-heading">
          <div>
            <span className="ip-eyebrow">CREATOR DASHBOARD</span>
            <h1>我的项目<span className="cw-title-dot">.</span></h1>
            <p>留住灵感，打磨细节，让每一个想法向前一步。</p>
          </div>
          <button className="ip-btn green" disabled={!loaded} onClick={() => void create()}>＋ 创建项目</button>
        </header>
        <p className="cw-disclaimer">正式发布后才会生成分享链接。当前不涉及付款。</p>
        {error && <p role="alert">{error}</p>}
        {(migrateOpen || migrateResult) && (
          <div className="cw-review">
            <h2>迁移本地草稿到账号</h2>
            <p>保留第一期在此浏览器填写的项目资料。迁移后本地副本仍在，可继续当作备份。</p>
            <button className="ip-btn green" onClick={() => void migrate()}>开始迁移</button>
            {migrateResult && (
              <div className="cw-migrate-result">
                <p>导入 {migrateResult.imported} 项，跳过 {migrateResult.skipped} 项。</p>
                <ul>{migrateResult.items.map((item, index) => <li key={`${item.name}-${index}`}>{item.outcome === 'imported' ? '已导入' : '已跳过'} · {item.name}{item.reason ? `（${item.reason}）` : ''}</li>)}</ul>
              </div>
            )}
          </div>
        )}
        <div className="cw-stats">
          {[['全部项目', items.length], ['待完善', items.filter(i => ['draft', 'changes'].includes(i.status)).length], ['待审核', items.filter(i => i.status === 'review').length], ['已发布', items.filter(i => i.status === 'published' || i.published).length]].map(([label, n]) => <div key={String(label)}><strong>{n}</strong><span>{label}</span></div>)}
        </div>
        <a className="cw-agent-banner" href="#agent"><span className="cw-agent-mark">✳</span><div><strong>下一个产品，从一句话开始。</strong><p>交给 Agent 整理方向、查找资料，再由你确认下一步。</p></div><span>开始新任务 ↗</span></a>
        <div className="cw-toolbar">
          <div>{[['all', '全部'], ['draft', '草稿'], ['review', '审核中'], ['published', '已发布'], ['archived', '归档']].map(([value, label]) => <button className={filter === value ? 'active' : ''} onClick={() => setFilter(value)} key={value}>{label}</button>)}</div>
          {initialDraft.name && <button className="ip-text-link" disabled={!loaded} onClick={() => void create(true)}>导入工作室草稿</button>}
        </div>
        <div className="cw-projects">
          {visible.map(item => (
            <article key={item.id}>
              {item.draft.image ? <img src={item.draft.image} alt={item.draft.name || '项目封面'} /> : <div className="cw-placeholder">IDEA IN PROGRESS</div>}
              <div>
                <span className="cw-badge">{statusLabels[item.status]}</span>
                <h2>{item.draft.name || '未命名项目'}</h2>
                <p>{item.draft.tagline || '从一个值得解决的问题开始。'}</p>
                <small>{6 - campaignIssues(item).filter(Boolean).length} / 6 项准备完成 · {new Date(item.updatedAt).toLocaleDateString('zh-CN')}</small>
                <div className="cw-card-actions">
                  <button className="ip-btn light" onClick={() => open(item.id)}>管理项目</button>
                  {item.published && <a href={`#project/${item.id}`} className="ip-text-link">查看发布 ↗</a>}
                </div>
              </div>
            </article>
          ))}
        </div>
        {!items.length && <div className="cw-empty"><span>01 — START SOMETHING</span><h2>给你的产品，一个开始。</h2><p>从名称到故事，从团队到计划，内容会保存在你的账号里。</p><button className="ip-btn green" disabled={!loaded} onClick={() => void create()}>创建第一个项目</button></div>}
        {items.length > 0 && !visible.length && <p className="cw-empty">这个分类下还没有项目。</p>}
      </section>
    )
  }

  return (
    <section className="cw ip-container">
      <header className="cw-heading">
        <div>
          <button className="ip-text-link" onClick={() => open('')}>← 我的项目</button>
          <h1>{c.draft.name || '一个新的产品想法'}</h1>
          <span className="cw-badge">{statusLabels[c.status]}</span>
        </div>
        <div>
          <p role="status">{saved}</p>
          {c.published && <button className="ip-btn light" onClick={() => setOps(!ops)}>{ops ? '返回编辑' : '运营中心'}</button>}
        </div>
      </header>
      {error && <p className="ip-form-error" role="alert">{error}</p>}
      {c.feedback && <p className="cw-feedback">修改意见：{c.feedback}</p>}
      {ops && c.published ? <CampaignOps campaign={c} onNotice={onNotice} /> : <>
        {c.status === 'review' && (
          <div className="cw-review">
            <h2>项目已提交审核</h2>
            <p>管理员会查看内容并留下意见。审核期间草稿锁定。</p>
            <button className="ip-text-link" onClick={() => void run(c.id, 'withdraw')}>撤回提交</button>
          </div>
        )}
        {c.status === 'approved' && (
          <div className="cw-review">
            <h2>审核已通过，可以正式发布</h2>
            <p>发布后会生成独立链接，其他登录用户可以访问。修订不会立刻替换已发布版本。</p>
            <button className="ip-btn green" onClick={() => void run(c.id, 'publish').then(item => { if (item) onNotice('项目已正式发布，可复制分享链接。') })}>正式发布</button>
            <button className="ip-btn light" onClick={() => void run(c.id, 'revise')}>返回修改</button>
          </div>
        )}
        {c.status === 'published' && (
          <div className="cw-review">
            <p>已发布内容保留在发现页和分享链接中。开始修订后，只有再次通过审核并发布，才会更新公开版本。</p>
            <a href={`#project/${c.id}`} className="ip-btn light">查看项目</a>
            <button className="ip-btn green" onClick={() => void run(c.id, 'revise')}>开始新修订</button>
          </div>
        )}
        <div className="cw-layout">
          <nav aria-label="发布步骤">
            {campaignSteps.map((label, i) => (
              <button key={label} aria-current={c.step === i ? 'step' : undefined} className={c.step === i ? 'active' : ''} onClick={() => patch({ step: i })}>
                <span>{i < 6 && !issues[i] ? '✓' : `0${i + 1}`}</span>{label}
              </button>
            ))}
            <p>内容自动保存到账号<br />提交后由管理员审核，不涉及付款</p>
            {['draft', 'changes'].includes(c.status) && <button onClick={() => void run(c.id, 'archive')}>归档草稿</button>}
            {c.status === 'archived' && <button onClick={() => void run(c.id, 'restore')}>恢复草稿</button>}
          </nav>
          <div className="cw-editor">
            <h2>{campaignSteps[c.step]}</h2>
            <fieldset disabled={!!locked || c.status === 'published' || uploading}>
              {c.step === 0 && <>
                {(['name', 'tagline', 'creator', 'city'] as const).map((key, i) => (
                  <label key={key}>{['产品名称', '一句话介绍', '创作者 / 工作室', '所在地'][i]}<input maxLength={key === 'tagline' ? 100 : 50} value={c.draft[key]} onChange={e => draft(key, e.target.value)} /></label>
                ))}
                <label>产品分类<select value={c.draft.category} onChange={e => draft('category', e.target.value)}>{categories.slice(1).map(v => <option key={v}>{v}</option>)}</select></label>
                <label>开发阶段<select value={c.draft.stage} onChange={e => draft('stage', e.target.value)}>{stages.map(v => <option key={v}>{v}</option>)}</select></label>
              </>}
              {c.step === 1 && <>
                <p>上传最多 6 张图片。图片会存到云端，不再占用浏览器存储。</p>
                <label>上传图片（每张最大 750 KB）<input type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={e => { void upload(e.target.files); e.target.value = '' }} /></label>
                <div className="cw-gallery">
                  {c.content.gallery.map((src, i) => (
                    <div key={`${i}-${src.slice(-24)}`}>
                      <img src={src} alt={`产品图片 ${i + 1}`} />
                      <button type="button" onClick={() => draft('image', src)}>{c.draft.image === src ? '✓ 当前封面' : '设为封面'}</button>
                      <button aria-label={`左移图片 ${i + 1}`} disabled={i === 0} onClick={() => { const next = [...c.content.gallery]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; content('gallery', next) }}>←</button>
                      <button aria-label={`右移图片 ${i + 1}`} disabled={i === c.content.gallery.length - 1} onClick={() => { const next = [...c.content.gallery]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; content('gallery', next) }}>→</button>
                      <button onClick={() => { const next = c.content.gallery.filter((_, n) => n !== i); patch({ content: { ...c.content, gallery: next }, draft: { ...c.draft, image: c.draft.image === src ? next[0] || '' : c.draft.image } }) }}>移除</button>
                    </div>
                  ))}
                </div>
                <p>也可以先选择示例概念封面：</p>
                <div className="cw-covers">{examples.map(p => <button key={p.id} aria-label={`选择 ${p.name} 封面`} aria-pressed={c.draft.image === p.image} onClick={() => draft('image', p.image)}><img src={p.image} alt={p.name} /></button>)}</div>
                <label>演示视频链接（选填，HTTPS）<input type="url" value={c.content.video} onChange={e => content('video', e.target.value)} placeholder="https://…" /></label>
              </>}
              {c.step === 2 && <>
                <label>产品故事 · 至少 40 字<textarea rows={9} maxLength={6000} value={c.draft.story} onChange={e => draft('story', e.target.value)} placeholder="发现了什么问题？你的产品如何解决它？哪些是已经验证的，哪些仍是设想？" /><small>{c.draft.story.trim().length} / 6000</small></label>
                <label>产品亮点 · 每行一个<textarea maxLength={1000} value={c.draft.highlights} onChange={e => draft('highlights', e.target.value)} /></label>
                {field('audience', '目标用户', '谁会使用它？在什么场景下？')}
              </>}
              {c.step === 3 && <>
                {field('milestones', '已有成果与里程碑', '例如：9 月完成用户访谈；10 月制作第一版原型；11 月进行测试。请说明预计时间与验证标准。')}
                <p>这些是创作者的计划，不代表已经完成或承诺交付。</p>
              </>}
              {c.step === 4 && <>
                <div className="cw-needs">{['用户反馈', '测试用户', '供应链合作', '打样支持', '工业设计', '内容共创'].map(n => <label key={n}><input type="checkbox" checked={c.draft.needs.includes(n)} onChange={() => draft('needs', c.draft.needs.includes(n) ? c.draft.needs.filter(v => v !== n) : [...c.draft.needs, n])} />{n}</label>)}</div>
                {field('participation', '参与说明', '你希望收到什么反馈？测试和合作如何开展？当前不涉及付款。')}
                <label>意向关注目标<input type="number" min={1} max={100000} value={c.draft.goal} onChange={e => draft('goal', e.target.value)} /></label>
              </>}
              {c.step === 5 && <>
                {field('team', '团队介绍', '团队背景、相关经验与分工。')}
                {field('risks', '风险与待验证问题', '结构、材料、成本或时间方面还有哪些不确定性？如何验证？')}
              </>}
            </fieldset>
            {c.step === 6 && <>
              <div className="cw-checks">{issues.map((issue, i) => <button key={i} onClick={() => patch({ step: i })}><span>{issue ? '○' : '✓'} {campaignSteps[i]}</span><small>{issue || '已准备'}</small></button>)}</div>
              <div className="cw-toolbar"><h3>项目预览</h3><button className="ip-btn light" onClick={() => setMobile(!mobile)}>{mobile ? '切换桌面宽度' : '切换手机宽度'}</button></div>
              <article className={`cw-preview ${mobile ? 'mobile' : ''}`}>
                {c.draft.image && <img src={c.draft.image} alt="项目预览封面" />}
                <div>
                  <span className="ip-eyebrow">{c.draft.category} · {c.draft.stage}</span>
                  <h2>{c.draft.name || '产品名称'}</h2>
                  <p>{c.draft.tagline}</p>
                  <small>{c.draft.creator} · {c.draft.city}</small>
                  <h3>产品故事</h3><p>{c.draft.story}</p>
                  <h3>产品亮点</h3><p>{c.draft.highlights}</p>
                  {(['audience', 'milestones', 'participation', 'team', 'risks'] as const).map((key, i) => <section key={key}><h3>{['目标用户', '进展计划', '参与说明', '团队', '风险与挑战'][i]}</h3><p>{c.content[key]}</p></section>)}
                  {c.content.gallery.map((src, i) => <img src={src} key={i} alt={`产品展示 ${i + 1}`} />)}
                </div>
              </article>
              {['draft', 'changes'].includes(c.status) && <>
                <label className="cw-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />我已检查内容，理解提交后将进入真实审核；通过后会对其他用户公开。当前不涉及付款。</label>
                <button className="ip-btn green" disabled={uploading || !consent} onClick={() => void submit()}>提交审核</button>
              </>}
            </>}
            <footer className="cw-footer">
              <span>{c.step + 1} / 7 · {6 - issues.filter(Boolean).length} 项已准备</span>
              {c.step > 0 && <button className="ip-btn light" onClick={() => patch({ step: c.step - 1 })}>上一步</button>}
              {c.step < 6 && <button className="ip-btn green" disabled={uploading} onClick={() => { if (issues[c.step]) { setError(issues[c.step] ?? ''); return } patch({ step: c.step + 1 }) }}>保存并继续</button>}
            </footer>
          </div>
        </div>
      </>}
    </section>
  )
}
