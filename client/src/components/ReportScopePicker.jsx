import { useTranslation } from 'react-i18next';
import TreePicker from './TreePicker.jsx';
import { formatIsoDate } from '../lib/format.js';

export default function ReportScopePicker({ report }) {
  const { t } = useTranslation('workflows');
  const { scope, change, groups, assignmentNodes, availablePeriods, assignments } = report;
  const periodNodes = availablePeriods.map(period => ({ ...period,
    parentId: `assignment:${period.assignmentId}`,
    name: `${t('scope.period', { seq: period.seq })} · ${formatIsoDate(period.startDate)} – ${formatIsoDate(period.endDate)}`,
  }));
  const parents = assignments.filter(a => availablePeriods.some(p => p.assignmentId === a.id)).map(a => ({ id: `assignment:${a.id}`, name: `${a.name || a.code}${a.name ? ` · ${a.code}` : ''}`, selectable: false }));
  return <section className="report-scope">
    <p className="hint">{t('scope.shared')}</p>
    <div className="form-grid">
      <TreePicker label={t('scope.groups')} items={groups} value={scope.groupIds} onChange={groupIds => change({ groupIds, assignmentIds: [], periodIds: [] })} includeBranch emptyHint={t('scope.allGroups')} />
      <TreePicker label={t('scope.assignments')} items={assignmentNodes} value={scope.assignmentIds} onChange={assignmentIds => change({ assignmentIds, periodIds: [] })} includeBranch emptyHint={t('scope.allAssignments')} />
      <TreePicker label={t('scope.periods')} items={[...parents, ...periodNodes]} value={scope.periodIds} onChange={periodIds => change({ periodIds })} includeBranch emptyHint={t('scope.allPeriods')} />
    </div>
    <fieldset className="segmented"><legend>{t('scope.dimensions')}</legend>
      {['quality', 'quantity'].map(dimension => <label key={dimension}>
        <input type="checkbox" checked={scope.dimensions.includes(dimension)} disabled={scope.dimensions.length === 1 && scope.dimensions[0] === dimension}
          onChange={event => change({ dimensions: event.target.checked ? [...scope.dimensions, dimension] : scope.dimensions.filter(d => d !== dimension) })} />
        {t(`scope.${dimension}`)}
      </label>)}
    </fieldset>
    <p className="hint">{t('scope.summary', { periods: report.selectedPeriods.length, dimensions: scope.dimensions.map(d => t(`scope.${d}`)).join(' + ') })}</p>
  </section>;
}
