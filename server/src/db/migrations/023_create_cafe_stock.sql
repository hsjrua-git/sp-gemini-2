-- Cafe, part 2: purchasing and the stock ledger. Movements are APPEND-ONLY
-- (a trigger refuses UPDATE/DELETE): stock is always SUM(qty) over movements,
-- so history can never drift from the total. Every movement snapshots the
-- unit cost it happened at; purchases also maintain the product's moving
-- average cost (clamped: when nothing was left in stock, the new delivery's
-- cost defines the average — a negative leftover never divides).

CREATE TABLE cafe_purchases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id  uuid NOT NULL REFERENCES cafe_suppliers(id),
  note         text,
  purchased_at date NOT NULL DEFAULT current_date,
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cafe_purchases_note_ck CHECK (note IS NULL OR char_length(btrim(note)) <= 500)
);

CREATE INDEX cafe_purchases_date_idx ON cafe_purchases (purchased_at DESC);
CREATE INDEX cafe_purchases_supplier_idx ON cafe_purchases (supplier_id);

CREATE TABLE cafe_purchase_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES cafe_purchases(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES cafe_products(id),
  qty         numeric(12,3) NOT NULL,
  unit_cost   bigint NOT NULL,
  CONSTRAINT cafe_purchase_items_qty_positive CHECK (qty > 0),
  CONSTRAINT cafe_purchase_items_cost_nonnegative CHECK (unit_cost >= 0)
);

CREATE INDEX cafe_purchase_items_purchase_idx ON cafe_purchase_items (purchase_id);
CREATE INDEX cafe_purchase_items_product_idx ON cafe_purchase_items (product_id);

CREATE TABLE cafe_stock_movements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     uuid NOT NULL REFERENCES cafe_products(id),
  kind           text NOT NULL,
  qty            numeric(12,3) NOT NULL,
  unit_cost      bigint NOT NULL DEFAULT 0,
  reference_type text,
  reference_id   uuid,
  note           text,
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cafe_movements_kind_ck
    CHECK (kind IN ('purchase', 'sale', 'waste', 'adjustment')),
  CONSTRAINT cafe_movements_qty_sign_ck
    CHECK (kind NOT IN ('purchase', 'sale', 'waste') OR qty <> 0),
  CONSTRAINT cafe_movements_note_ck CHECK (note IS NULL OR char_length(btrim(note)) <= 500)
);

CREATE INDEX cafe_movements_product_idx ON cafe_stock_movements (product_id, created_at DESC);
CREATE INDEX cafe_movements_kind_idx ON cafe_stock_movements (kind, created_at DESC);

-- Append-only: nothing may rewrite or erase a movement. Corrections are new
-- movements (the ledger is the truth).
CREATE FUNCTION cafe_movement_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'cafe_stock_movements is append-only';
END;
$$;

CREATE TRIGGER cafe_stock_movements_append_only
  BEFORE UPDATE OR DELETE ON cafe_stock_movements
  FOR EACH ROW EXECUTE FUNCTION cafe_movement_immutable();

-- Stock and the moving average, as the routes read them.
CREATE VIEW cafe_stock AS
SELECT p.id AS product_id,
       p.name,
       p.is_active,
       COALESCE(SUM(m.qty), 0) AS qty,
       p.avg_cost
FROM cafe_products p
LEFT JOIN cafe_stock_movements m ON m.product_id = p.id
GROUP BY p.id, p.name, p.is_active, p.avg_cost;
