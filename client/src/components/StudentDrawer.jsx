import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatChange, formatStudentCode } from '../lib/format.js';
import { CloseIcon } from './icons.jsx';
import Drawer from './Drawer.jsx';

// One student's card behind their node in the constellation: every in-use
// parameter this period, the score entered (or a dash where it's still missing),
// and the change from the previous period. Built from the results already loaded
// (lib/dashboard.js#studentBreakdown), so a click on a node — or its focusable
// control — opens straight away with no extra fetch. The core, satellites and
// nodes each open a matching drawer; this is the node's.
function StudentBody({ breakdown, titleId, onClose }) {
  const { t } = useTranslation(['reports', 'common']);
  const { fullName, studentCode, measured, inUse, rows } = breakdown;

  return (
    <>
      <header className="drawer-head">
        <h2 id={titleId} className="drawer-title">
          {fullName}
          {studentCode && (
            <span className="hint"> {formatStudentCode(studentCode)}</span>
          )}
        </h2>
        <button
          type="button"
          className="drawer-close"
          onClick={onClose}
          aria-label={t('common:actions.close')}
        >
          <CloseIcon size={18} />
        </button>
      </header>

      <p className="summary">
        <strong>{t('shared.of', { a: measured, b: inUse })}</strong>{' '}
        {t('studentDrawer.measuredThisPeriod')}
      </p>

      {rows.length === 0 ? (
        <p>{t('studentDrawer.noParameters')}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">{t('shared.parameter')}</th>
              <th scope="col">{t('shared.score')}</th>
              <th scope="col">{t('studentDrawer.change')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ parameter, value, change }) => (
              <tr key={parameter.id} className={value === null ? 'stale' : undefined}>
                <th scope="row">{parameter.name}</th>
                <td>{value === null ? '—' : value}</td>
                <td>{change === null ? '' : formatChange(change)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function StudentDrawer({ open, breakdown, onClose }) {
  const titleId = useId();
  // Same "remember the last props during slide-out" cache as ParameterDrawer: on
  // close the dashboard clears the selection so `breakdown` goes null, but we keep
  // rendering the last student until the panel is off-screen. The guard settles in
  // one extra render and never loops.
  const [cached, setCached] = useState(null);
  if (breakdown && cached !== breakdown) setCached(breakdown);
  const view = breakdown ?? cached;

  return (
    <Drawer open={open} titleId={titleId} onClose={onClose}>
      {view && <StudentBody breakdown={view} titleId={titleId} onClose={onClose} />}
    </Drawer>
  );
}

export default StudentDrawer;
