// Audit log reader — service layer (framework-free).
//
// PGlite test mirror of routes/audit.js. A pure read: no audit of its own,
// no req.user. Conversion is mechanical — pool→getDb(), the two 400s become
// ServiceError.validation, and the query string is coerced explicitly by the
// caller-facing args. The category whitelisting and the details.changes
// truncation are preserved verbatim; the rows now also carry the schema-4
// row snapshots (old_data/new_data).
//
// Writes still come from lib/audit.js (recordAudit), driven by the services
// that mutate; this only reads what they recorded.

import { getDb } from '../db.js';
import { ServiceError } from '../errors.js';
import { AUDIT_CATEGORIES, AUDIT_CATEGORY_PREFIXES } from '../../lib/auditCategories.js';

const PAGE_SIZE = 25;
const MAX_DETAIL_CHANGES = 50;

function toPositiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

// Read a page of the audit log. `filters` = { category?, actor?, page? }.
// Unknown category or a bad actor filter → VALIDATION. Returns
// { entries, total, page, pageSize }.
export async function getAuditEntries(filters = {}) {
  const db = getDb();
  const { category, actor } = filters;
  const page = Math.min(toPositiveInt(filters.page, 1), 100000);

  const conditions = [];
  const values = [];

  if (category !== undefined) {
    if (typeof category !== 'string' || !AUDIT_CATEGORIES.includes(category)) {
      throw ServiceError.validation('Unknown category.');
    }
    values.push(AUDIT_CATEGORY_PREFIXES[category]);
    conditions.push(`split_part(a.action, '.', 1) = ANY($${values.length}::text[])`);
  }
  if (actor !== undefined) {
    if (typeof actor !== 'string' || actor === '' || actor.length > 64) {
      throw ServiceError.validation('Invalid user filter.');
    }
    values.push(actor.toLowerCase());
    conditions.push(`lower(a.actor) = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countResult, listResult] = await Promise.all([
    db.query(`SELECT count(*)::int AS total FROM audit_log a ${where}`, values),
    db.query(
      `SELECT a.id::text        AS id,
              a.occurred_at     AS "occurredAt",
              a.actor,
              a.action,
              a.entity_type     AS "entityType",
              a.entity_id       AS "entityId",
              a.details,
              a.old_data        AS "oldData",
              a.new_data        AS "newData",
              s.full_name       AS "studentName",
              s.student_code    AS "studentCode",
              p.name            AS "parameterName"
       FROM audit_log a
       LEFT JOIN students s
         ON a.entity_type = 'student' AND s.id::text = a.entity_id
       LEFT JOIN parameters p
         ON a.entity_type = 'parameter' AND p.id::text = a.entity_id
       ${where}
       ORDER BY a.occurred_at DESC, a.id DESC
       LIMIT ${PAGE_SIZE} OFFSET $${values.length + 1}`,
      [...values, (page - 1) * PAGE_SIZE],
    ),
  ]);

  const entries = listResult.rows.map((row) => {
    const changes = row.details?.changes;
    if (Array.isArray(changes) && changes.length > MAX_DETAIL_CHANGES) {
      return {
        ...row,
        details: {
          ...row.details,
          changes: changes.slice(0, MAX_DETAIL_CHANGES),
          moreChanges: changes.length - MAX_DETAIL_CHANGES,
        },
      };
    }
    return row;
  });

  return {
    entries,
    total: countResult.rows[0].total,
    page,
    pageSize: PAGE_SIZE,
  };
}
