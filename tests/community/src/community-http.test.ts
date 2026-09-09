import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createGatewayApp } from '@dsh-supply/agent-gateway/app'
import { InMemoryAgentRuntime } from '@dsh-supply/agent-runtime'
import { CatalogService, InMemoryCatalogRepository } from '@dsh-supply/catalog'
import { CommerceService, FixtureShopifyStore, InMemoryCommerceRepository } from '@dsh-supply/commerce'
import { CommunityService, JsonCommunityRepository, SAMPLE_IMAGES } from '@dsh-supply/community'
import { InMemoryProcurementRepository, ProcurementService } from '@dsh-supply/procurement'

async function listen(handle: ReturnType<typeof createGatewayApp>['handle']) {
  const server = createServer((req, res) => { void handle(req, res) })
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve())
    server.on('error', reject)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('expected TCP listen address')
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  }
}

async function gateway() {
  const dir = await mkdtemp(join(tmpdir(), 'community-http-'))
  const catalog = new CatalogService(new InMemoryCatalogRepository())
  const procurement = new ProcurementService(new InMemoryProcurementRepository(), catalog)
  const commerce = new CommerceService(new InMemoryCommerceRepository(), catalog, procurement, new FixtureShopifyStore())
  const community = new CommunityService(
    new JsonCommunityRepository(join(dir, 'community.json')),
    join(dir, 'uploads'),
    { email: 'admin@supply.local', password: 'supply-admin-change-me', name: '平台管理员' },
  )
  const app = createGatewayApp({
    runtime: new InMemoryAgentRuntime(),
    catalog,
    procurement,
    commerce,
    community,
    storage: 'json',
    origin: '*',
    runtimeKind: 'in-memory',
    internalToken: 'gateway-secret',
  })
  return { app, server: await listen(app.handle) }
}

async function json(url: string, path: string, body?: unknown, token?: string, method = body === undefined ? 'GET' : 'POST') {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${url}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json() as Record<string, unknown>
  return { status: response.status, data }
}

const draft = {
  name: '可替换电池台灯',
  tagline: '坏了零件，不必丢掉整盏灯。',
  category: '可持续设计',
  stage: '原型开发',
  creator: '创作者A',
  city: '杭州',
  image: SAMPLE_IMAGES[0],
  story: '我们想重新思考一盏灯的寿命。当电池老化时，为什么必须丢掉整个产品？这是已经写够四十个字的产品故事，用于提交审核。',
  highlights: '模块化结构\n可独立更换电池',
  needs: ['用户反馈', '测试用户'],
  goal: '200',
}

const content = {
  gallery: [SAMPLE_IMAGES[0]],
  video: '',
  audience: '在意维修和长期使用的人',
  milestones: '9 月完成访谈；10 月制作第一版原型。',
  participation: '欢迎试用反馈，也欢迎结构与供应链合作。当前不涉及付款。',
  team: '两名工业设计师与一名硬件工程师。',
  risks: '材料成本和可维修结构仍需打样验证。',
}

test('HTTP community loop survives logout and a second account', async () => {
  const { server } = await gateway()
  try {
    const admin = await json(server.url, '/v1/community/login', { email: 'admin@supply.local', password: 'supply-admin-change-me' })
    const a = await json(server.url, '/v1/community/register', { email: 'a@example.com', password: 'password1', name: '创作者A' })
    const b = await json(server.url, '/v1/community/register', { email: 'b@example.com', password: 'password1', name: '参与者B' })
    const adminToken = String((admin.data as { token: string }).token)
    const tokenA = String((a.data as { token: string }).token)
    const tokenB = String((b.data as { token: string }).token)

    const created = await json(server.url, '/v1/community/campaigns', { draft, content, step: 6 }, tokenA)
    const campaignId = String(((created.data as { campaign: { id: string } }).campaign).id)
    assert.equal(created.status, 201)

    await json(server.url, `/v1/community/campaigns/${campaignId}`, { action: 'submit' }, tokenA)
    await json(server.url, `/v1/community/review/${campaignId}`, { action: 'approve', note: '可以发布' }, adminToken)
    await json(server.url, `/v1/community/campaigns/${campaignId}`, { action: 'publish' }, tokenA)

    const publicList = await json(server.url, '/v1/community/projects')
    assert.equal(publicList.status, 200)
    assert.equal(((publicList.data as { items: Array<{ id: string }> }).items).some(item => item.id === campaignId), true)

    await json(server.url, '/v1/community/logout', {}, tokenA)
    const denied = await json(server.url, '/v1/community/campaigns', { draft: { name: 'should fail' } }, tokenA)
    assert.equal(denied.status, 401)

    await json(server.url, `/v1/community/projects/${campaignId}`, { action: 'comment', text: '想报名一起测试。' }, tokenB)
    await json(server.url, `/v1/community/projects/${campaignId}`, { action: 'apply', kind: 'tester', message: '我可以连续两周记录使用体验。' }, tokenB)

    const relogin = await json(server.url, '/v1/community/login', { email: 'a@example.com', password: 'password1' })
    const freshA = String((relogin.data as { token: string }).token)
    const notes = await json(server.url, '/v1/community/notifications', undefined, freshA)
    const items = (notes.data as { items: Array<{ title: string }> }).items
    assert.ok(items.some(item => item.title.includes('评论') || item.title.includes('报名')))

    const detail = await json(server.url, `/v1/community/projects/${campaignId}`, undefined, freshA)
    const applications = (detail.data as { applications: Array<{ id: string }> }).applications
    await json(server.url, `/v1/community/applications/${applications[0]!.id}`, { action: 'accept', response: '欢迎加入测试。' }, freshA)
    await json(server.url, `/v1/community/projects/${campaignId}`, { action: 'update', title: '测试名单已确认', body: '第一批测试用户会在本周收到说明，不涉及付款。' }, freshA)

    const after = await json(server.url, `/v1/community/projects/${campaignId}`)
    assert.equal(((after.data as { project: { updates: Array<{ title: string }> } }).project.updates[0]?.title), '测试名单已确认')
  } finally {
    await server.close()
  }
})

test('plugin auth still requires the internal token while community user tokens are allowed', async () => {
  const { server } = await gateway()
  try {
    const denied = await fetch(`${server.url}/v1/catalog/products`, { headers: { 'x-dsh-plugin': '1' } })
    assert.equal(denied.status, 401)
    const allowed = await fetch(`${server.url}/v1/catalog/products`, { headers: { authorization: 'Bearer gateway-secret', 'x-dsh-plugin': '1' } })
    assert.equal(allowed.status, 200)
    const registered = await json(server.url, '/v1/community/register', { email: 'c@example.com', password: 'password1', name: '用户C' })
    const me = await json(server.url, '/v1/community/me', undefined, String((registered.data as { token: string }).token))
    assert.equal(me.status, 200)
  } finally {
    await server.close()
  }
})
