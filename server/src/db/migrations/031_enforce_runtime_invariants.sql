-- Runtime-integrity remediation.
--
-- The earlier cross-row trigger checks were correct in one transaction but
-- could race in two concurrent transactions. A tiny lock table gives portable
-- PostgreSQL/PGlite serialization without requiring btree_gist.

CREATE TABLE acct_invariant_locks (
  key text PRIMARY KEY
);

INSERT INTO acct_invariant_locks (key) VALUES
  ('fiscal_periods'),
  ('opening_entry')
ON CONFLICT DO NOTHING;

-- Migration 029 kept existing sessions but created a fresh periods table.
-- Backfill every live 4-session bucket once; subsequent session writes keep it
-- synchronized, so GET endpoints can remain truly read-only.
WITH counts AS (
  SELECT assignment_id, ceil(count(*)::numeric / 4)::int AS bucket_count
  FROM sessions
  WHERE canceled_at IS NULL AND archived_at IS NULL
  GROUP BY assignment_id
)
INSERT INTO periods (assignment_id, seq)
SELECT c.assignment_id, g.seq
FROM counts c
CROSS JOIN LATERAL generate_series(1, c.bucket_count) AS g(seq)
ON CONFLICT (assignment_id, seq) DO UPDATE
  SET archived_at = NULL, updated_at = now();

CREATE OR REPLACE FUNCTION acct_fiscal_periods_no_overlap() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Every period insert/range edit takes the same transaction-scoped row lock,
  -- so two uncommitted overlapping ranges cannot both pass the EXISTS check.
  PERFORM 1 FROM acct_invariant_locks
   WHERE key = 'fiscal_periods'
   FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM acct_fiscal_periods p
     WHERE p.id IS DISTINCT FROM NEW.id
       AND p.start_date <= NEW.end_date
       AND p.end_date >= NEW.start_date
  ) THEN
    RAISE EXCEPTION 'fiscal period [%, %] overlaps an existing fiscal period',
      NEW.start_date, NEW.end_date
      USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- One opening snapshot for the lifetime of the books. This covers drafts too,
-- so concurrent requests race into a DB conflict rather than double-booking.
CREATE UNIQUE INDEX acct_entries_one_opening_unique
  ON acct_journal_entries (source_type)
  WHERE source_type = 'opening';

-- A period may have a new closing entry each time it is reopened, receives
-- late postings, and closes again. Other source events stay once-only.
DROP INDEX acct_entries_source_unique;
CREATE UNIQUE INDEX acct_entries_source_unique
  ON acct_journal_entries (source_type, source_id)
  WHERE source_type IS NOT NULL
    AND source_type NOT IN ('opening', 'closing')
    AND status = 'posted';

-- Posting and voiding take a shared lock on the matching fiscal period. It
-- serializes with close/reopen's row update: either the entry wins and the
-- closer sees it, or close wins and the entry is refused.
CREATE OR REPLACE FUNCTION acct_entry_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  period_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'only draft journal entries can be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'posted' THEN
      SELECT status INTO period_status FROM acct_fiscal_periods
       WHERE NEW.entry_date BETWEEN start_date AND end_date
       ORDER BY start_date DESC
       LIMIT 1
       FOR SHARE;
      IF period_status = 'closed' THEN
        RAISE EXCEPTION 'cannot post into a closed fiscal period (%)', NEW.entry_date;
      END IF;
      NEW.posted_by := COALESCE(NEW.posted_by, current_setting('acct.user_id', true)::uuid);
      NEW.posted_at := COALESCE(NEW.posted_at, now());
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'draft' THEN
    IF NEW.status = 'draft' THEN
      RETURN NEW;
    END IF;
    IF NEW.status = 'posted' THEN
      SELECT status INTO period_status FROM acct_fiscal_periods
       WHERE NEW.entry_date BETWEEN start_date AND end_date
       ORDER BY start_date DESC
       LIMIT 1
       FOR SHARE;
      IF period_status = 'closed' THEN
        RAISE EXCEPTION 'cannot post into a closed fiscal period (%)', NEW.entry_date;
      END IF;
      NEW.posted_by := COALESCE(NEW.posted_by, current_setting('acct.user_id', true)::uuid);
      NEW.posted_at := COALESCE(NEW.posted_at, now());
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'a draft journal entry can only be posted';
  ELSIF OLD.status = 'posted' THEN
    IF NEW.status = 'voided'
       AND NEW.entry_date = OLD.entry_date
       AND NEW.memo IS NOT DISTINCT FROM OLD.memo
       AND NEW.source_type IS NOT DISTINCT FROM OLD.source_type
       AND NEW.source_id IS NOT DISTINCT FROM OLD.source_id
       AND NEW.reverses_entry_id IS NOT DISTINCT FROM OLD.reverses_entry_id THEN
      SELECT status INTO period_status FROM acct_fiscal_periods
       WHERE OLD.entry_date BETWEEN start_date AND end_date
       ORDER BY start_date DESC
       LIMIT 1
       FOR SHARE;
      IF period_status = 'closed' THEN
        RAISE EXCEPTION 'cannot void inside a closed fiscal period (%)', OLD.entry_date;
      END IF;
      NEW.voided_by := COALESCE(NEW.voided_by, current_setting('acct.user_id', true)::uuid);
      NEW.voided_at := COALESCE(NEW.voided_at, now());
      NEW.posted_by := OLD.posted_by;
      NEW.posted_at := OLD.posted_at;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'posted journal entries are immutable (void instead)';
  ELSE
    RAISE EXCEPTION 'voided journal entries are immutable';
  END IF;
END;
$$;

-- Reading a parameter under FOR SHARE makes range validation serialize with a
-- concurrent range update. Without it, both transactions could validate
-- against each other's old snapshots and commit an invalid value/range pair.
CREATE OR REPLACE FUNCTION check_evaluation_range() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_min integer;
  v_max integer;
BEGIN
  SELECT min_value, max_value INTO v_min, v_max
    FROM parameters WHERE id = NEW.parameter_id
    FOR SHARE;

  IF NEW.quality_value IS NOT NULL AND (
       (v_min IS NOT NULL AND NEW.quality_value < v_min) OR
       (v_max IS NOT NULL AND NEW.quality_value > v_max)) THEN
    RAISE EXCEPTION 'quality value % is outside parameter % range [%, %]',
      NEW.quality_value, NEW.parameter_id, COALESCE(v_min::text, '-inf'),
      COALESCE(v_max::text, '+inf')
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.quantity_value IS NOT NULL AND (
       (v_min IS NOT NULL AND NEW.quantity_value < v_min) OR
       (v_max IS NOT NULL AND NEW.quantity_value > v_max)) THEN
    RAISE EXCEPTION 'quantity value % is outside parameter % range [%, %]',
      NEW.quantity_value, NEW.parameter_id, COALESCE(v_min::text, '-inf'),
      COALESCE(v_max::text, '+inf')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

ALTER TABLE acct_mappings
  ADD CONSTRAINT acct_mappings_distinct_accounts
  CHECK (debit_account_id <> credit_account_id);

-- Archiving a student must not hide money that still needs settling. Cafe
-- balance/sale writes take FOR SHARE on the student row; this UPDATE lock then
-- serializes deletion with those transactions.
CREATE FUNCTION students_balance_settled_before_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM student_balances
     WHERE student_id = NEW.id AND balance <> 0
  ) THEN
    RAISE EXCEPTION 'student balance must be zero before deletion'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER students_balance_settled_before_delete_trg
  BEFORE UPDATE OF deleted_at ON students
  FOR EACH ROW EXECUTE FUNCTION students_balance_settled_before_delete();

-- Foreign-key indexes used by role joins, actor/history filters, hierarchy
-- traversal, mapping validation, and parent-row maintenance.
CREATE INDEX users_role_idx ON users (role_id);
CREATE INDEX student_groups_created_by_idx ON student_groups (created_by);
CREATE INDEX student_field_definitions_created_by_idx ON student_field_definitions (created_by);
CREATE INDEX assignments_interval_idx ON assignments (interval_id);
CREATE INDEX cafe_purchases_created_by_idx ON cafe_purchases (created_by);
CREATE INDEX cafe_stock_movements_created_by_idx ON cafe_stock_movements (created_by);
CREATE INDEX cafe_sales_sold_by_idx ON cafe_sales (sold_by);
CREATE INDEX cafe_sales_voided_by_idx ON cafe_sales (voided_by);
CREATE INDEX student_balance_transactions_created_by_idx ON student_balance_transactions (created_by);
CREATE INDEX acct_accounts_parent_idx ON acct_accounts (parent_id);
CREATE INDEX acct_fiscal_periods_closed_by_idx ON acct_fiscal_periods (closed_by);
CREATE INDEX acct_journal_entries_created_by_idx ON acct_journal_entries (created_by);
CREATE INDEX acct_journal_entries_posted_by_idx ON acct_journal_entries (posted_by);
CREATE INDEX acct_journal_entries_reverses_idx ON acct_journal_entries (reverses_entry_id);
CREATE INDEX acct_journal_entries_voided_by_idx ON acct_journal_entries (voided_by);
CREATE INDEX acct_mappings_credit_account_idx ON acct_mappings (credit_account_id);
CREATE INDEX acct_mappings_debit_account_idx ON acct_mappings (debit_account_id);

-- Retire permission rows for features removed by schema-4.
DELETE FROM role_permissions export
WHERE export.permission_key = 'data.export'
  AND EXISTS (
    SELECT 1 FROM (VALUES
      ('students.view'), ('scores.view'), ('parameters.view')
    ) AS required(key)
    WHERE NOT EXISTS (
      SELECT 1 FROM role_permissions held
      WHERE held.role_id = export.role_id
        AND held.permission_key = required.key
    )
  );

DELETE FROM role_permissions
 WHERE permission_key IN ('views.share', 'settings.manage');

DROP TABLE IF EXISTS settings;

UPDATE roles
SET description = 'Full access, including users, roles, scheduling, cafe and accounting.'
WHERE lower(name) = 'administrator' AND is_system;
