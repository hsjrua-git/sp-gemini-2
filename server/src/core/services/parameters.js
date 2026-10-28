// Parameters — service layer (framework-free).
//
// PGlite test mirror of routes/parameters.js under the schema-4 model: a
// parameter is identified by a NOT NULL unique code, its bounds are integers
// (both dimensions share the range), and there is no change log — the
// period-scoped add/remove changes and their impact math are gone. One
// guardrail survives: narrowing a range that recorded evaluations sit outside
// is refused (the route checks explicitly before the write; the DB trigger
// backs it). Plain args in, plain data out, ServiceError instead of status
// codes, getDb() for the pool, getLocalActor() for the audit row.
//
// The validation/parameter.js parser is reused unchanged.

import { getDb } from '../db.js';
import { ServiceError } from '../errors.js';
import { getLocalActor } from '../context.js';
import { parseParameterInput } from '../../validation/parameter.js';
import { recordAudit } from '../../lib/audit.js';
import { isUuid } from '../../lib/ids.js';

const PARAMETER_COLUMNS = `
  id,
  code,
  name,
  min_value    AS "minValue",
  max_value    AS "maxValue",
  sort_order   AS "sortOrder",
  archived_at  AS "archivedAt"
`;

// Map the two DB constraint violations the route special-cased to ServiceError.
function mapParameterError(err) {
  if (err && err.code === '23505') {
    return ServiceError.conflict(
      'A parameter with that name or code already exists.',
      { code: 'VALIDATION_NOT_UNIQUE' },
    );
  }
  if (err && err.code === '23514') {
    return ServiceError.validation('The value is outside the allowed range.', {
      code: 'PARAMETERS_MIN_ABOVE_MAX',
    });
  }
  return null;
}

// List parameters. `options` = { includeArchived? }.
export async function listParameters(options = {}) {
  const db = getDb();
  const includeArchived = options.includeArchived === true;
  const result = await db.query(
    `SELECT ${PARAMETER_COLUMNS}
     FROM parameters
     WHERE ${includeArchived ? 'TRUE' : 'archived_at IS NULL'}
     ORDER BY sort_order, lower(name)`
  );
  return { parameters: result.rows };
}

// Create a parameter. `input` = { code, name, minValue?, maxValue? }.
export async function createParameter(input = {}) {
  const db = getDb();
  const parsed = parseParameterInput(input);
  if (parsed.error) {
    throw ServiceError.validation(parsed.error, {
      code: parsed.code,
      params: parsed.params,
    });
  }
  const { code, name, minValue = null, maxValue = null } = parsed.values;

  try {
    const created = await db.query(
      `INSERT INTO parameters (code, name, min_value, max_value, sort_order)
       VALUES ($1, $2, $3, $4,
               (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM parameters))
       RETURNING ${PARAMETER_COLUMNS}`,
      [code, name, minValue, maxValue]
    );
    const actor = getLocalActor();
    await recordAudit(db, {
      userId: actor.userId,
      actor: actor.actor,
      action: 'parameter.create',
      entityType: 'parameter',
      entityId: created.rows[0].id,
      details: { result: created.rows[0] },
      newData: created.rows[0],
    });
    return created.rows[0];
  } catch (err) {
    const mapped = mapParameterError(err);
    if (mapped) throw mapped;
    throw err;
  }
}

// Update a parameter. `changes` is the raw body: the parsed partial fields
// plus an optional `archived` boolean. Narrowing a range that recorded
// evaluations sit outside is refused before the write.
export async function updateParameter(id, changes = {}) {
  const db = getDb();
  if (!isUuid(id)) {
    throw ServiceError.notFound('Not found.');
  }
  const parsed = parseParameterInput(changes, { partial: true });
  if (parsed.error) {
    throw ServiceError.validation(parsed.error, {
      code: parsed.code,
      params: parsed.params,
    });
  }

  const columns = {
    name: 'name',
    code: 'code',
    minValue: 'min_value',
    maxValue: 'max_value',
    sortOrder: 'sort_order',
  };
  const entries = Object.entries(parsed.values);
  if (entries.length === 0 && !('archived' in changes)) {
    throw ServiceError.validation('Nothing to change.', {
      code: 'VALIDATION_NOTHING_TO_CHANGE',
    });
  }

  const before = (
    await db.query(`SELECT ${PARAMETER_COLUMNS} FROM parameters WHERE id = $1`, [id])
  ).rows[0];
  if (!before) {
    throw ServiceError.notFound('Parameter not found.');
  }

  if ('minValue' in parsed.values || 'maxValue' in parsed.values) {
    const minValue = parsed.values.minValue ?? before.minValue;
    const maxValue = parsed.values.maxValue ?? before.maxValue;
    if (
      (minValue !== before.minValue || maxValue !== before.maxValue) &&
      (before.minValue !== null || before.maxValue !== null ||
       minValue !== null || maxValue !== null)
    ) {
      const outside = await db.query(
        `SELECT 1 FROM evaluations
         WHERE parameter_id = $1 AND archived_at IS NULL
           AND ((quality_value IS NOT NULL AND ($2::int IS NOT NULL AND quality_value < $2
                 OR $3::int IS NOT NULL AND quality_value > $3))
             OR (quantity_value IS NOT NULL AND ($2::int IS NOT NULL AND quantity_value < $2
                 OR $3::int IS NOT NULL AND quantity_value > $3)))
         LIMIT 1`,
        [id, minValue, maxValue]
      );
      if (outside.rowCount > 0) {
        throw ServiceError.conflict(
          'The range cannot be narrowed below values that are already recorded.',
          { code: 'PARAMETERS_RANGE_LOCKED' }
        );
      }
    }
  }

  const sets = [];
  const values = [];
  for (const [key, value] of entries) {
    values.push(value);
    sets.push(`${columns[key]} = $${values.length}`);
  }
  if ('archived' in changes) {
    if (typeof changes.archived !== 'boolean') {
      throw ServiceError.validation('archived must be true or false.', {
        code: 'VALIDATION_INVALID_TYPE',
      });
    }
    sets.push(`archived_at = ${changes.archived ? 'now()' : 'NULL'}`);
  }

  try {
    const result = await db.query(
      `UPDATE parameters
       SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $${values.length + 1}
       RETURNING ${PARAMETER_COLUMNS}`,
      [...values, id]
    );
    if (result.rowCount === 0) {
      throw ServiceError.notFound('Parameter not found.');
    }
    const actor = getLocalActor();
    await recordAudit(db, {
      userId: actor.userId,
      actor: actor.actor,
      action: 'parameter.update',
      entityType: 'parameter',
      entityId: id,
      details: { result: result.rows[0] },
      oldData: before,
      newData: result.rows[0],
    });
    return result.rows[0];
  } catch (err) {
    const mapped = mapParameterError(err);
    if (mapped) throw mapped;
    throw err;
  }
}
