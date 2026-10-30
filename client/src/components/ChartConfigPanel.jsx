import { useTranslation } from 'react-i18next';
import {
  CHART_KINDS,
  COMPARISON_SHAPES,
  HEATMAP_AXES,
  IMAGE_FORMATS,
  MAX_CHARTS,
} from '../lib/exportConfig.js';
import TreePicker from './TreePicker.jsx';

function newChart(kind = 'trend') {
  return {
    kind,
    parameterIds: [],
    periodKey: null,
    comparisonShape: 'bar',
    heatmapAxis: 'period',
    imageFormat: 'png',
  };
}

// A compact multi-select for parameters, used by the trend/comparison charts.
function ParameterChecklist({ chosen, parameters, onChange }) {
  const { t } = useTranslation(['reports', 'common']);
  return <TreePicker label={t('shared.parameter')} items={parameters} value={chosen} onChange={onChange} includeBranch />;
}

function ChartEditor({ chart, parameters, periodOptions, onChange, onRemove }) {
  const { t } = useTranslation(['reports', 'common']);
  function patch(changes) {
    onChange({ ...chart, ...changes });
  }

  return (
    <div className="section-card chart-editor">
      <div className="toolbar">
        <label className="inline">
          {t('charts.chartLabel')}
          <select value={chart.kind} onChange={(event) => patch({ kind: event.target.value })}>
            {CHART_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`charts.kind.${kind}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="inline">
          {t('charts.imageLabel')}
          <select
            value={chart.imageFormat}
            onChange={(event) => patch({ imageFormat: event.target.value })}
          >
            {IMAGE_FORMATS.map((format) => (
              <option key={format} value={format}>
                {format.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="quiet" onClick={onRemove}>
          {t('charts.remove')}
        </button>
      </div>

      {(chart.kind === 'trend' || chart.kind === 'comparison') && (
        <>
          <p className="hint">{t('charts.paramsToPlot')}</p>
          <ParameterChecklist
            chosen={chart.parameterIds}
            parameters={parameters}
            onChange={(parameterIds) => patch({ parameterIds })}
          />
        </>
      )}

      {chart.kind === 'comparison' && (
        <label className="inline">
          {t('charts.shapeLabel')}
          <select
            value={chart.comparisonShape}
            onChange={(event) => patch({ comparisonShape: event.target.value })}
          >
            {COMPARISON_SHAPES.map((shape) => (
              <option key={shape} value={shape}>
                {t(`charts.shape.${shape}`)}
              </option>
            ))}
          </select>
        </label>
      )}

      {chart.kind === 'distribution' && (
        <>
          <label className="inline">
            {t('shared.parameter')}
            <select
              value={chart.parameterIds[0] ?? ''}
              onChange={(event) => patch({ parameterIds: event.target.value ? [event.target.value] : [] })}
            >
              <option value="">{t('charts.chooseParameterPlaceholder')}</option>
              {parameters.map((parameter) => (
                <option key={parameter.id} value={parameter.id}>
                  {parameter.path || parameter.name}
                </option>
              ))}
            </select>
          </label>
          <label className="inline">
            {t('shared.period')}
            <select
              value={chart.periodKey ?? periodOptions[periodOptions.length - 1]?.key ?? ''}
              onChange={(event) => patch({ periodKey: event.target.value })}
            >
              {periodOptions.map((period) => (
                <option key={period.key} value={period.key}>
                  {period.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {chart.kind === 'heatmap' && (
        <>
          <label className="inline">
            {t('charts.layoutLabel')}
            <select
              value={chart.heatmapAxis}
              onChange={(event) => patch({ heatmapAxis: event.target.value })}
            >
              {HEATMAP_AXES.map((axis) => (
                <option key={axis} value={axis}>
                  {t(`charts.axis.${axis}`)}
                </option>
              ))}
            </select>
          </label>
          {chart.heatmapAxis === 'period' && (
            <label className="inline">
              {t('shared.parameter')}
              <select
                value={chart.parameterIds[0] ?? ''}
                onChange={(event) => patch({ parameterIds: event.target.value ? [event.target.value] : [] })}
              >
                <option value="">{t('charts.firstAvailable')}</option>
                {parameters.map((parameter) => (
                  <option key={parameter.id} value={parameter.id}>
                    {parameter.path || parameter.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {chart.heatmapAxis === 'parameter' && (
            <label className="inline">
              {t('shared.period')}
              <select
                value={chart.periodKey ?? periodOptions[periodOptions.length - 1]?.key ?? ''}
                onChange={(event) => patch({ periodKey: event.target.value })}
              >
                {periodOptions.map((period) => (
                  <option key={period.key} value={period.key}>
                    {period.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
    </div>
  );
}

// Add, configure, and remove any number of charts (up to MAX_CHARTS). `value`
// is config.charts; `onChange` receives the next charts array.
function ChartConfigPanel({ value, parameters, periodOptions, onChange }) {
  const { t } = useTranslation(['reports', 'common']);

  function add() {
    onChange([...value, newChart()]);
  }
  function update(index, chart) {
    onChange(value.map((item, i) => (i === index ? chart : item)));
  }
  function remove(index) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <fieldset className="export-fieldset">
      <legend>{t('charts.legend')}</legend>
      {value.length === 0 && (
        <p className="hint">{t('charts.empty')}</p>
      )}
      {value.map((chart, index) => (
        <ChartEditor
          key={index}
          chart={chart}
          parameters={parameters}
          periodOptions={periodOptions}
          onChange={(next) => update(index, next)}
          onRemove={() => remove(index)}
        />
      ))}
      <button
        type="button"
        className="primary"
        onClick={add}
        disabled={value.length >= MAX_CHARTS}
      >
        {t('charts.add')}
      </button>
      {value.length >= MAX_CHARTS && (
        <span className="hint"> {t('charts.max', { count: MAX_CHARTS })}</span>
      )}
    </fieldset>
  );
}

export default ChartConfigPanel;
