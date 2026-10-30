import { Router } from 'express';
import pool from '../db/pool.js';
import { isUuid } from '../lib/ids.js';
import {
  MAX_VIEWS_PER_USER,
  parseViewConfig,
  parseViewName,
} from '../lib/savedViews.js';

const router = Router();
const UNIQUE_VIOLATION = '23505';
const COLUMNS = `id, name, config, updated_at AS "updatedAt"`;
const DUPLICATE = 'You already have a view with that name.';

router.param('id', (req, res, next, value) => {
  if (!isUuid(value)) {
    return res.status(404).json({
      error: 'View not found.',
      code: 'NOT_FOUND',
      params: { entity: 'view' },
    });
  }
  next();
});

router.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT ${COLUMNS} FROM saved_views
     WHERE user_id = $1
     ORDER BY lower(name)`,
    [req.user.id]
  );
  res.json({ views: result.rows });
});

router.post('/', async (req, res) => {
  const name = parseViewName(req.body?.name);
  if (name.error) {
    return res
      .status(400)
      .json({ error: name.error, code: name.code, params: name.params });
  }
  const config = parseViewConfig(req.body?.config);
  if (config.error) {
    return res
      .status(400)
      .json({ error: config.error, code: config.code, params: config.params });
  }

  const count = await pool.query(
    'SELECT count(*)::int AS count FROM saved_views WHERE user_id = $1',
    [req.user.id]
  );
  if (count.rows[0].count >= MAX_VIEWS_PER_USER) {
    return res.status(409).json({
      error: `You can keep at most ${MAX_VIEWS_PER_USER} saved views. Delete one first.`,
      code: 'SAVED_VIEWS_TOO_MANY',
      params: { max: MAX_VIEWS_PER_USER },
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO saved_views (user_id, name, config)
       VALUES ($1, $2, $3::jsonb)
       RETURNING ${COLUMNS}`,
      [req.user.id, name.value, JSON.stringify(config.value)]
    );
    res.status(201).json({ view: result.rows[0] });
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({ error: DUPLICATE, code: 'VALIDATION_NOT_UNIQUE' });
    }
    throw err;
  }
});

router.put('/:id', async (req, res) => {
  const body = req.body ?? {};
  const assignments = [];
  const values = [];

  if ('name' in body) {
    const name = parseViewName(body.name);
    if (name.error) {
      return res
        .status(400)
        .json({ error: name.error, code: name.code, params: name.params });
    }
    values.push(name.value);
    assignments.push(`name = $${values.length}`);
  }
  if ('config' in body) {
    const config = parseViewConfig(body.config);
    if (config.error) {
      return res
        .status(400)
        .json({ error: config.error, code: config.code, params: config.params });
    }
    values.push(JSON.stringify(config.value));
    assignments.push(`config = $${values.length}::jsonb`);
  }
  if (assignments.length === 0) {
    return res.status(400).json({
      error: 'Nothing to change.',
      code: 'VALIDATION_NOTHING_TO_CHANGE',
    });
  }

  values.push(req.params.id, req.user.id);
  try {
    const result = await pool.query(
      `UPDATE saved_views
       SET ${assignments.join(', ')}, updated_at = now()
       WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING ${COLUMNS}`,
      values
    );
    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'View not found.',
        code: 'NOT_FOUND',
        params: { entity: 'view' },
      });
    }
    res.json({ view: result.rows[0] });
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({ error: DUPLICATE, code: 'VALIDATION_NOT_UNIQUE' });
    }
    throw err;
  }
});

router.delete('/:id', async (req, res) => {
  const result = await pool.query(
    'DELETE FROM saved_views WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({
      error: 'View not found.',
      code: 'NOT_FOUND',
      params: { entity: 'view' },
    });
  }
  res.status(204).end();
});

export default router;