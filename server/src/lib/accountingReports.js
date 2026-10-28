// The four accounting reports, all pure aggregates over POSTED lines.
// Sign conventions: asset/expense increase with DEBITS; liability/equity/
// income increase with CREDITS. Money stays whole Toman (numbers, converted
// from bigint).

const SIGNED = {
  asset: 'debit',
  expense: 'debit',
  liability: 'credit',
  equity: 'credit',
  income: 'credit',
};

function postedLines(from, to, accountId = null) {
  return `
    FROM acct_journal_lines l
    JOIN acct_journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
    JOIN acct_accounts a ON a.id = l.account_id
    WHERE e.entry_date >= $1::date AND e.entry_date <= $2::date
      ${accountId ? 'AND a.id = $3::uuid' : ''}
  `;
}

export async function trialBalance(db, { from, to }) {
  const result = await db.query(
    `SELECT a.id, a.code, a.name, a.type,
            SUM(l.debit)::bigint  AS debit,
            SUM(l.credit)::bigint AS credit
     ${postedLines(from, to)}
     GROUP BY a.id, a.code, a.name, a.type
     HAVING SUM(l.debit) <> 0 OR SUM(l.credit) <> 0
     ORDER BY a.code`,
    [from, to]
  );
  const rows = result.rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    debit: Number(row.debit),
    credit: Number(row.credit),
  }));
  return {
    range: { from, to },
    accounts: rows,
    totalDebit: rows.reduce((sum, row) => sum + row.debit, 0),
    totalCredit: rows.reduce((sum, row) => sum + row.credit, 0),
  };
}

export async function generalLedger(db, { accountId, from, to }) {
  const result = await db.query(
    `SELECT e.entry_no AS "entryNo",
            e.entry_date::text AS "entryDate",
            e.memo AS "entryMemo",
            e.status,
            l.debit,
            l.credit,
            l.memo AS "lineMemo"
     ${postedLines(from, to, accountId)}
     ORDER BY e.entry_date, e.entry_no`,
    [from, to, accountId]
  );
  const account = await db.query(
    'SELECT id, code, name, type FROM acct_accounts WHERE id = $1',
    [accountId]
  );
  if (account.rowCount === 0) {
    return { error: 'NOT_FOUND' };
  }
  const direction = SIGNED[account.rows[0].type] === 'debit' ? 1 : -1;
  let running = 0;
  const lines = result.rows.map((row) => {
    running += direction * (Number(row.debit) - Number(row.credit));
    return {
      entryNo: Number(row.entryNo),
      entryDate: row.entryDate,
      entryMemo: row.entryMemo,
      status: row.status,
      debit: Number(row.debit),
      credit: Number(row.credit),
      lineMemo: row.lineMemo,
      balance: running,
    };
  });
  return {
    account: account.rows[0],
    range: { from, to },
    lines,
    closingBalance: running,
  };
}

export async function incomeStatement(db, { from, to }) {
  const result = await db.query(
    `SELECT a.id, a.code, a.name, a.type,
            CASE a.type
              WHEN 'income'  THEN SUM(l.credit - l.debit)
              ELSE SUM(l.debit - l.credit)
            END::bigint AS balance
     ${postedLines(from, to)}
     AND a.type IN ('income', 'expense')
     GROUP BY a.id, a.code, a.name, a.type
     HAVING CASE a.type
              WHEN 'income'  THEN SUM(l.credit - l.debit)
              ELSE SUM(l.debit - l.credit)
            END <> 0
     ORDER BY a.type DESC, a.code`,
    [from, to]
  );
  const income = [];
  const expense = [];
  for (const row of result.rows) {
    const entry = {
      id: row.id,
      code: row.code,
      name: row.name,
      balance: Number(row.balance),
    };
    if (row.type === 'income') income.push(entry);
    else expense.push(entry);
  }
  const totalIncome = income.reduce((sum, row) => sum + row.balance, 0);
  const totalExpense = expense.reduce((sum, row) => sum + row.balance, 0);
  return {
    range: { from, to },
    income,
    expense,
    totalIncome,
    totalExpense,
    netProfit: totalIncome - totalExpense,
  };
}

// The balance sheet as of a date: standing balances of assets, liabilities
// and equity from the beginning of the books, plus retained earnings — the
// cumulative net income of all time — so assets always equal liabilities +
// equity + earnings.
export async function balanceSheet(db, { asOf }) {
  const result = await db.query(
    `SELECT a.id, a.code, a.name, a.type,
            CASE WHEN a.type IN ('asset', 'expense')
                 THEN SUM(l.debit - l.credit)
                 ELSE SUM(l.credit - l.debit)
            END::bigint AS balance
     ${postedLines('1900-01-01', asOf)}
     GROUP BY a.id, a.code, a.name, a.type
     HAVING CASE WHEN a.type IN ('asset', 'expense')
                 THEN SUM(l.debit - l.credit)
                 ELSE SUM(l.credit - l.debit)
            END <> 0
     ORDER BY a.code`,
    [ '1900-01-01', asOf ]
  );
  const assets = [];
  const liabilities = [];
  const equity = [];
  let incomeAllTime = 0;
  let expenseAllTime = 0;
  for (const row of result.rows) {
    const entry = {
      id: row.id,
      code: row.code,
      name: row.name,
      balance: Number(row.balance),
    };
    if (row.type === 'asset') assets.push(entry);
    else if (row.type === 'liability') liabilities.push(entry);
    else if (row.type === 'equity') equity.push(entry);
    else if (row.type === 'income') incomeAllTime += entry.balance;
    else expenseAllTime += entry.balance;
  }
  const totalAssets = assets.reduce((sum, row) => sum + row.balance, 0);
  const totalLiabilities = liabilities.reduce((sum, row) => sum + row.balance, 0);
  const totalEquity = equity.reduce((sum, row) => sum + row.balance, 0);
  const retainedEarnings = incomeAllTime - expenseAllTime;
  return {
    asOf,
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    retainedEarnings,
    // The accounting identity, verifiable by the client and the smoke test.
    balanced: totalAssets === totalLiabilities + totalEquity + retainedEarnings,
  };
}
