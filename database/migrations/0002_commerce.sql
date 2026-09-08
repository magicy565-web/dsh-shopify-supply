CREATE TABLE merchants (
  id text PRIMARY KEY,
  name text NOT NULL,
  destination_country text NOT NULL,
  shopify_shop text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO merchants (id, name, destination_country)
VALUES ('merchant-local', 'Local US Shopify', 'US')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE listings (
  id text PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  sourcing_case_id text NOT NULL REFERENCES sourcing_cases(id) ON DELETE RESTRICT,
  quote_request_id text NOT NULL REFERENCES quote_requests(id) ON DELETE RESTRICT,
  offer_id text NOT NULL REFERENCES supplier_offers(id) ON DELETE RESTRICT,
  product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id text REFERENCES product_variants(id) ON DELETE RESTRICT,
  supplier_id text NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  sku text NOT NULL,
  title text NOT NULL,
  currency text NOT NULL,
  unit_price numeric(14, 4) NOT NULL CHECK (unit_price > 0),
  status text NOT NULL CHECK (status IN ('active', 'inactive')),
  shopify_product_id text,
  shopify_variant_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, offer_id),
  UNIQUE (merchant_id, sku)
);

CREATE TABLE sales_orders (
  id text PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  shopify_order_id text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('received', 'routed', 'fulfilled', 'failed')),
  destination_country text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sales_order_lines (
  order_id text NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  listing_id text NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  sku text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(14, 4) NOT NULL CHECK (unit_price > 0),
  PRIMARY KEY (order_id, listing_id)
);

CREATE TABLE purchase_orders (
  id text PRIMARY KEY,
  sales_order_id text NOT NULL REFERENCES sales_orders(id) ON DELETE RESTRICT,
  listing_id text NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  supplier_id text NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  offer_id text NOT NULL REFERENCES supplier_offers(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('created', 'confirmed', 'shipped')),
  quantity integer NOT NULL CHECK (quantity > 0),
  currency text NOT NULL,
  unit_cost numeric(14, 4) NOT NULL CHECK (unit_cost > 0),
  warnings text[] NOT NULL DEFAULT '{}',
  tracking_number text,
  tracking_company text,
  shopify_fulfillment_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX listings_merchant_idx ON listings (merchant_id, status, updated_at DESC);
CREATE INDEX sales_orders_status_idx ON sales_orders (status, updated_at DESC);
CREATE INDEX purchase_orders_order_idx ON purchase_orders (sales_order_id, status);
