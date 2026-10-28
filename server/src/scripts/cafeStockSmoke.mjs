// One-off smoke test for the cafe stock ledger (023) against the live
// database, entirely inside a transaction that rolls back. Run with:
//   node --env-file=.env src/scripts/cafeStockSmoke.mjs
// Exercises lib/cafeStock.js — the same function the route calls.

import assert from 'node:assert/strict';
import pool from '../db/pool.js';
import { updateAverageCost } from '../lib/cafeStock.js';

const client = await pool.connect();
async function purchase(productIds, lines) {
  const pu = await client.query(
    `INSERT INTO cafe_purchases (supplier_id, created_by) VALUES ($1, $2) RETURNING id`,
    [supplierId, userId]
  );
  for (const [productId, qty, unitCost] of lines) {
    await client.query(
      `INSERT INTO cafe_purchase_items (purchase_id, product_id, qty, unit_cost)
       VALUES ($1, $2, $3, $4)`,
      [pu.rows[0].id, productId, qty, unitCost]
    );
    await client.query(
      `INSERT INTO cafe_stock_movements
         (product_id, kind, qty, unit_cost, reference_type, reference_id, created_by)
       VALUES ($1, 'purchase', $2, $3, 'purchase', $4, $5)`,
      [productId, qty, unitCost, pu.rows[0].id, userId]
    );
  }
  await updateAverageCost(client, pu.rows[0].id);
  return pu.rows[0].id;
}

let supplierId;
let userId;

try {
  await client.query('BEGIN');

  const user = await client.query(
    'SELECT id FROM users WHERE is_active ORDER BY created_at LIMIT 1'
  );
  assert.ok(user.rows[0], 'an active user exists');
  userId = user.rows[0].id;

  const supplier = await client.query(
    `INSERT INTO cafe_suppliers (name) VALUES ('ZZSmoke Dairy') RETURNING id`
  );
  supplierId = supplier.rows[0].id;
  const product = await client.query(
    `INSERT INTO cafe_products (name, price) VALUES ('ZZSmoke Milk', 20000) RETURNING id`
  );
  const productId = product.rows[0].id;

  const readStock = async () => {
    const row = await client.query(
      'SELECT qty::float8, avg_cost FROM cafe_stock WHERE product_id = $1',
      [productId]
    );
    return { qty: row.rows[0].qty, avg: Number(row.rows[0].avg_cost) };
  };

  // 1. First delivery into empty stock: the average IS this cost.
  await purchase(productId, [[productId, 10, 15000]]);
  assert.deepEqual(
    await readStock(),
    { qty: 10, avg: 15000 },
    'first delivery sets the average'
  );

  // 2. Second delivery at a different cost: weighted average
  //    (10*15000 + 30*18000)/40 = 17250.
  await purchase(productId, [[productId, 30, 18000]]);
  assert.deepEqual(
    await readStock(),
    { qty: 40, avg: 17250 },
    'second delivery weights the average'
  );

  // 3. A waste movement pulls stock down; the average is untouched.
  await client.query(
    `INSERT INTO cafe_stock_movements (product_id, kind, qty, unit_cost, created_by)
     VALUES ($1, 'waste', -5, 0, $2)`,
    [productId, userId]
  );
  assert.deepEqual(
    await readStock(),
    { qty: 35, avg: 17250 },
    'waste reduces stock, not the average'
  );

  // 4. Sold below stock then re-purchased: the leftover-less delivery
  //    defines the new average (no division by a negative stock).
  await client.query(
    `INSERT INTO cafe_stock_movements (product_id, kind, qty, unit_cost, created_by)
     VALUES ($1, 'sale', -35, 17250, $2)`,
    [productId, userId]
  );
  await purchase(productId, [[productId, 4, 20000]]);
  assert.deepEqual(
    await readStock(),
    { qty: 4, avg: 20000 },
    'delivery into empty stock resets the average'
  );

  // 5. The ledger is append-only. Each refusal aborts the surrounding
  //    transaction, so every probe runs inside its own savepoint.
  const expectAppendOnly = async (sql) => {
    await client.query('SAVEPOINT probe');
    await assert.rejects(() => client.query(sql), /append-only/);
    await client.query('ROLLBACK TO SAVEPOINT probe');
  };
  await expectAppendOnly('DELETE FROM cafe_stock_movements WHERE true');
  await expectAppendOnly('UPDATE cafe_stock_movements SET qty = 0 WHERE true');

  // 6. A product with movements cannot be deleted (RESTRICT).
  await client.query('SAVEPOINT probe');
  await assert.rejects(
    () => client.query('DELETE FROM cafe_products WHERE id = $1', [productId]),
    /violates foreign key/,
    'a product with history cannot be deleted'
  );
  await client.query('ROLLBACK TO SAVEPOINT probe');

  console.log('cafe stock smoke: all 6 checks passed');
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}
