import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { listCafeProducts } from '../api/cafe.js';
import {
  getCafeInventory,
  getProductStockCard,
  recordInventory,
} from '../api/cafeInventory.js';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { errorMessage } from '../i18n/errors.js';
import { formatDateTime } from '../lib/format.js';
import { formatAmount, formatWhole, parseQuantity } from '../lib/money.js';
import { invalidateAccounting } from '../lib/accountingCache.js';

// The cafe stockroom: current stock per product (with its movement ledger a
// click away), a form to record waste or count corrections, and the latest
// movements across all products. Like the other cafe pages, money and
// quantities keep Latin digits with thousands separators (amounts are data,
// not UI chrome) and only the unit word is translated.

// Movement kinds are fixed by the DB CHECK constraint; badge tones by taste —
// purchases and sales are routine (ok), waste is a loss (danger) and an
// adjustment fixes the ledger (warn).
const KINDS = ['purchase', 'sale', 'waste', 'adjustment'];
const KIND_BADGE = {
  purchase: 'ok',
  sale: 'ok',
  waste: 'danger',
  adjustment: 'warn',
};

function KindBadge({ kind }) {
  const { t } = useTranslation(['inventory']);
  if (!KINDS.includes(kind)) return kind;
  return <span className={`badge ${KIND_BADGE[kind]}`}>{t(`kind.${kind}`)}</span>;
}

// The kind-specific rules the server enforces: waste is entered positive,
// an adjustment is signed and non-zero (both share the shared parser's
// three-decimal/Persian-digit handling).
function parseLineQty(text, kind) {
  const value = parseQuantity(text, { signed: kind === 'adjustment' });
  if (value === null) return null;
  if (kind === 'waste' && value <= 0) return null;
  return value;
}

function emptyLine() {
  return { productId: '', qty: '' };
}

function isLineBlank(line) {
  return line.productId === '' && line.qty.trim() === '';
}

// One product's stock card, rendered inside an expandable table row (the
// SessionsPage tasks-panel pattern): the full movement ledger oldest →
// newest, each line carrying its running quantity.
function StockCardPanel({ row }) {
  const { t } = useTranslation(['inventory', 'common']);
  const cardQuery = useQuery({
    queryKey: ['cafe-inventory', 'card', row.productId],
    queryFn: () => getProductStockCard(row.productId),
  });
  const movements = cardQuery.data?.movements ?? [];

  return (
    <div>
      <h3>{cardQuery.data?.product.name ?? row.productName}</h3>
      {cardQuery.data && (
        <p className="hint">{t('card.currentQty', { qty: formatAmount(cardQuery.data.qty) })}</p>
      )}
      {cardQuery.isPending && <p className="hint">{t('common:status.loading')}</p>}
      {cardQuery.isError && (
        <p className="error" role="alert">
          {errorMessage(cardQuery.error)}
        </p>
      )}
      {cardQuery.isSuccess && movements.length === 0 && (
        <p className="hint">{t('card.empty')}</p>
      )}
      {movements.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('card.colTime')}</th>
                <th scope="col">{t('card.colKind')}</th>
                <th scope="col">{t('card.colQty')}</th>
                <th scope="col">{t('card.colUnitCost')}</th>
                <th scope="col">{t('card.colRunning')}</th>
                <th scope="col">{t('card.colNote')}</th>
                <th scope="col">{t('card.colUser')}</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((movement) => (
                <tr key={movement.id}>
                  <td className="nowrap">{formatDateTime(movement.createdAt)}</td>
                  <td>
                    <KindBadge kind={movement.kind} />
                  </td>
                  <td className="nowrap">
                    <bdi>{formatAmount(movement.qty)}</bdi>
                  </td>
                  <td className="nowrap">
                    {formatWhole(movement.unitCost)}{' '}
                    <span className="hint">{t('money.unit')}</span>
                  </td>
                  <td className="nowrap">
                    <bdi>{formatAmount(movement.runningQty)}</bdi>
                  </td>
                  <td>{movement.note || '—'}</td>
                  <td>{movement.createdBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Record waste or a count correction: a segmented waste/adjustment toggle,
// dynamic lines (product + qty) with a per-line sign hint, a shared note, and
// — for waste — a live affected-value hint at the line's average cost.
// Mirrors the server's validation so most mistakes never leave the browser.
function CorrectionForm({ products, loading }) {
  const { t } = useTranslation(['inventory', 'common']);
  const queryClient = useQueryClient();
  const [kind, setKind] = useState('waste');
  const [lines, setLines] = useState([emptyLine()]);
  const [note, setNote] = useState('');
  const [fieldError, setFieldError] = useState('');

  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products]
  );

  const parsedLines = lines.map((line) => ({
    ...line,
    qtyValue: parseLineQty(line.qty, kind),
    product: productById.get(line.productId) ?? null,
  }));
  const wasteTotal =
    kind === 'waste'
      ? parsedLines.reduce(
          (sum, line) =>
            line.qtyValue !== null && line.product
              ? sum + Math.round(line.qtyValue * Number(line.product.avgCost))
              : sum,
          0
        )
      : null;

  const save = useMutation({
    mutationFn: recordInventory,
    onSuccess: () => {
      // A correction moves stock (and, for waste, is valued at the average
      // cost the products list carries).
      queryClient.invalidateQueries({ queryKey: ['cafe-inventory'] });
      queryClient.invalidateQueries({ queryKey: ['cafe-products'] });
      queryClient.invalidateQueries({ queryKey: ['cafe-reports'] });
      invalidateAccounting(queryClient);
      setLines([emptyLine()]);
      setNote('');
    },
  });

  function setLine(index, patch) {
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line))
    );
  }

  function handleSubmit(event) {
    event.preventDefault();
    const filled = parsedLines.filter((line) => !isLineBlank(line));
    let problem = '';
    if (filled.length === 0) {
      problem = t('form.needOneLine');
    } else {
      for (const line of filled) {
        if (line.productId === '') {
          problem = t('form.chooseProduct');
          break;
        }
        if (line.qtyValue === null) {
          problem = t('form.invalidQty');
          break;
        }
      }
      if (!problem) {
        const ids = filled.map((line) => line.productId);
        if (new Set(ids).size !== ids.length) {
          problem = t('form.duplicateProduct');
        }
      }
    }
    if (problem) {
      save.reset();
      setFieldError(problem);
      return;
    }
    setFieldError('');
    save.mutate({
      kind,
      items: filled.map((line) => ({
        productId: line.productId,
        qty: line.qtyValue,
      })),
      ...(note.trim() !== '' ? { note: note.trim() } : {}),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="edit-form">
      <div className="row">
        <span className="hint">{t('form.kindLabel')}:</span>
        <div className="segmented">
          <label>
            <input
              type="radio"
              name="cafe-inventory-kind"
              checked={kind === 'waste'}
              onChange={() => setKind('waste')}
              disabled={save.isPending}
            />
            {t('form.kindWaste')}
          </label>
          <label>
            <input
              type="radio"
              name="cafe-inventory-kind"
              checked={kind === 'adjustment'}
              onChange={() => setKind('adjustment')}
              disabled={save.isPending}
            />
            {t('form.kindAdjustment')}
          </label>
        </div>
      </div>
      <p className="hint">
        {kind === 'waste' ? t('form.wasteHint') : t('form.adjustmentHint')}
      </p>

      {!loading && products.length === 0 && (
        <p className="hint">
          {t('form.noProducts')}{' '}
          <Link to="/cafe/products">{t('form.noProductsLink')}</Link>
        </p>
      )}
      {parsedLines.map((line, index) => {
        const affected =
          line.qtyValue !== null && line.product
            ? Math.round(line.qtyValue * Number(line.product.avgCost))
            : null;
        return (
          <div className="filter-row" key={index}>
            <select
              aria-label={`${t('form.product')} ${index + 1}`}
              value={line.productId}
              onChange={(event) =>
                setLine(index, { productId: event.target.value })
              }
              disabled={loading || save.isPending}
            >
              <option value="">{t('form.productPlaceholder')}</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
            <input
              aria-label={`${t('form.qty')} ${index + 1}`}
              value={line.qty}
              className={
                line.qtyValue === null && line.qty.trim() !== ''
                  ? 'invalid'
                  : undefined
              }
              onChange={(event) => setLine(index, { qty: event.target.value })}
              inputMode="decimal"
              placeholder={
                kind === 'waste'
                  ? t('form.qtyWastePlaceholder')
                  : t('form.qtyAdjustmentPlaceholder')
              }
              autoComplete="off"
              disabled={save.isPending}
            />
            <span className="hint">
              {kind === 'waste'
                ? affected !== null
                  ? t('form.lineValue', {
                      value: formatWhole(affected),
                      unit: t('money.unit'),
                    })
                  : t('form.wasteLineHint')
                : t('form.adjustmentLineHint')}
            </span>
            <button
              type="button"
              className="quiet"
              onClick={() =>
                setLines((current) => current.filter((_, i) => i !== index))
              }
              disabled={save.isPending}
            >
              {t('form.removeItem')}
            </button>
          </div>
        );
      })}
      <div className="row">
        <button
          type="button"
          onClick={() => setLines((current) => [...current, emptyLine()])}
          disabled={save.isPending}
        >
          {t('form.addItem')}
        </button>
        {kind === 'waste' && (
          <span className="hint">
            {t('form.totalAffected', {
              value: formatWhole(wasteTotal),
              unit: t('money.unit'),
            })}
          </span>
        )}
      </div>

      <label htmlFor="cafe-inventory-note">{t('form.note')}</label>
      <input
        id="cafe-inventory-note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={500}
        autoComplete="off"
        disabled={save.isPending}
      />

      <div className="row">
        <button type="submit" disabled={save.isPending || loading}>
          {save.isPending ? t('common:actions.saving') : t('form.submit')}
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
          {t('form.recorded', { lines: save.data.recorded })}
        </p>
      )}
    </form>
  );
}

function CafeInventoryPage() {
  const { t } = useTranslation(['inventory', 'common']);
  const { can } = useAuth();

  const canView = can('cafe.view');
  const canRecord = can('cafe.inventory');
  const [expandedId, setExpandedId] = useState(null);

  const inventoryQuery = useQuery({
    queryKey: ['cafe-inventory'],
    queryFn: getCafeInventory,
    enabled: canView,
  });
  // The correction form picks from the active products (which carry the
  // average cost the live waste hint needs).
  const productsQuery = useQuery({
    queryKey: ['cafe-products', { includeInactive: false }],
    queryFn: () => listCafeProducts({ includeInactive: false }),
    enabled: canRecord,
  });

  const stock = inventoryQuery.data?.stock ?? [];
  const movements = inventoryQuery.data?.movements ?? [];
  const products = productsQuery.data ?? [];

  const toggleCard = (productId) =>
    setExpandedId((current) => (current === productId ? null : productId));

  return (
    <main className="wide">
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p className="hint">{t('hint')}</p>
        </div>
      </div>

      {canView && (
        <section className="section-card">
          <h2>{t('stock.title')}</h2>

          {inventoryQuery.isPending && (
            <p className="hint">{t('common:status.loading')}</p>
          )}
          {inventoryQuery.isError && (
            <p className="error" role="alert">
              {errorMessage(inventoryQuery.error)}
            </p>
          )}
          {inventoryQuery.data?.stock.length === 0 && (
            <EmptyState
              title={t('stock.emptyTitle')}
              description={t('stock.emptyDescription')}
            />
          )}

          {stock.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                <tr>
                  <th scope="col">{t('common:table.name')}</th>
                  <th scope="col">{t('stock.colQty')}</th>
                  <th scope="col">{t('stock.colAvgCost')}</th>
                  <th scope="col">{t('stock.colValue')}</th>
                  <th scope="col">{t('stock.colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((row) => {
                  const expanded = expandedId === row.productId;
                  const rows = [
                    <tr
                      key={row.productId}
                      className={row.isActive ? undefined : 'stale'}
                      onClick={() => toggleCard(row.productId)}
                    >
                      <th scope="row">
                        <button
                          type="button"
                          className="quiet"
                          aria-expanded={expanded}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleCard(row.productId);
                          }}
                        >
                          {row.productName}
                        </button>
                      </th>
                      <td>
                        <bdi>{formatAmount(row.qty)}</bdi>
                      </td>
                      <td>
                        {Number(row.avgCost) > 0 ? (
                          <>
                            {formatWhole(row.avgCost)}{' '}
                            <span className="hint">{t('money.unit')}</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="nowrap">
                        <bdi>{formatWhole(row.value)}</bdi>{' '}
                        <span className="hint">{t('money.unit')}</span>
                      </td>
                      <td>
                        {t(row.isActive ? 'status.active' : 'status.inactive')}
                      </td>
                    </tr>,
                  ];
                  if (expanded) {
                    rows.push(
                      <tr key={`${row.productId}-card`}>
                        <td colSpan={5}>
                          <StockCardPanel row={row} />
                        </td>
                      </tr>
                    );
                  }
                  return rows;
                })}
              </tbody>
            </table>
            </div>
          )}
        </section>
      )}

      {canRecord && (
        <section className="section-card">
          <h2>{t('form.title')}</h2>
          {productsQuery.isError ? (
            <p className="error" role="alert">
              {errorMessage(productsQuery.error)}
            </p>
          ) : (
            <CorrectionForm
              products={products}
              loading={productsQuery.isPending}
            />
          )}
        </section>
      )}

      {canView && (
        <section className="section-card">
          <h2>{t('movements.title')}</h2>

          {inventoryQuery.isPending && (
            <p className="hint">{t('common:status.loading')}</p>
          )}
          {inventoryQuery.data?.truncated && (
            <p className="hint">{t('movements.truncated')}</p>
          )}
          {movements.length === 0 &&
            !inventoryQuery.isPending &&
            !inventoryQuery.isError && (
              <EmptyState
                title={t('movements.emptyTitle')}
                description={t('movements.emptyDescription')}
              />
            )}

          {movements.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('movements.colTime')}</th>
                    <th scope="col">{t('movements.colProduct')}</th>
                    <th scope="col">{t('movements.colKind')}</th>
                    <th scope="col">{t('movements.colQty')}</th>
                    <th scope="col">{t('movements.colNote')}</th>
                    <th scope="col">{t('movements.colUser')}</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((movement) => (
                    <tr key={movement.id}>
                      <td className="nowrap">{formatDateTime(movement.createdAt)}</td>
                      <th scope="row">{movement.productName}</th>
                      <td>
                        <KindBadge kind={movement.kind} />
                      </td>
                      <td className="nowrap">
                        <bdi>{formatAmount(movement.qty)}</bdi>
                      </td>
                      <td>{movement.note || '—'}</td>
                      <td>{movement.createdBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

export default CafeInventoryPage;
