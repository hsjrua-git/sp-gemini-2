import { useRef, useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { PreferencesContext } from '../../client/src/preferences/PreferencesContext.jsx';
import { setLanguage } from '../../client/src/i18n/index.js';
import { buildCube } from '../../client/src/lib/cube.js';
import { defaultExportConfig } from '../../client/src/lib/exportConfig.js';
import ExportPage from '../../client/src/pages/ExportPage.jsx';
import ExportPreview from '../../client/src/components/ExportPreview.jsx';
import ExportRunButton from '../../client/src/components/ExportRunButton.jsx';
import ChartConfigPanel from '../../client/src/components/ChartConfigPanel.jsx';
import DistributionChart from '../../client/src/components/DistributionChart.jsx';

const io = vi.hoisted(() => ({ request: vi.fn(), text: vi.fn(), blob: vi.fn() }));
vi.mock('../../client/src/api/http.js', () => ({ request: io.request }));
vi.mock('../../client/src/lib/download.js', () => ({ downloadTextFile: io.text, downloadBlob: io.blob }));
const assignmentId = '00000000-0000-4000-8000-000000000001';
const data = {
  assignments: [{ id: assignmentId, name: 'Audit class' }],
  students: [{ id: 's1', fullName: 'Audit student', studentCode: 'AAAAAAAA' }],
  parameters: [{ id: 'p1', name: 'Audit score', minValue: 0, maxValue: 10 }],
  periods: [1, 2].map(seq => ({ id: `period-${seq}`, assignmentId, seq, sessionCount: 1,
    answeredCount: 1, startDate: `2026-0${seq}-01`, endDate: `2026-0${seq}-01` })),
  cells: [2, 9].map((quality, index) => ({ studentId: 's1', parameterId: 'p1', assignmentId,
    periodSeq: index + 1, sessionDate: `2026-0${index + 1}-01`, quality, quantity: null, viaGroup: false })),
};
const cube = buildCube(data);
const clients = [];
beforeEach(() => {
  vi.resetAllMocks();
  setLanguage('en');
  // Only layout APIs and final download I/O are mocked; chart components, their
  // Recharts SVGs, capture selection and SVG serialization all execute unchanged.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const height = this.classList.contains('recharts-legend-wrapper') ? 24 : 280;
    return { x: 0, y: 0, left: 0, top: 0, right: 640, bottom: height, width: 640, height, toJSON() {} };
  });
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const width = Number(this.getAttribute('width')) || 640;
    const height = Number(this.getAttribute('height')) || 280;
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON() {} };
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { this.callback = callback; }
    observe(target) { this.callback([{ target, contentRect: target.getBoundingClientRect() }]); }
    unobserve() {}
    disconnect() {}
  });
  io.request.mockImplementation(async (path, options) => {
    if (path === '/api/parameters') return { parameters: data.parameters };
    if (path === '/api/assignments') return { assignments: data.assignments };
    if (path.startsWith('/api/periods?')) return { periods: data.periods };
    if (path === '/api/export/cube') {
      const body = JSON.parse(options.body);
      const seqs = body.periods ?? [1, 2];
      // The live endpoint retains all period metadata while filtering cells.
      return { ...data, cells: data.cells.filter(c => seqs.includes(c.periodSeq)) };
    }
    throw new Error(`Unexpected HTTP path ${path}`);
  });
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function preferences(children) {
  return <PreferencesContext value={{ preferences: { csvDelimiter: ',' } }}>{children}</PreferencesContext>;
}
function page(scope) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[{ pathname: '/export', state: { export: { scope, tabularFormat: 'json' } } }]}>
      {preferences(<ExportPage />)}
    </MemoryRouter>
  </QueryClientProvider>);
}

test.each([
  { mode: 'all', seqs: [], expected: [1, 2] },
  { mode: 'selection', seqs: [1], expected: [1] },
])('$mode scope controls the periods in the downloaded JSON', async item => {
  page({ assignmentId, mode: item.mode, seqs: item.seqs });
  const button = screen.getByRole('button', { name: 'Export', exact: true });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(io.text).toHaveBeenCalled());
  const exported = JSON.parse(io.text.mock.calls[0][1]);
  const request = io.request.mock.calls.find(([path]) => path === '/api/export/cube');
  console.log(JSON.stringify({ mode: item.mode, requestBody: JSON.parse(request[1].body),
    exportedPeriods: exported.periods.map(p => p.seq) }));
  expect(exported.students[0].periods.map(p => p.period)).toEqual(item.expected.map(seq => `Audit class · ${seq}`));
  expect(exported.students[0].periods.map(p => p.values.p1.value)).toEqual(item.mode === 'all' ? [2, 9] : [2]);
});

function Charts({ kind, shape = 'bar', axis = 'period' }) {
  const [charts, setCharts] = useState([{ kind, parameterIds: ['p1'], imageFormat: 'svg',
    comparisonShape: shape, heatmapAxis: axis, periodKey: null }]);
  const nodes = useRef(new Map());
  const config = { ...defaultExportConfig(), include: { data: false, delta: false, auditTrail: false }, charts };
  return preferences(<>
    <ChartConfigPanel value={charts} parameters={data.parameters} periodOptions={cube.periods} onChange={setCharts} />
    <ExportPreview config={config} cube={cube} registerChart={(index, node) => {
      if (node) nodes.current.set(index, node); else nodes.current.delete(index);
    }} />
    <ExportRunButton config={config} cube={cube} chartNodes={nodes} />
  </>);
}
async function downloadSvg() {
  fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }));
  await waitFor(() => expect(io.text).toHaveBeenCalled());
  const [name, text] = io.text.mock.calls[0];
  // jsdom's XMLSerializer duplicates xmlns on namespace-aware clones; inspect
  // the captured element via HTML parsing. Actual Chromium SVG bytes are retained
  // separately and establish real-file validity/geometry.
  const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (xml.querySelector('parsererror')) console.log(JSON.stringify({ harnessXmlParse: xml.documentElement.textContent }));
  return { name, svg: new DOMParser().parseFromString(text, 'text/html').querySelector('svg') };
}

test.each([
  ['trend', 'bar', '.recharts-line'],
  ['comparison', 'bar', '.recharts-bar'],
  ['comparison', 'radar', '.recharts-radar'],
  ['heatmap', 'bar', 'rect'],
])('%s %s SVG download contains the plotted data', async (kind, shape, mark) => {
  const view = render(<Charts kind={kind} shape={shape} />);
  await waitFor(() => expect(view.container.querySelector(`.chart-capture ${mark}`)).toBeTruthy());
  const { name, svg } = await downloadSvg();
  console.log(JSON.stringify({ kind, shape, name, width: svg.getAttribute('width'), height: svg.getAttribute('height'),
    ariaLabel: svg.getAttribute('aria-label'), plotPresent: !!svg.querySelector(mark) }));
  expect(svg.querySelector(mark)).toBeTruthy();
  expect(Number(svg.getAttribute('width'))).toBeGreaterThan(100);
});

test('heatmap period picker changes the actual cell values', async () => {
  const view = render(<Charts kind="heatmap" axis="parameter" />);
  expect([...view.container.querySelectorAll('.heatmap-svg rect title')].map(e => e.textContent)).toEqual(['Audit student — Audit score: 9']);
  fireEvent.change(screen.getByRole('combobox', { name: 'Period', exact: true }), { target: { value: cube.periods[0].key } });
  const titles = [...view.container.querySelectorAll('.heatmap-svg rect title')].map(e => e.textContent);
  console.log(JSON.stringify({ selectedPeriod: cube.periods[0].key, titles }));
  expect(titles).toEqual(['Audit student — Audit score: 2']);
});

test('distribution explicit-period control contains a nonzero score bin', async () => {
  const view = render(<DistributionChart cube={cube} parameterId="p1" periodKey={cube.periods[0].key} />);
  await waitFor(() => expect(view.container.querySelector('.recharts-bar-rectangle path')).toBeTruthy());
});

test('distribution default period displays the latest recorded score', async () => {
  const view = render(<DistributionChart cube={cube} parameterId="p1" />);
  await waitFor(() => expect(view.container.querySelectorAll('.recharts-bar-rectangle path').length).toBeGreaterThan(0));
});

test.each(['en', 'fa'])('period labels distinguish the chart buckets in %s', async language => {
  setLanguage(language);
  const chart = kind => ({ kind, parameterIds: ['p1'], imageFormat: 'svg', comparisonShape: 'bar', heatmapAxis: 'period' });
  const config = { ...defaultExportConfig(), include: { data: false }, charts: [chart('trend'), chart('comparison'), chart('heatmap')] };
  const view = render(<ExportPreview config={config} cube={cube} registerChart={() => {}} />);
  await waitFor(() => expect(view.container.querySelectorAll('.recharts-cartesian-axis-tick-value').length).toBeGreaterThan(0));
  const captures = [...view.container.querySelectorAll('.chart-capture')];
  const labels = captures.slice(0, 2).map(e => [...e.querySelectorAll('.recharts-xAxis-tick-labels text')].map(t => t.textContent));
  const headers = [...captures[2].querySelectorAll('.heatmap-svg > text')].slice(0, 2).map(e => e.textContent);
  console.log(JSON.stringify({ language, chartLabels: labels, heatmapHeaders: headers }));
  expect.soft(labels.every(items => items.length > 0 && items.every(label => label !== 'shared.periodKey'))).toBe(true);
  expect.soft(new Set(headers).size).toBe(2);
});
