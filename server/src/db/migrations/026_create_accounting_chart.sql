-- Accounting, part 2: the simplified accrual chart of accounts (deliberately
-- NOT the official Iranian coding), the editable cafe→journal mapping table,
-- the accounting permission keys (seeded to Administrator) and a seeded
-- Accountant role (view/enter/post; closing and management stay with the
-- administrator).
--
-- Accrual treatment of the cafe flows:
--   top-up        Dr 1100 Cash            Cr 2100 Student deposits
--   student sale  Dr 2100 Student deposits Cr 4100 Cafe sales income
--   walk-in sale  Dr 1100 Cash            Cr 4100 Cafe sales income
--   cogs          Dr 5100 COGS            Cr 1200 Cafe inventory
--   purchase      Dr 1200 Cafe inventory  Cr 1100 Cash
--   manual refund Dr 2100 Student deposits Cr 1100 Cash
--   waste         Dr 5500 Other expenses  Cr 1200 Cafe inventory

INSERT INTO acct_accounts (code, name, type, is_system) VALUES
  ('1100', 'صندوق',                      'asset',     true),
  ('1110', 'حساب بانکی',                  'asset',     true),
  ('1200', 'موجودی کافه',                 'asset',     true),
  ('1300', 'سایر دارایی‌ها',              'asset',     true),
  ('2100', 'سپرده‌های دانش‌آموزان',       'liability', true),
  ('2200', 'پرداختنی تأمین‌کنندگان',      'liability', true),
  ('2300', 'سایر بدهی‌ها',                'liability', true),
  ('3000', 'سرمایه / افتتاحیه',           'equity',    true),
  ('3100', 'سود انباشته',                 'equity',    true),
  ('4100', 'درآمد فروش کافه',             'income',    true),
  ('4200', 'سایر درآمدها',                'income',    true),
  ('5100', 'بهای تمام‌شده فروش کافه',     'expense',   true),
  ('5200', 'هزینه اجاره',                 'expense',   true),
  ('5300', 'هزینه آب و برق و گاز',        'expense',   true),
  ('5400', 'هزینه حقوق و دستمزد',         'expense',   true),
  ('5500', 'سایر هزینه‌ها (شامل ضایعات)', 'expense',   true);

-- Which cafe events post to the journal, and against which accounts. Admins
-- edit this freely (e.g. move sales income to a sub-account, or point cash
-- at the bank account); setting is_active = false pauses auto-posting for
-- that event — the cafe keeps working standalone.
CREATE TABLE acct_mappings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event            text NOT NULL,
  debit_account_id  uuid NOT NULL REFERENCES acct_accounts(id),
  credit_account_id uuid NOT NULL REFERENCES acct_accounts(id),
  is_active        boolean NOT NULL DEFAULT true,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acct_mappings_event_ck CHECK (event IN (
    'cafe.sale_walk_in', 'cafe.sale_student', 'cafe.cogs', 'cafe.purchase',
    'cafe.waste', 'balance.topup', 'balance.refund'
  ))
);

CREATE UNIQUE INDEX acct_mappings_event_unique ON acct_mappings (event);

CREATE TRIGGER acct_mappings_updated_at
  BEFORE UPDATE ON acct_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO acct_mappings (event, debit_account_id, credit_account_id)
SELECT v.event,
       (SELECT id FROM acct_accounts WHERE code = v.dr),
       (SELECT id FROM acct_accounts WHERE code = v.cr)
FROM (VALUES
  ('cafe.sale_walk_in', '1100', '4100'),
  ('cafe.sale_student', '2100', '4100'),
  ('cafe.cogs',         '5100', '1200'),
  ('cafe.purchase',     '1200', '1100'),
  ('cafe.waste',        '5500', '1200'),
  ('balance.topup',     '1100', '2100'),
  ('balance.refund',    '2100', '1100')
) AS v(event, dr, cr);

-- The accounting permission keys, seeded to Administrator.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, key
FROM roles r
CROSS JOIN (VALUES
  ('accounting.view'),
  ('accounting.enter'),
  ('accounting.post'),
  ('accounting.close'),
  ('accounting.manage')
) AS keys(key)
WHERE lower(r.name) = 'administrator'
ON CONFLICT DO NOTHING;

-- A ready-made Accountant role: read, draft, and post, but not close periods
-- nor manage the chart/mappings (that stays with the administrator).
INSERT INTO roles (name, description, is_system)
SELECT 'Accountant', 'Journal entries: draft and post; read reports', true
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE lower(name) = 'accountant');

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, key
FROM roles r
CROSS JOIN (VALUES
  ('accounting.view'),
  ('accounting.enter'),
  ('accounting.post')
) AS keys(key)
WHERE lower(r.name) = 'accountant'
ON CONFLICT DO NOTHING;
