import { useTranslation } from 'react-i18next';
import { includesTabular } from '../lib/exportConfig.js';
import { cubeLongRows, cubeWideRows } from '../lib/exports.js';
import TrendChart from './TrendChart.jsx';
import DistributionChart from './DistributionChart.jsx';
import ComparisonChart from './ComparisonChart.jsx';
import HeatmapMatrix from './HeatmapMatrix.jsx';

const PREVIEW_ROWS = 8;

// One chart, chosen by kind. Rendered into the visible preview (not hidden) so
// the Export run can read its final, measured <svg> for image export.
function ChartView({ cube, chart }) {
  switch (chart.kind) {
    case 'trend':
      return <TrendChart cube={cube} parameterIds={chart.parameterIds} />;
    case 'distribution':
      return (
        <DistributionChart
          cube={cube}
          parameterId={chart.parameterIds[0] ?? null}
          periodNumber={chart.periodNumber}
        />
      );
    case 'comparison':
      return (
        <ComparisonChart
          cube={cube}
          parameterIds={chart.parameterIds}
          shape={chart.comparisonShape}
        />
      );
    case 'heatmap':
      return (
        <HeatmapMatrix
          cube={cube}
          axis={chart.heatmapAxis}
          parameterId={chart.parameterIds[0] ?? null}
          periodNumber={chart.periodNumber}
        />
      );
    default:
      return null;
  }
}

// A bounded table taken from a 2-D row array (first row is the header).
function PreviewTable({ rows }) {
  const { t } = useTranslation(['reports', 'common']);
  if (rows.length <= 1) {
    return <p className="hint">{t('exportPreview.noRows')}</p>;
  }
  const [header, ...body] = rows;
  const shown = body.slice(0, PREVIEW_ROWS);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {header.map((cell, index) => (
              <th key={index}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell === null ? '—' : String(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {body.length > shown.length && (
        <p className="hint">
          {t('exportPreview.moreRows', { count: body.length - shown.length })}
        </p>
      )}
    </div>
  );
}

// The right-hand column: a summary of the resolved scope, a bounded table
// preview of the scores, and the live chart(s). `registerChart(index, node)`
// hands each chart's container back to the page so the run can grab its <svg>.
function ExportPreview({ config, cube, registerChart }) {
  const { t } = useTranslation(['reports', 'common']);
  const dataRows =
    config.layout === 'long' ? cubeLongRows(cube) : cubeWideRows(cube);

  return (
    <div className="export-preview">
      <p className="summary-line">
        {t('exportPreview.counts', {
          students: cube.students.length,
          parameters: cube.parameters.length,
          periods: cube.periods.length,
        })}
      </p>

      {includesTabular(config) && config.include.data && (
        <section className="section-card">
          <h3 className="group-title">{t('exportPreview.scoresTitle')}</h3>
          <PreviewTable rows={dataRows} />
        </section>
      )}

      {config.charts.map((chart, index) => (
        <section className="section-card" key={index}>
          <h3 className="group-title">
            {t(`charts.kind.${chart.kind}`)} · {chart.imageFormat.toUpperCase()}
          </h3>
          <div
            className="chart-capture"
            ref={(node) => registerChart(index, node)}
          >
            <ChartView cube={cube} chart={chart} />
          </div>
        </section>
      ))}

      {config.charts.length === 0 && !includesTabular(config) && (
        <p className="hint">{t('exportPreview.nothingSelected')}</p>
      )}
    </div>
  );
}

export default ExportPreview;
