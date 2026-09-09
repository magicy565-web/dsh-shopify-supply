import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  CommunityService,
  type ApplicationKind,
  type CampaignSaveInput,
} from '@dsh-supply/community'

type Helpers = {
  json: (res: ServerResponse, status: number, body: unknown) => void
  readJson: (req: IncomingMessage) => Promise<Record<string, unknown>>
  bearer: (req: IncomingMessage) => string | undefined
  sendMedia: (res: ServerResponse, mime: string, bytes: Buffer) => void
}

function stringField(body: Record<string, unknown>, name: string, fallback = ''): string {
  return typeof body[name] === 'string' ? body[name] : fallback
}

export async function handleCommunityRequest(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  community: CommunityService,
  helpers: Helpers,
): Promise<boolean> {
  const { json, readJson, bearer, sendMedia } = helpers
  const token = bearer(req)

  const mediaMatch = /^\/(?:v1\/community\/media|media)\/([^/]+)$/.exec(path)
  if (method === 'GET' && mediaMatch) {
    const file = await community.getMedia(decodeURIComponent(mediaMatch[1] ?? ''))
    if (!file) {
      json(res, 404, { error: '图片不存在' })
      return true
    }
    sendMedia(res, file.mime, file.bytes)
    return true
  }

  if (method === 'POST' && path === '/v1/community/register') {
    json(res, 201, await community.register(await readJson(req)))
    return true
  }
  if (method === 'POST' && path === '/v1/community/login') {
    json(res, 200, await community.login(await readJson(req)))
    return true
  }
  if (method === 'POST' && path === '/v1/community/logout') {
    json(res, 200, await community.logout(token))
    return true
  }
  if (method === 'GET' && path === '/v1/community/me') {
    json(res, 200, { user: await community.me(token) })
    return true
  }
  if (method === 'POST' && path === '/v1/community/media') {
    const body = await readJson(req)
    json(res, 201, await community.uploadMedia(token, body.image))
    return true
  }
  if (method === 'GET' && path === '/v1/community/projects') {
    json(res, 200, { items: await community.listPublished(), viewer: await community.viewerState(token) })
    return true
  }
  const publishedMatch = /^\/v1\/community\/projects\/([^/]+)$/.exec(path)
  if (method === 'GET' && publishedMatch) {
    json(res, 200, await community.getPublished(decodeURIComponent(publishedMatch[1] ?? ''), token))
    return true
  }
  if (method === 'POST' && publishedMatch) {
    const id = decodeURIComponent(publishedMatch[1] ?? '')
    const body = await readJson(req)
    if (body.action === 'save' || body.action === 'follow') {
      json(res, 200, await community.toggle(token, id, body.action === 'save' ? 'saved' : 'following'))
      return true
    }
    if (body.action === 'comment') {
      json(res, 201, { comment: await community.addComment(token, id, body.text, body.parentId) })
      return true
    }
    if (body.action === 'apply') {
      json(res, 201, { application: await community.apply(token, id, body.kind as ApplicationKind, body.message) })
      return true
    }
    if (body.action === 'update') {
      json(res, 201, { project: await community.addUpdate(token, id, body.title, body.body) })
      return true
    }
    json(res, 400, { error: '未知的项目操作' })
    return true
  }
  if (method === 'GET' && path === '/v1/community/campaigns') {
    json(res, 200, { items: await community.listMine(token) })
    return true
  }
  if (method === 'POST' && path === '/v1/community/campaigns') {
    json(res, 201, { campaign: await community.createCampaign(token, await readJson(req) as CampaignSaveInput) })
    return true
  }
  const campaignMatch = /^\/v1\/community\/campaigns\/([^/]+)$/.exec(path)
  if (method === 'GET' && campaignMatch) {
    json(res, 200, { campaign: await community.getCampaign(token, decodeURIComponent(campaignMatch[1] ?? '')) })
    return true
  }
  if (method === 'POST' && campaignMatch) {
    const id = decodeURIComponent(campaignMatch[1] ?? '')
    const body = await readJson(req)
    const action = stringField(body, 'action', 'save')
    if (action === 'submit') { json(res, 200, { campaign: await community.submit(token, id) }); return true }
    if (action === 'withdraw') { json(res, 200, { campaign: await community.withdraw(token, id) }); return true }
    if (action === 'publish') { json(res, 200, { campaign: await community.publish(token, id) }); return true }
    if (action === 'revise') { json(res, 200, { campaign: await community.revise(token, id) }); return true }
    if (action === 'archive') { json(res, 200, { campaign: await community.archive(token, id) }); return true }
    if (action === 'restore') { json(res, 200, { campaign: await community.restore(token, id) }); return true }
    json(res, 200, { campaign: await community.saveCampaign(token, id, body as CampaignSaveInput) })
    return true
  }
  if (method === 'GET' && path === '/v1/community/review') {
    json(res, 200, { items: await community.listReviewQueue(token) })
    return true
  }
  const reviewMatch = /^\/v1\/community\/review\/([^/]+)$/.exec(path)
  if (method === 'POST' && reviewMatch) {
    const body = await readJson(req)
    const action = stringField(body, 'action')
    if (action !== 'approve' && action !== 'return') {
      json(res, 400, { error: '请选择通过或退回' })
      return true
    }
    json(res, 200, { campaign: await community.review(token, decodeURIComponent(reviewMatch[1] ?? ''), action, stringField(body, 'note')) })
    return true
  }
  const applicationMatch = /^\/v1\/community\/applications\/([^/]+)$/.exec(path)
  if (method === 'POST' && applicationMatch) {
    const body = await readJson(req)
    const action = stringField(body, 'action')
    if (action !== 'accept' && action !== 'decline') {
      json(res, 400, { error: '请选择接受或婉拒' })
      return true
    }
    json(res, 200, { application: await community.respondApplication(token, decodeURIComponent(applicationMatch[1] ?? ''), action, body.response) })
    return true
  }
  if (method === 'GET' && path === '/v1/community/notifications') {
    json(res, 200, { items: await community.listNotifications(token) })
    return true
  }
  if (method === 'POST' && path === '/v1/community/notifications') {
    const body = await readJson(req)
    json(res, 200, await community.markNotification(token, stringField(body, 'id'), body.action === 'read-all'))
    return true
  }
  if (method === 'POST' && path === '/v1/community/migrate') {
    json(res, 200, await community.migrate(token, await readJson(req)))
    return true
  }
  return false
}
