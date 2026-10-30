import { Router } from 'express';
import pool from '../db/pool.js';
import { generateTeacherCode } from '../lib/studentCode.js';
import { isUuid } from '../lib/ids.js';
import { parseNewTeacher, parseTeacherUpdate } from '../validation/teacher.js';

const router = Router();
const UNIQUE_VIOLATION = '23505';

const TEACHER_COLUMNS = `
  id,
  code,
  full_name        AS "fullName",
  birth_date::text AS "birthDate",
  national_id      AS "nationalId",
  archived_at AS "archivedAt",
  created_at  AS "createdAt"
`;

function escapeLike(text) {
  return text.replace(/[\\%_]/g, '\\$&');
}

router.param('id', (req, res, next, value) => {
  if (!isUuid(value)) {
    return res
      .status(404)
      .json({ error: 'Teacher not found.', code: 'NOT_FOUND', params: { entity: 'teacher' } });
  }
  next();
});

router.get('/', async (req, res) => {
  const includeArchived = req.query.includeArchived === '1';
  const search =
    typeof req.query.search === 'string' ? req.query.search.trim() : '';
  if (search.length > 100) {
    return res.status(400).json({
      error: 'Search text is too long.',
      code: 'VALIDATION_TOO_LONG',
      params: { max: 100 },
    });
  }

  const conditions = [includeArchived ? 'TRUE' : 'archived_at IS NULL'];
  const values = [];
  if (search) {
    values.push(`%${escapeLike(search)}%`);
    const likeIdx = values.length;
    let nationalClause = '';
    if (/^[0-9]{10}$/.test(search)) {
      values.push(search);
      nationalClause = ` OR national_id = $${values.length}`;
    }
    conditions.push(
      `(full_name ILIKE $${likeIdx} OR code ILIKE $${likeIdx}${nationalClause})`
    );
  }
  const where = conditions.join(' AND ');

  const result = await pool.query(
    `SELECT ${TEACHER_COLUMNS}
     FROM teachers
     WHERE ${where}
     ORDER BY lower(full_name)`,
    values
  );
  res.json({ teachers: result.rows });
});

router.post('/', async (req, res) => {
  const parsed = parseNewTeacher(req.body);
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const result = await pool.query(
        `INSERT INTO teachers (code, full_name, birth_date, national_id)
         VALUES ($1, $2, $3::date, $4)
         RETURNING ${TEACHER_COLUMNS}`,
        [
          generateTeacherCode(),
          parsed.value.fullName,
          parsed.value.birthDate,
          parsed.value.nationalId,
        ]
      );
      return res.status(201).json({ teacher: result.rows[0] });
    } catch (err) {
      if (err.code !== UNIQUE_VIOLATION) throw err;
      if (err.constraint === 'teachers_national_id_unique') {
        return res.status(409).json({
          error: 'That national ID already belongs to another teacher.',
          code: 'VALIDATION_NOT_UNIQUE',
        });
      }
      // A code collision is astronomically unlikely; try a fresh code.
    }
  }

  res.status(500).json({
    error: 'Could not create a unique teacher code. Please try again.',
    code: 'TEACHERS_CODE_GENERATION_FAILED',
  });
});

router.patch('/:id', async (req, res) => {
  const parsed = parseTeacherUpdate(req.body ?? {});
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }

  const sets = [];
  const values = [];
  const COLUMN_OF = {
    fullName: ['full_name', null],
    birthDate: ['birth_date', '::date'],
    nationalId: ['national_id', null],
  };
  for (const [field, value] of Object.entries(parsed.value)) {
    if (field === 'archived') continue;
    const [column, cast] = COLUMN_OF[field];
    values.push(value);
    sets.push(`${column} = $${values.length}${cast ?? ''}`);
  }
  if ('archived' in parsed.value) {
    sets.push(`archived_at = ${parsed.value.archived ? 'now()' : 'NULL'}`);
  }

  values.push(req.params.id);
  let teacher;
  try {
    const result = await pool.query(
      `UPDATE teachers
       SET ${sets.join(', ')}
       WHERE id = $${values.length}
       RETURNING ${TEACHER_COLUMNS}`,
      values
    );
    teacher = result.rows[0];
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION && err.constraint === 'teachers_national_id_unique') {
      return res.status(409).json({
        error: 'That national ID already belongs to another teacher.',
        code: 'VALIDATION_NOT_UNIQUE',
      });
    }
    throw err;
  }

  if (!teacher) {
    return res
      .status(404)
      .json({ error: 'Teacher not found.', code: 'NOT_FOUND', params: { entity: 'teacher' } });
  }
  res.json({ teacher });
});

// DELETE archives; history is kept, and the code/national ID stay reserved.
router.delete('/:id', async (req, res) => {
  const result = await pool.query(
    `UPDATE teachers SET archived_at = now()
     WHERE id = $1 AND archived_at IS NULL
     RETURNING id`,
    [req.params.id]
  );
  if (result.rowCount === 0) {
    return res
      .status(404)
      .json({ error: 'Teacher not found.', code: 'NOT_FOUND', params: { entity: 'teacher' } });
  }
  res.status(204).end();
});

export default router;
