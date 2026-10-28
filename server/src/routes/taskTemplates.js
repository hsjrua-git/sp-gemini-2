import { Router } from 'express';
import pool from '../db/pool.js';
import { isUuid } from '../lib/ids.js';
import { parseTaskFields } from '../validation/schedule.js';

const router = Router();
const FOREIGN_KEY_VIOLATION = '23503';

const TEMPLATE_COLUMNS = `
  id,
  title,
  description,
  parameter_id AS "parameterId",
  extra,
  sort_order   AS "sortOrder",
  archived_at  AS "archivedAt"
`;

router.param('id', (req, res, next, value) => {
  if (!isUuid(value)) {
    return res.status(404).json({
      error: 'Task template not found.',
      code: 'NOT_FOUND',
      params: { entity: 'taskTemplate' },
    });
  }
  next();
});

router.get('/', async (req, res) => {
  const includeArchived = req.query.includeArchived === '1';
  const result = await pool.query(
    `SELECT ${TEMPLATE_COLUMNS}
     FROM task_templates
     WHERE $1 OR archived_at IS NULL
     ORDER BY sort_order, lower(title)`,
    [includeArchived]
  );
  res.json({ templates: result.rows });
});

router.post('/', async (req, res) => {
  const parsed = parseTaskFields(req.body ?? {});
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }
  try {
    const result = await pool.query(
      `INSERT INTO task_templates (title, description, parameter_id, extra, sort_order)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING ${TEMPLATE_COLUMNS}`,
      [
        parsed.value.title,
        parsed.value.description ?? null,
        parsed.value.parameterId ?? null,
        JSON.stringify(parsed.value.extra ?? {}),
        parsed.value.sortOrder ?? 0,
      ]
    );
    res.status(201).json({ template: result.rows[0] });
  } catch (err) {
    if (err.code === FOREIGN_KEY_VIOLATION) {
      return res.status(400).json({
        error: 'Referenced parameter does not exist.',
        code: 'VALIDATION_INVALID_CHOICE',
      });
    }
    throw err;
  }
});

router.patch('/:id', async (req, res) => {
  const body =
    req.body !== null && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body
      : {};
  const parsed = parseTaskFields(body, { partial: true });
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }
  if ('archived' in body && typeof body.archived !== 'boolean') {
    return res.status(400).json({
      error: 'archived must be true or false.',
      code: 'VALIDATION_INVALID_TYPE',
    });
  }

  const sets = [];
  const values = [];
  if ('title' in parsed.value) {
    values.push(parsed.value.title);
    sets.push(`title = $${values.length}`);
  }
  if ('description' in parsed.value) {
    values.push(parsed.value.description);
    sets.push(`description = $${values.length}`);
  }
  if ('parameterId' in parsed.value) {
    values.push(parsed.value.parameterId);
    sets.push(`parameter_id = $${values.length}`);
  }
  if ('extra' in parsed.value) {
    values.push(JSON.stringify(parsed.value.extra));
    sets.push(`extra = $${values.length}::jsonb`);
  }
  if ('sortOrder' in parsed.value) {
    values.push(parsed.value.sortOrder);
    sets.push(`sort_order = $${values.length}`);
  }
  if ('archived' in body) {
    sets.push(`archived_at = ${body.archived ? 'now()' : 'NULL'}`);
  }
  if (sets.length === 0) {
    return res.status(400).json({
      error: 'Nothing to change.',
      code: 'VALIDATION_NOTHING_TO_CHANGE',
    });
  }

  values.push(req.params.id);
  let result;
  try {
    result = await pool.query(
      `UPDATE task_templates
       SET ${sets.join(', ')}
       WHERE id = $${values.length}
       RETURNING ${TEMPLATE_COLUMNS}`,
      values
    );
  } catch (err) {
    if (err.code === FOREIGN_KEY_VIOLATION) {
      return res.status(400).json({
        error: 'Referenced parameter does not exist.',
        code: 'VALIDATION_INVALID_CHOICE',
      });
    }
    throw err;
  }
  if (result.rowCount === 0) {
    return res.status(404).json({
      error: 'Task template not found.',
      code: 'NOT_FOUND',
      params: { entity: 'taskTemplate' },
    });
  }
  res.json({ template: result.rows[0] });
});

// DELETE archives; tasks copied from the template keep running unchanged.
router.delete('/:id', async (req, res) => {
  const result = await pool.query(
    `UPDATE task_templates SET archived_at = now()
     WHERE id = $1 AND archived_at IS NULL
     RETURNING id`,
    [req.params.id]
  );
  if (result.rowCount === 0) {
    // Already archived, or never existed — tell them which.
    const exists = await pool.query(
      'SELECT 1 FROM task_templates WHERE id = $1',
      [req.params.id]
    );
    if (exists.rowCount === 0) {
      return res.status(404).json({
        error: 'Task template not found.',
        code: 'NOT_FOUND',
        params: { entity: 'taskTemplate' },
      });
    }
  }
  res.status(204).end();
});

export default router;
