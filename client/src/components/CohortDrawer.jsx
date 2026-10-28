import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon } from './icons.jsx';
import Drawer from './Drawer.jsx';

// The whole-class summary behind the glowing core: the headline completion and
// the roster breakdown (the same figures the KPI strip and the field colours
// encode). Read straight from the already-computed summary — no chart, just the
// numbers, since this is the overview the core stands in for at rest. Opened by
// clicking the core or its focusable "Class summary" control.
function CohortBody({ summary, titleId, onClose }) {
  const { t } = useTranslation(['reports', 'common']);
  const {
    completion,
    students,
    parametersInUse,
    measured,
    expected,
    studentsComplete,
    studentsPartial,
    studentsNone,
  } = summary;

  const rows = [
    { key: 'full', label: t('cohort.fullyMeasured'), value: studentsComplete },
    { key: 'partial', label: t('cohort.partlyMeasured'), value: studentsPartial },
    { key: 'none', label: t('cohort.notStarted'), value: studentsNone },
  ];

  return (
    <>
      <header className="drawer-head">
        <h2 id={titleId} className="drawer-title">
          {t('cohort.classSummary')}
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
        {completion === null ? (
          t('cohort.nothingYet')
        ) : (
          <>
            <strong>{completion}%</strong>{' '}
            {t('cohort.recordedTail', {
              measured,
              expected,
              students,
              parametersInUse,
            })}
          </>
        )}
      </p>

      <table>
        <thead>
          <tr>
            <th scope="col">{t('cohort.students')}</th>
            <th scope="col">{students}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">
                <span className={`kpi-swatch ${row.key}`} aria-hidden="true" />{' '}
                {row.label}
              </th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function CohortDrawer({ open, summary, onClose }) {
  const titleId = useId();
  // Same slide-out cache as the other drawers: keep the last summary rendered
  // while the panel closes. The guard settles in one extra render and never loops.
  const [cached, setCached] = useState(null);
  if (summary && cached !== summary) setCached(summary);
  const view = summary ?? cached;

  return (
    <Drawer open={open} titleId={titleId} onClose={onClose}>
      {view && <CohortBody summary={view} titleId={titleId} onClose={onClose} />}
    </Drawer>
  );
}

export default CohortDrawer;
