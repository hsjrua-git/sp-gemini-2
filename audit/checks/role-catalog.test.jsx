import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '../../client/src/auth/AuthContext.jsx';
import i18next, { setLanguage } from '../../client/src/i18n/index.js';
import ErrorBoundary from '../../client/src/components/ErrorBoundary.jsx';
import RolesPage from '../../client/src/pages/RolesPage.jsx';

const mocks = vi.hoisted(() => ({ catalog: vi.fn(), roles: vi.fn(), create: vi.fn(), update: vi.fn() }));
vi.mock('../../client/src/api/roles.js', () => ({
  fetchPermissionCatalog: mocks.catalog, listRoles: mocks.roles,
  createRole: mocks.create, updateRole: mocks.update, deleteRole: vi.fn(),
}));
const clients = [];
beforeEach(() => {
  vi.resetAllMocks();
  setLanguage('en');
  mocks.roles.mockResolvedValue([{ id: 'audit-role', name: 'Audit editor', description: '',
    isSystem: false, permissions: ['students.view'], userCount: 0 }]);
  mocks.catalog.mockResolvedValue({ permissions: [{ key: 'students.view', group: 'Students', label: 'View students' }], prerequisites: {} });
});
afterEach(() => { vi.restoreAllMocks(); for (const client of clients.splice(0)) client.clear(); });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><ErrorBoundary>
    <AuthContext value={{ can: key => key === 'roles.manage' }}><RolesPage /></AuthContext>
  </ErrorBoundary></QueryClientProvider>);
  return client;
}

test('successful catalog lets an existing role expose its selected permissions', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit', exact: true }));
  const checkbox = await screen.findByRole('checkbox');
  expect(checkbox.checked).toBe(true);
  expect(screen.getByDisplayValue('Audit editor')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: i18next.t('nav:errors.ui.title') })).toBeNull();
});

test.each(['new', 'edit'])('catalog failure is contained before %s editor activation', async mode => {
  mocks.catalog.mockRejectedValue(new Error('Synthetic catalog unavailable'));
  const errors = [];
  vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.map(String).join(' ')));
  const client = mount();
  await waitFor(() => expect(client.getQueryState(['role-catalog'])?.status).toBe('error'));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  // Permit either disabling the editor or replacing the page with its load-error
  // state. Activate it only if it remains available after the query has settled.
  const name = mode === 'new' ? i18next.t('admin:roles.newRole') : 'Edit';
  const button = screen.queryByRole('button', { name, exact: true });
  if (button && !button.disabled) fireEvent.click(button);
  const crashed = screen.queryByRole('heading', { name: i18next.t('nav:errors.ui.title') }) !== null;
  console.log(JSON.stringify({ mode, queryStatus: client.getQueryState(['role-catalog'])?.status,
    editorEnabled: !!button && !button.disabled, crashed,
    errors: errors.filter(message => message.includes('permissions') || message.includes('Unhandled error')) }));
  expect(crashed).toBe(false);
  expect(screen.getByText('Synthetic catalog unavailable')).toBeTruthy();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
});
