import { Router } from 'express';
import pool from '../db/pool.js';
import { recordAudit } from '../lib/audit.js';
import { isUuid } from '../lib/ids.js';
import { parseTaskFields } from '../validation/schedule.js';

const router = Router();
const MAX_SESSIONS_PER_ASSIGN = 200;
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

function handleTaskReferenceError(err, res) {
  if (err.code !== FOREIGN_KEY_VIOLATION && err.code !== CHECK_VIOLATION) {
    return false;
  }
  res.status(400).json({
    error: 'Choose an active parameter and a membership valid for the session date.',
    code: 'VALIDATION_INVALID_CHOICE',
  });
  return true;
}

const TASK_COLUMNS = `
  id,
  session_id    AS "sessionId",
  template_id   AS "templateId",
  parameter_id  AS "parameterId",
  membership_id AS "membershipId",
  title,
  description,
  extra,
  done,
  done_at       AS "doneAt",
  sort_order    AS "sortOrder",
  created_at    AS "createdAt"
`;

router.param('id', (req, res, next, value) => {
  if (!isUuid(value)) {
    return res.status(404).json({
      error: 'Task not found.',
      code: 'NOT_FOUND',
      params: { entity: 'task' },
    });
  }
  next();
});

router.get('/', async (req, res) => {
  const { sessionId } = req.query;
  if (!isUuid(sessionId)) {
    return res.status(400).json({
      error: 'sessionId must be a valid ID.',
      code: 'VALIDATION_INVALID_FORMAT',
      params: { field: 'sessionId' },
    });
  }
  const result = await pool.query(
    `SELECT ${TASK_COLUMNS}
     FROM tasks
     WHERE session_id = $1
     ORDER BY sort_order, created_at`,
    [sessionId]
  );
  res.json({ tasks: result.rows });
});

router.post('/', async (req, res) => {
  const { sessionId } = req.body ?? {};
  if (!isUuid(sessionId)) {
    return res.status(400).json({
      error: 'sessionId must be a valid ID.',
      code: 'VALIDATION_INVALID_FORMAT',
      params: { field: 'sessionId' },
    });
  }
  const parsed = parseTaskFields(req.body ?? {});
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }

  const session = await pool.query(
    `SELECT s.id
     FROM sessions s
     JOIN assignments a ON a.id = s.assignment_id
     WHERE s.id = $1
       AND s.archived_at IS NULL
       AND s.canceled_at IS NULL
       AND a.archived_at IS NULL`,
    [sessionId]
  );
  if (session.rowCount === 0) {
    return res.status(400).json({
      error: 'That session does not exist or is archived.',
      code: 'TASKS_SESSION_ARCHIVED',
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO tasks (session_id, parameter_id, membership_id, title, description, extra, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${TASK_COLUMNS}`,
      [
        sessionId,
        parsed.value.parameterId ?? null,
        parsed.value.membershipId ?? null,
        parsed.value.title,
        parsed.value.description ?? null,
        JSON.stringify(parsed.value.extra ?? {}),
        parsed.value.sortOrder ?? 0,
      ]
    );
    res.status(201).json({ task: result.rows[0] });
  } catch (err) {
    if (handleTaskReferenceError(err, res)) return;
    throw err;
  }
});

// Snapshot a template into one task row per session. Copies are independent:
// later template edits never change them.
router.post('/from-template', async (req, res) => {
  const { templateId } = req.body ?? {};
  const sessionIds = Array.isArray(req.body?.sessionIds) ? req.body.sessionIds : [];
  if (!isUuid(templateId)) {
    return res.status(400).json({
      error: 'templateId must be a valid ID.',
      code: 'VALIDATION_INVALID_FORMAT',
      params: { field: 'templateId' },
    });
  }
  if (
    sessionIds.length === 0 ||
    sessionIds.length > MAX_SESSIONS_PER_ASSIGN ||
    !sessionIds.every((id) => isUuid(id))
  ) {
    return res.status(400).json({
      error: `sessionIds must be 1 to ${MAX_SESSIONS_PER_ASSIGN} valid IDs.`,
      code: 'VALIDATION_INVALID_LENGTH',
      params: { min: 1, max: MAX_SESSIONS_PER_ASSIGN },
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const template = await client.query(
      `SELECT id, title, description, parameter_id AS "parameterId",
              extra, sort_order AS "sortOrder"
       FROM task_templates
       WHERE id = $1 AND archived_at IS NULL`,
      [templateId]
    );
    if (template.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'That template does not exist or is archived.',
        code: 'TASKS_TEMPLATE_ARCHIVED',
      });
    }

    const result = await client.query(
      `INSERT INTO tasks (session_id, template_id, parameter_id, membership_id, title, description, extra, sort_order)
       SELECT s.id, $1, $2, NULL, $3, $4, $5, $6
       FROM sessions s
       WHERE s.id = ANY($7::uuid[]) AND s.archived_at IS NULL
       RETURNING id`,
      [
        templateId,
        template.rows[0].parameterId,
        template.rows[0].title,
        template.rows[0].description,
        template.rows[0].extra,
        template.rows[0].sortOrder,
        sessionIds,
      ]
    );

    if (result.rowCount > 0) {
      await recordAudit(client, {
        userId: req.user.id,
        actor: req.user.username,
        action: 'task.assign_template',
        entityType: 'task',
        details: {
          templateId,
          requested: sessionIds.length,
          created: result.rowCount,
        },
      });
    }
    await client.query('COMMIT');
    res.status(201).json({ created: result.rowCount });
  } catch (err) {
    await client.query('ROLLBACK');
    if (handleTaskReferenceError(err, res)) return;
    throw err;
  } finally {
    client.release();
  }
});

router.patch('/:id', async (req, res) => {
  const body =
    req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body
      : {};
  const parsed = parseTaskFields(body, { partial: true });
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }
  if ('done' in body && typeof body.done !== 'boolean') {
    return res.status(400).json({
      error: 'done must be true or false.',
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
  if ('membershipId' in parsed.value) {
    values.push(parsed.value.membershipId);
    sets.push(`membership_id = $${values.length}`);
  }
  if ('extra' in parsed.value) {
    values.push(JSON.stringify(parsed.value.extra));
    sets.push(`extra = $${values.length}::jsonb`);
  }
  if ('sortOrder' in parsed.value) {
    values.push(parsed.value.sortOrder);
    sets.push(`sort_order = $${values.length}`);
  }
  if ('done' in body) {
    // done_at must be set exactly when done is true (tasks_done_ck); setting
    // done keeps the FIRST time it was completed.
    if (body.done) {
      sets.push('done = true, done_at = COALESCE(done_at, now())');
    } else {
      sets.push('done = false, done_at = NULL');
    }
  }
  if (sets.length === 0) {
    return res.status(400).json({
      error: 'Nothing to change.',
      code: 'VALIDATION_NOTHING_TO_CHANGE',
    });
  }

  values.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE tasks
       SET ${sets.join(', ')}
       WHERE id = $${values.length}
       RETURNING ${TASK_COLUMNS}`,
      values
    );
    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Task not found.',
        code: 'NOT_FOUND',
        params: { entity: 'task' },
      });
    }
    res.json({ task: result.rows[0] });
  } catch (err) {
    if (handleTaskReferenceError(err, res)) return;
    throw err;
  }
});

// Tasks are meant to be deleted when they are no longer useful; the audit
// middleware keeps the history.
router.delete('/:id', async (req, res) => {
  const result = await pool.query(
    'DELETE FROM tasks WHERE id = $1 RETURNING session_id AS "sessionId"',
    [req.params.id]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({
      error: 'Task not found.',
      code: 'NOT_FOUND',
      params: { entity: 'task' },
    });
  }
  const { sessionId } = result.rows[0];
  if (sessionId) {
    await pool.query('UPDATE sessions SET updated_at = now() WHERE id = $1', [
      sessionId,
    ]);
  }
  res.status(204).end();
});

export default router;
