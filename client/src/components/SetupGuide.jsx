import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import { listAssignments, listIntervals } from '../api/schedule.js';
import { listTeachers } from '../api/teachers.js';
import { listParameters } from '../api/parameters.js';
import { listStudents } from '../api/students.js';
import { listSessions } from '../api/sessions.js';

export default function SetupGuide() {
  const { t } = useTranslation(['reports', 'common']);
  const { can } = useAuth();
  const [manualToggle, setManualToggle] = useState(null);

  const canSchedule = can('schedule.view');
  const canTeachers = can('teachers.view');
  const canParameters = can('parameters.view') || can('parameters.manage');
  const canStudents = can('students.view');

  const intervalsQuery = useQuery({
    queryKey: ['intervals'],
    queryFn: () => listIntervals(),
    enabled: canSchedule,
  });
  const teachersQuery = useQuery({
    queryKey: ['teachers', { search: '', includeArchived: false }],
    queryFn: () => listTeachers({}),
    enabled: canTeachers,
  });
  const parametersQuery = useQuery({
    queryKey: ['parameters'],
    queryFn: () => listParameters(),
    enabled: canParameters,
  });
  const studentsQuery = useQuery({
    queryKey: ['students', 'setup-check'],
    queryFn: () => listStudents({ page: 1, pageSize: 1, sort: 'name' }),
    enabled: canStudents,
  });
  const assignmentsQuery = useQuery({
    queryKey: ['assignments'],
    queryFn: () => listAssignments(),
    enabled: canSchedule,
  });
  const sessionsQuery = useQuery({
    queryKey: ['sessions', 'setup-check'],
    queryFn: () => listSessions({}),
    enabled: canSchedule,
  });

  const hasIntervals = (intervalsQuery.data ?? []).some((item) => !item.archivedAt);
  const hasTeachers = (teachersQuery.data ?? []).some((item) => !item.archivedAt);
  const hasParameters = (parametersQuery.data ?? []).some((item) => !item.archivedAt);
  const hasStudents = (studentsQuery.data?.total ?? 0) > 0;
  const hasAssignments = (assignmentsQuery.data ?? []).some((item) => !item.archivedAt);
  const hasSessions = (sessionsQuery.data?.sessions ?? []).some(
    (item) => !item.canceledAt && !item.archivedAt
  );

  const steps = [
    {
      key: 'step1',
      done: !canSchedule || hasIntervals,
      title: t('dashboard.setupGuide.step1Title'),
      desc: t('dashboard.setupGuide.step1Desc'),
      actionLabel: t('dashboard.setupGuide.step1Action'),
      to: '/schedule',
      permitted: canSchedule,
    },
    {
      key: 'step2',
      done: !canTeachers || hasTeachers,
      title: t('dashboard.setupGuide.step2Title'),
      desc: t('dashboard.setupGuide.step2Desc'),
      actionLabel: t('dashboard.setupGuide.step2Action'),
      to: '/teachers',
      permitted: canTeachers,
    },
    {
      key: 'step3',
      done: !canParameters || hasParameters,
      title: t('dashboard.setupGuide.step3Title'),
      desc: t('dashboard.setupGuide.step3Desc'),
      actionLabel: t('dashboard.setupGuide.step3Action'),
      to: '/parameters',
      permitted: can('parameters.manage'),
    },
    {
      key: 'step4',
      done: !canStudents || hasStudents,
      title: t('dashboard.setupGuide.step4Title'),
      desc: t('dashboard.setupGuide.step4Desc'),
      actionLabel: t('dashboard.setupGuide.step4Action'),
      to: '/students',
      permitted: canStudents,
    },
    {
      key: 'step5',
      done: !canSchedule || (hasAssignments && hasSessions),
      title: t('dashboard.setupGuide.step5Title'),
      desc: t('dashboard.setupGuide.step5Desc'),
      actionLabel: hasAssignments
        ? t('dashboard.setupGuide.step5SessionsAction')
        : t('dashboard.setupGuide.step5Action'),
      to: hasAssignments ? '/sessions' : '/schedule',
      permitted: canSchedule,
    },
  ];

  const doneCount = steps.filter((step) => step.done).length;
  const allReady = doneCount === steps.length;
  const isOpen = manualToggle !== null ? manualToggle : !allReady;

  return (
    <section className="section-card" aria-label={t('dashboard.setupGuide.title')}>
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ marginBottom: '0.2rem' }}>{t('dashboard.setupGuide.title')}</h2>
          <p className="hint" style={{ margin: 0 }}>
            {allReady
              ? t('dashboard.setupGuide.allReady')
              : t('dashboard.setupGuide.subtitle')}
          </p>
        </div>
        <div className="row">
          <span className={`badge ${allReady ? 'ok' : 'warn'}`}>
            {t('dashboard.setupGuide.progress', { done: doneCount })}
          </span>
          <button
            type="button"
            onClick={() => setManualToggle(!isOpen)}
            aria-expanded={isOpen}
          >
            {isOpen ? t('dashboard.setupGuide.hide') : t('dashboard.setupGuide.show')}
          </button>
        </div>
      </div>

      {isOpen && (
        <div
          className="grid gap-3 pt-3"
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          {steps.map((step) => (
            <div
              key={step.key}
              className="param-card flex flex-col justify-between gap-3"
            >
              <div>
                <div className="param-card-head">
                  <h3>{step.title}</h3>
                  <span className={`badge ${step.done ? 'ok' : 'warn'}`}>
                    {step.done
                      ? t('dashboard.setupGuide.doneBadge')
                      : t('dashboard.setupGuide.pendingBadge')}
                  </span>
                </div>
                <p className="hint" style={{ marginTop: '0.35rem', marginBottom: 0 }}>
                  {step.desc}
                </p>
              </div>
              {step.permitted && (
                <div className="row">
                  <Link
                    className={`btn ${step.done ? '' : 'primary'}`}
                    to={step.to}
                  >
                    {step.actionLabel}
                  </Link>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
