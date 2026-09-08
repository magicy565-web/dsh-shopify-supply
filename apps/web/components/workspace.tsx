'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AgentEvent } from '@dsh-supply/agent-contracts'
import type { CatalogProduct, CatalogSearchResult } from '@dsh-supply/catalog'
import type { SourcingCaseView } from '@dsh-supply/procurement'
import { api, streamMessage } from '../lib/api'
import { catalogQueryForText } from '../lib/catalog-match'
import { demoProducts } from '../lib/demo'
import { Brand, Icon, Presence, ProductArt } from './ui'
import { OfferCard, price, type Selection } from './offer-card'
import { applyTheme, dismissIdeaContext, isIdeaDismissed, readIdeaContext, readTheme, writeIdeaContext, type IdeaContext, type Theme } from '../lib/theme'

type View = 'agent' | 'supply' | 'orders' | 'settings'
type Message = { id: string; role: 'user' | 'assistant'; text: string; products?: CatalogProduct[]; note?: string; draft?: string }
type Order = { id: string; status: string; destinationCountry: string; createdAt: string; purchaseOrders?: Array<{ trackingNumber?: string }> }
type Health = { runtime: string; storage: string; shopify: string }
const suggestions = [{ category: '宠物用品', query: 'pet', text: '发现值得卖的宠物好物', detail: '从陪伴它的日常开始', art: '宠物', title: '饮水瓶' }, { category: '家居生活', query: 'lamp', text: '寻找有设计感的家居产品', detail: '让平凡的角落更有意思', art: '家居', title: '灯' }, { category: '生活配件', query: 'bag', text: '为我的品牌寻找下一款单品', detail: '小物件，也可以有大想法', art: '配件', title: '包' }]
const friendlyTools: Record<string, string> = { search_catalog: '正在查找供货商品', get_product: '正在查看供货条件', compare_offers: '正在比较供应商报价', create_sourcing_case: '正在建立询价项目', draft_quote_request: '正在整理询价草稿', create_dropship_listing: '正在准备商品草稿' }
const orderStatus: Record<string, string> = { received: '已接收', routed: '已分配供应商', fulfilled: '已履约', failed: '待处理' }
const messageId = () => crypto.randomUUID()

export default function Workspace() {
  const [view, setView] = useState<View>('agent')
  const [theme, setTheme] = useState<Theme>('light')
  const [mobileNav, setMobileNav] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const [overlayPanel, setOverlayPanel] = useState(false)
  const [health, setHealth] = useState<Health>()
  const [connection, setConnection] = useState<'checking' | 'online' | 'offline'>('checking')
  const [demo, setDemo] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [catalogFilter, setCatalogFilter] = useState('')
  const [saved, setSaved] = useState<string[]>([])
  const [onlySaved, setOnlySaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [activity, setActivity] = useState('随时开始')
  const [error, setError] = useState('')
  const [selection, setSelection] = useState<Selection>()
  const [panelTab, setPanelTab] = useState<'offer' | 'quote'>('offer')
  const [quantity, setQuantity] = useState('1')
  const [destination, setDestination] = useState('US')
  const [draftId, setDraftId] = useState('')
  const [draftBusy, setDraftBusy] = useState(false)
  const [orders, setOrders] = useState<Order[]>([])
  const [ordersBusy, setOrdersBusy] = useState(false)
  const [approval, setApproval] = useState<Extract<AgentEvent, { type: 'approval.requested' }>>()
  const [approvalBusy, setApprovalBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [ideaContext, setIdeaContext] = useState<IdeaContext>()
  const [ideaMatches, setIdeaMatches] = useState<CatalogProduct[]>([])
  const [ideaMatchBusy, setIdeaMatchBusy] = useState(false)
  const [catalogBusy, setCatalogBusy] = useState(false)
  const session = useRef<string | undefined>(undefined)
  const aborter = useRef<AbortController | undefined>(undefined)
  const searchSequence = useRef(0)
  const panelRef = useRef<HTMLElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const hydrated = useRef(false)
  const draftProgress = useRef<{ key: string; caseId?: string; candidate: boolean; quoteId?: string }>({ key: '', candidate: false })

  useEffect(() => {
    const storedTheme = readTheme()
    setTheme(storedTheme)
    applyTheme(storedTheme)
    try { const ids: unknown = JSON.parse(localStorage.getItem('supply.saved') ?? '[]'); if (Array.isArray(ids)) setSaved(ids.filter((x): x is string => typeof x === 'string')) } catch { /* A malformed local preference is safe to reset. */ }
    const params = new URLSearchParams(window.location.search)
    const idea = params.get('idea')?.trim()
    if (idea) {
      const next = { name: idea, need: params.get('need')?.trim() || undefined, from: params.get('from')?.trim() || undefined }
      writeIdeaContext(next)
      setIdeaContext(next)
      setInput(`为产品灵感「${idea}」寻找可落地的供应链方案。${next.need ? `当前需要：${next.need}。` : ''}请先从现有供货目录匹配相近产品。`)
    } else if (!isIdeaDismissed()) {
      const stored = readIdeaContext()
      if (stored) {
        setIdeaContext(stored)
        setInput(`为产品灵感「${stored.name}」寻找可落地的供应链方案。${stored.need ? `当前需要：${stored.need}。` : ''}请先从现有供货目录匹配相近产品。`)
      }
    }
    hydrated.current = true
    const mobile = window.matchMedia('(max-width: 700px)')
    const overlay = window.matchMedia('(max-width: 960px)')
    const resize = () => { setNarrow(mobile.matches); setOverlayPanel(overlay.matches) }
    resize()
    mobile.addEventListener('change', resize)
    overlay.addEventListener('change', resize)
    void checkConnection()
    return () => { aborter.current?.abort(); mobile.removeEventListener('change', resize); overlay.removeEventListener('change', resize) }
  }, [])
  useEffect(() => {
    if (connection === 'checking') return
    const sequence = ++searchSequence.current
    setCatalogBusy(true)
    void loadCatalog().then(items => { if (searchSequence.current === sequence) setProducts(items) }).catch(() => { /* Catalog view retries explicitly. */ }).finally(() => { if (searchSequence.current === sequence) setCatalogBusy(false) })
  }, [connection, demo])
  useEffect(() => {
    if (!ideaContext) { setIdeaMatches([]); setIdeaMatchBusy(false); return }
    let cancelled = false
    const query = catalogQueryForText(`${ideaContext.name} ${ideaContext.need ?? ''}`)
    setIdeaMatchBusy(true)
    void loadCatalog(query).then(items => { if (!cancelled) setIdeaMatches(query ? items.slice(0, 3) : []) }).catch(() => { if (!cancelled) setIdeaMatches([]) }).finally(() => { if (!cancelled) setIdeaMatchBusy(false) })
    return () => { cancelled = true }
  }, [ideaContext, demo])
  useEffect(() => { if (hydrated.current) localStorage.setItem('supply.saved', JSON.stringify(saved)) }, [saved])
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 2800); return () => clearTimeout(timer) }, [toast])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'end' }) }, [messages, approval])
  useEffect(() => {
    if (selection) panelRef.current?.focus()
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setSelection(undefined); setMobileNav(false); openerRef.current?.focus() } }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [selection])
  useEffect(() => {
    const root = selection && overlayPanel ? panelRef.current : mobileNav && narrow ? sidebarRef.current : null
    if (!root) return
    root.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const focusable = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')].filter(el => el.offsetParent !== null)
      const first = focusable[0], last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root)) { event.preventDefault(); first.focus() }
    }
    root.addEventListener('keydown', trap)
    return () => root.removeEventListener('keydown', trap)
  }, [selection, overlayPanel, mobileNav, narrow])

  async function checkConnection() {
    setConnection('checking')
    try { setHealth(await api<Health>('/health')); setConnection('online') }
    catch { setConnection('offline'); setHealth(undefined) }
  }
  function changeTheme() { const next = theme === 'light' ? 'dark' : 'light'; setTheme(next); applyTheme(next) }
  function toggleSaved(id: string) { setSaved(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]) }
  function openOffer(value: Selection, tab: 'offer' | 'quote' = 'offer') { openerRef.current = document.activeElement as HTMLElement; setSelection(value); setPanelTab(tab); setQuantity(String(value.offer.moq)); setDraftId(''); setError('') }
  function closePanel() { setSelection(undefined); openerRef.current?.focus() }
  function setMode(next: boolean) {
    if (busy || draftBusy) return
    searchSequence.current++
    setDemo(next); setMessages([]); setProducts(next ? demoProducts : []); setSelection(undefined); setError(''); setOrders([]); setApproval(undefined); session.current = undefined; setActivity('随时开始')
    setView('agent')
  }
  async function loadCatalog(query = '', mode = demo, signal?: AbortSignal): Promise<CatalogProduct[]> {
    if (mode) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean)
      return demoProducts.filter(p => !words.length || words.some(w => `${p.title} ${p.category} ${p.tags.join(' ')}`.toLowerCase().includes(w)))
    }
    return (await api<CatalogSearchResult>(`/v1/catalog/products?${new URLSearchParams({ query, limit: '100' })}`, undefined, signal)).items
  }
  async function navigate(next: View) {
    setView(next); setMobileNav(false); setError(''); setSelection(undefined)
    if (next === 'supply') {
      const sequence = ++searchSequence.current
      setCatalogBusy(true)
      try { const items = await loadCatalog(); if (searchSequence.current === sequence) setProducts(items) } catch { if (searchSequence.current === sequence) setError('供货目录暂时无法加载。请检查连接，或到设置中开启演示预览。') }
      finally { if (searchSequence.current === sequence) setCatalogBusy(false) }
    }
    if (next === 'orders') {
      const sequence = ++searchSequence.current
      setOrdersBusy(true)
      try { const items = demo ? [] : (await api<{ items: Order[] }>('/v1/commerce/orders')).items; if (searchSequence.current === sequence) setOrders(items) }
      catch { if (searchSequence.current === sequence) setError('订单暂时无法加载，请稍后重试。') }
      finally { setOrdersBusy(false) }
    }
  }
  function searchCatalog(event: FormEvent) {
    event.preventDefault()
  }
  async function send(text = input) {
    if (!text.trim() || busy) return
    const userText = text.trim(), id = messageId()
    setView('agent'); setInput(''); setError(''); setBusy(true); setActivity('正在查找供货商品')
    setMessages(current => [...current, { id: messageId(), role: 'user', text: userText }, { id, role: 'assistant', text: '' }])
    const controller = new AbortController()
    aborter.current = controller
    function update(patch: Partial<Message>) { setMessages(current => current.map(m => m.id === id ? { ...m, ...patch } : m)) }
    try {
      const results = await loadCatalog(catalogQueryForText(userText), demo, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]))
      if (controller.signal.aborted) return
      update({ products: results.slice(0, 6), text: results.length ? `找到 ${results.length} 款相关商品。先看看供货条件，再选择值得进一步了解的产品。` : '暂时没有找到匹配的商品。试试更简短的产品名称，或者浏览全部供货目录。', note: demo ? '演示数据 · 仅用于体验界面，价格与供货条件不构成真实报价。' : '结果来自当前商品库；价格、库存和运输条件需向供应商确认。' })
      if (!demo && health?.runtime === 'dsh') {
        setActivity('正在分析供货条件')
        if (!session.current) session.current = (await api<{ id: string }>('/v1/sessions', {})).id
        let analysis = ''
        await streamMessage(session.current, userText, event => {
          if (event.type === 'message.delta') { analysis += event.text; update({ text: analysis }) }
          if (event.type === 'tool.started') setActivity(friendlyTools[event.toolName] ?? '正在整理供货信息')
          if (event.type === 'approval.requested') { setApproval(event); setActivity('等待你的确认') }
          if (event.type === 'approval.resolved') { setApproval(undefined); setActivity('正在继续处理') }
          if (event.type === 'agent.failed') throw new Error(event.message)
        }, controller.signal)
      }
      setActivity('已完成')
    } catch (caught) {
      if (controller.signal.aborted) { update({ text: '已停止本次分析。', note: undefined }); setActivity('已停止') }
      else { const text = caught instanceof Error && !/fetch|network/i.test(caught.message) ? caught.message : '暂时无法连接供货服务。你可以重试，或到设置中开启演示预览。'; update({ text }); setError(text); setActivity('连接需要检查') }
    } finally { if (controller.signal.aborted) { update({ text: '已停止本次分析。' }); setActivity('已停止') } setBusy(false); setApproval(undefined) }
  }
  async function stop() { aborter.current?.abort(); if (session.current) { try { await api(`/v1/sessions/${session.current}/abort`, {}) } catch { setError('已停止接收结果，但未能确认服务端任务已停止。') } } }
  async function decide(decision: 'allow' | 'deny') {
    if (!approval || !session.current) return
    setApprovalBusy(true)
    try { await api(`/v1/sessions/${session.current}/approvals/${approval.approvalId}`, { decision }); setApproval(undefined) }
    catch { setError('确认未提交成功，请重试。') } finally { setApprovalBusy(false) }
  }
  async function createDraft() {
    if (!selection || draftBusy) return
    const count = Number(quantity)
    if (!Number.isSafeInteger(count) || count < selection.offer.moq || count > 1000000) { setError(`请输入 ${selection.offer.moq} 至 1,000,000 之间的整数数量。`); return }
    setDraftBusy(true); setError('')
    try {
      let resultId = 'preview-quote'
      if (!demo) {
        const key = `${selection.offer.id}:${count}:${destination}`
        if (draftProgress.current.key !== key) draftProgress.current = { key, candidate: false }
        const progress = draftProgress.current
        if (!progress.caseId) progress.caseId = (await api<SourcingCaseView>('/v1/sourcing/cases', { title: `${selection.product.title} · 询价`, query: selection.product.title, quantity: count, destinationCountry: destination })).id
        if (!progress.candidate) { await api(`/v1/sourcing/cases/${progress.caseId}/candidates`, { productId: selection.product.id, rationale: '从供货工作区选入询价' }); progress.candidate = true }
        if (!progress.quoteId) {
          const result = await api<SourcingCaseView>(`/v1/sourcing/cases/${progress.caseId}/quote-requests`, { supplierId: selection.offer.supplierId, offerIds: [selection.offer.id], quantity: count })
          progress.quoteId = result.quoteRequests.at(-1)?.id
          if (!progress.quoteId) throw new Error('服务未返回询价草稿，请检查采购项目。')
        }
        resultId = progress.quoteId
      }
      setDraftId(resultId)
      setToast(demo ? '演示询价草稿已生成' : '询价草稿已保存')
      setMessages(current => [...current, { id: messageId(), role: 'assistant', text: `已整理「${selection.product.title}」的询价草稿。`, draft: `${count} 件 · 目的地 ${destination} · ${selection.offer.supplier.name}`, note: demo ? '这是界面演示，未创建真实业务记录。' : '已保存到采购项目，尚未发送供应商；正式报价需进一步确认。' }])
    } catch (caught) { setError(caught instanceof Error ? caught.message : '询价草稿未保存，请重试。') }
    finally { setDraftBusy(false) }
  }

  const catalogQuery = catalogFilter.trim().toLowerCase()
  const shownProducts = products.filter(p => {
    if (onlySaved && !saved.includes(p.id)) return false
    if (!catalogQuery) return true
    return `${p.title} ${p.category} ${p.sku} ${p.tags.join(' ')} ${p.description}`.toLowerCase().includes(catalogQuery)
  })
  const selectedOffer = selection?.offer
  const validQuantity = !!selectedOffer && Number.isSafeInteger(Number(quantity)) && Number(quantity) >= selectedOffer.moq && Number(quantity) <= 1000000
  const presence = approval ? 'waiting' : busy ? 'working' : error ? 'error' : 'idle'
  const composer = <form className={`composer ${messages.length ? 'compact' : ''}`} onSubmit={e => { e.preventDefault(); void send() }}><label className="sr-only" htmlFor="supply-prompt">告诉 Supply Agent 你想寻找的商品</label><textarea ref={composerRef} id="supply-prompt" placeholder="描述你的选品想法，剩下的交给我…" value={input} onChange={e => setInput(e.target.value)} maxLength={2000} rows={2} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} /><div className="composer-bottom"><span className="composer-context"><Icon name="supply" size={15} /> {demo ? '演示商品库' : '自有供货目录'}<span className="context-divider" /><Icon name="globe" size={14} /> 全球选品</span>{busy ? <button type="button" className="send-button" onClick={() => void stop()} aria-label="停止分析"><Icon name="stop" size={15} /></button> : <button className="send-button" disabled={!input.trim()} aria-label="发送选品需求"><Icon name="arrow" size={20} /></button>}</div></form>
  const renderCards = (items: CatalogProduct[]) => <div className="offer-grid">{items.map(product => <OfferCard key={product.id} product={product} demo={demo} saved={saved.includes(product.id)} onSave={() => toggleSaved(product.id)} onOpen={value => openOffer(value)} onQuote={value => openOffer(value, 'quote')} />)}</div>
  const ideaNeeds = ideaContext?.need?.split(/[、,，]/).map(item => item.trim()).filter(Boolean) ?? []
  const loopBack = ideaContext?.from ? <p className="loop-back">这一步已经有着落。<a href={`/#project/${ideaContext.from}`}>回到灵感，记下这一步进展</a></p> : null
  const ideaMatchBlock = ideaContext ? <div className="idea-matches">{ideaMatchBusy ? <p className="source-note ui-disclaimer" role="status">正在对照现有供货目录…</p> : ideaMatches.length ? <><div className="inspiration-heading idea-match-heading"><span>目录中相近的供货</span><button type="button" className="text-button" onClick={() => void navigate('supply')}>查看全部 <Icon name="chevron" size={12} /></button></div>{renderCards(ideaMatches)}<p className="source-note ui-disclaimer"><Icon name="supply" size={13} />相近结果来自当前商品库，不代表该灵感已有现成商品。</p></> : <p className="source-note ui-disclaimer">现有目录还没有直接对应「{ideaContext.name}」的商品。描述得更具体，或先浏览全部供货。</p>}</div> : null
  const ideaLanding = <section className="idea-landing"><article className="idea-landing-card"><div><div className="overline">FROM IDEA TO SUPPLY</div><h1>{ideaContext?.name}</h1><p>先对照现有供货，再决定要不要继续询价。结果来自当前商品库，不代表该灵感已有现成商品。</p>{ideaNeeds.length > 0 && <div className="idea-needs">{ideaNeeds.map(need => <span key={need}>{need}</span>)}</div>}</div><div className="idea-landing-actions">{ideaContext?.from && <a className="text-button" href={`/#project/${ideaContext.from}`}><Icon name="back" size={14} />返回灵感</a>}<button type="button" className="text-button" onClick={() => { dismissIdeaContext(); setIdeaContext(undefined); setInput('') }}>知道了</button></div></article>{composer}{ideaMatchBlock}<p className="welcome-footnote ui-disclaimer"><span />相近供货来自当前商品库，不代表该灵感已有现成商品。</p></section>

  return <div className={`app-shell ${selection ? 'with-panel' : ''}`}>
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    {mobileNav && <button className="nav-scrim" aria-label="关闭导航" onClick={() => setMobileNav(false)} />}
    <aside ref={sidebarRef} tabIndex={-1} inert={(narrow && !mobileNav) || (!!selection && overlayPanel)} className={`sidebar ${mobileNav ? 'mobile-open' : ''}`} aria-label="主导航"><a className="brand" href="#" onClick={e => { e.preventDefault(); void navigate('agent') }}><Brand /><span>supply<span className="brand-period">.</span></span><span className="brand-beta">BETA</span></a><button className="new-conversation" disabled={busy || draftBusy} onClick={() => { setMessages([]); setSelection(undefined); setInput(''); session.current = undefined; void navigate('agent'); composerRef.current?.focus() }}><Icon name="plus" size={17} /> 新的选品想法 <span>↗</span></button>
      <div className="nav-label">你的工作伙伴</div><button className={`agent-nav ${view === 'agent' ? 'selected' : ''}`} onClick={() => void navigate('agent')} aria-current={view === 'agent' ? 'page' : undefined}><Presence state={presence} /><span><strong>Supply Agent</strong><small>{busy ? activity : '把想法变成下一款产品'}</small></span><span className="online-dot" /></button>
      <div className="nav-label second">工作空间</div><nav><a className="sidebar-link" href="/"><Icon name="spark" />灵感广场</a><button className={view === 'supply' && !onlySaved ? 'selected' : ''} aria-current={view === 'supply' && !onlySaved ? 'page' : undefined} onClick={() => { setOnlySaved(false); void navigate('supply') }}><Icon name="supply" />供货目录</button><button className={view === 'supply' && onlySaved ? 'selected' : ''} aria-current={view === 'supply' && onlySaved ? 'page' : undefined} onClick={() => { setOnlySaved(true); void navigate('supply') }}><Icon name="bookmark" />我的收藏{saved.length > 0 && <span className="nav-count">{saved.length}</span>}</button><button className={view === 'orders' ? 'selected' : ''} aria-current={view === 'orders' ? 'page' : undefined} onClick={() => void navigate('orders')}><Icon name="orders" />订单与履约</button></nav>
      <div className="sidebar-bottom"><div className="workspace-note"><span className="note-line" />从一个好想法，<br />到一门好生意。</div><button className="settings-nav" onClick={() => void navigate('settings')}><Icon name="settings" />设置与连接<Icon name="chevron" size={13} /></button><div className="profile"><span className="profile-avatar">S</span><span><strong>我的工作空间</strong><small>{demo ? '演示预览' : '个人工作空间'}</small></span><button className="icon-button" onClick={changeTheme} aria-label={theme === 'light' ? '切换深色模式' : '切换浅色模式'} title={theme === 'light' ? '深色模式' : '浅色模式'}><Icon name={theme === 'light' ? 'moon' : 'sun'} size={17} /></button></div></div>
    </aside>

    <main id="main-content" className="main-area" inert={(!!selection && overlayPanel) || (mobileNav && narrow)}><header className="topbar"><div className="topbar-title"><button className="icon-button mobile-menu" aria-label="打开导航" onClick={() => setMobileNav(true)}><Icon name="menu" /></button><span>{view === 'agent' ? 'Supply Agent' : view === 'supply' ? '供货目录' : view === 'orders' ? '订单与履约' : '设置与连接'}</span>{view === 'agent' && <span className="subtle-tag">你的选品伙伴</span>}</div><button className="connection-status" onClick={() => void navigate('settings')}><span className={`connection-dot ${demo ? 'demo' : connection}`} />{demo ? '演示预览' : connection === 'online' ? '工作空间已连接' : connection === 'checking' ? '连接中' : '离线 · 检查连接'}<Icon name="chevron" size={12} /></button></header>
      {demo && <div className="demo-banner">正在预览演示商品与交互，所有供货条件均为示例。<button onClick={() => setMode(false)} disabled={busy || draftBusy}>返回我的工作空间 <Icon name="chevron" size={12} /></button></div>}
      {ideaContext && messages.length > 0 && <div className="idea-banner"><p>正在为灵感<strong>「{ideaContext.name}」</strong>寻找实现路径。{ideaContext.need ? `需求：${ideaContext.need}。` : ''}结果来自当前供货目录，不代表该灵感已有现成商品。</p><div className="idea-actions">{ideaContext.from && <a href={`/#project/${ideaContext.from}`}>返回灵感</a>}<button type="button" onClick={() => { dismissIdeaContext(); setIdeaContext(undefined) }}>知道了</button></div></div>}
      {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}><Icon name="close" size={16} /></button></div>}

      {view === 'agent' && <div className={`agent-view ${messages.length ? 'has-conversation' : ''}`}>
        {messages.length === 0 ? ideaContext ? ideaLanding : <section className="welcome"><div className="welcome-presence"><Presence large /><span className="welcome-spark">✳</span></div><div className="welcome-eyebrow">A GOOD IDEA STARTS HERE</div><h1>你想卖点什么<span>？</span></h1><p className="welcome-description">从发现好产品，到找到靠谱的供货伙伴。<br className="mobile-break" />一起把想法向前推一步。</p>{composer}<div className="quick-prompts">{[['宠物用品', '帮我找一些宠物用品'], ['家居生活', '帮我找一些家居氛围灯'], ['美妆个护', '找一些美妆个护产品'], ['户外出行', '寻找适合户外出行的产品']].map(([label, query]) => <button key={label} disabled={busy} onClick={() => void send(query)}>{label}<Icon name="chevron" size={12} /></button>)}</div><div className="inspiration-heading"><span>一点灵感，从这里开始</span><a href="/#discover">去灵感广场</a></div><div className="inspiration-grid">{suggestions.map(s => <button className="inspiration-card" key={s.query} onClick={() => void send(s.text)}><ProductArt category={s.art} title={s.title} /><div><span className="overline">{s.category}</span><strong>{s.text}</strong><small>{s.detail}</small></div><span className="inspiration-arrow"><Icon name="external" size={15} /></span></button>)}</div><div className="welcome-footnote"><span /> 供货条件清晰可见，每一步由你决定</div>{connection === 'offline' && !demo && <button className="demo-entry text-button" onClick={() => setMode(true)}>先体验演示工作空间 <Icon name="chevron" size={14} /></button>}</section>
        : <><div className="conversation" aria-label="选品对话">{messages.map(message => message.role === 'user' ? <div className="user-message" key={message.id}><div>{message.text}</div><span className="message-avatar">你</span></div> : <article className="assistant-message" key={message.id}><div className="message-heading"><Presence state={busy && message.id === messages.at(-1)?.id ? presence : 'idle'} /><strong>Supply Agent</strong><span>{message.draft ? '询价草稿' : '供货发现'}</span></div>{message.text && <p className="message-text">{message.text}</p>}{!message.text && busy && <div className="thinking-line"><span /><span /><span />正在查看供货目录</div>}{message.products && message.products.length > 0 && renderCards(message.products)}{message.draft && <><div className="draft-card"><span className="draft-icon"><Icon name="orders" size={22} /></span><div><strong>询价草稿已准备好</strong><p>{message.draft}</p><span>等待确认商业条件</span></div><Icon name="check" size={18} /></div>{loopBack}</>}{message.note && <p className="source-note ui-disclaimer"><Icon name="supply" size={13} />{message.note}</p>}{message.products?.length === 0 && <button className="small-button" onClick={() => void navigate('supply')}>浏览全部供货目录 <Icon name="chevron" size={13} /></button>}</article>)}
          {approval && <div className="approval-card" role="status"><span className="approval-symbol"><Icon name="spark" /></span><div><h3>这一步，需要你确认</h3><p>{friendlyTools[approval.toolName] ?? approval.toolName}</p>{approval.reason && <p>{approval.reason}</p>}<div className="button-row"><button className="primary-button" disabled={approvalBusy} onClick={() => void decide('allow')}>允许这一次</button><button className="small-button" disabled={approvalBusy} onClick={() => void decide('deny')}>拒绝</button></div></div></div>}<div ref={bottom} /></div><div className="composer-dock">{busy && <div className="activity-line" role="status"><Presence state={presence} />{activity}</div>}{composer}<span className="composer-hint">Enter 发送 · Shift + Enter 换行 · 商业条件以供应商确认为准</span></div></>}
      </div>}

      {view === 'supply' && <section className="collection-view"><div className="page-heading"><div><div className="overline">YOUR NEXT OPPORTUNITY</div><h1>{onlySaved ? '留住好想法。' : '找到下一款好产品。'}</h1><p>查看供货条件，把值得继续了解的产品留下来。</p></div><span className="count-label">{catalogBusy && !shownProducts.length ? '加载中' : `${shownProducts.length} 款产品`}</span></div><div className="catalog-toolbar"><div className="segmented"><button className={!onlySaved ? 'active' : ''} onClick={() => setOnlySaved(false)}>全部商品</button><button className={onlySaved ? 'active' : ''} onClick={() => setOnlySaved(true)}>我的收藏</button></div><form className="catalog-search" onSubmit={searchCatalog}><Icon name="search" size={16} /><input aria-label="搜索供货目录" placeholder="搜索商品、品类或 SKU" value={catalogFilter} onChange={e => setCatalogFilter(e.target.value)} /><button className="icon-button" aria-label="搜索目录"><Icon name="chevron" size={15} /></button></form></div>{catalogBusy && !shownProducts.length ? <div className="empty-state ui-empty" role="status"><Presence state="working" /><p>正在加载供货目录…</p></div> : shownProducts.length ? renderCards(shownProducts) : <div className="empty-state ui-empty"><Icon name={onlySaved ? 'bookmark' : 'supply'} size={34} /><h2>{onlySaved ? '给好产品留个位置' : '这里还没有匹配的产品'}</h2><p>{onlySaved ? '点击商品卡片上的收藏图标，稍后在这里继续。' : catalogFilter.trim() ? '试试其他关键词，或清除搜索后浏览全部商品。' : '试试其他关键词，或先体验演示商品。'}</p><button className="small-button" onClick={() => { if (onlySaved) setOnlySaved(false); else if (catalogFilter.trim()) setCatalogFilter(''); else if (!demo && !products.length) setMode(true); else void navigate('supply') }}>{onlySaved ? '浏览全部商品' : catalogFilter.trim() ? '清除搜索' : !demo ? '体验演示商品' : '重新加载'}</button></div>}</section>}

      {view === 'orders' && <section className="collection-view"><div className="page-heading"><div><div className="overline">FROM ORDER TO DOORSTEP</div><h1>每一单，都有着落。</h1><p>从供应商确认，到包裹送达，在这里跟进。</p></div><button className="small-button" disabled={ordersBusy} onClick={() => void navigate('orders')}><Icon name="refresh" size={14} />刷新</button></div>{ordersBusy ? <div className="empty-state ui-empty" role="status"><Presence state="working" /><p>正在加载订单…</p></div> : orders.length ? <div className="order-list">{orders.map(order => <article className="order-card" key={order.id}><Icon name="orders" size={24} /><div><strong>订单 {order.id.slice(-8)}</strong><span>目的地 {order.destinationCountry} · {new Date(order.createdAt).toLocaleDateString('zh-CN')}</span>{order.purchaseOrders?.map((po, index) => po.trackingNumber && <small key={index}>物流单号 {po.trackingNumber}</small>)}</div><span className="subtle-tag">{orderStatus[order.status] ?? order.status}</span></article>)}</div> : <div className="empty-state ui-empty order-empty"><span className="empty-illustration"><Icon name="orders" size={40} /></span><h2>你的第一笔订单，从一个好产品开始</h2><p>{demo ? '演示模式不生成真实订单。' : '连接店铺并建立供货关系后，订单会显示在这里。'}</p><button className="primary-button" onClick={() => void navigate('supply')}>去发现产品 <Icon name="chevron" size={14} /></button></div>}</section>}

      {view === 'settings' && <section className="settings-view"><div className="page-heading"><div><div className="overline">MAKE IT YOURS</div><h1>准备好，一起出发。</h1><p>管理工作空间的连接与偏好。</p></div></div><div className="settings-group"><div className="setting-row"><span className="setting-icon"><Icon name="supply" size={22} /></span><div><h3>供货工作空间</h3><p>{connection === 'online' ? '供货服务已连接，可以查看当前目录。' : connection === 'checking' ? '正在检查连接…' : '尚未连接。请启动本地供货服务后重试。'}</p></div><button className="small-button" onClick={() => void checkConnection()} disabled={connection === 'checking'}>检查连接</button></div><div className="setting-row"><span className="setting-icon shopify-letter">S</span><div><h3>Shopify</h3><p>{health?.shopify === 'admin' ? '已配置店铺连接。店铺授权与草稿管理将在后续阶段开放。' : '连接店铺后，将选定的产品带到你的商店。'}</p></div><span className="subtle-tag">{health?.shopify === 'admin' ? '已配置' : '待接入'}</span></div><div className="settings-explanation ui-disclaimer">店铺授权、正式供货关系和商品推送尚未接入此界面。当前询价操作只会生成草稿。</div></div><div className="settings-group"><div className="setting-row"><span className="setting-icon"><Icon name={theme === 'light' ? 'sun' : 'moon'} size={22} /></span><div><h3>外观</h3><p>选择适合你工作节奏的配色。</p></div><button className="small-button" onClick={changeTheme}>{theme === 'light' ? '浅色' : '深色'}<Icon name={theme === 'light' ? 'sun' : 'moon'} size={15} /></button></div><div className="setting-row"><span className="setting-icon"><Icon name="spark" size={22} /></span><div><h3>演示预览</h3><p>体验选品、收藏和询价，不创建真实业务记录。</p></div><button role="switch" aria-checked={demo} aria-label="演示预览" className={`toggle ${demo ? 'on' : ''}`} disabled={busy || draftBusy} onClick={() => setMode(!demo)}><span /></button></div></div><p className="settings-footer">Supply · 让每个好想法，都有可靠的供给。</p></section>}
    </main>

    {selection && <><button className="panel-scrim" aria-label="关闭供货详情" onClick={closePanel} /><aside className="context-panel" ref={panelRef} tabIndex={-1} aria-label="供货详情"><div className="panel-heading"><span>供货详情</span><button className="icon-button" aria-label="关闭供货详情" onClick={closePanel}><Icon name="close" size={19} /></button></div><div className="panel-scroll">{error && <div className="error-banner" role="alert">{error}</div>}<div className="panel-product"><ProductArt title={selection.product.title} category={selection.product.category} image={selection.product.images[0]} /><span className="art-label">{demo ? '演示商品 · 产品示意' : selection.product.images.length ? '商品图片' : '产品示意'}</span></div><div className="panel-product-title"><span className="overline">{selection.product.category}</span><h2>{selection.product.title}</h2><p>{selection.product.sku}</p></div><div className="panel-tabs" role="tablist" aria-label="供货详情内容"><button role="tab" id="offer-tab" aria-controls="offer-content" aria-selected={panelTab === 'offer'} className={panelTab === 'offer' ? 'active' : ''} onClick={() => setPanelTab('offer')}>供货条件</button><button role="tab" id="quote-tab" aria-controls="quote-content" aria-selected={panelTab === 'quote'} className={panelTab === 'quote' ? 'active' : ''} onClick={() => setPanelTab('quote')}>询价草稿</button></div>
      {panelTab === 'offer' ? <div className="panel-content" role="tabpanel" id="offer-content" aria-labelledby="offer-tab"><p className="panel-description">{selection.product.description}</p><label className="field-label" htmlFor="supplier-select">供货方 · {selection.product.offers.length} 个报价</label><select id="supplier-select" value={selection.offer.id} onChange={e => { const offer = selection.product.offers.find(o => o.id === e.target.value)!; setSelection({ ...selection, offer }); setQuantity(String(offer.moq)); setDraftId('') }}>{selection.product.offers.map(o => <option key={o.id} value={o.id}>{o.supplier.name} · {price(o.unitPrice, o.currency)}</option>)}</select><dl className="detail-list"><div><dt>商品单价</dt><dd className="detail-price">{price(selection.offer.unitPrice, selection.offer.currency)}<small> / 件</small></dd></div><div><dt>最低起订量</dt><dd>{selection.offer.moq} 件</dd></div><div><dt>参考交期</dt><dd>{selection.offer.leadTimeDays} 天</dd></div><div><dt>记录库存</dt><dd>{selection.offer.stock === undefined ? '待确认' : `${selection.offer.stock} 件`}</dd></div><div><dt>发货国家</dt><dd>{selection.offer.supplier.country === 'CN' ? '中国' : selection.offer.supplier.country}</dd></div><div><dt>品牌定制</dt><dd className="muted">待供应商确认</dd></div></dl><div className="evidence-note"><span className="evidence-dot" /><div><strong>{demo ? '演示供货信息' : '目录记录 · 未验证'}</strong><p>更新于 {new Date(selection.offer.updatedAt).toLocaleDateString('zh-CN')}<br />{demo ? '仅供界面体验，不代表真实供应商或库存。' : '当前目录未提供商业条件的验证凭据。'}</p></div></div></div>
      : <div className="panel-content" role="tabpanel" id="quote-content" aria-labelledby="quote-tab"><div className="quote-intro"><Icon name="orders" size={18} /><span>先整理需求，再确认正式报价。</span></div><div className="quote-fields"><label>采购数量<input type="number" min={selection.offer.moq} max="1000000" step="1" value={quantity} disabled={draftBusy} onChange={e => { setQuantity(e.target.value); setDraftId('') }} /></label><label>目的地<select value={destination} disabled={draftBusy} onChange={e => { setDestination(e.target.value); setDraftId('') }}><option value="US">美国 US</option><option value="GB">英国 GB</option><option value="DE">德国 DE</option><option value="CA">加拿大 CA</option><option value="AU">澳大利亚 AU</option></select></label></div><p className="field-hint">最低起订 {selection.offer.moq} 件 · 不含品牌定制</p><dl className="quote-breakdown"><div><dt>商品单价</dt><dd>{price(selection.offer.unitPrice, selection.offer.currency)}</dd></div><div><dt>商品小计</dt><dd>{validQuantity ? price(Math.round(selection.offer.unitPrice * 100) * Number(quantity) / 100, selection.offer.currency) : '—'}</dd></div><div><dt>目录参考运费</dt><dd>{price(selection.offer.shippingFlat, selection.offer.currency)}</dd></div><div><dt>目的地运费 / 税费</dt><dd className="muted">待确认</dd></div><div className="quote-total"><dt>最终到岸成本</dt><dd>待正式报价</dd></div></dl><div className="quote-disclaimer ui-disclaimer">目录运费尚未确认适用地区和计费条件，不计入最终报价。草稿不会自动发送给供应商。</div>{draftId && <div className="draft-success" role="status"><Icon name="check" size={17} /><div><strong>{demo ? '演示草稿已准备好' : '询价草稿已保存'}</strong><p>{demo ? '未创建真实业务记录' : '可在采购项目中继续处理'}</p></div></div>}</div>}
      </div><div className="panel-footer">{panelTab === 'offer' ? <button className="primary-button full" onClick={() => setPanelTab('quote')}>准备询价 <Icon name="chevron" size={16} /></button> : <button className="primary-button full" disabled={!validQuantity || draftBusy || !!draftId} onClick={() => void createDraft()}>{draftBusy ? '正在保存草稿…' : draftId ? '草稿已准备好' : demo ? '预览询价草稿' : '保存询价草稿'}<Icon name={draftId ? 'check' : 'chevron'} size={16} /></button>}{draftId && loopBack}<span>没有你的确认，不会下单或支付。</span></div></aside></>}
    {toast && <div className="toast" role="status"><Icon name="check" size={16} />{toast}</div>}
  </div>
}

