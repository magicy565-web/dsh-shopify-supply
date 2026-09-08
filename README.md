# DSH Shopify Supply

Agentive Shopify supply platform built around an operator-managed private catalog. DeepSeek Harness is a pinned, replaceable subprocess runtime. Alibaba is not a data source or integration.

## Run

```sh
pnpm install
pnpm build
cp .env.example .env
pnpm catalog:seed
pnpm dev
```

- UI: http://127.0.0.1:3000
- Gateway: http://127.0.0.1:8787

## Inspiration platform

The homepage is a Kickstarter-inspired product idea discovery and publishing UI. It includes curated concepts, category/search/stage filters, project stories and progress, creator pages, saved ideas, interest tracking, feedback, and a three-step publication flow. Published local projects can be edited, backed up, and deleted. The existing supply workspace remains at `/workspace`.

The current UI also incorporates the most useful interaction patterns from the reference project `magicy565-web/lovart`: a recent-activity feed and a project-lineage view for following ideas from concept through collaboration and release. The reference checkout is kept under `.reference/` for comparison only and is excluded from the application build.

The gateway now exposes the same platform flow through `/v1/inspiration/projects`: list and read projects, create or update a project, record saves/follows, add feedback, publish progress updates, and remove a local project. JSON mode stores this data in `data/inspiration.json`; set `INSPIRATION_DATA_FILE` to use another file. The Web UI syncs with this API when the gateway is available and falls back to browser storage for offline previews.

This is a frontend preview: publication, drafts, interest, and feedback use the current browser's local storage. There is no public publication service, shared community, account authentication, crowdfunding, or payment integration. Sample projects and counts are illustrative; generated cover images are concepts rather than manufactured-product evidence. Image generation prompts are documented in `apps/web/public/inspiration/README.md`.

## Web workspace

The `/workspace` route opens a conversation-first Supply Agent workspace: a persistent sidebar, product discovery cards, saved products, an on-demand offer/quote panel, orders, and connection settings. Light and dark themes and saved product IDs are stored in this browser. The layout supports mobile navigation, keyboard focus containment in mobile overlays, and reduced motion.

- Catalog search and offer details use the existing catalog API. In-memory runtime mode uses keyword matching; it does not claim to run model reasoning. With `AGENT_RUNTIME=dsh`, conversation text and approval requests additionally stream from the existing runtime API.
- Quote preparation uses the existing sourcing APIs to save an inquiry draft. It is not a supplier-confirmed quote and is not sent to a supplier. Destination shipping and taxes remain unconfirmed.
- Settings → 演示预览 enables isolated UI examples, including a local-only quote preview. These examples are not imported into the catalog and cannot trigger sourcing writes.
- Orders read the existing commerce API. Shopify authorization, formal supply relationships, and product publishing are explicitly marked as pending UI integration.
- Product illustrations are generic SVG placeholders when catalog photos are absent. They are not evidence of actual product appearance.

Frontend source is in `apps/web/components`, with API and demo adapters in `apps/web/lib`. `pnpm --filter @dsh-supply/web typecheck` and `pnpm --filter @dsh-supply/web build` check the frontend independently.

Default `AGENT_RUNTIME=in-memory` exercises the product contract without a model key.

The procurement workspace loads the private catalog independently of the Agent provider. The sample seed contains three products and four supplier offers. Storage is local JSON by default; set `DATABASE_URL` to switch catalog, sourcing, and commerce writes to PostgreSQL without changing domain code.

## Catalog API

- `GET /v1/catalog/products` — search by query, category, unit price, MOQ, and lead time
- `GET /v1/catalog/products/:id` — product, variants, and active supplier offers
- `POST /v1/catalog/compare` — quantity-aware offer comparison
- `POST /v1/catalog/import` — replace the development catalog from CSV when `CATALOG_IMPORT_ENABLED=true`

## Sourcing API

- `GET /v1/sourcing/cases` — list sourcing cases
- `POST /v1/sourcing/cases` — create a draft case
- `GET /v1/sourcing/cases/:id` — case, candidates, quote drafts, and decisions
- `POST /v1/sourcing/cases/:id/candidates` — shortlist a catalog product
- `POST /v1/sourcing/cases/:id/quote-requests` — draft a quote for in-scope offers
- `POST /v1/sourcing/cases/:id/quote-requests/:quoteId/approve` — human approval; locks the case

## Commerce API

- `GET /v1/commerce/listings` — dropship listings bound to awarded offers
- `POST /v1/commerce/listings` — create listings from an approved sourcing case
- `GET /v1/commerce/orders` — routed Shopify sales orders and supplier POs
- `POST /v1/commerce/orders/simulate` — local fixture order against a listing
- `POST /v1/commerce/shopify/webhooks/orders-create` — ingest a Shopify order payload
- `POST /v1/commerce/orders/:id/purchase-orders/:poId/confirm` — confirm a supplier PO
- `POST /v1/commerce/orders/:id/purchase-orders/:poId/ship` — write tracking back through the Shopify adapter

Catalog tools exposed to the real Harness are `search_catalog`, `get_product`, and `compare_offers`. Procurement write tools are `create_sourcing_case`, `add_sourcing_candidate`, `draft_quote_request`, and `approve_quote_request`. Commerce tools are `list_listings`, `get_sales_order`, `create_dropship_listing`, `simulate_shopify_order`, `confirm_purchase_order`, and `ship_purchase_order`. They call the product-owned API and do not read business storage or Shopify credentials directly. Write tools require operator approval.

PostgreSQL:

```sh
# .env
DATABASE_URL=postgres://user:pass@127.0.0.1:5432/dsh_supply
pnpm db:migrate
pnpm catalog:seed
```

`GET /health` reports `{ runtime, storage: "json" | "postgres", shopify: "fixture" | "admin" }`.

To drive the real Harness (same UI, same events):

```sh
# .env
AGENT_RUNTIME=dsh
DEEPSEEK_API_KEY=...
```

Then `pnpm build && pnpm dev:gateway` and `pnpm dev:web`.

## Tests

```sh
pnpm test          # AgentRuntime contracts + catalog + sourcing + dropship closed loop (memory, JSON, HTTP; Postgres if DATABASE_URL)
pnpm test:dsh      # pins + mapping + keyless boot; full DSH contracts with a model key
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the runtime boundary and the do-not-reinvent list.
