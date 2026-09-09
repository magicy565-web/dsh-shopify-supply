// Browser acceptance uses intercepted gateway responses; no live task is started.
// PLAYWRIGHT_MODULE_DIR may point to an existing Playwright installation.
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_DIR || 'playwright')
const base = process.env.UX_BASE_URL || 'http://127.0.0.1:3100'
const output = path.resolve(process.env.UX_OUTPUT_DIR || 'docs/ux-artifacts')
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: process.env.UX_BROWSER_CHANNEL || 'msedge', headless: true })
const results = []
const event = (type, props = {}) => ({ type, sessionId: 'ux-session', ts: '2026-09-09T10:00:00Z', ...props })
let run = { id: 'ux-run', sessionId: 'ux-session', goal: '演示任务：探索模块化台灯', status: 'running', activity: '正在研究产品方向', error: '', stages: [], campaign: { draft: { name: '模块化台灯', story: '' } }, events: [] }
let runReads = 0
async function fixture(context, login = false) {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin === new URL(base).origin) return route.continue()
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return route.abort()
    let body = {}
    if (url.pathname === '/health') body = { launch: { modelConfigured: true } }
    else if (url.pathname === '/v1/community/me') body = { user: { id: 'ux-user', name: '视觉验收', email: 'ux@example.test', role: 'creator' } }
    else if (url.pathname === '/v1/community/projects') body = { items: [], viewer: { saved: [], following: [] } }
    else if (url.pathname === '/v1/launch/runs') { body = { items: [structuredClone(run)] }; runReads++ }
    else if (url.pathname.includes('/notifications')) body = { items: [] }
    else if (route.request().method() !== 'GET') return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: '隔离验收：不执行真实操作' }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: { 'Access-Control-Allow-Origin': '*' } })
  })
  if (login) await context.addInitScript(() => localStorage.setItem('supply.community.token', 'isolated-ux-test'))
}
let navigation = 0
async function navigate(page, hash) {
  await page.goto(`${base}/?ux=${++navigation}#${hash}`)
  await page.locator('.ip-footer').waitFor()
}
async function check(name, fn) { await fn(); results.push(name); console.log('PASS', name) }
async function pollRun(page, status) {
  await page.waitForFunction(status => document.querySelector('.agent-runtime')?.getAttribute('data-state') === status, status)
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await fixture(context)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await check('Responsive light/dark layouts at 390, 768, 1440', async () => {
    for (const width of [390, 768, 1440]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 })
      await navigate(page, 'home')
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await page.locator('.tech-hero .visual-image[data-loaded=true]').waitFor()
      await page.waitForTimeout(350)
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.screenshot({ path: path.join(output, `home-${width}-${theme}.png`) })
      for (const route of ['discover', 'studio', 'agent']) {
        await page.evaluate(hash => { location.hash = hash }, route)
        await page.waitForTimeout(400)
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}/${theme}/${route} overflow`)
        if (route === 'agent') {
          const core = page.locator('.tech-core .visual-image')
          await page.locator('.tech-core [data-loaded=true]').waitFor()
          assert.equal(await core.evaluate(el => getComputedStyle(el).filter), 'none')
          assert((await core.boundingBox()).width >= 140)
        }
      }
    }
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await check('Keyboard focus, offscreen pause and reduced motion', async () => {
    await navigate(page, 'home')
    const primary = page.locator('.tech-hero-actions .ip-btn')
    await primary.focus()
    assert(await primary.evaluate(el => el === document.activeElement))
    await page.locator('.ip-footer').scrollIntoViewIfNeeded()
    await page.waitForFunction(() => document.querySelector('.tech-hero')?.getAttribute('data-motion-paused') === 'true')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.locator('.tech-hero').scrollIntoViewIfNeeded()
    assert.equal(await page.locator('.tech-hero-copy').evaluate(el => getComputedStyle(el).animationName), 'none')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
  })
  await check('Image load failure keeps hero action and reserved geometry', async () => {
    await page.route('**/tech-hero-v1.webp', route => route.abort())
    await navigate(page, 'home')
    await page.locator('.tech-hero [data-failed=true]').waitFor()
    assert(await page.locator('.tech-hero-actions .ip-btn').isVisible())
    assert((await page.locator('.tech-hero').boundingBox()).height >= 400)
    await page.unroute('**/tech-hero-v1.webp')
  })
  await check('Slow image preserves layout, then fades in', async () => {
    let release
    const gate = new Promise(resolve => { release = resolve })
    await page.route('**/tech-hero-v1.webp', async route => { await gate; await route.continue() })
    await page.goto(`${base}/?ux=${++navigation}#home`, { waitUntil: 'domcontentloaded' })
    await page.locator('.tech-hero').waitFor()
    const before = await page.locator('.tech-hero').boundingBox()
    release()
    await page.locator('.tech-hero [data-loaded=true]').waitFor()
    assert.equal((await page.locator('.tech-hero').boundingBox()).height, before.height)
    await page.unroute('**/tech-hero-v1.webp')
  })
  await check('Confirmed collection feedback, failure and empty search', async () => {
    await navigate(page, 'discover')
    const save = page.locator('.ip-save').first()
    await save.click()
    assert.equal(await save.getAttribute('aria-pressed'), 'true')
    await page.getByRole('status').filter({ hasText: '已加入收藏' }).waitFor()
    await page.evaluate(() => { window.__originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.includes('saved')) throw new DOMException('Full', 'QuotaExceededError'); return window.__originalSetItem.call(this, key, value) } })
    await save.click()
    assert.equal(await save.getAttribute('aria-pressed'), 'true')
    await page.locator('.ip-global-error').waitFor()
    await page.evaluate(() => { Storage.prototype.setItem = window.__originalSetItem })
    await page.locator('.ip-search-field input').fill('no-such-product-ux')
    await page.locator('.ip-empty').waitFor()
  })
  await check('Studio validation focus, step navigation, saved draft and failed save', async () => {
    await navigate(page, 'studio')
    await page.getByRole('button', { name: '继续下一步' }).click()
    assert(await page.getByPlaceholder('给你的想法起个名字').evaluate(el => el === document.activeElement))
    await page.getByPlaceholder('给你的想法起个名字').fill('模块化台灯')
    await page.getByPlaceholder('它为谁，解决什么问题？').fill('让每一个零件都可以独立更换。')
    await page.locator('.qs-editor textarea').fill('为长期使用而设计的模块化台灯，让灯罩、电池和底座都能单独更换，减少浪费，也让维修变得更加简单。')
    await page.getByRole('button', { name: '继续下一步' }).click()
    await page.locator('.qs-directions button').first().click()
    await page.locator('.qs-editor textarea').fill('可独立更换电池\n模块化连接结构')
    await page.getByRole('button', { name: '上一步', exact: true }).click()
    assert.equal(await page.getByPlaceholder('给你的想法起个名字').inputValue(), '模块化台灯')
    await page.getByRole('button', { name: '保存草稿', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '草稿已保存' }).waitFor()
    await page.reload()
    assert.equal(await page.getByPlaceholder('给你的想法起个名字').inputValue(), '模块化台灯')
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError') } })
    await page.getByRole('button', { name: '保存草稿', exact: true }).click()
    await page.locator('.ip-global-error').waitFor()
    assert.equal(await page.locator('.motion-toast').count(), 0)
  })
  assert.deepEqual(errors, [])
  await context.close()

  const agentContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await fixture(agentContext, true)
  const agent = await agentContext.newPage()
  run.events = Array.from({ length: 36 }, (_, i) => event('tool.completed', { toolCallId: String(i), toolName: `研究步骤 ${i + 1}`, isError: false, result: {} }))
  await navigate(agent, 'agent?run=ux-run')
  await check('Agent six states and completion animation does not replay on polling', async () => {
    for (const status of ['idle', 'running', 'waiting_approval', 'completed', 'failed', 'aborted']) {
      run.status = status
      await pollRun(agent, status)
      assert.equal(await agent.locator('.agent-equalizer').count(), status === 'running' ? 1 : 0)
      if (status === 'completed') {
        await agent.locator('.agent-runtime').scrollIntoViewIfNeeded()
        await agent.evaluate(() => { window.__completionAnimations = 0; document.querySelector('.agent-orbit>span').addEventListener('animationstart', () => window.__completionAnimations++) })
        await agent.waitForTimeout(400)
        const count = await agent.evaluate(() => window.__completionAnimations)
        const previousReads = runReads
        await agent.waitForTimeout(2700)
        assert(runReads > previousReads)
        assert.equal(await agent.evaluate(() => window.__completionAnimations), count)
      }
    }
  })
  await check('Log follows bottom, preserves history position, and jumps to latest', async () => {
    const log = agent.locator('.agent-event-rows')
    await log.scrollIntoViewIfNeeded()
    assert(await log.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 35))
    await log.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')) })
    run.events.push(event('message.delta', { text: '新一段真实事件格式的隔离测试输出。' }))
    await agent.getByRole('button', { name: '查看最新记录' }).waitFor()
    assert.equal(await log.evaluate(el => el.scrollTop), 0)
    await agent.getByRole('button', { name: '查看最新记录' }).click()
    assert(await log.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 35))
    run.events.push(event('message.delta', { text: '\n继续追加输出。'.repeat(30) }))
    await agent.waitForTimeout(2800)
    assert(await log.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 35))
  })
  await agentContext.close()

  if (process.env.UX_RECORD !== '0') {
    const recording = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: output, size: { width: 1440, height: 900 } } })
    await fixture(recording)
    const demo = await recording.newPage()
    await recording.addInitScript(() => {
      window.addEventListener('DOMContentLoaded', () => {
        const badge = document.createElement('div')
        badge.textContent = 'UI 动效演示 · 隔离测试数据 · 不执行真实任务'
        badge.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;background:#092a26;color:#bcf5de;border:1px solid #537c6c;padding:10px 16px;border-radius:24px;font:12px system-ui;pointer-events:none'
        document.body.append(badge)
      })
    })
    await navigate(demo, 'home')
    await demo.waitForTimeout(6500)
    await demo.screenshot({ path: path.join(output, 'demo-home.png') })
    await demo.locator('.tech-secondary').click()
    await demo.locator('.ip-project-card').first().hover()
    await demo.waitForTimeout(1500)
    await demo.locator('.ip-save').first().click()
    await demo.waitForTimeout(2500)
    await demo.screenshot({ path: path.join(output, 'demo-discover.png') })
    await navigate(demo, 'studio')
    await demo.getByPlaceholder('给你的想法起个名字').fill('模块化台灯')
    await demo.getByPlaceholder('它为谁，解决什么问题？').fill('每个零件，都能拥有更长的使用寿命。')
    await demo.locator('.qs-editor textarea').fill('为长期使用而设计的模块化台灯，让灯罩、电池和底座都能单独更换，减少浪费，也让维修变得更加简单。')
    await demo.waitForTimeout(1800)
    await demo.getByRole('button', { name: '继续下一步' }).click()
    await demo.locator('.qs-directions button').first().click()
    await demo.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    await demo.waitForTimeout(1800)
    await demo.screenshot({ path: path.join(output, 'demo-studio.png') })
    await navigate(demo, 'agent')
    await demo.locator('.tech-core [data-loaded=true]').waitFor()
    await demo.waitForTimeout(5000)
    await demo.screenshot({ path: path.join(output, 'demo-agent-welcome.png') })
    await demo.evaluate(() => localStorage.setItem('supply.community.token', 'isolated-ux-test'))
    run = { ...run, status: 'running', activity: '正在检索产品方向', events: [event('tool.started', { toolCallId: 'demo-search', toolName: '产品方向研究' })] }
    await navigate(demo, 'agent?run=ux-run')
    await demo.locator('.agent-runtime').scrollIntoViewIfNeeded()
    await demo.locator('.agent-runtime').evaluate(el => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 120, behavior: 'smooth' }))
    await demo.waitForTimeout(3500)
    run.status = 'waiting_approval'; run.activity = '等待确认草稿写入'
    run.events.push(event('approval.requested', { approvalId: 'demo-approval', toolName: '保存项目草稿', reason: '演示确认状态，不执行写入。', arguments: {} }))
    await pollRun(demo, 'waiting_approval')
    await demo.waitForTimeout(3000)
    run.status = 'completed'; run.activity = '本轮完成，成果已整理'
    run.events.push(event('approval.resolved', { approvalId: 'demo-approval', decision: 'allow', outcome: 'demo' }), event('tool.completed', { toolCallId: 'demo-search', toolName: '产品方向研究', isError: false, result: {} }), event('agent.completed'))
    run.campaign.draft.story = '演示成果：已梳理模块化台灯的设计方向与待验证事项。此内容为隔离测试数据。'
    await pollRun(demo, 'completed')
    await demo.waitForTimeout(3500)
    await demo.screenshot({ path: path.join(output, 'demo-agent.png') })
    await demo.locator('.agent-draft-result').scrollIntoViewIfNeeded()
    await demo.waitForTimeout(3000)
    const video = demo.video()
    await recording.close()
    await video.saveAs(path.join(output, 'core-ux-demo.webm'))
    await video.delete()
    results.push('Recorded core-ux-demo.webm at 1440×900 with visible isolated-data label')
  }
  await fs.writeFile(path.join(output, 'acceptance.json'), JSON.stringify({ passed: results, date: new Date().toISOString() }, null, 2))
  console.log('All acceptance checks passed.')
} finally { await browser.close() }
