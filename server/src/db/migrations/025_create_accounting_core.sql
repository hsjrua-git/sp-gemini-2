-- Accounting, part 1: the double-entry core. Money is bigint Toman
-- throughout (the project-wide convention). Design invariants:
--   * every journal entry BALANCES (Σdebit = Σcredit) — enforced by a
--     DEFERRED constraint trigger at COMMIT time, so lines can be built in
--     any order inside a transaction but no unbalanced entry can ever land;
--   * POSTED entries are immutable (corrections are reversing entries) —
--     only the void transition is allowed, and lines may only touch drafts;
--   * nothing posts into a CLOSED fiscal period (checked on the post
--     transition by trigger);
--   * a source event (a cafe sale, a top-up…) can have at most ONE posted
--     entry (partial unique index); voiding frees the slot for a re-post.

CREATE TABLE acct_accounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL,
  name       text NOT NULL,
  type       text NOT NULL,
  parent_id  uuid REFERENCES acct_accounts(id),
  is_system  boolean NOT NULL DEFAULT false,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acct_accounts_type_ck
    CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  CONSTRAINT acct_accounts_code_ck CHECK (char_length(btrim(code)) BETWEEN 1 AND 20),
  CONSTRAINT acct_accounts_name_ck CHECK (char_length(btrim(name)) BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX acct_accounts_code_unique ON acct_accounts (code);
CREATE INDEX acct_accounts_type_idx ON acct_accounts (type);

CREATE TRIGGER acct_accounts_updated_at
  BEFORE UPDATE ON acct_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE acct_fiscal_periods (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  start_date date NOT NULL,
  end_date   date NOT NULL,
  status     text NOT NULL DEFAULT 'open',
  closed_by  uuid REFERENCES users(id),
  closed_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acct_periods_status_ck CHECK (status IN ('open', 'closed')),
  CONSTRAINT acct_periods_range_ck CHECK (end_date >= start_date),
  CONSTRAINT acct_periods_name_ck CHECK (char_length(btrim(name)) BETWEEN 1 AND 80)
);

CREATE INDEX acct_periods_range_idx ON acct_fiscal_periods (start_date, end_date);

CREATE SEQUENCE acct_entry_no_seq START 1000;

CREATE TABLE acct_journal_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_no          bigint NOT NULL DEFAULT nextval('acct_entry_no_seq'),
  entry_date        date NOT NULL,
  memo              text,
  status            text NOT NULL DEFAULT 'draft',
  source_type       text,
  source_id         uuid,
  posted_by         uuid REFERENCES users(id),
  posted_at         timestamptz,
  voided_by         uuid REFERENCES users(id),
  voided_at         timestamptz,
  reverses_entry_id uuid REFERENCES acct_journal_entries(id),
  created_by        uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acct_entries_status_ck CHECK (status IN ('draft', 'posted', 'voided')),
  CONSTRAINT acct_entries_memo_ck CHECK (memo IS NULL OR char_length(btrim(memo)) <= 500),
  CONSTRAINT acct_entries_reversal_ck
    CHECK (reverses_entry_id IS NULL OR reverses_entry_id <> id)
);

CREATE UNIQUE INDEX acct_entries_no_unique ON acct_journal_entries (entry_no);
CREATE INDEX acct_entries_date_idx
  ON acct_journal_entries (entry_date DESC, entry_no DESC)
  WHERE status = 'posted';
-- One POSTED entry per source event; voiding frees the slot.
CREATE UNIQUE INDEX acct_entries_source_unique
  ON acct_journal_entries (source_type, source_id)
  WHERE source_type IS NOT NULL AND status = 'posted';

CREATE TABLE acct_journal_lines (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id   uuid NOT NULL REFERENCES acct_journal_entries(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES acct_accounts(id),
  debit      bigint NOT NULL DEFAULT 0,
  credit     bigint NOT NULL DEFAULT 0,
  memo       text,
  CONSTRAINT acct_lines_nonneg_ck CHECK (debit >= 0 AND credit >= 0),
  -- Exactly one side carries the amount: (debit > 0) <> (credit > 0)
  -- is XOR when both are non-negative.
  CONSTRAINT acct_lines_one_side_ck CHECK ((debit > 0) <> (credit > 0)),
  CONSTRAINT acct_lines_memo_ck CHECK (memo IS NULL OR char_length(btrim(memo)) <= 500)
);

CREATE INDEX acct_lines_entry_idx ON acct_journal_lines (entry_id);
CREATE INDEX acct_lines_account_idx ON acct_journal_lines (account_id);

-- Σdebit = Σcredit per entry, checked at COMMIT (deferred), so multi-line
-- entries can be assembled freely inside a transaction.
CREATE FUNCTION acct_entry_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  total bigint;
BEGIN
  SELECT COALESCE(SUM(debit - credit), 1) INTO total
  FROM acct_journal_lines WHERE entry_id = COALESCE(NEW.entry_id, OLD.entry_id);
  IF total <> 0 THEN
    RAISE EXCEPTION 'journal entry % does not balance (Σdebit ≠ Σcredit by %)',
      COALESCE(NEW.entry_id, OLD.entry_id), total;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER acct_entry_balance_trg
  AFTER INSERT OR UPDATE OR DELETE ON acct_journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION acct_entry_balanced();

-- Lines belong to drafts only: a posted (or voided) entry's economics are
-- frozen; corrections arrive as new reversing entries.
CREATE FUNCTION acct_lines_draft_only() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  entry_status text;
BEGIN
  SELECT status INTO entry_status FROM acct_journal_entries
   WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
  IF entry_status IS NOT NULL AND entry_status <> 'draft' THEN
    RAISE EXCEPTION 'journal entry % is %; its lines are immutable', COALESCE(NEW.entry_id, OLD.entry_id), entry_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER acct_lines_draft_only_trg
  BEFORE INSERT OR UPDATE OR DELETE ON acct_journal_lines
  FOR EACH ROW EXECUTE FUNCTION acct_lines_draft_only();

-- Entry lifecycle guards (every UPDATE, and DELETE): drafts are freely
-- editable and deletable; posting (draft→posted, or a direct posted INSERT)
-- is blocked in closed periods and stamps the bookkeeping; a posted entry
-- may ONLY transition to voided with nothing else changed; voided entries
-- are frozen. Corrections are new reversing entries — never edits.
CREATE FUNCTION acct_entry_lifecycle() RETURNS trigger
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
       WHERE NEW.entry_date BETWEEN start_date AND end_date;
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
      RETURN NEW; -- free editing while still a draft
    END IF;
    IF NEW.status = 'posted' THEN
      SELECT status INTO period_status FROM acct_fiscal_periods
       WHERE NEW.entry_date BETWEEN start_date AND end_date;
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

CREATE TRIGGER acct_entry_lifecycle_trg
  BEFORE INSERT OR UPDATE OR DELETE ON acct_journal_entries
  FOR EACH ROW EXECUTE FUNCTION acct_entry_lifecycle();
