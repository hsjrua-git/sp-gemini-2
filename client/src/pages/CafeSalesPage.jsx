import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { listCafeProducts } from '../api/cafe.js';
import {
  listCafeSales,
  recordSale,
  searchCafeStudents,
  voidSale,
} from '../api/cafeSales.js';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { errorMessage } from '../i18n/errors.js';
import { formatDateTime, toIsoDate } from '../lib/format.js';
import { useDebouncedValue } from '../lib/useDebouncedValue.js';
import { invalidateAccounting } from '../lib/accountingCache.js';
import { formatAmount, formatWhole, parseQuantity, parseWholeNumber, saleQuote } from '../lib/money.js';
// The cafe POS: tap products into a cart, pick walk-in or a student (charged
// to their prepaid balance — overdraft allowed, so balances may go negative by
// design), record the sale, and void today's mistakes. Money and quantities in
// tables keep Latin digits with thousands separators — amounts are data, not
// UI chrome — and only the unit word is translated, like CafeProductsPage.

// Client-side mirrors of the server's sale validation, so the cart can flag a
// bad line (red input) before the POST. Persian digits and stray separators
// are accepted, exactly like the products form.
function BalanceText({ value }) {
  const { t } = useTranslation(['pos']);
  const amount = Number(value ?? 0);
  return (
    <span className={amount < 0 ? 'error' : undefined}>
      <bdi>{formatWhole(amount)}</bdi>{' '}
      <span className="hint">{t('money.unit')}</span>
    </span>
  );
}

// Finds the student to charge through the balances endpoint (open to
// cafe.sell): minimal identity — name, code, balance — nothing more.
function StudentFinder({ disabled, onPick }) {
  const { t } = useTranslation(['pos', 'common']);
  const [search, setSearch] = useState('');
  const trimmed = search.trim();
  const debounced = useDebouncedValue(trimmed, 300);

  const resultsQuery = useQuery({
    queryKey: ['cafe-balance-students', debounced],
    queryFn: () => searchCafeStudents(debounced),
    enabled: debounced.length >= 2,
  });
  const students = resultsQuery.data ?? [];

  return (
    <div>
      <label htmlFor="pos-student-search">{t('finder.label')}</label>
      <input
        id="pos-student-search"
        type="search"
        className="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t('finder.placeholder')}
        autoComplete="off"
        disabled={disabled}
      />
      {trimmed.length > 0 && trimmed.length < 2 && (
        <p className="hint">{t('finder.minChars')}</p>
      )}
      {resultsQuery.isPending && debounced.length >= 2 && (
        <p className="hint">{t('finder.searching')}</p>
      )}
      {resultsQuery.isError && (
        <p className="error" role="alert">
          {errorMessage(resultsQuery.error)}
        </p>
      )}
      {resultsQuery.isSuccess && students.length === 0 && (
        <p className="hint">{t('finder.noResults')}</p>
      )}
      {students.length > 0 && (
        <ul className="plain-list">
          {students.map((candidate) => (
            <li key={candidate.id}>
              {candidate.fullName}{' '}
              <code className="hint">{candidate.code}</code>{' '}
              <span className="hint">{t('finder.balanceLabel')}:</span>{' '}
              <BalanceText value={candidate.balance} />
              {Number(candidate.balance) < 0 && (
                <span className="badge danger">{t('finder.debt')}</span>
              )}{' '}
              <button
                type="button"
                className="quiet"
                onClick={() => onPick(candidate)}
                disabled={disabled}
              >
                {t('finder.choose')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CafeSalesPage() {
  const { t, i18n } = useTranslation(['pos', 'common']);
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const canSell = can('cafe.sell');
  const canView = can('cafe.view');
  const todayIso = toIsoDate(new Date());
  const itemsSeparator = i18n.resolvedLanguage === 'en' ? ', ' : '، ';

  // --- POS state -----------------------------------------------------------
  const [customer, setCustomer] = useState('walk_in');
  const [student, setStudent] = useState(null); // {id, fullName, code, balance}
  const [lines, setLines] = useState([]); // {productId, name, qtyText, priceText}
  const [note, setNote] = useState('');
  const [fieldError, setFieldError] = useState('');

  const productsQuery = useQuery({
    queryKey: ['cafe-products', { includeInactive: false }],
    queryFn: () => listCafeProducts({ includeInactive: false }),
    enabled: canSell,
  });

  // Parsed once per render: qty/unitPrice are null while the text is invalid,
  // which flags the input, drops the line from the running total, and blocks
  // the submit.
  const parsedLines = lines.map((line) => ({
    ...line,
    qty: parseQuantity(line.qtyText),
    unitPrice: parseWholeNumber(line.priceText),
  }));
  const total = saleQuote(parsedLines);

  function addProduct(product) {
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) {
        const qty = parseQuantity(existing.qtyText);
        return current.map((line) =>
          line.productId === product.id
            ? { ...line, qtyText: formatAmount((qty ?? 0) + 1) }
            : line
        );
      }
      return [
        ...current,
        {
          productId: product.id,
          name: product.name,
          qtyText: '1',
          priceText: String(product.price),
        },
      ];
    });
  }

  function updateLine(productId, patch) {
    setLines((current) =>
      current.map((line) =>
        line.productId === productId ? { ...line, ...patch } : line
      )
    );
  }

  function removeLine(productId) {
    setLines((current) =>
      current.filter((line) => line.productId !== productId)
    );
  }

  const invalidateSales = () => {
    queryClient.invalidateQueries({ queryKey: ['cafe-sales'] });
    queryClient.invalidateQueries({ queryKey: ['cafe-products'] });
    queryClient.invalidateQueries({ queryKey: ['cafe-balance-students'] });
    queryClient.invalidateQueries({ queryKey: ['cafe-balance'] });
    queryClient.invalidateQueries({ queryKey: ['cafe-reports'] });
    queryClient.invalidateQueries({ queryKey: ['cafe-inventory'] });
    invalidateAccounting(queryClient);
  };

  const save = useMutation({
    mutationFn: (body) => recordSale(body),
    onSuccess: (data) => {
      invalidateSales();
      setLines([]);
      setNote('');
      // Keep the student pinned (with their fresh balance) so the next sale
      // to the same student is one click away.
      if (student != null && data.sale.balanceAfter != null) {
        setStudent({ ...student, balance: Number(data.sale.balanceAfter) });
      }
    },
  });

  function handleSubmit(event) {
    event.preventDefault();
    if (customer === 'student' && student === null) {
      setFieldError(t('cart.needStudent'));
      return;
    }
    if (lines.length === 0) {
      setFieldError(t('cart.emptyCart'));
      return;
    }
    const items = [];
    for (const line of parsedLines) {
      if (line.qty === null) {
        setFieldError(t('cart.invalidQty'));
        return;
      }
      if (line.unitPrice === null) {
        setFieldError(t('cart.invalidPrice'));
        return;
      }
      items.push({
        productId: line.productId,
        qty: line.qty,
        unitPrice: line.unitPrice,
      });
    }
    setFieldError('');
    save.mutate({
      customer,
      ...(customer === 'student' ? { studentId: student.id } : {}),
      items,
      ...(note.trim() !== '' ? { note: note.trim() } : {}),
    });
  }

  // --- Today's sales -------------------------------------------------------
  const todayQuery = useQuery({
    queryKey: ['cafe-sales', 'today', todayIso],
    queryFn: () =>
      listCafeSales({ from: todayIso, to: todayIso, includeVoided: true }),
    enabled: canView,
  });

  const voidSaleMutation = useMutation({
    mutationFn: (sale) => voidSale(sale.id),
    onSuccess: (data, sale) => {
      invalidateSales();
      if (
        student != null &&
        sale.studentId === student.id &&
        data.balanceAfter != null
      ) {
        setStudent({ ...student, balance: Number(data.balanceAfter) });
      }
    },
  });

  function handleVoid(sale) {
    if (!window.confirm(t('void.confirm'))) return;
    voidSaleMutation.mutate(sale);
  }

  const sales = todayQuery.data?.sales ?? [];

  return (
    <main className="wide">
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p className="hint">{t('hint')}</p>
        </div>
      </div>

      {canSell && (
        <section className="section-card">
          <h2>{t('cart.title')}</h2>

          <div className="row">
            <span className="hint">{t('customer.label')}:</span>
            <div className="segmented">
              <label>
                <input
                  type="radio"
                  name="pos-customer"
                  checked={customer === 'walk_in'}
                  onChange={() => setCustomer('walk_in')}
                  disabled={save.isPending}
                />
                {t('customer.walkIn')}
              </label>
              <label>
                <input
                  type="radio"
                  name="pos-customer"
                  checked={customer === 'student'}
                  onChange={() => setCustomer('student')}
                  disabled={save.isPending}
                />
                {t('customer.student')}
              </label>
            </div>
          </div>

          {customer === 'student' &&
            (student === null ? (
              <StudentFinder disabled={save.isPending} onPick={setStudent} />
            ) : (
              <p>
                <span className="hint">{t('cart.studentPrefix')}:</span>{' '}
                <strong>{student.fullName}</strong>{' '}
                <code className="hint">{student.code}</code>{' '}
                <span className="hint">{t('finder.balanceLabel')}:</span>{' '}
                <BalanceText value={student.balance} />
                {Number(student.balance) < 0 && (
                  <span className="badge danger">{t('finder.debt')}</span>
                )}{' '}
                <button
                  type="button"
                  className="quiet"
                  onClick={() => setStudent(null)}
                  disabled={save.isPending}
                >
                  {t('finder.change')}
                </button>
              </p>
            ))}

          <h3>{t('pad.title')}</h3>
          {productsQuery.isPending && (
            <p className="hint">{t('common:status.loading')}</p>
          )}
          {productsQuery.isError && (
            <p className="error" role="alert">
              {errorMessage(productsQuery.error)}
            </p>
          )}
          {productsQuery.data?.length === 0 && (
            <p className="hint">{t('pad.empty')}</p>
          )}
          {(productsQuery.data ?? []).length > 0 && (
            <div className="chip-row">
              {(productsQuery.data ?? []).map((product) => (
                <button
                  key={product.id}
                  type="button"
                  className="chip"
                  onClick={() => addProduct(product)}
                  disabled={save.isPending}
                >
                  {product.name}{' '}
                  <span className="hint">{formatWhole(product.price)}</span>
                </button>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="edit-form">
            {lines.length === 0 ? (
              <p className="hint">{t('cart.empty')}</p>
            ) : (
              <div className="table-wrap">
                <table>
                <thead>
                  <tr>
                    <th scope="col">{t('cart.colProduct')}</th>
                    <th scope="col">{t('cart.colQty')}</th>
                    <th scope="col">{t('cart.colUnitPrice')}</th>
                    <th scope="col">{t('cart.colLineTotal')}</th>
                    <th scope="col">{t('common:table.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedLines.map((line) => (
                    <tr key={line.productId}>
                      <th scope="row">{line.name}</th>
                      <td>
                        <input
                          value={line.qtyText}
                          className={line.qty === null ? 'invalid' : undefined}
                          onChange={(event) =>
                            updateLine(line.productId, {
                              qtyText: event.target.value,
                            })
                          }
                          inputMode="decimal"
                          placeholder={t('cart.qtyPlaceholder')}
                          autoComplete="off"
                          disabled={save.isPending}
                          aria-label={`${t('cart.colQty')}: ${line.name}`}
                        />
                      </td>
                      <td>
                        <input
                          value={line.priceText}
                          className={
                            line.unitPrice === null ? 'invalid' : undefined
                          }
                          onChange={(event) =>
                            updateLine(line.productId, {
                              priceText: event.target.value,
                            })
                          }
                          inputMode="numeric"
                          placeholder={t('cart.pricePlaceholder')}
                          autoComplete="off"
                          disabled={save.isPending}
                          aria-label={`${t('cart.colUnitPrice')}: ${line.name}`}
                        />
                      </td>
                      <td className="nowrap">
                        {line.qty !== null && line.unitPrice !== null ? (
                          <>
                            {formatWhole(saleQuote([line]))}{' '}
                            <span className="hint">{t('money.unit')}</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="quiet"
                          onClick={() => removeLine(line.productId)}
                          disabled={save.isPending}
                        >
                          {t('cart.remove')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={3}>
                      {t('cart.total')}
                    </th>
                    <td className="nowrap">
                      <strong>{formatWhole(total)}</strong>{' '}
                      <span className="hint">{t('money.unit')}</span>
                    </td>
                    <td />
                  </tr>
                </tfoot>
                </table>
              </div>
            )}

            <label htmlFor="pos-note">{t('cart.note')}</label>
            <input
              id="pos-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              autoComplete="off"
              disabled={save.isPending}
            />

            <div className="row">
              <button
                type="submit"
                disabled={save.isPending || lines.length === 0}
              >
                {save.isPending ? t('cart.submitting') : t('cart.submit')}
              </button>
            </div>
            {fieldError && (
              <p className="error" role="alert">
                {fieldError}
              </p>
            )}
            {save.isError && (
              <p className="error" role="alert">
                {errorMessage(save.error)}
              </p>
            )}
            {save.isSuccess && (
              <p className="success" role="status">
                {t('success.recorded')}{' '}
                {save.data.sale.balanceAfter != null && (
                  <>
                    {t('success.newBalance')}{' '}
                    <bdi>{formatWhole(save.data.sale.balanceAfter)}</bdi>{' '}
                    {t('money.unit')}
                  </>
                )}
              </p>
            )}
          </form>
        </section>
      )}

      {!canSell && canView && <p className="hint">{t('noSell')}</p>}

      {canView && (
        <section className="section-card">
          <h2>{t('today.title')}</h2>

          {todayQuery.isPending && (
            <p className="hint">{t('common:status.loading')}</p>
          )}
          {todayQuery.isError && (
            <p className="error" role="alert">
              {errorMessage(todayQuery.error)}
            </p>
          )}
          {todayQuery.data?.truncated && (
            <p className="hint">{t('today.truncated')}</p>
          )}
          {sales.length === 0 && !todayQuery.isPending && (
            <EmptyState
              title={t('today.emptyTitle')}
              description={t('today.emptyDescription')}
            />
          )}

          {sales.length > 0 && (
            <div className="table-wrap">
              <table>
              <thead>
                <tr>
                  <th scope="col">{t('today.colTime')}</th>
                  <th scope="col">{t('today.colCustomer')}</th>
                  <th scope="col">{t('today.colItems')}</th>
                  <th scope="col">{t('today.colTotal')}</th>
                  <th scope="col">{t('today.colStatus')}</th>
                  {canSell && (
                    <th scope="col">{t('common:table.actions')}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr
                    key={sale.id}
                    className={sale.voidedAt ? 'stale' : undefined}
                  >
                    <td className="nowrap">{formatDateTime(sale.soldAt)}</td>
                    <td>
                      {sale.customer === 'student' ? (
                        <>
                          {sale.studentName}{' '}
                          <code className="hint">{sale.studentCode}</code>
                        </>
                      ) : (
                        t('today.walkIn')
                      )}
                    </td>
                    <td>
                      {sale.items
                        .map(
                          (item) =>
                            `${formatAmount(item.qty)} × ${item.productName}`
                        )
                        .join(itemsSeparator)}
                    </td>
                    <td className="nowrap">
                      {formatWhole(sale.total)}{' '}
                      <span className="hint">{t('money.unit')}</span>
                    </td>
                    <td>
                      {sale.voidedAt ? (
                        <span className="badge warn">{t('today.voided')}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    {canSell && (
                      <td>
                        {!sale.voidedAt && (
                          <button
                            type="button"
                            className="quiet"
                            onClick={() => handleVoid(sale)}
                            disabled={voidSaleMutation.isPending}
                          >
                            {t('void.action')}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          )}
          {voidSaleMutation.isError && (
            <p className="error" role="alert">
              {errorMessage(voidSaleMutation.error)}
            </p>
          )}
          {voidSaleMutation.isSuccess && (
            <p className="success" role="status">
              {t('success.voided')}{' '}
              {voidSaleMutation.data.balanceAfter != null && (
                <>
                  {t('success.newBalance')}{' '}
                  <bdi>{formatWhole(voidSaleMutation.data.balanceAfter)}</bdi>{' '}
                  {t('money.unit')}
                </>
              )}
            </p>
          )}
        </section>
      )}
    </main>
  );
}

export default CafeSalesPage;
