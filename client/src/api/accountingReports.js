import { request } from './http.js';

// Accounting reports, all over POSTED lines. Money is bigint Toman.

export async function getTrialBalance({ from, to }) {
  const query = new URLSearchParams({ from, to });
  return request(`/api/accounting/reports/trial-balance?${query}`);
}

export async function getGeneralLedger({ accountId, from, to }) {
  const query = new URLSearchParams({ accountId, from, to });
  return request(`/api/accounting/reports/ledger?${query}`);
}

export async function getIncomeStatement({ from, to }) {
  const query = new URLSearchParams({ from, to });
  return request(`/api/accounting/reports/income-statement?${query}`);
}

export async function getBalanceSheet({ asOf }) {
  return request(`/api/accounting/reports/balance-sheet?asOf=${encodeURIComponent(asOf)}`);
}
