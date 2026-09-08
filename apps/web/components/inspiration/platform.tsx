'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Icon } from '../ui'
import { categories, stages, examples, freshDraft, safeImage, isProject, relatedProjects, projectToDraft, creatorHref, LOCAL_PROJECTS, LOCAL_SAVED, LOCAL_FOLLOWING, LOCAL_DRAFT, type Project, type Draft } from '../../lib/inspiration'
import { applyTheme, readTheme, type Theme } from '../../lib/theme'
import { ProjectCard } from './project-card'
import { PublishForm } from './publish-form'
import { ProjectDetail, type Comment } from './project-detail'
import { api } from '../../lib/api'

type Route = 'home' | 'discover' | 'project' | 'publish' | 'saved' | 'creators' | 'creator'
const commentKey = 'supply.inspiration.comments.v1'
const titles: Record<Route, string> = {
  home: 'Supply 灵感 — 好想法，值得发生',
  discover: '发现灵感 — Supply',
  project: '项目详情 — Supply 灵感',
  publish: '发布灵感 — Supply',
  saved: '我的空间 — Supply 灵感',
  creators: '创作者 — Supply 灵感',
  creator: '创作者 — Supply 灵感',
}

export default function InspirationPlatform() {
  const [route, setRoute] = useState<Route>('home')
  const [projectId, setProjectId] = useState('')
  const [creatorFilter, setCreatorFilter] = useState('')
  const [category, setCategory] = useState('全部灵感')
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState('全部阶段')
  const [sort, setSort] = useState('推荐排序')
  const [discoverView, setDiscoverView] = useState<'feed' | 'activity' | 'lineage'>('feed')
  const [saved, setSaved] = useState<string[]>([])
  const [following, setFollowing] = useState<string[]>([])
  const [localProjects, setLocalProjects] = useState<Project[]>([])
  const [draft, setDraft] = useState<Draft>(freshDraft)
  const [comments, setComments] = useState<Record<string, Comment[]>>({})
  const [spaceTab, setSpaceTab] = useState('saved')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [editId, setEditId] = useState('')
  const [theme, setTheme] = useState<Theme>('light')
  const [compactCats, setCompactCats] = useState(false)
  const [inspirationOnline, setInspirationOnline] = useState(false)
  const topSearch = useRef<HTMLInputElement>(null)
  const content = useRef<HTMLElement>(null)
  const hydrated = useRef(false)
  const localRef = useRef<Project[]>([])
  const editIdRef = useRef('')
  localRef.current = localProjects
  editIdRef.current = editId
  const projects = [...localProjects, ...examples]
  const project = projects.find(p => p.id === projectId)
  const editing = localProjects.find(p => p.id === editId)
  const creatorName = route === 'creator' ? (() => { try { return decodeURIComponent(projectId) } catch { return projectId } })() : creatorFilter
  const creatorProjects = creatorName ? projects.filter(p => p.creator === creatorName) : []
  const showCategories = route === 'home' || route === 'discover'

  useEffect(() => {
    const next = readTheme()
    setTheme(next)
    applyTheme(next)
    function read(key: string) { try { return JSON.parse(localStorage.getItem(key) ?? 'null') as unknown } catch { return null } }
    const loadedProjects = read(LOCAL_PROJECTS)
    const parsedProjects = Array.isArray(loadedProjects) ? loadedProjects.filter(isProject) : []
    localRef.current = parsedProjects
    setLocalProjects(parsedProjects)
    void api<{ items: Project[] }>('/v1/inspiration/projects', undefined, AbortSignal.timeout(1200)).then(({ items }) => {
      setInspirationOnline(true)
      const valid = items.filter(isProject)
      if (!valid.length) return
      setLocalProjects(current => { const byId = new Map([...current, ...valid].map(item => [item.id, item])); const merged = [...byId.values()]; for (const item of current) if (!valid.some(remoteProject => remoteProject.id === item.id)) void remote('/v1/inspiration/projects', item); persistProjectList(merged); return merged })
    }).catch(() => undefined)
    const loadedSaved = read(LOCAL_SAVED), loadedFollowing = read(LOCAL_FOLLOWING)
    if (Array.isArray(loadedSaved)) setSaved(loadedSaved.filter((s): s is string => typeof s === 'string'))
    if (Array.isArray(loadedFollowing)) setFollowing(loadedFollowing.filter((s): s is string => typeof s === 'string'))
    const loadedDraft = read(LOCAL_DRAFT)
    if (loadedDraft && typeof loadedDraft === 'object') {
      const candidate = loadedDraft as Partial<Draft>, base = freshDraft()
      for (const key of ['name', 'tagline', 'creator', 'city', 'story', 'highlights', 'goal'] as const) if (typeof candidate[key] === 'string') base[key] = candidate[key]!.slice(0, 6000)
      if (categories.some(c => c === candidate.category)) base.category = candidate.category!
      if (stages.some(s => s === candidate.stage)) base.stage = candidate.stage!
      if (safeImage(candidate.image)) base.image = candidate.image
      if (Array.isArray(candidate.needs)) base.needs = candidate.needs.filter((s): s is string => typeof s === 'string')
      setDraft(base)
    }
    const loadedComments = read(commentKey)
    if (loadedComments && typeof loadedComments === 'object' && !Array.isArray(loadedComments)) {
      const safe: Record<string, Comment[]> = {}
      for (const [id, list] of Object.entries(loadedComments)) if (Array.isArray(list)) safe[id] = list.filter((c): c is Comment => c && typeof c.text === 'string' && typeof c.date === 'string')
      setComments(safe)
    }
    function syncRoute() {
      const [path, params] = window.location.hash.slice(1).split('?')
      const [page, id] = (path || 'home').split('/')
      const nextRoute: Route = ['discover', 'project', 'publish', 'saved', 'creators', 'creator'].includes(page) ? page as Route : 'home'
      const search = new URLSearchParams(params)
      setRoute(nextRoute)
      setProjectId(id ?? '')
      setCreatorFilter(search.get('creator') ?? '')
      if (search.get('creator')) { setCategory('全部灵感'); setStage('全部阶段'); setQuery('') }
      const edit = search.get('edit') ?? ''
      if (nextRoute === 'publish' && edit) {
        const match = localRef.current.find(p => p.id === edit)
        setEditId(match ? edit : '')
        if (match) setDraft(projectToDraft(match))
      } else {
        if (editIdRef.current && nextRoute === 'publish') {
          const stored = read(LOCAL_DRAFT)
          if (stored && typeof stored === 'object') {
            const candidate = stored as Partial<Draft>, base = freshDraft()
            for (const key of ['name', 'tagline', 'creator', 'city', 'story', 'highlights', 'goal'] as const) if (typeof candidate[key] === 'string') base[key] = candidate[key]!.slice(0, 6000)
            if (categories.some(c => c === candidate.category)) base.category = candidate.category!
            if (stages.some(s => s === candidate.stage)) base.stage = candidate.stage!
            if (safeImage(candidate.image)) base.image = candidate.image
            if (Array.isArray(candidate.needs)) base.needs = candidate.needs.filter((s): s is string => typeof s === 'string')
            setDraft(base)
          } else setDraft(freshDraft())
        }
        setEditId('')
      }
      setError('')
      setNavOpen(false)
      setSearchOpen(false)
      if (hydrated.current) { window.scrollTo({ top: 0, behavior: 'instant' }); content.current?.focus({ preventScroll: true }) }
    }
    syncRoute(); hydrated.current = true; setReady(true)
    window.addEventListener('hashchange', syncRoute)
    return () => window.removeEventListener('hashchange', syncRoute)
  }, [])

  useEffect(() => {
    if (route !== 'publish') return
    const edit = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('edit') ?? ''
    if (!edit) return
    const match = localProjects.find(p => p.id === edit)
    if (match && editId !== edit) { setEditId(edit); setDraft(projectToDraft(match)) }
  }, [route, localProjects, editId])

  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(timer) }, [notice])
  useEffect(() => { if (searchOpen) topSearch.current?.focus() }, [searchOpen])
  useEffect(() => {
    if (!showCategories) { setCompactCats(false); return }
    const onScroll = () => setCompactCats(window.scrollY > 80)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [showCategories])
  useEffect(() => {
    if (route === 'project' && project) document.title = `${project.name} — Supply 灵感`
    else if (route === 'creator' && creatorName) document.title = `${creatorName} — Supply 灵感`
    else document.title = titles[route]
  }, [route, project, creatorName])

  function persist(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true }
    catch { setError('浏览器存储空间不足或不可用。请缩小封面图片后重试；当前表单内容仍然保留。'); return false }
  }
  function persistProjectList(value: Project[]) { try { localStorage.setItem(LOCAL_PROJECTS, JSON.stringify(value)) } catch { /* API data remains available for this session. */ } }
  function remote(path: string, body?: unknown) { return api(path, body, AbortSignal.timeout(1500)).catch(() => undefined) }
  function changeTheme() { const next = theme === 'light' ? 'dark' : 'light'; setTheme(next); applyTheme(next) }
  function toggleSave(id: string) {
    const next = saved.includes(id) ? saved.filter(s => s !== id) : [...saved, id]
    if (persist(LOCAL_SAVED, next)) { setSaved(next); void remote(`/v1/inspiration/projects/${encodeURIComponent(id)}`, { action: 'save' }); setNotice(next.includes(id) ? '已加入收藏，在「我的空间」继续探索。' : '已取消收藏。') }
  }
  function toggleFollow(id: string) {
    const next = following.includes(id) ? following.filter(s => s !== id) : [...following, id]
    if (persist(LOCAL_FOLLOWING, next)) { setFollowing(next); void remote(`/v1/inspiration/projects/${encodeURIComponent(id)}`, { action: 'follow' }); setNotice(next.includes(id) ? '已记录关注意向，仅保存在当前浏览器。' : '已取消关注。') }
  }
  function publish(p: Project) {
    if (editing) {
      const next = localProjects.map(item => item.id === editing.id ? { ...p, id: editing.id } : item)
      if (!persist(LOCAL_PROJECTS, next)) return false
      setLocalProjects(next)
      void remote(`/v1/inspiration/projects/${encodeURIComponent(editing.id)}`, p)
      setNotice('项目已更新，仍仅保存在当前浏览器。')
      window.location.hash = `project/${editing.id}`
      return true
    }
    const item = { ...p, id: `local-${crypto.randomUUID()}`, name: p.name.trim(), tagline: p.tagline.trim(), creator: p.creator.trim(), city: p.city.trim(), story: p.story.trim() }
    const next = [item, ...localProjects]
    if (!persist(LOCAL_PROJECTS, next)) return false
    setLocalProjects(next); setDraft(freshDraft()); try { localStorage.removeItem(LOCAL_DRAFT) } catch { /* Publication is already persisted. */ }
    void remote('/v1/inspiration/projects', item)
    setNotice('灵感已发布到本地预览，尚未对其他用户公开。'); window.location.hash = `project/${item.id}`; return true
  }
  function saveDraft() { if (persist(LOCAL_DRAFT, draft)) setNotice('草稿已保存在当前浏览器，下次可以继续。') }
  function selectCategory(value: string) { setCategory(value); setQuery(''); setCreatorFilter(''); setStage('全部阶段'); window.location.hash = 'discover' }
  function search(e: FormEvent) { e.preventDefault(); setCategory('全部灵感'); setCreatorFilter(''); window.location.hash = 'discover'; setSearchOpen(false) }
  function addComment(id: string, text: string) {
    const next = { ...comments, [id]: [...(comments[id] ?? []), { text: text.trim(), date: new Date().toISOString() }] }
    if (!persist(commentKey, next)) return false
    void remote(`/v1/inspiration/projects/${encodeURIComponent(id)}`, { action: 'comment', text: text.trim() })
    setComments(next); setNotice('反馈已保存在本地预览。'); return true
  }
  function addUpdate(id: string, title: string, body: string) {
    const next = localProjects.map(item => item.id === id ? { ...item, updates: [{ date: new Date().toISOString().slice(0, 10), title, body }, ...item.updates] } : item)
    if (!persist(LOCAL_PROJECTS, next)) return false
    void remote(`/v1/inspiration/projects/${encodeURIComponent(id)}`, { action: 'update', title: title.trim(), body: body.trim() })
    setLocalProjects(next); setNotice('进展已添加到本地预览。'); return true
  }
  function deleteProject(id: string) {
    const next = localProjects.filter(item => item.id !== id)
    if (!persist(LOCAL_PROJECTS, next)) return
    setLocalProjects(next)
    void remote(`/v1/inspiration/projects/${encodeURIComponent(id)}`, { action: 'delete' })
    const nextSaved = saved.filter(s => s !== id)
    const nextFollowing = following.filter(s => s !== id)
    persist(LOCAL_SAVED, nextSaved); persist(LOCAL_FOLLOWING, nextFollowing)
    setSaved(nextSaved); setFollowing(nextFollowing)
    setNotice('本地预览项目已删除。')
    window.location.hash = 'saved'
  }
  async function shareProject(id: string) {
    const url = `${window.location.origin}/#project/${id}`
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url)
      else throw new Error('clipboard unavailable')
      setNotice('链接已复制，可分享给正在一起看界面的人。')
    } catch {
      const input = document.createElement('textarea')
      input.value = url
      input.setAttribute('readonly', '')
      input.style.position = 'fixed'
      input.style.left = '-9999px'
      document.body.appendChild(input)
      input.select()
      const copied = document.execCommand('copy')
      input.remove()
      setNotice(copied ? '链接已复制，可分享给正在一起看界面的人。' : `请手动复制链接：${url}`)
    }
  }
  function filteredProjects() {
    const text = query.toLowerCase().trim()
    let result = projects.filter(p => (category === '全部灵感' || p.category === category) && (stage === '全部阶段' || p.stage === stage) && (!creatorFilter || p.creator === creatorFilter) && (!text || `${p.name} ${p.tagline} ${p.category} ${p.creator} ${p.needs.join(' ')}`.toLowerCase().includes(text)))
    if (sort === '最多关注') result = result.sort((a, b) => (b.supporters + Number(following.includes(b.id))) - (a.supporters + Number(following.includes(a.id))))
    if (sort === '最新发布') result = result.sort((a, b) => b.date.localeCompare(a.date))
    return result
  }
  const cards = (items: Project[]) => <div className="ip-project-grid">{items.map(p => <ProjectCard key={p.id} project={p} saved={saved.includes(p.id)} followed={following.includes(p.id)} onSave={() => toggleSave(p.id)} />)}</div>
  const empty = (title: string, description: string) => <div className="ip-empty ui-empty"><Icon name="spark" size={30} /><h2>{title}</h2><p>{description}</p><button className="ip-btn green" onClick={() => { setQuery(''); setCategory('全部灵感'); setStage('全部阶段'); setCreatorFilter(''); window.location.hash = 'discover' }}>发现更多灵感 <Icon name="chevron" size={15} /></button></div>
  const featured = examples[0]
  const featuredCount = featured.supporters + Number(following.includes(featured.id))
  const activityItems = projects.flatMap(p => p.updates.map(update => ({ ...update, project: p }))).sort((a, b) => b.date.localeCompare(a.date))
  const lineageStages = ['概念探索', '原型开发', '寻找合作', '准备发布']
  const header = (
    <header className="ip-header">
      <div className="ip-header-inner">
        <a className="ip-logo" href="#home" aria-label="Supply 灵感首页"><span className="ip-logo-star">✳</span>supply<span className="ip-logo-dot">.</span><span className="ip-logo-sub">灵感，让好产品发生</span></a>
        <nav className="ip-main-nav" aria-label="主要导航">
          <a href="#discover" aria-current={route === 'discover' ? 'page' : undefined}>发现灵感</a>
          <a href="#creators" aria-current={route === 'creators' || route === 'creator' ? 'page' : undefined}>创作者</a>
          <a href="/workspace">供应链工作台 <span>↗</span></a>
        </nav>
        <div className="ip-header-actions">
          <button className="ip-icon-btn" aria-label={theme === 'light' ? '切换深色模式' : '切换浅色模式'} title={theme === 'light' ? '深色模式' : '浅色模式'} onClick={changeTheme}><Icon name={theme === 'light' ? 'moon' : 'sun'} size={18} /></button>
          <button className="ip-icon-btn" aria-label="搜索灵感" aria-expanded={searchOpen} onClick={() => setSearchOpen(!searchOpen)}><Icon name="search" size={19} /></button>
          <a href="#saved" className="ip-my-space" aria-current={route === 'saved' ? 'page' : undefined}>我的空间</a>
          <a href="#publish" className="ip-btn green"><Icon name="plus" size={15} />发布灵感</a>
          <button className="ip-icon-btn ip-menu-toggle" aria-label="展开导航" aria-expanded={navOpen} onClick={() => setNavOpen(!navOpen)}><Icon name={navOpen ? 'close' : 'menu'} /></button>
        </div>
      </div>
      {navOpen && <nav className="ip-mobile-nav"><a href="#discover" onClick={() => setNavOpen(false)}>发现灵感</a><a href="#creators" onClick={() => setNavOpen(false)}>创作者</a><a href="#saved" onClick={() => setNavOpen(false)}>我的空间</a><a href="#publish" onClick={() => setNavOpen(false)}>发布灵感</a><a href="/workspace">供应链工作台 ↗</a><button type="button" onClick={() => { changeTheme(); setNavOpen(false) }}>{theme === 'light' ? '深色模式' : '浅色模式'}</button></nav>}
      {searchOpen && <form className="ip-top-search ip-container" onSubmit={search}><Icon name="search" /><input ref={topSearch} aria-label="搜索产品、想法或创作者" placeholder="搜索产品、想法或创作者…" value={query} onChange={e => setQuery(e.target.value)} maxLength={100} onKeyDown={e => { if (e.key === 'Escape') setSearchOpen(false) }} /><button className="ip-btn green">搜索</button></form>}
    </header>
  )

  return (
    <div className="ip">
      <a className="skip-link" href="#ip-content" onClick={e => { e.preventDefault(); content.current?.focus(); content.current?.scrollIntoView() }}>跳到内容</a>
      {header}
      {showCategories && (
        <div className={`ip-category-bar ${compactCats ? 'is-compact' : ''}`}>
          <nav className="ip-container" aria-label="产品分类">
            {categories.map((c, i) => <button key={c} className={(route === 'home' && i === 0) || (route === 'discover' && category === c) ? 'active' : ''} onClick={() => selectCategory(c)}>{i === 0 && <Icon name="spark" size={14} />}{c}</button>)}
          </nav>
        </div>
      )}
      {error && <div className="ip-global-error" role="alert">{error}<button className="ip-icon-btn" aria-label="关闭提示" onClick={() => setError('')}><Icon name="close" size={17} /></button></div>}
      <main ref={content} tabIndex={-1} id="ip-content">
        {route === 'home' && <>
          <section className="ip-home-intro ip-container">
            <div>
              <span className="ip-eyebrow"><span /> FOR THE IDEAS THAT DESERVE TO EXIST</span>
              <h1>好产品，<span>从一个想法开始。</span></h1>
              <p>发现值得发生的产品灵感，遇见认真创造的人。下一件改变日常的小事，也许就在这里。</p>
            </div>
            <a className="ip-text-link" href="#publish">让你的想法被看见 <Icon name="external" size={16} /></a>
          </section>
          <section className="ip-feature-layout ip-container">
            <div className="ip-featured">
              <div className="ip-section-label"><span>本周精选</span><span>FEATURED IDEA / 01</span></div>
              <a className="ip-feature-image" href={`#project/${featured.id}`}>
                <img src={featured.image} alt={`${featured.name} 概念设计`} fetchPriority="high" />
                <span className="ip-feature-sticker"><Icon name="spark" size={14} />编辑推荐</span>
                <span className="ip-image-credit">AI 概念示意</span>
                <span className="ip-round-arrow"><Icon name="external" size={24} /></span>
              </a>
              <div className="ip-feature-copy">
                <div>
                  <div className="ip-feature-tags"><span>{featured.category}</span><span>{featured.stage}</span></div>
                  <h2><a href={`#project/${featured.id}`}>{featured.name} <span>{featured.tagline}</span></a></h2>
                  <p>{featured.highlights[0]}。{featured.highlights[1] ?? ''}</p>
                  <a className="ip-byline" href={creatorHref(featured.creator)}><span className="ip-avatar small">{featured.creator.slice(0, 1)}</span>{featured.creator}<span>· {featured.city}</span></a>
                </div>
                <div className="ip-feature-interest">
                  <strong>{featuredCount}</strong>
                  <span>人对这个想法感兴趣</span>
                  <div className="ip-progress"><span style={{ width: `${Math.min(100, featuredCount / featured.goal * 100)}%` }} /></div>
                  <small>关注目标 {featured.goal} 人 · 演示数据</small>
                </div>
              </div>
            </div>
            <aside className="ip-editor-picks">
              <div className="ip-section-label"><span>同样值得你停留</span><Icon name="spark" size={14} /></div>
              {examples.slice(1).map((p, i) => (
                <article className="ip-pick" key={p.id}>
                  <a className="ip-pick-image" href={`#project/${p.id}`} tabIndex={-1} aria-hidden="true"><img src={p.image} alt="" /></a>
                  <div>
                    <span className="ip-pick-number">0{i + 2} <span>/ {p.category}</span></span>
                    <h3><a href={`#project/${p.id}`}>{p.name}<span>{p.tagline}</span></a></h3>
                    <div className="ip-pick-meta">
                      <span>{p.supporters + Number(following.includes(p.id))} 人感兴趣</span>
                      <button className="ip-icon-btn" aria-label={`${saved.includes(p.id) ? '取消收藏' : '收藏'} ${p.name}`} aria-pressed={saved.includes(p.id)} onClick={() => toggleSave(p.id)}><Icon name={saved.includes(p.id) ? 'check' : 'bookmark'} size={15} /></button>
                    </div>
                  </div>
                </article>
              ))}
              <a className="ip-all-link" href="#discover">探索全部灵感 <Icon name="chevron" size={15} /></a>
              <p className="ip-example-note ui-disclaimer">精选内容为示例项目，图片与关注数用于界面演示。</p>
            </aside>
          </section>
          <section className="ip-values-band">
            <div className="ip-container">
              <div><span>01</span><strong>看见新想法</strong><p>从一个真实需求，发现新的可能。</p></div>
              <div><span>02</span><strong>参与它的成长</strong><p>用关注与反馈，让好想法向前一步。</p></div>
              <div><span>03</span><strong>一起把它做出来</strong><p>连接创作者与供应链，让灵感落地。</p></div>
            </div>
          </section>
          <section className="ip-explore-section ip-container">
            <div className="ip-section-heading">
              <div><span className="ip-eyebrow">SMALL IDEAS. REAL POSSIBILITIES.</span><h2>总有一个想法，让你心动。</h2></div>
              <a href="#discover" className="ip-text-link">查看全部 <Icon name="chevron" size={15} /></a>
            </div>
            {cards(projects.slice(0, 4))}
          </section>
          <section className="ip-creator-callout ip-container">
            <div className="ip-callout-mark">✳</div>
            <div>
              <span className="ip-eyebrow">YOUR IDEA COULD BE NEXT</span>
              <h2>那个你一直想做的产品，<br />也许有人和你一样期待。</h2>
              <p>分享一个想法，找到第一批同路人。</p>
            </div>
            <a href="#publish" className="ip-btn green">发布我的第一个灵感 <Icon name="external" size={16} /></a>
          </section>
        </>}
        {route === 'discover' && (
          <section className="ip-discover ip-container">
            <div className="ip-page-intro">
              <span className="ip-eyebrow">DISCOVER WHAT COULD BE NEXT</span>
              <h1>{creatorFilter ? `${creatorFilter} 的产品灵感` : '探索值得发生的好想法。'}</h1>
              <p>从日常小物到全新体验，找到你想参与的创造。</p>
            </div>
            <div className="ip-filter-bar">
              <form onSubmit={e => e.preventDefault()} className="ip-search-field"><Icon name="search" size={18} /><input aria-label="筛选产品灵感" placeholder="搜索产品、关键词、创作者" value={query} onChange={e => setQuery(e.target.value)} maxLength={100} /></form>
              <label><span className="sr-only">项目阶段</span><select value={stage} onChange={e => setStage(e.target.value)}><option>全部阶段</option>{stages.map(s => <option key={s}>{s}</option>)}</select></label>
              <label><span className="sr-only">项目排序</span><select value={sort} onChange={e => setSort(e.target.value)}>{['推荐排序', '最新发布', '最多关注'].map(s => <option key={s}>{s}</option>)}</select></label>
            </div>
            <div className="ip-results-label">
              <span>{category}{creatorFilter && ` / ${creatorFilter}`} · {filteredProjects().length} 个灵感</span>
              {(query || creatorFilter || category !== '全部灵感' || stage !== '全部阶段') && <button onClick={() => { setCategory('全部灵感'); setQuery(''); setStage('全部阶段'); setCreatorFilter(''); window.location.hash = 'discover' }}>清除筛选 <Icon name="close" size={12} /></button>}
            </div>
            <div className="ip-discover-views" role="tablist" aria-label="发现视图">
              {([['feed', '项目网格'], ['activity', '最近动态'], ['lineage', '项目脉络']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={discoverView === id} className={discoverView === id ? 'active' : ''} onClick={() => setDiscoverView(id)}><Icon name={id === 'feed' ? 'spark' : id === 'activity' ? 'refresh' : 'globe'} size={14} />{label}</button>)}
            </div>
            {discoverView === 'feed' && (filteredProjects().length ? cards(filteredProjects()) : empty('这里还没有匹配的灵感。', '换个关键词或分类，也许下一个好想法就在旁边。'))}
            {discoverView === 'activity' && <div className="ip-activity-feed">{activityItems.map((item, i) => <article key={`${item.project.id}-${item.date}-${i}`}><span className="ip-avatar">{item.project.creator.slice(0, 1)}</span><div><div className="ip-activity-meta"><strong>{item.project.creator}</strong><span>更新了 <a href={`#project/${item.project.id}`}>{item.project.name}</a> · {item.date}</span></div><h3>{item.title}</h3><p>{item.body}</p><div className="ip-activity-tags"><span>{item.project.stage}</span>{item.project.needs.slice(0, 2).map(n => <span key={n}>寻找{n}</span>)}</div></div></article>)}</div>}
            {discoverView === 'lineage' && <div className="ip-lineage"><p className="ip-lineage-intro">启物的“项目脉络”视图帮助你看见一个想法从概念到落地的推进路径。</p>{lineageStages.map((stageName, index) => <section key={stageName} className="ip-lineage-stage"><div className="ip-lineage-stage-head"><span>0{index + 1}</span><strong>{stageName}</strong><small>{projects.filter(p => p.stage === stageName).length} 个项目</small></div><div className="ip-lineage-items">{projects.filter(p => p.stage === stageName).map(p => <a href={`#project/${p.id}`} key={p.id}><img src={p.image} alt="" /><span><strong>{p.name}</strong><small>{p.creator}</small></span><Icon name="chevron" size={14} /></a>)}{!projects.some(p => p.stage === stageName) && <p>还没有项目进入这个阶段。</p>}</div>{index < lineageStages.length - 1 && <span className="ip-lineage-arrow">↓</span>}</section>)}</div>}
          </section>
        )}
        {route === 'project' && (project
          ? <ProjectDetail
              key={project.id}
              project={project}
              saved={saved.includes(project.id)}
              followed={following.includes(project.id)}
              onSave={() => toggleSave(project.id)}
              onFollow={() => toggleFollow(project.id)}
              comments={comments[project.id] ?? []}
              onComment={text => addComment(project.id, text)}
              related={relatedProjects(project, projects)}
              savedIds={saved}
              followingIds={following}
              onSaveRelated={toggleSave}
              onShare={() => void shareProject(project.id)}
              isOwner={!project.demo}
              onEdit={() => { setDraft(projectToDraft(project)); window.location.hash = `publish?edit=${project.id}` }}
              onDelete={() => deleteProject(project.id)}
              onAddUpdate={(title, body) => addUpdate(project.id, title, body)}
            />
          : ready ? empty('这个灵感暂时不在这里。', '本地发布的项目只在创建它的浏览器中可见。') : <div className="ip-empty ui-empty" role="status">正在读取灵感…</div>)}
        {route === 'publish' && <PublishForm draft={draft} setDraft={setDraft} onSave={saveDraft} onPublish={publish} existing={editing} />}
        {route === 'saved' && (
          <section className="ip-space ip-container">
            <div className="ip-page-intro">
              <span className="ip-eyebrow">A LITTLE SPACE FOR BIG IDEAS</span>
              <h1>给好想法，留个位置。</h1>
              <p>你收藏的灵感、关注的项目，以及正在成形的创造。内容保存在当前浏览器。</p>
            </div>
            <div className="ip-space-tabs">
              {[['saved', '我的收藏', saved.length], ['following', '我感兴趣的', following.length], ['published', '我发布的', localProjects.length]].map(([id, title, count]) => <button key={id} className={spaceTab === id ? 'active' : ''} onClick={() => setSpaceTab(String(id))}>{title}<span>{count}</span></button>)}
              <a href="#publish">继续我的草稿 <Icon name="chevron" size={14} /></a>
            </div>
            {(() => {
              const items = spaceTab === 'published' ? localProjects : projects.filter(p => (spaceTab === 'saved' ? saved : following).includes(p.id))
              return items.length ? cards(items) : empty(spaceTab === 'published' ? '你的第一个想法，值得被看见。' : '还没有留下心动的灵感。', spaceTab === 'published' ? '点击「发布灵感」，让产品概念有自己的故事页。' : '浏览项目时，点击收藏或感兴趣，就能在这里找到它。')
            })()}
          </section>
        )}
        {route === 'creators' && (
          <section className="ip-creators ip-container">
            <div className="ip-page-intro">
              <span className="ip-eyebrow">MEET THE PEOPLE BEHIND THE IDEAS</span>
              <h1>认真创造的人，总会相遇。</h1>
              <p>独立设计师、小小工作室、想把生活变好一点的人。这里展示的是示例创作者与本地项目作者。</p>
            </div>
            <div className="ip-creator-grid">
              {Array.from(new Set(projects.map(p => p.creator))).map(name => {
                const own = projects.filter(p => p.creator === name)
                return (
                  <article key={name}>
                    <div className="ip-creator-cover"><img src={own[0].image} alt={`${name} 的产品灵感`} /></div>
                    <div className="ip-creator-card-body">
                      <span className="ip-avatar big">{name.slice(0, 1)}</span>
                      <h2>{name}</h2>
                      <p>{own[0].city} · {own.length} 个产品灵感</p>
                      <span>{own[0].category} / {own[0].needs[0] ?? '开放交流'}</span>
                      <a className="ip-btn light" href={creatorHref(name)}>查看 TA 的项目 <Icon name="chevron" size={14} /></a>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        )}
        {route === 'creator' && (
          creatorProjects.length ? (
            <section className="ip-creator-page ip-container">
              <a href="#creators" className="ip-back"><Icon name="back" size={15} />全部创作者</a>
              <div className="ip-creator-hero">
                <div className="ip-creator-hero-image"><img src={creatorProjects[0].image} alt={`${creatorName} 的产品灵感`} /></div>
                <div>
                  <span className="ip-avatar big">{creatorName.slice(0, 1)}</span>
                  <span className="ip-eyebrow">THE PERSON BEHIND THE IDEA</span>
                  <h1>{creatorName}</h1>
                  <p>{creatorProjects[0].city} · {creatorProjects.length} 个产品灵感。这里展示的是公开示例或你在本浏览器发布的项目。</p>
                  <div className="ip-creator-tags">{Array.from(new Set(creatorProjects.map(p => p.category))).map(c => <span key={c}>{c}</span>)}</div>
                </div>
              </div>
              <div className="ip-section-heading">
                <div><span className="ip-eyebrow">PROJECTS</span><h2>{creatorName} 的灵感</h2></div>
              </div>
              {cards(creatorProjects)}
            </section>
          ) : empty('还没有找到这位创作者。', '示例创作者与本地发布的作者会出现在这里。')
        )}
      </main>
      <footer className="ip-footer">
        <div className="ip-container">
          <div><a href="#home" className="ip-logo"><span className="ip-logo-star">✳</span>supply<span className="ip-logo-dot">.</span></a><span>好想法，值得发生。</span></div>
          <nav aria-label="页脚导航"><a href="#discover">发现灵感</a><a href="#publish">成为创作者</a><a href="/workspace">供应链支持 ↗</a></nav>
        </div>
        <div className="ip-footer-note ip-container">
          <span>{inspirationOnline ? '项目服务已连接 · 示例项目及关注数均为演示。' : '本地 UI 预览 · 示例项目及关注数均为演示。发布与互动只保存在当前浏览器。'}</span>
          <span>MADE FOR WHAT COMES NEXT.</span>
        </div>
      </footer>
      {notice && <div className="ip-toast" role="status"><Icon name="check" size={17} />{notice}<button className="ip-icon-btn" aria-label="关闭通知" onClick={() => setNotice('')}><Icon name="close" size={14} /></button></div>}
    </div>
  )
}
