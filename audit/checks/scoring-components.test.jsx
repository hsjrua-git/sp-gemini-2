import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { AuthContext } from '../../client/src/auth/AuthContext.jsx';
import { PreferencesContext } from '../../client/src/preferences/PreferencesContext.jsx';
import { setLanguage } from '../../client/src/i18n/index.js';
import EvaluatePage from '../../client/src/pages/EvaluatePage.jsx';
import ImportScoresPage from '../../client/src/pages/ImportScoresPage.jsx';
import ErrorBoundary from '../../client/src/components/ErrorBoundary.jsx';
import { previewCells, previewCounts } from '../../server/src/lib/scorePreview.js';

const mocks = vi.hoisted(() => ({
  assignments: vi.fn(), sessions: vi.fn(), members: vi.fn(), parameters: vi.fn(),
  evaluations: vi.fn(), save: vi.fn(), students: vi.fn(),
}));
vi.mock('../../client/src/api/schedule.js', () => ({ listAssignments: mocks.assignments }));
vi.mock('../../client/src/api/sessions.js', () => ({ listSessions: mocks.sessions }));
vi.mock('../../client/src/api/groups.js', () => ({ listGroupMembers: mocks.members }));
vi.mock('../../client/src/api/parameters.js', () => ({ listParameters: mocks.parameters }));
vi.mock('../../client/src/api/evaluations.js', () => ({ listEvaluations: mocks.evaluations, saveEvaluations: mocks.save }));
vi.mock('../../client/src/api/students.js', () => ({ fetchAllStudents: mocks.students }));

const student = { id: 'student', membershipId: 'membership', fullName: 'Audit Student',
  studentCode: 'ABCD2345', joinedOn: '2020-01-01', leftOn: null };
const parameter = { id: 'parameter', name: 'Speed', minValue: 0, maxValue: 100 };
const session = { id: 'session', seq: 1, sessionDate: '2026-10-29', canceledAt: null, archivedAt: null };
const clients = [];

beforeEach(() => {
  vi.resetAllMocks();
  setLanguage('en');
  mocks.parameters.mockResolvedValue([parameter]);
  mocks.sessions.mockResolvedValue({ sessions: [session] });
  mocks.members.mockResolvedValue([student]);
  mocks.students.mockResolvedValue([student]);
  mocks.evaluations.mockResolvedValue([]);
});
afterEach(() => { for (const client of clients.splice(0)) client.clear(); });

function mount(Page, { individual = false, blind = false } = {}) {
  mocks.assignments.mockResolvedValue([{ id: 'assignment', name: 'Audit Assignment',
    groupId: individual ? null : 'group', groupName: 'Audit Group',
    membershipId: individual ? student.membershipId : null,
    studentId: individual ? student.id : null, studentName: individual ? student.fullName : null }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const permissions = ['scores.enter', 'students.view', 'parameters.view', 'data.import',
    ...(!blind ? ['scores.view'] : [])];
  render(<QueryClientProvider client={client}><MemoryRouter>
    <AuthContext value={{ can: key => permissions.includes(key) }}>
      <PreferencesContext value={{ preferences: { csvDelimiter: ',' } }}>
        <ErrorBoundary><Page /></ErrorBoundary>
      </PreferencesContext>
    </AuthContext>
  </MemoryRouter></QueryClientProvider>);
  return client;
}

test.each([
  ['sighted group control', { individual: false, blind: false }],
  ['individual assignment', { individual: true, blind: false }],
  ['blind group entry', { individual: false, blind: true }],
])('score inputs become usable after required data settles: %s', async (label, mode) => {
  const client = mount(EvaluatePage, mode);
  await waitFor(() => {
    expect(client.getQueryData(['sessions', { assignmentId: 'assignment' }])).toBeDefined();
    expect(client.getQueryData(['parameters'])).toHaveLength(1);
    if (!mode.individual) expect(client.getQueryData(['group-members', 'group'])).toHaveLength(1);
    if (!mode.blind) expect(client.getQueryData(['evaluations', { sessionId: 'session' }])).toEqual([]);
    expect(client.isFetching()).toBe(0);
  });
  if (mode.blind) expect(mocks.evaluations).not.toHaveBeenCalled();
  if (mode.individual) expect(mocks.members).not.toHaveBeenCalled();
  console.log(JSON.stringify({ label, queries: client.getQueryCache().getAll().map(q => ({
    key: q.queryKey, status: q.state.status, fetchStatus: q.state.fetchStatus,
  })) }));
  const checkbox = await screen.findByRole('checkbox', { name: /Speed.*Audit Student/ });
  fireEvent.click(checkbox);
  const quality = screen.getByRole('textbox', { name: /Quality.*Speed.*Audit Student/ });
  expect(quality).toBeEnabled();
  fireEvent.change(quality, { target: { value: '77' } });
  expect(quality).toHaveValue('77');
});

test('score-import preview renders each dimension from the real server preview shape', async () => {
  mocks.save.mockImplementation(async ({ entries, dryRun }) => {
    expect(dryRun).toBe(true);
    const cells = previewCells({ entries, existing: new Map(), problemIndexes: new Set() });
    return { dryRun: true, cells, problems: [], counts: previewCounts(cells, []) };
  });
  const client = mount(ImportScoresPage);
  await waitFor(() => {
    expect(client.getQueryData(['group-members', 'group'])).toHaveLength(1);
    expect(client.getQueryData(['sessions', { assignmentId: 'assignment' }])).toBeDefined();
  });
  const input = document.querySelector('input[type="file"]');
  // JSDOM's File lacks text(); supply only the browser File interface this
  // handler uses. PapaParse, mapping, Query, preview builder and page are real.
  const csv = 'Student code,Speed (quality),Speed (quantity)\nABCD2345,77,66\n';
  fireEvent.change(input, { target: { files: [{ name: 'scores.csv', size: csv.length,
    text: async () => csv }] } });
  const check = await screen.findByRole('button', { name: 'Check file' });
  await waitFor(() => expect(check).toBeEnabled());
  fireEvent.click(check);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(await screen.findByRole('button', { name: /Import 1/ })).toBeEnabled();
  expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  expect(document.querySelector('tbody').textContent).toContain('77');
  expect(document.querySelector('tbody').textContent).toContain('66');
});
