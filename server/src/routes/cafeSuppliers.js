import { Router } from 'express';
import pool from '../db/pool.js';
import { isUuid } from '../lib/ids.js';
import { parseSupplierBody } from '../validation/cafe.js';

const router = Router();
const UNIQUE_VIOLATION = '23505';

const SUPPLIER_COLUMNS = `
  id,
  name,
  phone,
  note,
  is_active  AS "isActive",
  created_at AS "createdAt"
`;

router.param('id', (req, res, next, value) => {
  if (!isUuid(value)) {
    return res.status(404).json({
      error: 'Supplier not found.',
      code: 'NOT_FOUND',
      params: { entity: 'supplier' },
    });
  }
  next();
});

router.get('/', async (req, res) => {
  const includeInactive = req.query.includeInactive === '1';
  const result = await pool.query(
    `SELECT ${SUPPLIER_COLUMNS}
     FROM cafe_suppliers
     WHERE ${includeInactive ? 'TRUE' : 'is_active'}
     ORDER BY is_active DESC, lower(name)`
  );
  res.json({ suppliers: result.rows });
});

router.post('/', async (req, res) => {
  const parsed = parseSupplierBody(req.body ?? {});
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }
  try {
    const result = await pool.query(
      `INSERT INTO cafe_suppliers (name, phone, note)
       VALUES ($1, $2, $3)
       RETURNING ${SUPPLIER_COLUMNS}`,
      [parsed.value.name, parsed.value.phone ?? null, parsed.value.note ?? null]
    );
    res.status(201).json({ supplier: result.rows[0] });
  } catch (err) {
    if (
      err.code === UNIQUE_VIOLATION &&
      err.constraint === 'cafe_suppliers_name_unique'
    ) {
      return res.status(409).json({
        error: 'An active supplier with that name already exists.',
        code: 'VALIDATION_NOT_UNIQUE',
      });
    }
    throw err;
  }
});

router.patch('/:id', async (req, res) => {
  const parsed = parseSupplierBody(req.body ?? {}, { partial: true });
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }

  const sets = [];
  const values = [];
  const columns = {
    name: 'name',
    phone: 'phone',
    note: 'note',
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
      `UPDATE cafe_suppliers
       SET ${sets.join(', ')}
       WHERE id = $${values.length}
       RETURNING ${SUPPLIER_COLUMNS}`,
      values
    );
    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Supplier not found.',
        code: 'NOT_FOUND',
        params: { entity: 'supplier' },
      });
    }
    res.json({ supplier: result.rows[0] });
  } catch (err) {
    if (
      err.code === UNIQUE_VIOLATION &&
      err.constraint === 'cafe_suppliers_name_unique'
    ) {
      return res.status(409).json({
        error: 'An active supplier with that name already exists.',
        code: 'VALIDATION_NOT_UNIQUE',
      });
    }
    throw err;
  }
});

// Deactivate rather than delete: purchases (023) RESTRICT against removing a
// supplier that was ever bought from.
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE cafe_suppliers SET is_active = false WHERE id = $1 AND is_active
       RETURNING id`,
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Supplier not found.',
        code: 'NOT_FOUND',
        params: { entity: 'supplier' },
      });
    }
    res.status(204).end();
  } catch (err) {
    if (
      err.code === UNIQUE_VIOLATION &&
      err.constraint === 'cafe_suppliers_name_unique'
    ) {
      return res.status(409).json({
        error: 'An active supplier with that name already exists.',
        code: 'VALIDATION_NOT_UNIQUE',
      });
    }
    throw err;
  }
});

export default router;
