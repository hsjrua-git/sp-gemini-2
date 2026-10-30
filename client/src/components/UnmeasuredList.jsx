import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { formatStudentCode } from '../lib/format.js';

const SHOWN = 20;

// The dashboard's "who to score next" queue. unmeasuredStudents() hands these
// over worst-first (most missing parameters first), so the rail reads left to
// right as a work order: the students furthest from complete sit at the front.
// A horizontal rail keeps the glowing hero the page's vertical focus instead of
// a long list pushing everything down.
function UnmeasuredList({ items }) {
  const { t } = useTranslation(['reports', 'common']);

  if (items.length === 0) {
    return <p className="needs-clear">{t('unmeasured.clear')}</p>;
  }

  const shown = items.slice(0, SHOWN);
  const rest = items.length - shown.length;

  return (
    <>
      <p className="hint">
        {t('unmeasured.needsScore', { count: items.length })}
      </p>
      <ul className="needs-rail">
        {shown.map((item) => (
          <li key={item.id} className="needs-ticket">
            <div className="needs-ticket-head">
              <Link to={`/students/${item.id}`} className="needs-name">
                {item.fullName}
              </Link>
              <span className="hint code">
                {formatStudentCode(item.studentCode)}
              </span>
            </div>
            <span className="chip-row">
              {item.missing.map((name) => (
                <span key={name} className="chip warn">
                  {name}
                </span>
              ))}
            </span>
          </li>
        ))}
        {rest > 0 && (
          <li className="needs-ticket needs-more" aria-hidden="true">
            {t('unmeasured.more', { count: rest })}
          </li>
        )}
      </ul>
    </>
  );
}

export default UnmeasuredList;
