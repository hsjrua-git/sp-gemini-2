-- Audit remediation migration:
-- 1. Enforce non-overlapping date ranges on acct_fiscal_periods at the DB level
--    (works identically in PostgreSQL and embedded PGlite without requiring
--    superuser btree_gist extensions).
-- 2. Make acct_entry_lifecycle() period lookup deterministic with LIMIT 1.
-- 3. Add self-parent CHECK constraints on acct_accounts and parameters to
--    match student_groups.

CREATE OR REPLACE FUNCTION acct_fiscal_periods_no_overlap() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
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

DROP TRIGGER IF EXISTS acct_fiscal_periods_no_overlap_trg ON acct_fiscal_periods;
CREATE TRIGGER acct_fiscal_periods_no_overlap_trg
  BEFORE INSERT OR UPDATE OF start_date, end_date ON acct_fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION acct_fiscal_periods_no_overlap();

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
       LIMIT 1;
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
       LIMIT 1;
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
      IF OLD.source_type = 'closing' THEN
        RAISE EXCEPTION 'closing journal entries cannot be voided';
      END IF;
      SELECT status INTO period_status FROM acct_fiscal_periods
       WHERE OLD.entry_date BETWEEN start_date AND end_date
       ORDER BY start_date DESC
       LIMIT 1;
      IF period_status = 'closed' THEN
        RAISE EXCEPTION 'cannot void an entry in a closed fiscal period (%)', OLD.entry_date;
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

ALTER TABLE acct_accounts
  ADD CONSTRAINT acct_accounts_not_own_parent
  CHECK (parent_id IS NULL OR parent_id <> id);

ALTER TABLE parameters
  ADD CONSTRAINT parameters_not_own_parent
  CHECK (parent_id IS NULL OR parent_id <> id);

-- 016 attached student_group_members_updated_at trigger to student_group_members
-- without adding the updated_at column, causing every UPDATE (such as setting
-- left_on when removing a member) to fail with 42703.
ALTER TABLE student_group_members
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

