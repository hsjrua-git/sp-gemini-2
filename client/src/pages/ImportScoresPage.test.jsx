import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { AuthContext } from '../auth/AuthContext.jsx';
import { PreferencesContext } from '../preferences/PreferencesContext.jsx';
import { setLanguage } from '../i18n/index.js';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import ImportScoresPage from './ImportScoresPage.jsx';
import { previewCells, previewCounts } from '../../../server/src/lib/scorePreview.js';

const mocks = vi.hoisted(() => ({
  assignments: vi.fn(), sessions: vi.fn(), members: vi.fn(), parameters: vi.fn(),
  save: vi.fn(), students: vi.fn(),
}));
vi.mock('../api/schedule.js', () => ({ listAssignments: mocks.assignments }));
vi.mock('../api/sessions.js', () => ({ listSessions: mocks.sessions }));
vi.mock('../api/groups.js', () => ({ listGroupMembers: mocks.members }));
vi.mock('../api/parameters.js', () => ({ listParameters: mocks.parameters }));
vi.mock('../api/evaluations.js', () => ({ saveEvaluations: mocks.save }));
vi.mock('../api/students.js', () => ({ fetchAllStudents: mocks.students }));

const student = { id: 'student', membershipId: 'membership', fullName: 'Test Student',
  studentCode: 'ABCD2345', joinedOn: '2020-01-01', leftOn: null };
const existingCell = { selected: true, qualityValue: 7, quantityValue: 6, qualityComment: null, quantityComment: null };
const clients = [];
beforeEach(() => {
  vi.resetAllMocks();
  setLanguage('en');
  mocks.assignments.mockResolvedValue([{ id: 'assignment', name: 'Test Assignment', groupId: 'group' }]);
  mocks.sessions.mockResolvedValue({ sessions: [{ id: 'session', sessionDate: '2026-10-29' }] });
  mocks.parameters.mockResolvedValue([{ id: 'parameter', name: 'Speed', minValue: 0, maxValue: 100 }]);
  mocks.members.mockResolvedValue([student]);
  mocks.students.mockResolvedValue([student]);
});
afterEach(() => { for (const client of clients.splice(0)) client.clear(); });

test.each([
  { status: 'new', csvValues: '0,66', expected: ['0', '66'], canRun: true },
  { status: 'change', csvValues: '0,5', old: existingCell, expected: ['7 → 0', '6 → 5'], canRun: true },
  { status: 'unchanged', csvValues: '7,6', old: existingCell, expected: ['7', '6'], canRun: false },
  { status: 'save', csvValues: '0,5', old: existingCell, blind: true, expected: ['0', '5'], canRun: true },
  { status: 'locked', csvValues: '0,5', old: { ...existingCell, isLocked: true }, expected: ['7 → 0', '6 → 5'], canRun: false },
  { status: 'locked', csvValues: '0,5', old: { ...existingCell, isLocked: true }, blind: true, expected: ['— → 0', '— → 5'], canRun: false },
  { status: 'new', csvValues: ',5', expected: ['—', '5'], canRun: true },
])('renders scalar dimensions for $status (blind=$blind, values=$csvValues)', async (scenario) => {
  mocks.save.mockImplementation(async ({ entries, dryRun }) => {
    if (!dryRun) return { changed: 1 };
    const existing = new Map(scenario.old ? [['membership:parameter', scenario.old]] : []);
    const cells = previewCells({ entries, existing, problemIndexes: new Set(), canViewScores: !scenario.blind });
    expect(cells[0].status).toBe(scenario.status);
    return { dryRun: true, redacted: !!scenario.blind, cells, problems: [], counts: previewCounts(cells, []) };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter>
    <AuthContext value={{ can: key => key === 'scores.enter' || (!scenario.blind && key === 'scores.view') }}>
      <PreferencesContext value={{ preferences: { csvDelimiter: ',' } }}>
        <ErrorBoundary><ImportScoresPage /></ErrorBoundary>
      </PreferencesContext>
    </AuthContext>
  </MemoryRouter></QueryClientProvider>);
  const input = await screen.findByLabelText('Choose a CSV file of scores to import');
  const csv = `Student code,Speed (quality),Speed (quantity)\nABCD2345,${scenario.csvValues}\n`;
  fireEvent.change(input, { target: { files: [{ name: 'scores.csv', size: csv.length, text: async () => csv }] } });
  const check = await screen.findByRole('button', { name: 'Check file' });
  await waitFor(() => expect(check).toBeEnabled());
  fireEvent.click(check);
  const importButton = await screen.findByRole('button', { name: /^Import \d/ });
  expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  const row = screen.getByRole('row', { name: /Test Student/ });
  const cells = within(row).getAllByRole('cell').slice(2);
  expect(cells).toHaveLength(2);
  scenario.expected.forEach((text, index) => expect(cells[index]).toHaveTextContent(text));
  expect(row.textContent).not.toContain('[object Object]');
  if (scenario.blind) {
    expect(cells[0].textContent).not.toContain('7');
    expect(cells[1].textContent).not.toContain('6');
  }
  if (scenario.canRun) {
    expect(importButton).toBeEnabled();
    fireEvent.click(importButton);
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1][0]).toMatchObject({ sessionId: 'session', source: 'import', entries: mocks.save.mock.calls[0][0].entries });
  } else {
    expect(importButton).toBeDisabled();
    expect(mocks.save).toHaveBeenCalledOnce();
  }
});
