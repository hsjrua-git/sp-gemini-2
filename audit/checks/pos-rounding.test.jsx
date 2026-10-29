import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '../../client/src/auth/AuthContext.jsx';
import { setLanguage } from '../../client/src/i18n/index.js';
import CafeSalesPage from '../../client/src/pages/CafeSalesPage.jsx';

const mocks = vi.hoisted(() => ({ products: vi.fn(), sales: vi.fn(), save: vi.fn() }));
vi.mock('../../client/src/api/cafe.js', () => ({ listCafeProducts: mocks.products }));
vi.mock('../../client/src/api/cafeSales.js', () => ({
  listCafeSales: mocks.sales, recordSale: mocks.save,
  searchCafeStudents: vi.fn(), voidSale: vi.fn(),
}));
const clients = [];
beforeEach(() => {
  vi.resetAllMocks();
  setLanguage('en');
  mocks.products.mockResolvedValue([
    { id: 'first', name: 'Audit First', price: 100 },
    { id: 'second', name: 'Audit Second', price: 100 },
  ]);
  mocks.sales.mockResolvedValue({ sales: [] });
});
afterEach(() => { for (const client of clients.splice(0)) client.clear(); });

test.each([
  ['whole-quantity control', ['1'], '100 Toman', ['100 Toman']],
  ['decimal half boundary', ['0.145'], '15 Toman', ['15 Toman']],
  ['round once after adding exact line amounts', ['0.005', '0.005'], '1 Toman', null],
])('POS quote agrees with whole-Toman sale contract: %s', async (label, quantities, expectedTotal, expectedLines) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  render(<QueryClientProvider client={client}>
    <AuthContext value={{ can: () => true }}><CafeSalesPage /></AuthContext>
  </QueryClientProvider>);
  const names = ['Audit First', 'Audit Second'];
  for (const [index, qty] of quantities.entries()) {
    fireEvent.click(await screen.findByRole('button', { name: `${names[index]} 100` }));
    fireEvent.change(screen.getByRole('textbox', { name: `Qty: ${names[index]}` }), { target: { value: qty } });
  }
  expect(screen.getByRole('button', { name: 'Record sale' })).toBeEnabled();
  const table = document.querySelector('form table');
  const total = table.querySelector('tfoot td').textContent.trim();
  const lineAmounts = [...table.querySelectorAll('tbody tr')].map(row => row.cells[3].textContent.trim());
  console.log(JSON.stringify({ label, quantities, total, lineAmounts }));
  // Fixed arithmetic examples are independent of the implementation. The API
  // sums numeric quantities × prices before casting the final sum to bigint.
  expect(total).toBe(expectedTotal);
  if (expectedLines) expect(lineAmounts).toEqual(expectedLines);
});
