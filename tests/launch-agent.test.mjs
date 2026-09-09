import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LaunchService, JsonLaunchRepository, runLaunchPlaybook } from '../packages/launch/dist/index.js'
import { handleLaunchRequest } from '../apps/agent-gateway/dist/launch-http.js'

async function service() { return new LaunchService(new JsonLaunchRepository(join(await mkdtemp(join(tmpdir(),'launch-test-')),'runs.json'))) }
test('parallel runs and edits survive repository reload without lost updates', async () => {
  const s = await service()
  const runs = await Promise.all(Array.from({length:20},(_,i) => s.create(`产品目标 ${i}`,`s-${i}`)))
  assert.equal((await s.list()).length,20)
  await Promise.all(runs.map(r => s.mutate(r.id,item => {item.activity='saved'})))
  assert.ok((await s.list()).every(r => r.activity === 'saved'))
})
test('invalid tool payload cannot destroy draft; subsequent valid writes recover', async () => {
  const s = await service(), r = await s.create('可维修台灯','session')
  await assert.rejects(s.saveCampaign(r.id,{}), /schema/)
  assert.equal((await s.get(r.id)).campaign.draft.name,'')
  await assert.rejects(s.recordStage(r.id,{id:'unknown'}), /Invalid/)
  const next = structuredClone(r.campaign); next.draft.name='真实草稿'
  await s.saveCampaign(r.id,next)
  assert.equal((await s.get(r.id)).campaign.draft.name,'真实草稿')
})
test('model event path records real output and failure without filling template results', async () => {
  const s = await service(), r = await s.create('可维修台灯','session')
  const runtime = {async *sendMessage() {yield {type:'message.delta',text:'缺少需求信息',sessionId:'session',ts:new Date().toISOString()}; yield {type:'agent.failed',message:'provider unavailable',sessionId:'session',ts:new Date().toISOString()}}}
  for await (const _ of runLaunchPlaybook({runtime,launch:s,runId:r.id,modelConnected:true})) {}
  const saved = await s.get(r.id)
  assert.equal(saved.status,'failed'); assert.equal(saved.campaign.draft.story,''); assert.equal(saved.events.length,2)
})
test('formal route rejects anonymous users and never falls back to in-memory', async () => {
  const launch = await service()
  const helpers = {json(_res,status,body){this.result={status,body}}, readJson:async()=>({goal:'可维修台灯'}),writeSse(){},origin:'http://localhost'}
  let result
  helpers.json = (_res,status,body) => {result={status,body}}
  const options = {launch,runtime:{createSession(){throw new Error('must not run')}},runtimeKind:'in-memory'}
  await handleLaunchRequest({headers:{}},{},'POST','/v1/launch/runs',options,helpers)
  assert.equal(result.status,401)
  await handleLaunchRequest({headers:{}},{},'POST','/v1/launch/runs',{...options,userId:'owner'},helpers)
  assert.equal(result.status,503)
  const run = await launch.create('可维修台灯','session'); await launch.mutate(run.id,r=>{r.ownerId='owner'})
  await handleLaunchRequest({headers:{}},{},'GET',`/v1/launch/runs/${run.id}`,{...options,userId:'other'},helpers)
  assert.equal(result.status,404)
})
