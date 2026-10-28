import { Router } from 'express';
import pool from '../db/pool.js';
import { parseParameterInput } from '../validation/parameter.js';
import { recordAudit } from '../lib/audit.js';

const router = Router();

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

const PARAMETER_COLUMNS = `
  id,
  code,
  name,
  min_value    AS "minValue",
  max_value    AS "maxValue",
  sort_order   AS "sortOrder",
  archived_at  AS "archivedAt"
`;

router.param('id', (req, res, next, value) => {
  const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_PATTERN.test(value)) {
    return res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' });
  }
  next();
});

function handleParameterError(err, res) {
  if (err.code === UNIQUE_VIOLATION) {
    res.status(409).json({
      error: 'A parameter with that name or code already exists.',
      code: 'VALIDATION_NOT_UNIQUE',
    });
    return true;
  }
  if (err.code === CHECK_VIOLATION) {
    res.status(400).json({
      error: 'The value is outside the allowed range.',
      code: 'PARAMETERS_MIN_ABOVE_MAX',
    });
    return true;
  }
  return false;
}

router.get('/parameters', async (req, res) => {
  const includeArchived = req.query.includeArchived === '1';
  const result = await pool.query(
    `SELECT ${PARAMETER_COLUMNS}
     FROM parameters
     WHERE ${includeArchived ? 'TRUE' : 'archived_at IS NULL'}
     ORDER BY sort_order, lower(name)`
  );
  res.json({ parameters: result.rows });
});

router.post('/parameters', async (req, res) => {
  const parsed = parseParameterInput(req.body);
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }

  const { code, name, minValue = null, maxValue = null } = parsed.values;

  try {
    const created = await pool.query(
      `INSERT INTO parameters (code, name, min_value, max_value, sort_order)
       VALUES ($1, $2, $3, $4,
               (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM parameters))
       RETURNING ${PARAMETER_COLUMNS}`,
      [code, name, minValue, maxValue]
    );
    await recordAudit(pool, {
      userId: req.user.id,
      actor: req.user.username,
      action: 'parameter.create',
      entityType: 'parameter',
      entityId: created.rows[0].id,
      details: { result: created.rows[0] },
      newData: created.rows[0],
    });
    res.status(201).json(created.rows[0]);
  } catch (err) {
    if (handleParameterError(err, res)) return;
    throw err;
  }
});

router.patch('/parameters/:id', async (req, res) => {
  const parsed = parseParameterInput(req.body, { partial: true });
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }

  const columns = {
    name: 'name',
    code: 'code',
    minValue: 'min_value',
    maxValue: 'max_value',
    sortOrder: 'sort_order',
  };
  const entries = Object.entries(parsed.values);
  if (entries.length === 0 && !('archived' in (req.body ?? {}))) {
    return res.status(400).json({
      error: 'Nothing to change.',
      code: 'VALIDATION_NOTHING_TO_CHANGE',
    });
  }

  const before = (await pool.query(
    `SELECT ${PARAMETER_COLUMNS} FROM parameters WHERE id = $1`,
    [req.params.id]
  )).rows[0];
  if (!before) {
    return res.status(404).json({
      error: 'Parameter not found.',
      code: 'NOT_FOUND',
      params: { entity: 'parameter' },
    });
  }

  // Narrowing a range that existing evaluations sit outside is refused by the
  // range-narrowing trigger; the explicit check here gives the friendlier
  // message before the write even happens.
  if ('minValue' in parsed.values || 'maxValue' in parsed.values) {
    const minValue = parsed.values.minValue ?? before.minValue;
    const maxValue = parsed.values.maxValue ?? before.maxValue;
    if (
      (minValue !== before.minValue || maxValue !== before.maxValue) &&
      (before.minValue !== null || before.maxValue !== null ||
       minValue !== null || maxValue !== null)
    ) {
      const outside = await pool.query(
        `SELECT 1 FROM evaluations
         WHERE parameter_id = $1 AND archived_at IS NULL
           AND ((quality_value IS NOT NULL AND ($2::int IS NOT NULL AND quality_value < $2
                 OR $3::int IS NOT NULL AND quality_value > $3))
             OR (quantity_value IS NOT NULL AND ($2::int IS NOT NULL AND quantity_value < $2
                 OR $3::int IS NOT NULL AND quantity_value > $3)))
         LIMIT 1`,
        [req.params.id, minValue, maxValue]
      );
      if (outside.rowCount > 0) {
        return res.status(409).json({
          error:
            'The range cannot be narrowed below values that are already recorded.',
          code: 'PARAMETERS_RANGE_LOCKED',
        });
      }
    }
  }

  const sets = [];
  const values = [];
  for (const [key, value] of entries) {
    values.push(value);
    sets.push(`${columns[key]} = $${values.length}`);
  }
  if ('archived' in (req.body ?? {})) {
    if (typeof req.body.archived !== 'boolean') {
      return res.status(400).json({
        error: 'archived must be true or false.',
        code: 'VALIDATION_INVALID_TYPE',
      });
    }
    sets.push(`archived_at = ${req.body.archived ? 'now()' : 'NULL'}`);
  }

  try {
    const result = await pool.query(
      `UPDATE parameters
       SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $${values.length + 1}
       RETURNING ${PARAMETER_COLUMNS}`,
      [...values, req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Parameter not found.',
        code: 'NOT_FOUND',
        params: { entity: 'parameter' },
      });
    }
    await recordAudit(pool, {
      userId: req.user.id,
      actor: req.user.username,
      action: 'parameter.update',
      entityType: 'parameter',
      entityId: req.params.id,
      details: { result: result.rows[0] },
      oldData: before,
      newData: result.rows[0],
    });
    res.json(result.rows[0]);
  } catch (err) {
    if (handleParameterError(err, res)) return;
    throw err;
  }
});

export default router;
