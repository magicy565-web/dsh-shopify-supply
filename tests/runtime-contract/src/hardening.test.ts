import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AgentError } from '@dsh-supply/agent-contracts'
import type { AgentEvent } from '@dsh-supply/agent-contracts'
import { InMemoryAgentRuntime } from '@dsh-supply/agent-runtime'

async function collect(
  runtime: InMemoryAgentRuntime,
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

async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timed out')
}

test('send after abort resumes without an explicit resume call', async () => {
  const runtime = new InMemoryAgentRuntime()
  const session = await runtime.createSession()
  await collect(runtime, session.id, 'CALL dangerous_test_action', async (event) => {
    if (event.type === 'approval.requested') await runtime.abort(session.id)
  })
  assert.equal((await runtime.getSession(session.id)).status, 'aborted')

  const resumed = await collect(runtime, session.id, 'hello')
  assert.ok(resumed.some((event) => event.type === 'message.delta'))
  assert.equal(resumed.at(-1)?.type, 'agent.completed')
  assert.equal((await runtime.getSession(session.id)).status, 'idle')
})

test('overlapping turns fail closed with session.busy', async () => {
  const runtime = new InMemoryAgentRuntime()
  const session = await runtime.createSession()
  const first = collect(runtime, session.id, 'CALL dangerous_test_action')
  await waitFor(async () => (await runtime.getSession(session.id)).status === 'waiting_approval')

  const second = await collect(runtime, session.id, 'hello')
  const failed = second.find((event) => event.type === 'agent.failed')
  assert.ok(failed && failed.type === 'agent.failed')
  assert.equal(failed.code, 'session.busy')

  const pending = (await runtime.getSession(session.id)).pendingApprovalIds ?? []
  assert.equal(pending.length, 1)
  await runtime.approve(session.id, pending[0]!, 'deny')
  await first
})

test('approval ttl fail-closes the tool', async () => {
  const runtime = new InMemoryAgentRuntime({ approvalTtlMs: 30 })
  const session = await runtime.createSession()
  const events = await collect(runtime, session.id, 'CALL dangerous_test_action')
  const resolved = events.find((event) => event.type === 'approval.resolved')
  assert.ok(resolved && resolved.type === 'approval.resolved')
  assert.equal(resolved.outcome, 'cancelled')
  const completed = events.find((event) => event.type === 'tool.completed')
  assert.ok(completed && completed.type === 'tool.completed' && completed.isError)
})

test('unknown session throws a structured error', async () => {
  const runtime = new InMemoryAgentRuntime()
  await assert.rejects(
    () => runtime.getSession('missing'),
    (error: unknown) => error instanceof AgentError && error.code === 'session.unknown',
  )
})

test('closed sessions reject later turns', async () => {
  const runtime = new InMemoryAgentRuntime()
  const session = await runtime.createSession()
  await runtime.close(session.id)
  const events = await collect(runtime, session.id, 'hello')
  const failed = events.find((event) => event.type === 'agent.failed')
  assert.ok(failed && failed.type === 'agent.failed')
  assert.equal(failed.code, 'session.closed')
})
