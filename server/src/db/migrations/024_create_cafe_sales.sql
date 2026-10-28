-- Cafe, part 3: sales and prepaid student balances.
--
-- Money is bigint Toman throughout. Student balances are PREPAID WITH
-- OVERDRAFT ALLOWED: a charge may push the balance negative — the product
-- decision is that the cafe never refuses a hungry student; the debt is
-- visible and settled later. student_balance_transactions keeps the full
-- history with the running balance_after, so the ledger can always be
-- replayed. Sales void (reversing stock and balance), never delete.

CREATE TABLE cafe_sales (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sold_at    timestamptz NOT NULL DEFAULT now(),
  sold_by    uuid NOT NULL REFERENCES users(id),
  customer   text NOT NULL,
  student_id uuid REFERENCES students(id),
  -- Defaults of 0: the row is inserted first and its totals are computed
  -- from the items (exact numeric math) in the same transaction; the default
  -- only bridges the moment between INSERT and UPDATE inside it.
  total      bigint NOT NULL DEFAULT 0,
  cost_total bigint NOT NULL DEFAULT 0,
  note       text,
  voided_at  timestamptz,
  voided_by  uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cafe_sales_customer_ck CHECK (customer IN ('walk_in', 'student')),
  CONSTRAINT cafe_sales_target_ck
    CHECK ((customer = 'student') = (student_id IS NOT NULL)),
  CONSTRAINT cafe_sales_amounts_ck CHECK (total >= 0 AND cost_total >= 0),
  CONSTRAINT cafe_sales_note_ck CHECK (note IS NULL OR char_length(btrim(note)) <= 500)
);

CREATE INDEX cafe_sales_sold_at_idx ON cafe_sales (sold_at DESC);
CREATE INDEX cafe_sales_student_idx ON cafe_sales (student_id) WHERE student_id IS NOT NULL;

CREATE TABLE cafe_sale_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id     uuid NOT NULL REFERENCES cafe_sales(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES cafe_products(id),
  qty         numeric(12,3) NOT NULL,
  unit_price  bigint NOT NULL,
  unit_cost   bigint NOT NULL,
  CONSTRAINT cafe_sale_items_qty_positive CHECK (qty > 0),
  CONSTRAINT cafe_sale_items_price_nonneg CHECK (unit_price >= 0),
  CONSTRAINT cafe_sale_items_cost_nonneg CHECK (unit_cost >= 0)
);

CREATE INDEX cafe_sale_items_sale_idx ON cafe_sale_items (sale_id);
CREATE INDEX cafe_sale_items_product_idx ON cafe_sale_items (product_id);

CREATE TABLE student_balances (
  student_id uuid PRIMARY KEY REFERENCES students(id),
  balance    bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER student_balances_updated_at
  BEFORE UPDATE ON student_balances
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE student_balance_transactions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     uuid NOT NULL REFERENCES students(id),
  kind           text NOT NULL,
  amount         bigint NOT NULL,
  balance_after  bigint NOT NULL,
  reference_type text,
  reference_id   uuid,
  note           text,
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cafe_balance_kinds_ck
    CHECK (kind IN ('topup', 'charge', 'refund', 'adjustment')),
  CONSTRAINT cafe_balance_topup_positive CHECK (kind <> 'topup' OR amount > 0),
  CONSTRAINT cafe_balance_refund_positive CHECK (kind <> 'refund' OR amount > 0),
  CONSTRAINT cafe_balance_charge_negative CHECK (kind <> 'charge' OR amount < 0),
  CONSTRAINT cafe_balance_adjustment_nonzero CHECK (kind <> 'adjustment' OR amount <> 0),
  CONSTRAINT cafe_balance_note_ck CHECK (note IS NULL OR char_length(btrim(note)) <= 500)
);

CREATE INDEX cafe_balance_txn_student_idx
  ON student_balance_transactions (student_id, created_at DESC);
