import { useState } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '../../client/src/auth/AuthContext.jsx';
import { setLanguage } from '../../client/src/i18n/index.js';
import CafeSalesPage from '../../client/src/pages/CafeSalesPage.jsx';
import AccountingReportsPage from '../../client/src/pages/AccountingReportsPage.jsx';
import AccountingJournalPage from '../../client/src/pages/AccountingJournalPage.jsx';

const mocks = vi.hoisted(() => ({
  products: vi.fn(), sales: vi.fn(), save: vi.fn(), void: vi.fn(),
  accounts: vi.fn(), journal: vi.fn(), trial: vi.fn(),
}));
vi.mock('../../client/src/api/cafe.js', () => ({ listCafeProducts: mocks.products }));
vi.mock('../../client/src/api/cafeSales.js', () => ({
  listCafeSales: mocks.sales, recordSale: mocks.save, voidSale: mocks.void,
  searchCafeStudents: vi.fn(),
}));
vi.mock('../../client/src/api/accountingJournal.js', () => ({
  listAccounts: mocks.accounts, listJournalEntries: mocks.journal,
  createJournalEntry: vi.fn(), postEntry: vi.fn(), voidEntry: vi.fn(),
}));
vi.mock('../../client/src/api/accountingReports.js', () => ({
  getTrialBalance: mocks.trial, getIncomeStatement: vi.fn(),
  getBalanceSheet: vi.fn(), getGeneralLedger: vi.fn(),
}));

function Navigation({ consumer }) {
  const [page, setPage] = useState('accounting');
  return <>
    <button onClick={() => setPage('pos')}>Audit POS route</button>
    <button onClick={() => setPage('accounting')}>Audit accounting route</button>
    {page === 'pos' ? <CafeSalesPage /> : consumer === 'report'
      ? <AccountingReportsPage /> : <AccountingJournalPage />}
  </>;
}

const clients = [];
beforeEach(() => { vi.resetAllMocks(); setLanguage('en'); });
afterEach(() => { vi.restoreAllMocks(); for (const client of clients.splice(0)) client.clear(); });

test.each([
  ['sale', 'report'], ['sale', 'journal'], ['void', 'report'], ['void', 'journal'],
])('%s refreshes the previously visited accounting %s', async (action, consumer) => {
  // Same freshness/window-focus settings as main.jsx. Render real producer and
  // consumer pages; replace only I/O. No implementation invalidation keys are
  // supplied to the intended-contract assertion.
  const client = new QueryClient({ defaultOptions: { queries: {
    staleTime: 30_000, gcTime: Infinity, retry: false, refetchOnWindowFocus: false,
  } } });
  clients.push(client);
  let posted = action === 'void';
  let voided = false;
  const sale = {
    id: 'audit-sale', customer: 'walk_in', soldAt: new Date().toISOString(),
    total: 100, items: [{ productName: 'Audit cache product', qty: 1 }],
  };
  mocks.products.mockResolvedValue([{ id: 'audit-product', name: 'Audit cache product', price: 100 }]);
  mocks.accounts.mockResolvedValue([]);
  mocks.sales.mockImplementation(async () => ({ sales: posted || voided
    ? [{ ...sale, voidedAt: voided ? new Date().toISOString() : null }] : [] }));
  mocks.save.mockImplementation(async () => { posted = true; return { sale }; });
  mocks.void.mockImplementation(async () => { posted = false; voided = true; return {}; });
  mocks.trial.mockImplementation(async () => ({
    accounts: [{ id: 'cash', code: '1100', name: 'Audit cash', debit: posted ? 200 : 100, credit: 0 }],
    totalDebit: posted ? 200 : 100, totalCredit: posted ? 200 : 100,
  }));
  mocks.journal.mockImplementation(async () => ({ entries: posted || voided ? [{
    id: 'audit-entry', entryNo: 101, entryDate: new Date().toISOString().slice(0, 10),
    memo: 'Audit cached sale entry', sourceType: 'sale', total: 100,
    status: posted ? 'posted' : 'voided', lines: [],
  }] : [] }));
  vi.spyOn(window, 'confirm').mockReturnValue(true);

  render(<QueryClientProvider client={client}>
    <AuthContext value={{ can: key => ['cafe.view', 'cafe.sell'].includes(key) }}>
      <Navigation consumer={consumer} />
    </AuthContext>
  </QueryClientProvider>);
  const queryFn = consumer === 'report' ? mocks.trial : mocks.journal;
  const readDisplay = () => consumer === 'report'
    ? document.querySelector('main tfoot td')?.textContent
    : document.querySelector('main tbody tr td:nth-child(6)')?.textContent ?? 'absent';
  const before = action === 'sale' ? (consumer === 'report' ? '100' : 'absent')
    : (consumer === 'report' ? '200' : 'Posted');
  const expected = action === 'sale' ? (consumer === 'report' ? '200' : 'Posted')
    : (consumer === 'report' ? '100' : 'Voided');
  await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await waitFor(() => expect(readDisplay()).toBe(before));
  fireEvent.click(screen.getByRole('button', { name: 'Audit POS route' }));
  if (action === 'sale') {
    fireEvent.click(await screen.findByRole('button', { name: 'Audit cache product 100' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record sale' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  } else {
    fireEvent.click(await screen.findByRole('button', { name: 'Void' }));
    await waitFor(() => expect(mocks.void).toHaveBeenCalledTimes(1));
  }
  await waitFor(() => expect(document.querySelector('.success[role="status"]')).not.toBeNull());
  await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));
  fireEvent.click(screen.getByRole('button', { name: 'Audit accounting route' }));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  const observed = readDisplay();
  const callsAfterReturn = queryFn.mock.calls.length;

  // A deliberate refresh is a passing control: the mock backing state changed,
  // and the unchanged consumer can display it. This does not mask the saved
  // before-refresh observation used by the regression assertion below.
  await act(async () => { await client.invalidateQueries(); });
  await waitFor(() => expect(readDisplay()).toBe(expected));
  console.log(JSON.stringify({ action, consumer, before, observed, expected,
    callsAfterReturn, refreshed: readDisplay(), refreshedCalls: queryFn.mock.calls.length }));
  expect(observed).toBe(expected);
});
