import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  CommunityForbiddenError,
  CommunityService,
  JsonCommunityRepository,
  SAMPLE_IMAGES,
} from '@dsh-supply/community'

async function service() {
  const dir = await mkdtemp(join(tmpdir(), 'community-'))
  return new CommunityService(
    new JsonCommunityRepository(join(dir, 'community.json')),
    join(dir, 'uploads'),
    { email: 'admin@supply.local', password: 'supply-admin-change-me', name: '平台管理员' },
  )
}

function completeDraft(creator = '创作者 A') {
  return {
    name: '可替换电池台灯',
    tagline: '坏了零件，不必丢掉整盏灯。',
    category: '可持续设计',
    stage: '原型开发',
    creator,
    city: '杭州',
    image: SAMPLE_IMAGES[0],
    story: '我们想重新思考一盏灯的寿命。当电池老化时，为什么必须丢掉整个产品？这是已经写够四十个字的产品故事，用于提交审核。',
    highlights: '模块化结构\n可独立更换电池',
    needs: ['用户反馈', '测试用户'],
    goal: '200',
  }
}

function completeContent() {
  return {
    gallery: [SAMPLE_IMAGES[0]],
    video: '',
    audience: '在意维修和长期使用的人',
    milestones: '9 月完成访谈；10 月制作第一版原型。',
    participation: '欢迎试用反馈，也欢迎结构与供应链合作。当前不涉及付款。',
    team: '两名工业设计师与一名硬件工程师。',
    risks: '材料成本和可维修结构仍需打样验证。',
  }
}

test('account B cannot edit account A campaign', async () => {
  const community = await service()
  const a = await community.register({ email: 'a@example.com', password: 'password1', name: '创作者A' })
  const b = await community.register({ email: 'b@example.com', password: 'password1', name: '参与者B' })
  const campaign = await community.createCampaign(a.token, { draft: { name: 'A 的草稿' } })
  await assert.rejects(() => community.saveCampaign(b.token, campaign.id, { draft: { name: '被篡改' } }), CommunityForbiddenError)
  const mine = await community.listMine(a.token)
  assert.equal(mine[0]?.draft.name, 'A 的草稿')
  assert.equal((await community.listMine(b.token)).length, 0)
})

test('acceptance loop: A submits, admin reviews, B participates, A is notified and publishes an update', async () => {
  const community = await service()
  const admin = await community.login({ email: 'admin@supply.local', password: 'supply-admin-change-me' })
  const a = await community.register({ email: 'creator.a@example.com', password: 'password1', name: '创作者A' })
  const b = await community.register({ email: 'member.b@example.com', password: 'password1', name: '参与者B' })

  const created = await community.createCampaign(a.token, { draft: completeDraft(), content: completeContent(), step: 6 })
  const submitted = await community.submit(a.token, created.id)
  assert.equal(submitted.status, 'review')

  const queue = await community.listReviewQueue(admin.token)
  assert.equal(queue.length, 1)
  await community.review(admin.token, created.id, 'approve', '内容完整，可以发布。')
  const published = await community.publish(a.token, created.id)
  assert.equal(published.status, 'published')
  assert.equal(published.published?.name, '可替换电池台灯')

  const listed = await community.listPublished()
  assert.equal(listed.some(item => item.id === created.id), true)

  await community.toggle(b.token, created.id, 'saved')
  await community.toggle(b.token, created.id, 'following')
  await community.addComment(b.token, created.id, '很喜欢可维修的方向。')
  const application = await community.apply(b.token, created.id, 'collab', '我们可以一起做结构打样评估。')

  const inbox = await community.listNotifications(a.token)
  assert.ok(inbox.some(item => item.title.includes('评论')))
  assert.ok(inbox.some(item => item.title.includes('合作')))

  await community.respondApplication(a.token, application.id, 'accept', '欢迎一起打样。')
  const updated = await community.addUpdate(a.token, created.id, '开始修订前的进展', '我们收到了第一份合作申请，下周同步结构草图。')
  assert.equal(updated.updates[0]?.title, '开始修订前的进展')

  await community.revise(a.token, created.id)
  await community.saveCampaign(a.token, created.id, { draft: { name: '修订中的新名称' } })
  const stillPublic = await community.getPublished(created.id)
  assert.equal(stillPublic.project.name, '可替换电池台灯')
  assert.equal(stillPublic.project.updates[0]?.title, '开始修订前的进展')

  const bInbox = await community.listNotifications(b.token)
  assert.ok(bInbox.some(item => item.title.includes('申请已通过')))
  assert.ok(bInbox.some(item => item.title.includes('新进展')))
})

test('local draft migration keeps filled fields and reports results', async () => {
  const community = await service()
  const a = await community.register({ email: 'migrate@example.com', password: 'password1', name: '迁移用户' })
  const result = await community.migrate(a.token, {
    campaigns: [{
      id: 'local-old-1',
      status: 'draft',
      step: 2,
      draft: { ...completeDraft('本地创作者'), name: '第一期台灯草稿' },
      content: completeContent(),
    }],
    studioDraft: { name: '工作室速记', story: '这是第一期工作室里写下的构想，需要保留。'.repeat(2), category: '产品设计', stage: '概念探索', tagline: '', creator: '', city: '', image: '', highlights: '', needs: ['用户反馈'], goal: '100' },
  })
  assert.equal(result.imported, 2)
  const again = await community.migrate(a.token, {
    campaigns: [{ id: 'local-old-1', status: 'draft', draft: completeDraft(), content: completeContent() }],
  })
  assert.equal(again.skipped, 1)
  const mine = await community.listMine(a.token)
  assert.ok(mine.some(item => item.draft.name === '第一期台灯草稿'))
  assert.ok(mine.some(item => item.draft.name === '工作室速记'))
})
