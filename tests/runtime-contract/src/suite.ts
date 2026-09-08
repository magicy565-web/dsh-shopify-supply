import assert from 'node:assert/strict'
import type { AgentEvent } from '@dsh-supply/agent-contracts'
import type { AgentRuntime } from '@dsh-supply/agent-runtime'
import { ECHO_THROW_TOKEN } from '@dsh-supply/config'

export type RuntimeContractPrompts = {
  message: string
  echo: string
  echoError: string
  dangerous: string
}

const deterministicPrompts: RuntimeContractPrompts = {
  message: 'hello',
  echo: 'CALL echo ping',
  echoError: `CALL echo ${ECHO_THROW_TOKEN}`,
  dangerous: 'CALL dangerous_test_action',
}

async function collect(
  runtime: AgentRuntime,
  sessionId: string,
  text: string,
  onEvent?: (event: AgentEvent) => Promise<void> | void,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of runtime.sendMessage(sessionId, { role: 'user', text })) {
    events.push(event)
    await onEvent?.(event)
  }
  return events
}

export async function assertRuntimeContract(
  runtime: AgentRuntime,
  prompts: RuntimeContractPrompts = deterministicPrompts,
): Promise<void> {
  const session = await runtime.createSession()
  assert.ok(session.id, '01 runtime boots / session creates')

  const created = await runtime.getSession(session.id)
  assert.equal(created.status, 'idle')
  assert.ok(created.tools.includes('echo'), '04 echo tool visible')

  const streamed = await collect(runtime, session.id, prompts.message)
  assert.ok(streamed.some((event) => event.type === 'message.delta'), '03 message streams')
  assert.equal(streamed.at(-1)?.type, 'agent.completed')

  const echoed = await collect(runtime, session.id, prompts.echo)
  assert.ok(echoed.some((event) => event.type === 'tool.started' && event.toolName === 'echo'), '05 tool executes')
  const echoDone = echoed.find((event) => event.type === 'tool.completed' && event.toolName === 'echo')
  assert.ok(echoDone && echoDone.type === 'tool.completed' && echoDone.isError === false)

  const failed = await collect(runtime, session.id, prompts.echoError)
  const errorResult = failed.find((event) => event.type === 'tool.completed')
  assert.ok(errorResult && errorResult.type === 'tool.completed' && errorResult.isError, '06 tool error returned')

  const approved = await collect(
    runtime,
    session.id,
    prompts.dangerous,
    async (event) => {
      if (event.type === 'approval.requested') {
        await runtime.approve(session.id, event.approvalId, 'allow')
      }
    },
  )
  assert.ok(approved.some((event) => event.type === 'approval.requested'), '07 publish triggers approval')
  const allowed = approved.find((event) => event.type === 'tool.completed' && event.toolName === 'dangerous_test_action')
  assert.ok(allowed && allowed.type === 'tool.completed' && allowed.isError === false, '09 approve executes once')
  assert.equal(approved.filter((event) => event.type === 'tool.completed' && event.toolName === 'dangerous_test_action' && !event.isError).length, 1)

  const denied = await collect(
    runtime,
    session.id,
    prompts.dangerous,
    async (event) => {
      if (event.type === 'approval.requested') {
        await runtime.approve(session.id, event.approvalId, 'deny')
      }
    },
  )
  const deniedResult = denied.find((event) => event.type === 'tool.completed' && event.toolName === 'dangerous_test_action')
  assert.ok(deniedResult && deniedResult.type === 'tool.completed' && deniedResult.isError, '08 deny prevents execution')

  const abortSession = await runtime.createSession()
  const aborting = collect(
    runtime,
    abortSession.id,
    prompts.dangerous,
    async (event) => {
      if (event.type === 'approval.requested') {
        await runtime.abort(abortSession.id)
      }
    },
  )
  await aborting
  const aborted = await runtime.getSession(abortSession.id)
  assert.equal(aborted.status, 'aborted', '10 session abort')

  await runtime.resume(abortSession.id)
  const resumed = await runtime.getSession(abortSession.id)
  assert.equal(resumed.status, 'idle')

  await runtime.close(abortSession.id)
  const closed = await runtime.getSession(abortSession.id)
  assert.equal(closed.status, 'closed')
}
