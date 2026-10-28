import { useEffect } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { listStudents } from '../api/students.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { errorMessage } from '../i18n/errors.js';
import { usePreferences } from '../preferences/PreferencesContext.jsx';
import StudentRow from './StudentRow.jsx';

function StudentsTable({ search, page, onPageChange, groupId = null }) {
  const { t } = useTranslation(['students', 'common']);
  const { can } = useAuth();
  const { preferences } = usePreferences();
  const pageSize = preferences.studentsPageSize;
  const sort = preferences.studentsSort;

  const { data, isPending, isError, error, isPlaceholderData } = useQuery({
    queryKey: ['students', { search, page, pageSize, sort, groupId }],
    queryFn: () => listStudents({ search, page, pageSize, sort, groupId }),
    placeholderData: keepPreviousData,
  });

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.pageSize))
    : 1;

  useEffect(() => {
    if (data && page > totalPages) onPageChange(totalPages);
  }, [data, page, totalPages, onPageChange]);

  if (isPending) return <p>{t('list.loading')}</p>;
  if (isError) return <p className="error">{errorMessage(error)}</p>;
  if (data.total === 0) {
    return (
      <p>
        {search
          ? t('list.noMatch', { search })
          : can('students.create')
            ? t('list.emptyCanCreate')
            : t('list.empty')}
      </p>
    );
  }

  return (
    <>
      <div className={`table-wrap${isPlaceholderData ? ' stale' : ''}`}>
        <table>
          <thead>
            <tr>
              {preferences.studentsShowCode && (
                <th>{t('common:table.code')}</th>
              )}
              <th>{t('list.fullName')}</th>
              {preferences.studentsShowAdded && <th>{t('list.addedCol')}</th>}
              {(can('students.edit') || can('students.delete')) && (
                <th>{t('common:table.actions')}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {data.students.map((student) => (
              <StudentRow key={student.id} student={student} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          {t('list.previous')}
        </button>
        <span>
          {t('list.pageStatus', { page, totalPages, total: data.total })}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          {t('list.next')}
        </button>
      </div>
    </>
  );
}

export default StudentsTable;