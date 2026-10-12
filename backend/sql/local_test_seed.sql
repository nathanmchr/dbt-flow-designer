\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dbt_flow_reader') THEN
    CREATE ROLE dbt_flow_reader LOGIN PASSWORD 'dbt_flow_reader_local';
  END IF;
END
$$;

ALTER ROLE dbt_flow_reader PASSWORD 'dbt_flow_reader_local';
ALTER ROLE dbt_flow_reader SET default_transaction_read_only = on;

REVOKE ALL ON DATABASE dbt_flow_test FROM PUBLIC;
GRANT CONNECT ON DATABASE dbt_flow_test TO dbt_flow_reader;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA IF NOT EXISTS raw;
REVOKE ALL ON SCHEMA raw FROM PUBLIC;
GRANT USAGE ON SCHEMA raw TO dbt_flow_reader;

CREATE TABLE IF NOT EXISTS raw.customers (
  customer_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  country_code TEXT NOT NULL CHECK (country_code IN ('FR', 'JP', 'US', 'DE', 'GB')),
  segment TEXT NOT NULL CHECK (segment IN ('consumer', 'business', 'enterprise')),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS raw.products (
  product_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS raw.orders (
  order_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES raw.customers(customer_id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'shipped', 'cancelled', 'refunded')),
  channel TEXT NOT NULL CHECK (channel IN ('web', 'mobile', 'partner')),
  total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
  is_priority BOOLEAN NOT NULL DEFAULT false,
  ordered_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS raw.order_items (
  order_item_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES raw.orders(order_id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES raw.products(product_id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS raw.events (
  event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT REFERENCES raw.customers(customer_id) ON DELETE SET NULL,
  event_name TEXT NOT NULL CHECK (event_name IN ('page_view', 'search', 'add_to_cart', 'checkout', 'purchase')),
  session_id TEXT NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS orders_customer_id_idx ON raw.orders (customer_id);
CREATE INDEX IF NOT EXISTS orders_status_ordered_at_idx ON raw.orders (status, ordered_at);
CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON raw.order_items (order_id);
CREATE INDEX IF NOT EXISTS order_items_product_id_idx ON raw.order_items (product_id);
CREATE INDEX IF NOT EXISTS events_customer_id_idx ON raw.events (customer_id);
CREATE INDEX IF NOT EXISTS events_occurred_at_idx ON raw.events (occurred_at);

TRUNCATE TABLE raw.events, raw.order_items, raw.orders, raw.products, raw.customers
RESTART IDENTITY CASCADE;

INSERT INTO raw.customers (full_name, email, country_code, segment, created_at)
SELECT
  format('Customer %s', number),
  format('customer%s@example.test', number),
  (ARRAY['FR', 'JP', 'US', 'DE', 'GB'])[1 + ((number - 1) % 5)],
  (ARRAY['consumer', 'business', 'enterprise'])[1 + ((number - 1) % 3)],
  TIMESTAMPTZ '2024-01-01 09:00:00+00' + (number * INTERVAL '1 day')
FROM generate_series(1, 100) AS series(number);

INSERT INTO raw.products (
  sku,
  product_name,
  category,
  unit_price,
  is_active,
  created_at
)
SELECT
  'SKU-' || to_char(number, 'FM0000'),
  format('Product %s', number),
  (ARRAY['analytics', 'storage', 'automation', 'security', 'support'])[1 + ((number - 1) % 5)],
  (10 + ((number * 137) % 20000) / 100.0)::NUMERIC(12, 2),
  number % 11 <> 0,
  TIMESTAMPTZ '2024-01-01 09:00:00+00' + (number * INTERVAL '2 days')
FROM generate_series(1, 30) AS series(number);

INSERT INTO raw.orders (
  customer_id,
  status,
  channel,
  total_amount,
  is_priority,
  ordered_at,
  created_at
)
SELECT
  1 + ((number - 1) % 100),
  (ARRAY['pending', 'paid', 'shipped', 'cancelled', 'refunded'])[1 + ((number - 1) % 5)],
  (ARRAY['web', 'mobile', 'partner'])[1 + ((number - 1) % 3)],
  (15 + ((number * 379) % 50000) / 100.0)::NUMERIC(12, 2),
  number % 10 = 0,
  TIMESTAMPTZ '2025-01-01 08:00:00+00'
    + (((number - 1) % 365) * INTERVAL '1 day')
    + ((number % 24) * INTERVAL '1 hour'),
  TIMESTAMPTZ '2025-01-01 08:00:00+00'
    + (((number - 1) % 365) * INTERVAL '1 day')
FROM generate_series(1, 1000) AS series(number);

INSERT INTO raw.order_items (
  order_id,
  product_id,
  quantity,
  unit_price,
  created_at
)
SELECT
  1 + ((number - 1) % 1000),
  1 + ((number * 7 - 1) % 30),
  1 + (number % 4),
  (10 + (((1 + ((number * 7 - 1) % 30)) * 137) % 20000) / 100.0)::NUMERIC(12, 2),
  TIMESTAMPTZ '2025-01-01 08:00:00+00'
    + (((number - 1) % 365) * INTERVAL '1 day')
FROM generate_series(1, 3000) AS series(number);

INSERT INTO raw.events (
  customer_id,
  event_name,
  session_id,
  properties,
  occurred_at,
  created_at
)
SELECT
  CASE WHEN number % 20 = 0 THEN NULL ELSE 1 + ((number - 1) % 100) END,
  (ARRAY['page_view', 'search', 'add_to_cart', 'checkout', 'purchase'])[1 + ((number - 1) % 5)],
  'session-' || to_char(1 + ((number - 1) / 5), 'FM000000'),
  jsonb_build_object(
    'device', (ARRAY['desktop', 'mobile', 'tablet'])[1 + ((number - 1) % 3)],
    'campaign', CASE WHEN number % 4 = 0 THEN 'summer_test' ELSE NULL END,
    'sequence', number
  ),
  TIMESTAMPTZ '2025-01-01 00:00:00+00' + (number * INTERVAL '90 minutes'),
  TIMESTAMPTZ '2025-01-01 00:00:00+00' + (number * INTERVAL '90 minutes')
FROM generate_series(1, 5000) AS series(number);

CREATE OR REPLACE VIEW raw.order_summary AS
SELECT
  order_data.order_id,
  order_data.customer_id,
  customer_data.full_name AS customer_name,
  customer_data.country_code,
  order_data.status,
  order_data.channel,
  order_data.total_amount,
  order_data.is_priority,
  order_data.ordered_at,
  COUNT(item_data.order_item_id) AS item_count,
  COALESCE(SUM(item_data.quantity), 0) AS total_quantity
FROM raw.orders AS order_data
JOIN raw.customers AS customer_data
  ON customer_data.customer_id = order_data.customer_id
LEFT JOIN raw.order_items AS item_data
  ON item_data.order_id = order_data.order_id
GROUP BY
  order_data.order_id,
  order_data.customer_id,
  customer_data.full_name,
  customer_data.country_code,
  order_data.status,
  order_data.channel,
  order_data.total_amount,
  order_data.is_priority,
  order_data.ordered_at;

GRANT SELECT ON ALL TABLES IN SCHEMA raw TO dbt_flow_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA raw
GRANT SELECT ON TABLES TO dbt_flow_reader;

ANALYZE raw.customers;
ANALYZE raw.products;
ANALYZE raw.orders;
ANALYZE raw.order_items;
ANALYZE raw.events;
