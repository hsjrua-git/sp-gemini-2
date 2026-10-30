import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getStudentBalance, recordBalanceEvent } from '../api/cafeSales.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { errorMessage } from '../i18n/errors.js';
import { formatDateTime } from '../lib/format.js';
import { formatWhole, parseWholeNumber } from '../lib/money.js';
import { invalidateAccounting } from '../lib/accountingCache.js';

const KINDS = ['topup', 'refund', 'adjustment'];

// The cafe balance panel on a student's page: current balance (a negative
// one is an allowed overdraft, shown as debt), the top-up/refund/adjustment
// form for cafe.balance holders, and the full transaction history. Money is
// whole Toman; inputs accept Persian digits.
function StudentBalanceSection({ student }) {
  const { t } = useTranslation(['cafe', 'common']);
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState('topup');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const toman = (value) => `${formatWhole(value)} ${t('money.unit')}`;

  const balanceQuery = useQuery({
    queryKey: ['cafe-balance', student.id],
    queryFn: () => getStudentBalance(student.id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['cafe-balance', student.id] });
    queryClient.invalidateQueries({ queryKey: ['cafe-balance-students'] });
    queryClient.invalidateQueries({ queryKey: ['cafe-reports'] });
    invalidateAccounting(queryClient);
  };

  const submit = useMutation({
    mutationFn: (parsedAmount) =>
      recordBalanceEvent({
        studentId: student.id,
        kind,
        amount: parsedAmount,
        note: note.trim() === '' ? undefined : note.trim(),
      }),
    onSuccess: () => {
      invalidate();
      setAmount('');
      setNote('');
    },
  });

  function handleSubmit(event) {
    event.preventDefault();
    const parsed = parseWholeNumber(amount, { signed: kind === 'adjustment' });
    if (parsed === null || parsed === 0) return;
    submit.mutate(parsed);
  }


  const balance = balanceQuery.data?.balance ?? null;
  const transactions = balanceQuery.data?.transactions ?? [];

  return (
    <section className="section-card">
      <h2>{t('balance.title')}</h2>
      {balanceQuery.isPending && <p className="hint">{t('common:status.loading')}</p>}
      {balanceQuery.isError && (
        <p className="error" role="alert">
          {errorMessage(balanceQuery.error)}
        </p>
      )}
      {balance !== null && (
        <p
          className={balance < 0 ? 'error' : undefined}
          aria-label={t('balance.current')}
        >
          <bdi>{toman(balance)}</bdi>
          {balance < 0 && (
            <span className="badge danger">{t('balance.inDebt')}</span>
          )}
        </p>
      )}

      {can('cafe.balance') && (
        <form onSubmit={handleSubmit} className="edit-form">
          <div className="segmented" role="radiogroup" aria-label={t('balance.kind')}>
            {KINDS.map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name={`balance-kind-${student.id}`}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                  disabled={submit.isPending}
                />
                {t(`balance.kinds.${value}`)}
              </label>
            ))}
          </div>
          <label htmlFor={`balance-amount-${student.id}`}>
            {t('balance.amount')}
          </label>
          <input
            id={`balance-amount-${student.id}`}
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={kind === 'adjustment' ? '±100000' : '100000'}
            disabled={submit.isPending}
          />
          <p className="hint">{t('balance.amountHint')}</p>
          <label htmlFor={`balance-note-${student.id}`}>
            {t('balance.note')}
          </label>
          <input
            id={`balance-note-${student.id}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            disabled={submit.isPending}
          />
          <div className="row">
            <button type="submit" disabled={submit.isPending || amount.trim() === ''}>
              {submit.isPending
                ? t('common:actions.saving')
                : t('balance.submit')}
            </button>
          </div>
          {submit.isError && (
            <p className="error" role="alert">
              {errorMessage(submit.error)}
            </p>
          )}
          {submit.isSuccess && (
            <p className="success" role="status">
              {t('balance.saved', { balance: toman(submit.data.balanceAfter) })}
            </p>
          )}
        </form>
      )}

      {transactions.length > 0 && (
        <div className="table-wrap">
          <table>
          <thead>
            <tr>
              <th scope="col">{t('balance.when')}</th>
              <th scope="col">{t('balance.kindCol')}</th>
              <th scope="col" className="num">{t('balance.amount')}</th>
              <th scope="col" className="num">{t('balance.after')}</th>
              <th scope="col">{t('balance.note')}</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((entry) => (
              <tr key={entry.id}>
                <td>{formatDateTime(entry.createdAt)}</td>
                <td>{t(`balance.kinds.${entry.kind}`)}</td>
                <td className="num">
                  <bdi>{new Intl.NumberFormat('en-US').format(entry.amount)}</bdi>
                </td>
                <td className="num">
                  <bdi>{new Intl.NumberFormat('en-US').format(entry.balanceAfter)}</bdi>
                </td>
                <td>{entry.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      )}
      {balanceQuery.data?.truncated && (
        <p className="hint">{t('balance.truncated')}</p>
      )}
    </section>
  );
}

export default StudentBalanceSection;
