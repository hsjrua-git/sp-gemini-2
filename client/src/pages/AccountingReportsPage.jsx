import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getBalanceSheet,
  getGeneralLedger,
  getIncomeStatement,
  getTrialBalance,
} from '../api/accountingReports.js';
import { listAccounts } from '../api/accountingJournal.js';
import EmptyState from '../components/EmptyState.jsx';
import JalaliDatePicker from '../components/JalaliDatePicker.jsx';
import StatCard from '../components/StatCard.jsx';
import { errorMessage } from '../i18n/errors.js';
import { formatIsoDate, toIsoDate } from '../lib/format.js';
import { startOfJalaliMonth } from '../lib/locale.js';

// The institution runs on the Jalali calendar, so the range opens on the
// first day of the current Jalali month; the wire range stays ISO.
const money = new Intl.NumberFormat('en-US');
const formatAmount = (value) => money.format(Number(value ?? 0));

const TABS = ['trialBalance', 'incomeStatement', 'balanceSheet', 'ledger'];

function AccountingReportsPage() {
  const { t } = useTranslation(['accountingReports', 'common']);
  const today = new Date();
  const [from, setFrom] = useState(toIsoDate(startOfJalaliMonth(today)));
  const [to, setTo] = useState(toIsoDate(today));
  const [tab, setTab] = useState('trialBalance');
  const [ledgerAccountId, setLedgerAccountId] = useState('');

  const accountsQuery = useQuery({
    queryKey: ['accounting-accounts', { includeInactive: false }],
    queryFn: () => listAccounts(),
  });
  const accounts = accountsQuery.data ?? [];

  const trialQuery = useQuery({
    queryKey: ['accounting-trial-balance', { from, to }],
    queryFn: () => getTrialBalance({ from, to }),
    enabled: tab === 'trialBalance',
  });
  const incomeQuery = useQuery({
    queryKey: ['accounting-income', { from, to }],
    queryFn: () => getIncomeStatement({ from, to }),
    enabled: tab === 'incomeStatement',
  });
  const sheetQuery = useQuery({
    queryKey: ['accounting-balance-sheet', { to }],
    queryFn: () => getBalanceSheet({ asOf: to }),
    enabled: tab === 'balanceSheet',
  });
  const ledgerQuery = useQuery({
    queryKey: ['accounting-ledger', { accountId: ledgerAccountId, from, to }],
    queryFn: () => getGeneralLedger({ accountId: ledgerAccountId, from, to }),
    enabled: tab === 'ledger' && ledgerAccountId !== '',
  });

  const activeQuery = {
    trialBalance: trialQuery,
    incomeStatement: incomeQuery,
    balanceSheet: sheetQuery,
    ledger: ledgerQuery,
  }[tab];

  const trial = trialQuery.data;
  const income = incomeQuery.data;
  const sheet = sheetQuery.data;
  const ledger = ledgerQuery.data;

  return (
    <main className="wide">
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p className="hint">{t('hint')}</p>
        </div>
      </div>

      <div className="toolbar">
        <label htmlFor="reports-from">{t('from')}</label>
        <JalaliDatePicker id="reports-from" value={from} onChange={setFrom} />
        <label htmlFor="reports-to">{t('to')}</label>
        <JalaliDatePicker id="reports-to" value={to} onChange={setTo} />
      </div>

      <div className="tabs" role="tablist" aria-label={t('title')}>
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? 'tab active' : 'tab'}
            onClick={() => setTab(value)}
          >
            {t(`tabs.${value}`)}
          </button>
        ))}
      </div>

      {activeQuery.isPending && <p className="hint">{t('common:status.loading')}</p>}
      {activeQuery.isError && (
        <p className="error" role="alert">
          {errorMessage(activeQuery.error)}
        </p>
      )}

      {tab === 'trialBalance' && trial && (
        <section className="section-card">
          {trial.accounts.length === 0 ? (
            <EmptyState title={t('trialBalance.empty')} />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('trialBalance.account')}</th>
                    <th scope="col" className="num">{t('trialBalance.debit')}</th>
                    <th scope="col" className="num">{t('trialBalance.credit')}</th>
                  </tr>
                </thead>
                <tbody>
                  {trial.accounts.map((account) => (
                    <tr key={account.id}>
                      <th scope="row">
                        <code>{account.code}</code> {account.name}
                      </th>
                      <td className="num">
                        {account.debit !== 0 && <bdi>{formatAmount(account.debit)}</bdi>}
                        {account.debit === 0 && '—'}
                      </td>
                      <td className="num">
                        {account.credit !== 0 && <bdi>{formatAmount(account.credit)}</bdi>}
                        {account.credit === 0 && '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">{t('trialBalance.totals')}</th>
                    <td className="num"><bdi>{formatAmount(trial.totalDebit)}</bdi></td>
                    <td className="num"><bdi>{formatAmount(trial.totalCredit)}</bdi></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'incomeStatement' && income && (
        <section className="section-card">
          {income.income.length === 0 && income.expense.length === 0 ? (
            <EmptyState title={t('incomeStatement.empty')} />
          ) : (
            <>
              <h2>{t('incomeStatement.income')}</h2>
              <div className="table-wrap">
                <table>
                  <tbody>
                    {income.income.map((row) => (
                      <tr key={row.id}>
                        <th scope="row"><code>{row.code}</code> {row.name}</th>
                        <td className="num"><bdi>{formatAmount(row.balance)}</bdi></td>
                      </tr>
                    ))}
                    <tr>
                      <th scope="row">{t('incomeStatement.totalIncome')}</th>
                      <td className="num"><bdi>{formatAmount(income.totalIncome)}</bdi></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <h2>{t('incomeStatement.expense')}</h2>
              <div className="table-wrap">
                <table>
                  <tbody>
                    {income.expense.map((row) => (
                      <tr key={row.id}>
                        <th scope="row"><code>{row.code}</code> {row.name}</th>
                        <td className="num"><bdi>{formatAmount(row.balance)}</bdi></td>
                      </tr>
                    ))}
                    <tr>
                      <th scope="row">{t('incomeStatement.totalExpense')}</th>
                      <td className="num"><bdi>{formatAmount(income.totalExpense)}</bdi></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="stat-grid">
                {income.netProfit >= 0 ? (
                  <StatCard
                    label={t('incomeStatement.netProfit')}
                    value={`${formatAmount(income.netProfit)} ${t('moneyUnit')}`}
                    tone="ok"
                  />
                ) : (
                  <StatCard
                    label={t('incomeStatement.netLoss')}
                    value={`${formatAmount(-income.netProfit)} ${t('moneyUnit')}`}
                    tone="danger"
                  />
                )}
              </div>
            </>
          )}
        </section>
      )}

      {tab === 'balanceSheet' && sheet && (
        <section className="section-card">
          <div className="stat-grid">
            <StatCard
              label={t('balanceSheet.totalAssets')}
              value={`${formatAmount(sheet.totalAssets)} ${t('moneyUnit')}`}
            />
            <StatCard
              label={t('balanceSheet.totalLiabilities')}
              value={`${formatAmount(sheet.totalLiabilities)} ${t('moneyUnit')}`}
            />
            <StatCard
              label={t('balanceSheet.totalEquity')}
              value={`${formatAmount(sheet.totalEquity)} ${t('moneyUnit')}`}
            />
            <StatCard
              label={t('balanceSheet.retainedEarnings')}
              value={`${formatAmount(sheet.retainedEarnings)} ${t('moneyUnit')}`}
              tone={sheet.retainedEarnings < 0 ? 'danger' : undefined}
            />
          </div>
          <p className={sheet.balanced ? 'success' : 'error'} role="status">
            {sheet.balanced ? t('balanceSheet.balanced') : t('balanceSheet.unbalanced')}
          </p>
          {(['assets', 'liabilities', 'equity']).map((group) =>
            sheet[group].length > 0 ? (
              <div key={group}>
                <h2>{t(`balanceSheet.${group}`)}</h2>
                <div className="table-wrap">
                  <table>
                    <tbody>
                      {sheet[group].map((row) => (
                        <tr key={row.id}>
                          <th scope="row"><code>{row.code}</code> {row.name}</th>
                          <td className="num"><bdi>{formatAmount(row.balance)}</bdi></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null
          )}
        </section>
      )}

      {tab === 'ledger' && (
        <section className="section-card">
          <div className="toolbar">
            <label htmlFor="ledger-account">{t('ledger.pickAccount')}</label>
            <select
              id="ledger-account"
              value={ledgerAccountId}
              onChange={(event) => setLedgerAccountId(event.target.value)}
            >
              <option value="">{t('ledger.pickAccount')}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} · {account.name}
                </option>
              ))}
            </select>
          </div>
          {ledgerAccountId === '' && <p className="hint">{t('ledger.pickHint')}</p>}
          {ledger && (
            <>
              <h2>
                <code>{ledger.account.code}</code> {ledger.account.name}
              </h2>
              {ledger.lines.length === 0 ? (
                <EmptyState title={t('ledger.empty')} />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">{t('ledger.entryNo')}</th>
                        <th scope="col">{t('ledger.date')}</th>
                        <th scope="col">{t('ledger.memo')}</th>
                        <th scope="col" className="num">{t('ledger.debit')}</th>
                        <th scope="col" className="num">{t('ledger.credit')}</th>
                        <th scope="col" className="num">{t('ledger.balance')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.lines.map((line, index) => (
                        <tr key={index}>
                          <td>№ {line.entryNo}</td>
                          <td>{formatIsoDate(line.entryDate)}</td>
                          <td>{line.entryMemo ?? line.lineMemo ?? '—'}</td>
                          <td className="num">
                            {line.debit !== 0 && <bdi>{formatAmount(line.debit)}</bdi>}
                            {line.debit === 0 && '—'}
                          </td>
                          <td className="num">
                            {line.credit !== 0 && <bdi>{formatAmount(line.credit)}</bdi>}
                            {line.credit === 0 && '—'}
                          </td>
                          <td className="num"><bdi>{formatAmount(line.balance)}</bdi></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th scope="row" colSpan={5}>{t('ledger.closing')}</th>
                        <td className="num"><bdi>{formatAmount(ledger.closingBalance)}</bdi></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}

export default AccountingReportsPage;
