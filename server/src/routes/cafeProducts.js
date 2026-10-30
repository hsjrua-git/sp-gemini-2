import { Router } from 'express';
import pool from '../db/pool.js';
import { isUuid } from '../lib/ids.js';
import { parseProductBody } from '../validation/cafe.js';

const router = Router();
const UNIQUE_VIOLATION = '23505';

const PRODUCT_COLUMNS = `
  id,
  name,
  price,
  is_active  AS "isActive",
  sort_order AS "sortOrder",
  avg_cost   AS "avgCost",
  created_at AS "createdAt"
`;

router.param('id', (req, res, next, value) => {
  if (!isUuid(value)) {
    return res.status(404).json({
      error: 'Product not found.',
      code: 'NOT_FOUND',
      params: { entity: 'product' },
    });
  }
  next();
});

router.get('/', async (req, res) => {
  const includeInactive = req.query.includeInactive === '1';
  const result = await pool.query(
    `SELECT ${PRODUCT_COLUMNS}
     FROM cafe_products
     WHERE ${includeInactive ? 'TRUE' : 'is_active'}
     ORDER BY is_active DESC, sort_order, lower(name)`
  );
  res.json({ products: result.rows });
});

router.post('/', async (req, res) => {
  const parsed = parseProductBody(req.body ?? {});
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }
  try {
    const result = await pool.query(
      `INSERT INTO cafe_products (name, price, sort_order)
       VALUES ($1, $2, $3)
       RETURNING ${PRODUCT_COLUMNS}`,
      [parsed.value.name, parsed.value.price, parsed.value.sortOrder ?? 0]
    );
    res.status(201).json({ product: result.rows[0] });
  } catch (err) {
    if (
      err.code === UNIQUE_VIOLATION &&
      err.constraint === 'cafe_products_name_unique'
    ) {
      return res.status(409).json({
        error: 'An active product with that name already exists.',
        code: 'VALIDATION_NOT_UNIQUE',
      });
    }
    throw err;
  }
});

router.patch('/:id', async (req, res) => {
  const parsed = parseProductBody(req.body ?? {}, { partial: true });
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }

  const sets = [];
  const values = [];
  const columns = {
    name: 'name',
    price: 'price',
    sortOrder: 'sort_order',
    isActive: 'is_active',
  };
  for (const [key, column] of Object.entries(columns)) {
    if (key in parsed.value) {
      values.push(parsed.value[key]);
      sets.push(`${column} = $${values.length}`);
    }
  }

  values.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE cafe_products
       SET ${sets.join(', ')}
       WHERE id = $${values.length}
       RETURNING ${PRODUCT_COLUMNS}`,
      values
    );
    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Product not found.',
        code: 'NOT_FOUND',
        params: { entity: 'product' },
      });
    }
    res.json({ product: result.rows[0] });
  } catch (err) {
    if (
      err.code === UNIQUE_VIOLATION &&
      err.constraint === 'cafe_products_name_unique'
    ) {
      return res.status(409).json({
        error: 'An active product with that name already exists.',
        code: 'VALIDATION_NOT_UNIQUE',
      });
    }
    throw err;
  }
});

// Deactivate rather than delete: the stock ledger (023) RESTRICTs against
// removing a product that ever moved.
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE cafe_products SET is_active = false WHERE id = $1 AND is_active
       RETURNING id`,
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Product not found.',
        code: 'NOT_FOUND',
        params: { entity: 'product' },
      });
    }
    res.status(204).end();
  } catch (err) {
    if (
      err.code === UNIQUE_VIOLATION &&
      err.constraint === 'cafe_products_name_unique'
    ) {
      // Reactivating elsewhere freed the name; this deactivation cannot
      // collide, but stay safe if the index ever changes shape.
      return res.status(409).json({
        error: 'An active product with that name already exists.',
        code: 'VALIDATION_NOT_UNIQUE',
      });
    }
    throw err;
  }
});

export default router;
