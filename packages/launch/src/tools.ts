import type { CatalogService } from '@dsh-supply/catalog'
import type { MemoryToolHandler } from '@dsh-supply/agent-runtime'
import type { SearchPublicWeb } from './search.js'
import { searchPublicWeb } from './search.js'
import type { LaunchService } from './service.js'
import type { LaunchCampaign } from './types.js'
import { LaunchInputError } from './types.js'

function textArg(args: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function numberArg(args: Record<string, unknown>, key: string, fallback?: number): number {
  const value = args[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value)
  if (fallback !== undefined) return fallback
  throw new LaunchInputError(`${key} must be a number`)
}

export function launchToolHandlers(options: {
  catalog: CatalogService
  launch: LaunchService
  searchWeb?: SearchPublicWeb
}): Record<string, MemoryToolHandler> {
  const search = options.searchWeb ?? searchPublicWeb
  return {
    async search_catalog(args, ctx) {
      ctx.signal.throwIfAborted()
      return options.catalog.search({
        query: textArg(args, ['query', 'text']),
        category: textArg(args, ['category']) || undefined,
        maxUnitPrice: args.maxUnitPrice === undefined ? undefined : numberArg(args, 'maxUnitPrice'),
        maxMoq: args.maxMoq === undefined ? undefined : numberArg(args, 'maxMoq'),
        maxLeadTimeDays: args.maxLeadTimeDays === undefined ? undefined : numberArg(args, 'maxLeadTimeDays'),
        limit: args.limit === undefined ? 8 : numberArg(args, 'limit'),
      })
    },
    async get_product(args, ctx) {
      ctx.signal.throwIfAborted()
      return options.catalog.getProduct(textArg(args, ['id', 'text']))
    },
    async compare_offers(args, ctx) {
      ctx.signal.throwIfAborted()
      const productIds = Array.isArray(args.productIds)
        ? args.productIds.filter((item): item is string => typeof item === 'string')
        : []
      return options.catalog.compareOffers({
        productIds,
        quantity: numberArg(args, 'quantity'),
      })
    },
    async search_public_web(args, ctx) {
      return search(textArg(args, ['query', 'text']), ctx.signal)
    },
    async get_launch_run(args) {
      return options.launch.get(textArg(args, ['runId', 'id', 'text']))
    },
    async write_campaign_draft(args) {
      const runId = textArg(args, ['runId', 'id'])
      const campaign = args.campaign as LaunchCampaign | undefined
      if (!campaign || typeof campaign !== 'object') throw new LaunchInputError('campaign is required')
      return { campaign: (await options.launch.saveCampaign(runId, campaign)).campaign }
    },
    async record_launch_stage(args) {
      const runId = textArg(args, ['runId', 'id'])
      const stage = args.stage
      if (!stage || typeof stage !== 'object') throw new LaunchInputError('stage is required')
      return { run: await options.launch.recordStage(runId, stage as never) }
    },
  }
}
