CREATE TABLE products (
  id text PRIMARY KEY,
  sku text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'inactive')),
  tags text[] NOT NULL DEFAULT '{}',
  images text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_variants (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku text NOT NULL UNIQUE,
  attributes jsonb NOT NULL DEFAULT '{}',
  weight_grams integer CHECK (weight_grams > 0)
);

CREATE TABLE suppliers (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  country text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE supplier_offers (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id text REFERENCES product_variants(id) ON DELETE CASCADE,
  supplier_id text NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  currency text NOT NULL,
  unit_price numeric(14, 4) NOT NULL CHECK (unit_price > 0),
  moq integer NOT NULL CHECK (moq > 0),
  lead_time_days integer NOT NULL CHECK (lead_time_days >= 0),
  stock integer CHECK (stock >= 0),
  shipping_flat numeric(14, 2) CHECK (shipping_flat >= 0),
  status text NOT NULL CHECK (status IN ('active', 'inactive')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sourcing_cases (
  id text PRIMARY KEY,
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'researching', 'shortlisted', 'approved', 'closed')),
  requirements jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sourcing_candidates (
  sourcing_case_id text NOT NULL REFERENCES sourcing_cases(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  rationale text NOT NULL DEFAULT '',
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sourcing_case_id, product_id)
);

CREATE TABLE quote_requests (
  id text PRIMARY KEY,
  sourcing_case_id text NOT NULL REFERENCES sourcing_cases(id) ON DELETE RESTRICT,
  supplier_id text NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('draft', 'approved', 'sent', 'responded', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quote_request_items (
  quote_request_id text NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  offer_id text NOT NULL REFERENCES supplier_offers(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (quote_request_id, offer_id)
);

CREATE TABLE procurement_decisions (
  id text PRIMARY KEY,
  sourcing_case_id text NOT NULL REFERENCES sourcing_cases(id) ON DELETE RESTRICT,
  offer_id text NOT NULL REFERENCES supplier_offers(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('selected', 'rejected')),
  reason text NOT NULL DEFAULT '',
  decided_by text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX products_search_idx ON products USING gin (to_tsvector('simple', sku || ' ' || title || ' ' || description || ' ' || category));
CREATE INDEX supplier_offers_product_idx ON supplier_offers (product_id, status);
CREATE INDEX supplier_offers_supplier_idx ON supplier_offers (supplier_id, status);
CREATE UNIQUE INDEX supplier_offers_identity_idx ON supplier_offers (supplier_id, product_id, COALESCE(variant_id, ''));
CREATE INDEX sourcing_cases_status_idx ON sourcing_cases (status, updated_at DESC);
