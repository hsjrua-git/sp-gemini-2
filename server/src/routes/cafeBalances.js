import { Router } from 'express';
import pool from '../db/pool.js';
import { recordAudit } from '../lib/audit.js';
import { applyBalanceChange } from '../lib/cafeBalance.js';
import { requireAnyPermission, requirePermission } from '../middleware/auth.js';
import { isUuid } from '../lib/ids.js';
import { parseBalanceBody } from '../validation/cafe.js';

const router = Router();
const MAX_LISTED = 100;

// The POS needs to find a student WITHOUT students.view: the blind-entry
// precedent — minimal identity only (name, code, balance), nothing else.
router.use(requireAnyPermission('cafe.sell', 'cafe.balance'));

function escapeLike(text) {
  return text.replace(/[\\%_]/g, '\\$&');
}

router.get('/students', async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  if (search.length > 100) {
    return res.status(400).json({
      error: 'Search text is too long.',
      code: 'VALIDATION_TOO_LONG',
      params: { max: 100 },
    });
  }

  const values = [];
  let where = 's.deleted_at IS NULL';
  if (search) {
    values.push(`%${escapeLike(search)}%`);
    where += ` AND (s.full_name ILIKE $1 OR s.student_code ILIKE $1)`;
  }

  const result = await pool.query(
    `SELECT s.id,
            s.full_name AS "fullName",
            s.student_code AS "code",
            COALESCE(b.balance, 0) AS balance
     FROM students s
     LEFT JOIN student_balances b ON b.student_id = s.id
     WHERE ${where}
     ORDER BY s.full_name
     LIMIT 20`
    ,
    values
  );
  res.json({ students: result.rows });
});

router.get('/:studentId', async (req, res) => {
  if (!isUuid(req.params.studentId)) {
    return res.status(400).json({
      error: 'studentId must be a valid ID.',
      code: 'VALIDATION_INVALID_FORMAT',
    });
  }
  const balance = await pool.query(
    `SELECT COALESCE(b.balance, 0) AS balance
     FROM students s
     LEFT JOIN student_balances b ON b.student_id = s.id
     WHERE s.id = $1 AND s.deleted_at IS NULL`,
    [req.params.studentId]
  );
  if (balance.rowCount === 0) {
    return res.status(404).json({
      error: 'Student not found.',
      code: 'NOT_FOUND',
      params: { entity: 'student' },
    });
  }
  const history = await pool.query(
    `SELECT id,
            kind,
            amount,
            balance_after AS "balanceAfter",
            reference_type AS "referenceType",
            reference_id   AS "referenceId",
            note,
            created_by    AS "createdBy",
            created_at    AS "createdAt"
     FROM student_balance_transactions
     WHERE student_id = $1
     ORDER BY created_at DESC
     LIMIT ${MAX_LISTED + 1}`,
    [req.params.studentId]
  );
  res.json({
    balance: Number(balance.rows[0].balance),
    transactions: history.rows.slice(0, MAX_LISTED),
    truncated: history.rows.length > MAX_LISTED,
  });
});

// Top-ups, refunds (manual, independent of voiding a sale) and signed
// corrections. All of them go through the same atomic balance change.
router.post('/', requirePermission('cafe.balance'), async (req, res) => {
  const parsed = parseBalanceBody(req.body ?? {});
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }
  const { studentId, kind, amount, note } = parsed.value;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const student = await client.query(
      'SELECT id FROM students WHERE id = $1 AND deleted_at IS NULL',
      [studentId]
    );
    if (student.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'That student does not exist.',
        code: 'CAFE_STUDENT_INACTIVE',
      });
    }

    const balanceAfter = await applyBalanceChange(client, {
      studentId,
      delta: amount,
      kind,
      note,
      createdBy: req.user.id,
    });

    await recordAudit(client, {
      userId: req.user.id,
      actor: req.user.username,
      action: `cafe_balance.${kind}`,
      entityType: 'cafe_balance',
      details: { studentId, amount, balanceAfter },
    });

    await client.query('COMMIT');
    res.status(201).json({ balanceAfter });
  } catch (err) {
    await client.query('ROLLBACK');
    if (/closed fiscal period/i.test(String(err?.message))) {
      return res.status(409).json({
        error: 'The entry falls in a closed fiscal period.',
        code: 'ACCOUNTING_PERIOD_CLOSED',
      });
    }
    throw err;
  } finally {
    client.release();
  }
});

export default router;
