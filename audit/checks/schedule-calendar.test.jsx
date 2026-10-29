import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '../../client/src/auth/AuthContext.jsx';
import { setLanguage } from '../../client/src/i18n/index.js';
import { formatIsoDate } from '../../client/src/lib/format.js';
import SchedulePage from '../../client/src/pages/SchedulePage.jsx';
import cases from './schedule-calendar-cases.mjs';

const mocks = vi.hoisted(() => ({ assignments: vi.fn() }));
vi.mock('../../client/src/api/schedule.js', () => ({
  listAssignments: mocks.assignments, listIntervals: vi.fn(async () => []),
  archiveAssignment: vi.fn(), archiveInterval: vi.fn(), createAssignment: vi.fn(),
  createInterval: vi.fn(), listStudentMemberships: vi.fn(), updateAssignment: vi.fn(), updateInterval: vi.fn(),
}));
const clients = [];
afterEach(() => { vi.useRealTimers(); for (const client of clients.splice(0)) client.clear(); });

test.each(cases)('$name: schedule next date matches anchored calendar', async item => {
  setLanguage('en');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${item.today}T12:00:00`));
  mocks.assignments.mockResolvedValue([{ id: 'audit-assignment', code: 'AUD-001', name: item.name,
    teacherName: 'Audit teacher', groupId: 'audit-group', groupName: 'Audit group',
    anchorDate: item.anchor, every: item.every, intervalName: item.sqlInterval, archivedAt: null }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  render(<QueryClientProvider client={client}>
    <AuthContext value={{ can: key => key === 'schedule.view' }}><SchedulePage /></AuthContext>
  </QueryClientProvider>);
  const row = (await screen.findByText('AUD-001')).closest('tr');
  const shown = row.querySelectorAll('td')[6].textContent;
  console.log(JSON.stringify({ name: item.name, today: item.today, anchor: item.anchor,
    expectedIso: item.expected, expectedDisplay: formatIsoDate(item.expected), shown }));
  expect(shown).toBe(formatIsoDate(item.expected));
});
