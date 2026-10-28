// The four accounting reports, all pure aggregates over POSTED lines.
// Sign conventions: asset/expense increase with DEBITS; liability/equity/
// income increase with CREDITS. Money stays whole Toman (numbers, converted
// from bigint).
import { moneyNumber, sumMoney } from './money.js';

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
    debit: moneyNumber(row.debit, 'Trial-balance debit'),
    credit: moneyNumber(row.credit, 'Trial-balance credit'),
  }));
  return {
    range: { from, to },
    accounts: rows,
    totalDebit: sumMoney(rows.map((row) => row.debit), 'Trial-balance debit total'),
    totalCredit: sumMoney(rows.map((row) => row.credit), 'Trial-balance credit total'),
  };
}

export async function generalLedger(db, { accountId, from, to }) {
  const result = await db.query(
    `SELECT e.entry_no AS "entryNo",
            e.entry_date AS "entryDate",
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
  let running = 0n;
  const lines = result.rows.map((row) => {
    const debit = moneyNumber(row.debit, 'Ledger debit');
    const credit = moneyNumber(row.credit, 'Ledger credit');
    running += BigInt(direction) * (BigInt(debit) - BigInt(credit));
    return {
      entryNo: Number(row.entryNo),
      entryDate: row.entryDate,
      entryMemo: row.entryMemo,
      status: row.status,
      debit,
      credit,
      lineMemo: row.lineMemo,
      balance: moneyNumber(running, 'Ledger running balance'),
    };
  });
  return {
    account: account.rows[0],
    range: { from, to },
    lines,
    closingBalance: moneyNumber(running, 'Ledger closing balance'),
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
      AND e.source_type IS DISTINCT FROM 'closing'
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
      balance: moneyNumber(row.balance, 'Income-statement balance'),
    };
    if (row.type === 'income') income.push(entry);
    else expense.push(entry);
  }
  const totalIncome = sumMoney(income.map((row) => row.balance), 'Total income');
  const totalExpense = sumMoney(expense.map((row) => row.balance), 'Total expense');
  return {
    range: { from, to },
    income,
    expense,
    totalIncome,
    totalExpense,
    netProfit: sumMoney([totalIncome, -totalExpense], 'Net profit'),
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
      balance: moneyNumber(row.balance, 'Balance-sheet account balance'),
    };
    if (row.type === 'asset') assets.push(entry);
    else if (row.type === 'liability') liabilities.push(entry);
    else if (row.type === 'equity') equity.push(entry);
    else if (row.type === 'income') {
      incomeAllTime = sumMoney([incomeAllTime, entry.balance], 'All-time income');
    } else {
      expenseAllTime = sumMoney([expenseAllTime, entry.balance], 'All-time expense');
    }
  }
  const totalAssets = sumMoney(assets.map((row) => row.balance), 'Total assets');
  const totalLiabilities = sumMoney(
    liabilities.map((row) => row.balance),
    'Total liabilities'
  );
  const totalEquity = sumMoney(equity.map((row) => row.balance), 'Total equity');
  const retainedEarnings = sumMoney(
    [incomeAllTime, -expenseAllTime],
    'Retained earnings'
  );
  const rightSide = sumMoney(
    [totalLiabilities, totalEquity, retainedEarnings],
    'Balance-sheet right side'
  );
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
    balanced: totalAssets === rightSide,
  };
}
