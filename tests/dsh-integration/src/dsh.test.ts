import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { config as loadEnv } from 'dotenv'
import { DeepSeekHarnessRuntime } from '@dsh-supply/agent-runtime-dsh'
import { mapSessionEvent } from '@dsh-supply/agent-runtime-dsh'
import { DSH_PINNED_VERSION, ECHO_THROW_TOKEN, findWorkspaceRoot } from '@dsh-supply/config'
import { assertRuntimeContract } from '@dsh-supply/runtime-contract/suite'

loadEnv({ path: join(findWorkspaceRoot(), '.env') })

test('runtime-facing DSH packages use the pinned release', () => {
  const workspaceRoot = findWorkspaceRoot()
  const anchors = [
    createRequire(join(workspaceRoot, 'packages', 'agent-runtime-dsh', 'package.json')),
    createRequire(join(workspaceRoot, 'apps', 'dsh-runtime', 'package.json')),
  ]
  const packages = [
    '@deepseek-ai/dsh-sdk-client',
    '@deepseek-ai/dsh-sdk-protocol',
    '@deepseek-ai/dsh-sdk-jsonrpc-demo',
    '@deepseek-ai/dsh-sdk-jsonrpc-server',
    '@deepseek-ai/dsh-agent-spine-demo',
    '@deepseek-ai/dsh-llm-deepseek',
    '@deepseek-ai/dsh-session-persistence-jsonl',
    '@deepseek-ai/dsh-user-approval',
  ]

  for (const packageName of packages) {
    const packageJson = anchors
      .map((resolve) => {
        try {
          return resolve.resolve(`${packageName}/package.json`)
        } catch {
          return undefined
        }
      })
      .find((value) => value !== undefined)
    assert.ok(packageJson, `${packageName} must be installed from a runtime workspace`)
    const manifest = JSON.parse(readFileSync(packageJson, 'utf8')) as { version?: string }
    assert.equal(manifest.version, DSH_PINNED_VERSION, `${packageName} version drift`)
  }
})

test('DSH event mapping preserves tool identity and errors', () => {
  const toolNames = new Map<string, string>()
  const started = mapSessionEvent({
    type: 'tool/call',
    data: {
      callId: 'call-1',
      name: 'echo',
      arguments: '{"text":"ping"}',
    },
  }, 'mapping', toolNames)
  assert.deepEqual(started[0], {
    type: 'tool.started',
    sessionId: 'mapping',
    ts: started[0]?.ts,
    toolCallId: 'call-1',
    toolName: 'echo',
    arguments: { text: 'ping' },
  })

  const completed = mapSessionEvent({
    type: 'tool/result',
    data: {
      message: {
        content: [{
          type: 'tool-result',
          toolCallId: 'call-1',
          content: [{ type: 'text', text: 'failed' }],
          isError: true,
        }],
      },
      error: { name: 'Error', code: 'EXECUTE_FAILED' },
    },
  }, 'mapping', toolNames)
  assert.equal(completed[0]?.type, 'tool.completed')
  if (completed[0]?.type === 'tool.completed') {
    assert.equal(completed[0].toolName, 'echo')
    assert.equal(completed[0].toolCallId, 'call-1')
    assert.equal(completed[0].isError, true)
  }

  const failed = mapSessionEvent({
    type: 'assistant/chunk',
    data: {
      chunk: {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { code: 'AUTH', message: 'credential rejected' },
        },
      },
    },
  }, 'mapping')
  assert.equal(failed[0]?.type, 'agent.failed')
  if (failed[0]?.type === 'agent.failed') {
    assert.equal(failed[0].message, 'credential rejected')
  }
})

test('DeepSeek Harness runtime boots without a model credential', async () => {
  const runtime = new DeepSeekHarnessRuntime()
  try {
    await runtime.boot()
    const session = await runtime.createSession({ id: `boot-${randomUUID()}` })
    assert.ok(session.id)
    assert.equal((await runtime.getSession(session.id)).status, 'idle')
    await runtime.close(session.id)
  } finally {
    await runtime.shutdown()
  }
})

test('DeepSeek Harness satisfies the AgentRuntime contract', async (t) => {
  if (!process.env.DEEPSEEK_API_KEY) {
    t.skip('DEEPSEEK_API_KEY is required for model-backed DSH contract tests')
    return
  }
  const runtime = new DeepSeekHarnessRuntime()
  try {
    await assertRuntimeContract(runtime, {
      message: 'Reply with the single word hi.',
      echo: 'Call the echo tool exactly once with text "ping".',
      echoError: `Call the echo tool exactly once with text "${ECHO_THROW_TOKEN}".`,
      dangerous: 'Call the dangerous_test_action tool exactly once.',
    })
  } finally {
    await runtime.shutdown()
  }
})
