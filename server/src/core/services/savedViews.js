// Saved result views — service layer (framework-free).
//
// On-device equivalent of routes/savedViews.js. Same peeling as the other
// services: plain args in, plain data out, ServiceError instead of status
// codes, getDb() for the pool, getLocalUserId() in place of req.user.id.
// The route's router.param('id') uuid guard (which returned 404 for a
// non-uuid) becomes an isUuid check returning NOT_FOUND at the top of each
// id-taking function. Name/config validation stays in lib/savedViews.js.
//
// saved_views.user_id is a NOT NULL FK to users(id), so ensureLocalUser() MUST
// have run first (at startup, and in any test that touches this).

import { getDb } from '../db.js';
import { ServiceError } from '../errors.js';
import { getLocalUserId } from '../context.js';
import { isUuid } from '../../lib/ids.js';
import {
  MAX_VIEWS_PER_USER,
  parseViewConfig,
  parseViewName,
} from '../../lib/savedViews.js';

const COLUMNS = `id, name, config, updated_at AS "updatedAt"`;
const DUPLICATE = 'You already have a view with that name.';

// List this user's saved views, alphabetically.
export async function listViews() {
  const db = getDb();
  const result = await db.query(
    `SELECT ${COLUMNS} FROM saved_views
     WHERE user_id = $1
     ORDER BY lower(name)`,
    [getLocalUserId()],
  );
  return { views: result.rows };
}

// Create a saved view. `input` = { name, config }. Enforces the per-user cap
// (CONFLICT) and rejects a duplicate name (CONFLICT).
export async function createView(input = {}) {
  const db = getDb();

  const name = parseViewName(input.name);
  if (name.error) throw ServiceError.validation(name.error);
  const config = parseViewConfig(input.config);
  if (config.error) throw ServiceError.validation(config.error);

  const userId = getLocalUserId();
  const count = await db.query(
    'SELECT count(*)::int AS count FROM saved_views WHERE user_id = $1',
    [userId],
  );
  if (count.rows[0].count >= MAX_VIEWS_PER_USER) {
    throw ServiceError.conflict(
      `You can keep at most ${MAX_VIEWS_PER_USER} saved views. Delete one first.`,
    );
  }

  try {
    const result = await db.query(
      `INSERT INTO saved_views (user_id, name, config)
       VALUES ($1, $2, $3::jsonb)
       RETURNING ${COLUMNS}`,
      [userId, name.value, JSON.stringify(config.value)],
    );
    return { view: result.rows[0] };
  } catch (err) {
    if (err && err.code === '23505') throw ServiceError.conflict(DUPLICATE);
    throw err;
  }
}

// Update a saved view. `changes` may include name and/or config. Nothing to
// change → VALIDATION; missing view (or someone else's) → NOT_FOUND; duplicate
// name → CONFLICT.
export async function updateView(id, changes = {}) {
  const db = getDb();
  if (!isUuid(id)) throw ServiceError.notFound('View not found.');

  const assignments = [];
  const values = [];
  if ('name' in changes) {
    const name = parseViewName(changes.name);
    if (name.error) throw ServiceError.validation(name.error);
    values.push(name.value);
    assignments.push(`name = $${values.length}`);
  }
  if ('config' in changes) {
    const config = parseViewConfig(changes.config);
    if (config.error) throw ServiceError.validation(config.error);
    values.push(JSON.stringify(config.value));
    assignments.push(`config = $${values.length}::jsonb`);
  }
  if (assignments.length === 0) {
    throw ServiceError.validation('Nothing to change.');
  }

  values.push(id, getLocalUserId());
  try {
    const result = await db.query(
      `UPDATE saved_views
       SET ${assignments.join(', ')}, updated_at = now()
       WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING ${COLUMNS}`,
      values,
    );
    if (result.rowCount === 0) throw ServiceError.notFound('View not found.');
    return { view: result.rows[0] };
  } catch (err) {
    if (err && err.code === '23505') throw ServiceError.conflict(DUPLICATE);
    throw err;
  }
}

// Delete a saved view. Missing view (or someone else's) → NOT_FOUND.
export async function deleteView(id) {
  const db = getDb();
  if (!isUuid(id)) throw ServiceError.notFound('View not found.');

  const result = await db.query(
    'DELETE FROM saved_views WHERE id = $1 AND user_id = $2',
    [id, getLocalUserId()],
  );
  if (result.rowCount === 0) throw ServiceError.notFound('View not found.');
}
