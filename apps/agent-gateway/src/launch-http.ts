import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AgentEvent } from '@dsh-supply/agent-contracts'
import type { AgentRuntime } from '@dsh-supply/agent-runtime'
import {
  isDshRuntime,
  LaunchInputError,
  LaunchNotFoundError,
  runLaunchPlaybook,
  type LaunchCampaign,
  type LaunchService,
  type SearchPublicWeb,
  type LaunchStage,
} from '@dsh-supply/launch'

type Helpers = {
  json: (res: ServerResponse, status: number, body: unknown) => void
  readJson: (req: IncomingMessage) => Promise<Record<string, unknown>>
  writeSse: (res: ServerResponse, event: AgentEvent) => void
  origin: string
}
const activeRuns = new Set<string>()

export async function handleLaunchRequest(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  options: {
    runtime: AgentRuntime
    launch: LaunchService
    runtimeKind?: string
    searchWeb?: SearchPublicWeb
    userId?: string
  },
  helpers: Helpers,
): Promise<boolean> {
  const { json, readJson, writeSse, origin } = helpers
  if (path.startsWith('/v1/launch/tools/') && method === 'POST') {
    if (req.headers['x-dsh-plugin'] !== '1') { json(res, 403, { error: 'Internal runtime tools only' }); return true }
    const body = await readJson(req), tool = path.split('/').pop()
    const id = typeof body.runId === 'string' ? body.runId : ''
    if (tool === 'search_public_web') json(res, 200, await options.searchWeb!(String(body.query ?? '')))
    else if (tool === 'get_launch_run') json(res, 200, { run: await options.launch.get(id) })
    else if (tool === 'write_campaign_draft') json(res, 200, { run: await options.launch.saveCampaign(id, body.campaign as LaunchCampaign) })
    else if (tool === 'record_launch_stage') json(res, 200, { run: await options.launch.recordStage(id, body.stage as LaunchStage) })
    else throw new LaunchNotFoundError('Unknown tool')
    return true
  }

  if (!path.startsWith('/v1/launch/')) return false
  if (!options.userId) { json(res, 401, { error: '请先登录，再使用产品 Agent' }); return true }

  if (method === 'GET' && path === '/v1/launch/runs') {
    for (const r of (await options.launch.list()).filter(r => r.ownerId === options.userId && ['running','waiting_approval'].includes(r.status) && !activeRuns.has(r.id))) {
      await options.launch.mutate(r.id, item => { item.status = 'failed'; item.error = '执行进程已结束，已保存成果保留，可继续任务'; item.activity = '等待恢复' })
    }
    json(res, 200, { items: (await options.launch.list()).filter(r => r.ownerId === options.userId) })
    return true
  }

  if (method === 'POST' && path === '/v1/launch/search-web') {
    const body = await readJson(req)
    const query = typeof body.query === 'string' ? body.query : ''
    const search = options.searchWeb
    if (!search) {
      json(res, 200, { query, hits: [], error: 'public web search is not configured' })
      return true
    }
    json(res, 200, await search(query))
    return true
  }

  if (method === 'POST' && path === '/v1/launch/runs') {
    if (!isDshRuntime(options.runtimeKind) || !process.env.DEEPSEEK_API_KEY) { json(res, 503, { error: '真实 Agent 尚未配置：需要 AGENT_RUNTIME=dsh 和 DEEPSEEK_API_KEY。不会使用模拟运行时替代。' }); return true }
    const body = await readJson(req)
    const goal = typeof body.goal === 'string' ? body.goal : ''
    const session = await options.runtime.createSession()
    const created = await options.launch.create(goal, session.id)
    const run = await options.launch.mutate(created.id, r => { r.ownerId = options.userId })
    json(res, 201, { run })
    return true
  }

  const match = /^\/v1\/launch\/runs\/([^/]+)(?:\/([^/]+))?$/.exec(path)
  if (!match) return false
  const id = decodeURIComponent(match[1] ?? '')
  const action = match[2]
  if ((await options.launch.get(id)).ownerId !== options.userId) { json(res, 404, { error: '任务不存在' }); return true }

  if (method === 'GET' && !action) {
    json(res, 200, { run: await options.launch.get(id) })
    return true
  }

  if (method === 'POST' && action === 'start') {
    if (!isDshRuntime(options.runtimeKind)) { json(res, 503, { error: 'Real Agent runtime is required' }); return true }
    const run = await options.launch.get(id)
    if (activeRuns.has(id)) { json(res, 409, { error: '任务正在执行，请勿重复开始' }); return true }
    activeRuns.add(id)
    try {
    const input = await readJson(req)
    if (typeof input.text === 'string' && input.text.trim()) await options.launch.mutate(id, item => { item.goal += `\n用户补充：${input.text!.toString().slice(0, 4000)}` })
    try {
      const state = await options.runtime.getSession(run.sessionId)
      if (state.status === 'aborted') await options.runtime.resume(run.sessionId)
    } catch {
      const session = await options.runtime.createSession({ id: run.sessionId })
      await options.launch.bindSession(id, session.id)
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': origin,
    })
    try {
      for await (const event of runLaunchPlaybook({
        runtime: options.runtime,
        launch: options.launch,
        runId: id,
        searchWeb: options.searchWeb,
        modelConnected: isDshRuntime(options.runtimeKind),
      })) {
        if (event.type === 'approval.requested') {
          await options.launch.mutate(id, (item) => {
            if (item.status !== 'aborted') { item.status = 'waiting_approval'; item.activity = '等待你确认关键操作' }
          })
        }
        if (event.type === 'approval.resolved' && event.decision === 'allow') {
          await options.launch.mutate(id, (item) => {
            if (item.status === 'waiting_approval') {
              item.status = 'running'
              item.activity = '正在继续'
            }
          })
        }
        writeSse(res, event)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await options.launch.mutate(id, (item) => {
        if (item.status !== 'aborted') {
          item.status = 'failed'
          item.error = message
          item.activity = '执行失败'
        }
      })
      writeSse(res, {
        type: 'agent.failed',
        sessionId: run.sessionId,
        ts: new Date().toISOString(),
        message,
      })
    }
    res.end()
    } finally { activeRuns.delete(id) }
    return true
  }

  if (method === 'POST' && action === 'abort') {
    const run = await options.launch.get(id)
    try { await options.runtime.abort(run.sessionId) } catch { /* Session may already be gone. */ }
    json(res, 200, { run: await options.launch.mutate(id, (item) => {
      item.status = 'aborted'
      item.activity = '已中断'
    }) })
    return true
  }

  if (method === 'POST' && action === 'resume') {
    const run = await options.launch.get(id)
    try { await options.runtime.resume(run.sessionId) } catch { /* Resume is best-effort. */ }
    json(res, 200, { run: await options.launch.mutate(id, (item) => {
      if (item.status === 'aborted' || item.status === 'failed') {
        item.status = 'idle'
        item.activity = '已恢复，可以继续'
        item.error = ''
      }
    }) })
    return true
  }

  if (method === 'POST' && action === 'retry') {
    const run = await options.launch.get(id)
    try { await options.runtime.resume(run.sessionId) } catch { /* ignore */ }
    json(res, 200, { run: await options.launch.mutate(id, (item) => {
      item.status = 'idle'
      item.error = ''
      item.activity = '准备重试失败步骤'
      if (item.resumeStep > 4) item.resumeStep = 3
    }) })
    return true
  }

  if (method === 'POST' && (action === 'draft' || !action)) {
    const body = await readJson(req)
    if (action === 'draft' || body.campaign || body.draft) {
      const current = await options.launch.get(id)
      const next = {
        ...current.campaign,
        ...(body.campaign && typeof body.campaign === 'object' ? body.campaign as LaunchCampaign : {}),
        draft: body.draft && typeof body.draft === 'object' ? { ...current.campaign.draft, ...body.draft as object } : current.campaign.draft,
        content: body.content && typeof body.content === 'object' ? { ...current.campaign.content, ...body.content as object } : current.campaign.content,
        step: Number.isInteger(body.step) ? Number(body.step) : current.campaign.step,
        id: current.id,
      }
      json(res, 200, { run: await options.launch.saveCampaign(id, next as LaunchCampaign) })
      return true
    }
    if (body.flow === 'simulated') {
      json(res, 200, { run: await options.launch.mutate(id, (item) => {
        item.flow = 'simulated'
        item.activity = '已离开 Agent 正式流程，进入演示审核'
      }) })
      return true
    }
  }

  throw new LaunchNotFoundError('未知的发布任务操作')
}

export function launchErrorStatus(error: unknown): number | undefined {
  if (error instanceof LaunchInputError) return 400
  if (error instanceof LaunchNotFoundError) return 404
  return undefined
}
