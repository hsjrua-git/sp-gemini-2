// The sale lifecycle as reusable transactions: create (price/cost snapshots,
// stock out, balance charge — OVERDRAFT ALLOWED) and void (stock back,
// balance refund). Routes stay thin; the smoke test exercises these directly.

import { applyBalanceChange } from './cafeBalance.js';
import { findEntryBySource, postMappedEvent, voidEntry } from './accountingJournal.js';
import { recordAudit } from './audit.js';

// `user` is the acting request user ({ id, username }). Returns the created
// sale id and totals (the caller re-reads the full row for the response).
export async function createSale(db, { user, customer, studentId, items, note }) {
  const productIds = items.map((item) => item.productId);

  if (customer === 'student') {
    const student = await db.query(
      'SELECT id FROM students WHERE id = $1 AND deleted_at IS NULL',
      [studentId]
    );
    if (student.rowCount === 0) {
      return { error: 'CAFE_STUDENT_INACTIVE' };
    }
  }

  // Lock the products in a stable order; the current price fills any line
  // without an explicit one, and avg_cost is the cost snapshot.
  const products = await db.query(
    `SELECT id, price, avg_cost FROM cafe_products
     WHERE id = ANY($1::uuid[]) AND is_active
     ORDER BY id
     FOR UPDATE`,
    [productIds]
  );
  const byId = new Map(products.rows.map((row) => [row.id, row]));
  if (byId.size !== new Set(productIds).size) {
    return { error: 'CAFE_PRODUCT_INACTIVE' };
  }

  const resolved = items.map((item) => ({
    productId: item.productId,
    qty: item.qty,
    unitPrice: item.unitPrice ?? Number(byId.get(item.productId).price),
    unitCost: Number(byId.get(item.productId).avg_cost),
  }));

  const sale = await db.query(
    `INSERT INTO cafe_sales (sold_by, customer, student_id, note)
     VALUES ($1, $2, $3, $4)
     RETURNING id, sold_at::date AS day`,
    [user.id, customer, studentId ?? null, note ?? null]
  );
  const saleId = sale.rows[0].id;

  await db.query(
    `INSERT INTO cafe_sale_items (sale_id, product_id, qty, unit_price, unit_cost)
     SELECT $1, x.product_id, x.qty, x.unit_price, x.unit_cost
     FROM unnest($2::uuid[], $3::numeric[], $4::bigint[], $5::bigint[])
       AS x(product_id, qty, unit_price, unit_cost)`,
    [
      saleId,
      resolved.map((item) => item.productId),
      resolved.map((item) => item.qty),
      resolved.map((item) => item.unitPrice),
      resolved.map((item) => item.unitCost),
    ]
  );

  const totals = await db.query(
    `SELECT COALESCE(SUM(qty * unit_price), 0)::bigint AS total,
            COALESCE(SUM(qty * unit_cost), 0)::bigint AS cost_total
     FROM cafe_sale_items WHERE sale_id = $1`,
    [saleId]
  );
  const total = Number(totals.rows[0].total);
  const costTotal = Number(totals.rows[0].cost_total);
  await db.query(
    'UPDATE cafe_sales SET total = $2, cost_total = $3 WHERE id = $1',
    [saleId, total, costTotal]
  );

  await db.query(
    `INSERT INTO cafe_stock_movements
       (product_id, kind, qty, unit_cost, reference_type, reference_id, created_by)
     SELECT x.product_id, 'sale', -x.qty, x.unit_cost, 'sale', $1, $2
     FROM unnest($3::uuid[], $4::numeric[], $5::bigint[])
       AS x(product_id, qty, unit_cost)`,
    [
      saleId,
      user.id,
      resolved.map((item) => item.productId),
      resolved.map((item) => item.qty),
      resolved.map((item) => item.unitCost),
    ]
  );

  let balanceAfter = null;
  if (customer === 'student') {
    balanceAfter = await applyBalanceChange(db, {
      studentId,
      delta: -total,
      kind: 'charge',
      referenceType: 'sale',
      referenceId: saleId,
      createdBy: user.id,
    });
  }

  // Auto-post to the journal when the mappings are active: the revenue pair
  // for this customer type plus the COGS pair, all in one entry inside the
  // sale's transaction. Inactive mappings make this a no-op.
  const accounting = await postMappedEvent(db, {
    user,
    sourceType: 'cafe_sale',
    sourceId: saleId,
    date: sale.rows[0].day,
    memo: customer === 'student' ? 'Cafe sale (student)' : 'Cafe sale (walk-in)',
    pairs: [
      {
        event: customer === 'student' ? 'cafe.sale_student' : 'cafe.sale_walk_in',
        amount: total,
      },
      { event: 'cafe.cogs', amount: costTotal },
    ],
  });

  await recordAudit(db, {
    userId: user.id,
    actor: user.username,
    action: 'cafe_sale.create',
    entityType: 'cafe_sale',
    details: {
      saleId,
      customer,
      itemCount: items.length,
      total,
      costTotal,
      balanceAfter,
      journalEntryNo: accounting.posted ? accounting.entryNo : null,
      note: note ?? null,
    },
  });

  return { saleId, total, costTotal, balanceAfter };
}

export async function voidSale(db, { user, saleId }) {
  const sale = await db.query(
    `SELECT id, customer, student_id AS "studentId", total, voided_at AS "voidedAt"
     FROM cafe_sales WHERE id = $1 FOR UPDATE`,
    [saleId]
  );
  if (sale.rowCount === 0) return { error: 'NOT_FOUND' };
  if (sale.rows[0].voidedAt !== null) return { error: 'CAFE_SALE_ALREADY_VOIDED' };
  const { customer, studentId, total } = sale.rows[0];

  await db.query(
    `INSERT INTO cafe_stock_movements
       (product_id, kind, qty, unit_cost, reference_type, reference_id, created_by)
     SELECT si.product_id, 'sale', si.qty, si.unit_cost, 'sale_void', si.sale_id, $2
     FROM cafe_sale_items si WHERE si.sale_id = $1`,
    [saleId, user.id]
  );

  let balanceAfter = null;
  if (customer === 'student') {
    balanceAfter = await applyBalanceChange(db, {
      studentId,
      delta: total,
      kind: 'refund',
      referenceType: 'sale_void',
      referenceId: saleId,
      note: 'Voided sale',
      createdBy: user.id,
    });
  }

  await db.query(
    'UPDATE cafe_sales SET voided_at = now(), voided_by = $2 WHERE id = $1',
    [saleId, user.id]
  );

  // The sale's journal entry (if one was posted) is voided in the same
  // transaction — voiding unposts its economics, which is exactly the
  // reversal the books need.
  const entry = await findEntryBySource(db, 'cafe_sale', saleId);
  if (entry) {
    const voidedEntry = await voidEntry(db, { user, entryId: entry.id });
    if (voidedEntry?.error) {
      return voidedEntry;
    }
  }

  await recordAudit(db, {
    userId: user.id,
    actor: user.username,
    action: 'cafe_sale.void',
    entityType: 'cafe_sale',
    details: { saleId, total, balanceAfter },
  });

  return { total, balanceAfter };
}
