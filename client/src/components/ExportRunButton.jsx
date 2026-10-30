import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePreferences } from '../preferences/PreferencesContext.jsx';
import { errorMessage } from '../i18n/errors.js';
import { toCsv } from '../lib/csv.js';
import { downloadBlob, downloadTextFile } from '../lib/download.js';
import { buildWorkbookBlob } from '../lib/xlsx.js';
import { buildZipBlob } from '../lib/bundle.js';
import { canExportPng, svgToPng, svgToString } from '../lib/chartImage.js';
import {
  auditTrailRows,
  cubeJson,
  cubeLongRows,
  cubeWideRows,
  deltaRows,
} from '../lib/exports.js';

// Each selected content type is one artifact; charts add one image each. One
// artifact downloads directly, several are zipped so the chart lands beside the
// data in a single file. XLSX is the exception: all tabular content goes into
// one multi-sheet workbook (still one artifact for bundling purposes).
const TABULAR = [
  { key: 'data', name: 'scores', sheet: 'Scores' },
  { key: 'delta', name: 'changes-vs-previous', sheet: 'Changes' },
  { key: 'auditTrail', name: 'audit-trail', sheet: 'Audit trail' },
];

// Turn a 2-D row array (header + body) into an array of header-keyed objects for
// JSON export of the non-cube content types.
function rowsToObjects(rows) {
  if (rows.length <= 1) return [];
  const [header, ...body] = rows;
  return body.map((row) => {
    const record = {};
    header.forEach((key, index) => {
      record[key] = row[index] ?? null;
    });
    return record;
  });
}

// The 2-D rows for each selected tabular content type, in a fixed order. Data
// is raw scores (delta is its own artifact, so the data file never doubles it).
function tabularRows(config, cube, auditEntries) {
  const out = [];
  for (const item of TABULAR) {
    if (!config.include[item.key]) continue;
    let rows;
    if (item.key === 'data') {
      rows = config.layout === 'long' ? cubeLongRows(cube) : cubeWideRows(cube);
    } else if (item.key === 'delta') {
      rows = deltaRows(cube);
    } else {
      rows = auditTrailRows(auditEntries);
    }
    out.push({ ...item, rows });
  }
  return out;
}

function ExportRunButton({
  config,
  cube,
  cubes,
  scope = null,
  auditEntries = [],
  chartNodes,
  disabled = false,
}) {
  const { t } = useTranslation(['reports', 'common']);
  const { preferences } = usePreferences();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  // One file per selected tabular content type — except XLSX, which folds them
  // all into a single multi-sheet workbook.
  async function tabularFiles() {
    const sources = cubes ?? [cube];
    const selected = sources.flatMap((source, index) => tabularRows({ ...config, include: { ...config.include, auditTrail: index === 0 && config.include.auditTrail } }, source, auditEntries)
      .map(item => ({ ...item, cube: source, name: `${item.name}-${source.dimension}`, sheet: `${item.sheet} ${source.dimension}` })));
    if (selected.length === 0) return [];

    if (config.tabularFormat === 'xlsx') {
      const blob = await buildWorkbookBlob(
        selected.map((item) => ({ name: item.sheet, rows: item.rows }))
      );
      return [{ name: 'export.xlsx', data: blob }];
    }

    if (config.tabularFormat === 'json') {
      return selected.map((item) => ({
        name: `${item.name}.json`,
        data: JSON.stringify(
          item.key === 'data' ? cubeJson(item.cube, { scope }) : rowsToObjects(item.rows),
          null,
          2
        ),
        type: 'application/json;charset=utf-8',
      }));
    }

    return selected.map((item) => ({
      name: `${item.name}.csv`,
      data: toCsv(item.rows, { delimiter: preferences.csvDelimiter }),
      type: 'text/csv;charset=utf-8',
    }));
  }

  // Each chart → one image, read from its <svg> in the visible preview. PNG when
  // the browser can raster (canvas → toBlob), otherwise a self-contained SVG.
  async function chartFiles() {
    const files = [];
    const surface =
      getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() ||
      '#ffffff';
    for (const source of cubes ?? [cube]) {
    for (let index = 0; index < config.charts.length; index += 1) {
      const chart = config.charts[index];
      const svg = chartNodes.current.get(cubes ? `${source.dimension}:${index}` : index)?.querySelector('svg[data-chart-root]');
      if (!svg) {
        throw new Error(t('exportRun.captureFailed', { index: index + 1 }));
      }
      const base = `chart-${index + 1}-${chart.kind}-${source.dimension}`;
      if (chart.imageFormat === 'png' && canExportPng()) {
        const blob = await svgToPng(svg, { scale: 2, background: surface });
        files.push({ name: `${base}.png`, data: blob, compressed: true });
      } else {
        files.push({
          name: `${base}.svg`,
          data: svgToString(svg),
          type: 'image/svg+xml;charset=utf-8',
        });
      }
    }
    }
    return files;
  }

  async function run() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const files = [...(await tabularFiles()), ...(await chartFiles())];
      if (files.length === 0) {
        setError(t('exportRun.nothing'));
        return;
      }
      if (files.length === 1) {
        const [file] = files;
        if (typeof file.data === 'string') {
          downloadTextFile(file.name, file.data, file.type);
        } else {
          downloadBlob(file.name, file.data);
        }
        setNote(t('exportRun.downloadedOne', { name: file.name }));
        return;
      }
      const zip = await buildZipBlob(files);
      downloadBlob('export.zip', zip);
      setNote(t('exportRun.downloadedZip', { count: files.length }));
    } catch (err) {
      setError(errorMessage(err) || t('exportRun.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="export-run">
      <button
        type="button"
        className="primary"
        onClick={run}
        disabled={disabled || busy}
      >
        {busy ? t('exportRun.preparing') : t('exportRun.button')}
      </button>
      {note && <span className="hint">{note}</span>}
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}

export default ExportRunButton;
