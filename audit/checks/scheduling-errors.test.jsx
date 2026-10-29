import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '../../client/src/auth/AuthContext.jsx';
import { setLanguage } from '../../client/src/i18n/index.js';
import i18n from '../../client/src/i18n/index.js';
import SessionsPage from '../../client/src/pages/SessionsPage.jsx';
import SchedulePage from '../../client/src/pages/SchedulePage.jsx';

const io = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../client/src/api/http.js', () => ({ request: io.request }));
const session = { id: 'session-1', code: 'AUDIT-SESSION', sessionDate: '2026-10-22',
  plannedDate: '2026-10-22', canceledAt: null, archivedAt: null, movedTo: null,
  teacherName: 'Audit teacher', groupId: 'group-1', groupName: 'Audit group',
  periodSeq: 2, note: null, taskCount: 0 };
const assignment = { id: 'assignment-1', code: 'AUDIT-ASSIGNMENT', name: 'Archived assignment',
  teacherName: 'Audit teacher', groupId: 'group-1', groupName: 'Archived group',
  anchorDate: '2026-10-01', every: { days: 7 }, intervalName: 'Weekly',
  archivedAt: '2026-10-20T00:00:00Z' };
const clients = [];
function refused(status, code, message) {
  return Object.assign(new Error(message), { status, code, params: null, data: { code, error: message } });
}
beforeEach(() => {
  io.request.mockReset();
  io.request.mockImplementation(async (path, options = {}) => {
    if (path === '/api/sessions/session-1') {
      expect(options.method).toBe('PATCH');
      expect(JSON.parse(options.body).canceled).toBe(true);
      // Exact live route refusal, observed through both quick cancel and Edit.
      throw refused(409, 'SESSIONS_HAS_EVALUATIONS', 'Archive or remove the active evaluation cells before canceling this session.');
    }
    if (path === '/api/assignments/assignment-1') {
      expect(options.method).toBe('PATCH');
      expect(JSON.parse(options.body)).toEqual({ archived: false });
      throw refused(400, 'ASSIGNMENTS_GROUP_INACTIVE', 'Choose an active group.');
    }
    if (path.startsWith('/api/sessions?')) return { sessions: [session], truncated: false };
    if (path.startsWith('/api/assignments')) return { assignments: path.includes('includeArchived=1') ? [assignment] : [] };
    if (path.startsWith('/api/teachers')) return { teachers: [] };
    if (path.startsWith('/api/groups')) return { groups: [] };
    if (path.startsWith('/api/intervals')) return { intervals: [] };
    if (path.startsWith('/api/task-templates')) return { templates: [] };
    if (path === '/api/alerts') return { alerts: [], truncated: false };
    throw new Error(`Unexpected request ${path}`);
  });
});
afterEach(() => { for (const client of clients.splice(0)) client.clear(); });

function mount(Page, language) {
  setLanguage(language);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><AuthContext value={{ can: () => true }}><Page /></AuthContext></QueryClientProvider>);
  return client;
}
async function settledRefusal(client, code, button) {
  await waitFor(() => {
    const mutations = client.getMutationCache().getAll();
    expect(mutations).toHaveLength(1);
    expect(mutations[0].state.status).toBe('error');
    expect(mutations[0].state.error.data.code).toBe(code);
    expect(button).toBeEnabled();
  });
}

test.each(['en', 'fa'])('quick cancel displays the refusal in %s', async language => {
  const client = mount(SessionsPage, language);
  const row = (await screen.findByText('AUDIT-SESSION')).closest('tr');
  const button = within(row).getByRole('button', { name: i18n.t('common:actions.cancel'), exact: true });
  fireEvent.click(button);
  await settledRefusal(client, 'SESSIONS_HAS_EVALUATIONS', button);
  console.log(JSON.stringify({ language, action: 'quick cancel', settled: '409', errors: [...document.querySelectorAll('main .error')].map(e => e.textContent) }));
  expect(await screen.findByText(i18n.t('errors:SESSIONS_HAS_EVALUATIONS'))).toBeVisible();
});

test.each(['en', 'fa'])('Edit cancellation control displays the same refusal in %s', async language => {
  const client = mount(SessionsPage, language);
  const row = (await screen.findByText('AUDIT-SESSION')).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: i18n.t('common:actions.edit'), exact: true }));
  fireEvent.click(within(document.querySelector('tbody form')).getByRole('checkbox', { name: i18n.t('admin:sessions.edit.canceled'), exact: true }));
  const button = screen.getByRole('button', { name: i18n.t('admin:sessions.edit.save'), exact: true });
  fireEvent.click(button);
  await settledRefusal(client, 'SESSIONS_HAS_EVALUATIONS', button);
  expect(await screen.findByText(i18n.t('errors:SESSIONS_HAS_EVALUATIONS'))).toBeVisible();
});

test.each(['en', 'fa'])('assignment restore displays its inactive-group refusal in %s', async language => {
  const client = mount(SchedulePage, language);
  fireEvent.click(screen.getByRole('checkbox', { name: i18n.t('admin:schedule.includeArchived') }));
  const row = (await screen.findByText('AUDIT-ASSIGNMENT')).closest('tr');
  const button = within(row).getByRole('button', { name: i18n.t('common:actions.restore'), exact: true });
  fireEvent.click(button);
  await settledRefusal(client, 'ASSIGNMENTS_GROUP_INACTIVE', button);
  console.log(JSON.stringify({ language, action: 'restore assignment', settled: '400', errors: [...document.querySelectorAll('main .error')].map(e => e.textContent) }));
  expect(await screen.findByText(i18n.t('errors:ASSIGNMENTS_GROUP_INACTIVE'))).toBeVisible();
});
