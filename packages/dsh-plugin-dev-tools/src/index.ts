import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ECHO_THROW_TOKEN } from '@dsh-supply/config'

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'sample.json')

export const name = 'dsh-supply-dev-tools'
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'echo',
    description: 'Echo text back. Development tool for runtime contract tests.',
    parameters: {
      text: { type: 'string', required: true, description: 'Text to echo' },
    },
    output: {
      schema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        additionalProperties: false,
      },
      render: (_args: unknown, value: { text: string }) => [
        { type: 'text', text: value.text },
      ],
    },
    async execute(args: { text: string }) {
      if (args.text === ECHO_THROW_TOKEN) {
        throw new Error('echo forced failure')
      }
      return { text: args.text }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'read_test_data',
    description: 'Read the packaged runtime fixture record.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: { sku: string; title: string; moq: number }) => [
        { type: 'text' as const, text: JSON.stringify(value) },
      ],
    },
    async execute() {
      return JSON.parse(readFileSync(fixturePath, 'utf8')) as {
        sku: string
        title: string
        moq: number
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dangerous_test_action',
    description: 'A privileged development action. Policy must ask before it runs.',
    parameters: {
      note: { type: 'string', description: 'Optional operator note' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          action: { type: 'string' },
        },
        additionalProperties: false,
      },
      render: (_args: unknown, value: { ok: boolean; action: string }) => [
        { type: 'text', text: JSON.stringify(value) },
      ],
    },
    async execute() {
      return { ok: true, action: 'dangerous_test_action' }
    },
  }))
}
