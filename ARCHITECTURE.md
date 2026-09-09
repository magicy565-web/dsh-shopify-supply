# Architecture

This repository is a Shopify supply platform with an embedded Agent Runtime. DeepSeek Harness is the first runtime provider. It is not the product, and it is not forked.

Product direction: operator-managed private catalog, China → US Shopify dropship, and agentive procurement comparable to Accio Work's sourcing workflow. Alibaba is explicitly out of scope.

## Runtime stack

```text
Next.js
  → Agent Gateway
    → AgentRuntime          (owned contract)
      → DeepSeekHarnessRuntime
        → @deepseek-ai/dsh-sdk-client
          → pinned SDK JSON-RPC subprocess + out-of-tree plugins
            → Cordis plugins (tools + policy)
```

The product owns `packages/agent-contracts` and `packages/agent-runtime`. DeepSeek types stop at `packages/agent-runtime-dsh`.

Pinned Harness train: see `DSH_PINNED_VERSION` in `packages/config`. Do not depend on `@deepseek-ai/*@latest`. The SDK client, protocol, JSON-RPC runtime/server, spine, and runtime-facing plugins are exact-version dependencies and are checked by `tests/dsh-integration`.

The pinned `0.1.0-rc.6` release predates the published `sdk` profile bundle. Its official TypeScript SDK therefore launches the published `dsh-jsonrpc-agent` entry with a complete config owned by `apps/dsh-runtime`. When a later Harness train is adopted, moving this composition to `dsh --profile sdk --patch ...` is confined to that app and `agent-runtime-dsh`; the product contract does not change.

## Non-goals / do not reinvent

Do not build any of the following. They already exist in DeepSeek Harness:

- Agent loop
- Tool calling engine
- Tool registry (`ctx.tools.register()`)
- Approval runtime (`tools/pre-execute` + `ctx.approval`)
- Session runtime
- Context engine
- Subagent orchestration
- Tool ACL framework (per-scope allow/deny)
- Retry / timeout / metrics pipeline (`tools/execute`)
- Agent Web UI framework (`dsh web` is not the product UI)
- Model gateway / LiteLLM
- Workflow DAG
- Agent memory framework

## What we do own

- Product UI (Next.js), speaking only `AgentEvent`
- `AgentRuntime` adapter
- Domain services (catalog / procurement / Shopify / fulfillment)
- Out-of-tree Cordis plugins that are thin tool adapters
- Business database adapters behind repository interfaces

## Phase 2 catalog and procurement

```text
Procurement UI
  → Agent Gateway
    → CatalogService / ProcurementService
      → CatalogRepository / ProcurementRepository
        → local JSON adapter (development)
        → PostgreSQL adapter (set DATABASE_URL)

DeepSeek Harness
  → dsh-plugin-catalog-tools (HTTP, allow)
  → dsh-plugin-procurement-tools (HTTP writes, ask)
    → Agent Gateway APIs
```

Products, variants, suppliers, and supplier offers are separate records. This prevents a sales-channel variant or one supplier quote from becoming the product master.

Procurement writes are atomic business actions (`createCase`, `saveCandidate`, `createQuoteRequest`, `approveQuoteRequest`), not whole-document snapshots. JSON and PostgreSQL implement the same interface so switching storage does not change domain code. PostgreSQL uses row-level transactions and optimistic status guards so concurrent quote drafts or approvals cannot overwrite each other.

`database/migrations/0001_procurement.sql` is the PostgreSQL schema. Local development persists to ignored `data/catalog.json` and `data/procurement.json` unless `DATABASE_URL` is set. `GET /health` reports `storage: json | postgres`.

Sourcing status: `draft → shortlisted → approved | closed`. An approved case is immutable. Quote drafts may only reference offers on candidate products for the named supplier. Harness write tools are on the `ASK_TOOL_NAMES` list.

## DSH extension surface (only these four)

1. Profile — `apps/dsh-runtime` patches stacked on `sdk`
2. Plugin — tool schema + executor + model-facing formatting
3. Policy — which tools are `allow` vs `ask`
4. Adapter — `packages/agent-runtime-dsh` JSON-RPC → `AgentEvent`

Plugins must not contain SQL, Prisma, catalog rules, or Shopify business state.

## SDK gaps we bridge, not reimplement

Official TypeScript SDK currently has no client→server approval RPC and no mid-turn cancel.

- Approval: `dsh-plugin-policy` is the terminal `approval/request` answerer and waits on a localhost bridge inside `DeepSeekHarnessRuntime`. Product `approve()` resolves that wait into Harness `allowed-once` / `rejected`. The bridge is keyed by approval/call id (not a single slot per session) and fail-closes on TTL. Plugin ↔ gateway/bridge calls carry `AGENT_INTERNAL_TOKEN`.
- Abort: close the runtime process for that session. The next `sendMessage` auto-resumes; `POST /v1/sessions/:id/resume` remains available. When Harness adds prompt-cancel, only `agent-runtime-dsh` changes.
- Close: `POST /v1/sessions/:id/close` tears down the session. Idle DSH subprocesses are recycled after `AGENT_SESSION_IDLE_TTL_MS` and revived on the next turn.
- Writes: gateway honors `Idempotency-Key` (plugins send the tool call id) so model retries do not create duplicate cases or orders.

## Upgrade gate

`pnpm test` runs the ten `AgentRuntime` contracts against the in-memory provider.
`pnpm test:dsh` always checks package pins, event mapping, and keyless subprocess startup. With `DEEPSEEK_API_KEY`, it additionally runs the same contracts against pinned DeepSeek Harness.

Upgrade sequence: bump the pin → `pnpm test:dsh` → merge only if green.
