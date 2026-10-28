import { Router } from 'express';
import pool from '../db/pool.js';
import { isUuid } from '../lib/ids.js';
import { parseIntervalBody } from '../validation/schedule.js';

const router = Router();
const UNIQUE_VIOLATION = '23505';

const INTERVAL_COLUMNS = `
  id,
  name,
  every,
  sort_order  AS "sortOrder",
  archived_at AS "archivedAt"
`;

router.param('id', (req, res, next, value) => {
  if (!isUuid(value)) {
    return res.status(404).json({
      error: 'Interval not found.',
      code: 'NOT_FOUND',
      params: { entity: 'interval' },
    });
  }
  next();
});

router.get('/', async (req, res) => {
  const includeArchived = req.query.includeArchived === '1';
  const result = await pool.query(
    `SELECT ${INTERVAL_COLUMNS}
     FROM intervals
     WHERE $1 OR archived_at IS NULL
     ORDER BY sort_order, lower(name)`,
    [includeArchived]
  );
  res.json({ intervals: result.rows });
});

router.post('/', async (req, res) => {
  const parsed = parseIntervalBody(req.body ?? {});
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }
  try {
    const result = await pool.query(
      `INSERT INTO intervals (name, every, sort_order)
       VALUES ($1, $2::interval, $3)
       RETURNING ${INTERVAL_COLUMNS}`,
      [parsed.value.name, parsed.value.every, parsed.value.sortOrder ?? 0]
    );
    return res.status(201).json({ interval: result.rows[0] });
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({
        error: 'An interval with that name already exists.',
        code: 'VALIDATION_NOT_UNIQUE',
      });
    }
    throw err;
  }
});

router.patch('/:id', async (req, res) => {
  const parsed = parseIntervalBody(req.body ?? {}, { partial: true });
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }

  const sets = [];
  const values = [];
  if ('name' in parsed.value) {
    values.push(parsed.value.name);
    sets.push(`name = $${values.length}`);
  }
  if ('every' in parsed.value) {
    values.push(parsed.value.every);
    sets.push(`every = $${values.length}::interval`);
  }
  if ('sortOrder' in parsed.value) {
    values.push(parsed.value.sortOrder);
    sets.push(`sort_order = $${values.length}`);
  }
  if ('archived' in parsed.value) {
    sets.push(`archived_at = ${parsed.value.archived ? 'now()' : 'NULL'}`);
  }

  values.push(req.params.id);
  let interval;
  try {
    const result = await pool.query(
      `UPDATE intervals
       SET ${sets.join(', ')}
       WHERE id = $${values.length}
       RETURNING ${INTERVAL_COLUMNS}`,
      values
    );
    interval = result.rows[0];
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({
        error: 'An interval with that name already exists.',
        code: 'VALIDATION_NOT_UNIQUE',
      });
    }
    throw err;
  }
  if (!interval) {
    return res.status(404).json({
      error: 'Interval not found.',
      code: 'NOT_FOUND',
      params: { entity: 'interval' },
    });
  }
  res.json({ interval });
});

// DELETE archives; assignments keep pointing at the archived row.
router.delete('/:id', async (req, res) => {
  const result = await pool.query(
    `UPDATE intervals SET archived_at = now()
     WHERE id = $1 AND archived_at IS NULL
     RETURNING id`,
    [req.params.id]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({
      error: 'Interval not found.',
      code: 'NOT_FOUND',
      params: { entity: 'interval' },
    });
  }
  res.status(204).end();
});

export default router;
