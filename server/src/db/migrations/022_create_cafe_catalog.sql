-- Cafe, part 1: the catalog layer — products and suppliers. Prices are
-- Toman in whole numbers (bigint, per the project-wide money convention);
-- quantities elsewhere are numeric(12,3) because items can be sold by
-- weight/portion. Products deactivate rather than delete once sales exist
-- (RESTRICT from the movement ledger in 023); avg_cost arrives maintained
-- by that same ledger — it sits here so the column and its story live with
-- the table it belongs to.

CREATE TABLE cafe_products (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  price      bigint NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  avg_cost   bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cafe_products_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT cafe_products_price_nonnegative CHECK (price >= 0),
  CONSTRAINT cafe_products_sort_ck CHECK (sort_order >= 0)
);

-- Active products have unique names (case-insensitive); deactivating frees
-- the name for a relaunch.
CREATE UNIQUE INDEX cafe_products_name_unique
  ON cafe_products (lower(name))
  WHERE is_active;

CREATE INDEX cafe_products_active_sort_idx
  ON cafe_products (is_active, sort_order, lower(name));

CREATE TRIGGER cafe_products_updated_at
  BEFORE UPDATE ON cafe_products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cafe_suppliers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  phone      text,
  note       text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cafe_suppliers_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT cafe_suppliers_phone_length CHECK (phone IS NULL OR char_length(btrim(phone)) <= 30)
);

CREATE UNIQUE INDEX cafe_suppliers_name_unique
  ON cafe_suppliers (lower(name))
  WHERE is_active;

CREATE TRIGGER cafe_suppliers_updated_at
  BEFORE UPDATE ON cafe_suppliers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The Administrator role gains every cafe key; other roles get nothing new.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, key
FROM roles r
CROSS JOIN (VALUES
  ('cafe.view'),
  ('cafe.sell'),
  ('cafe.balance'),
  ('cafe.supplies'),
  ('cafe.inventory'),
  ('cafe.manage')
) AS keys(key)
WHERE lower(r.name) = 'administrator'
ON CONFLICT DO NOTHING;
