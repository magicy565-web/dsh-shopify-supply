import { test } from 'node:test'
import { InMemoryAgentRuntime } from '@dsh-supply/agent-runtime'
import { assertRuntimeContract } from './suite.js'

test('in-memory AgentRuntime contract', async () => {
  await assertRuntimeContract(new InMemoryAgentRuntime())
})
