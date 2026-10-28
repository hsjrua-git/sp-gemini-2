import { Router } from 'express';
import pool from '../db/pool.js';
import { isUuid } from '../lib/ids.js';
import { userCan } from '../middleware/auth.js';
import {
  listAssignmentPeriods,
  syncAssignmentPeriods,
} from '../lib/periods.js';

const router = Router();

// The period calendar of one assignment (there is no school-wide period
// anymore). Periods are materialized on the fly, so a fresh assignment with
// generated sessions lists its periods immediately. The answered-cell count
// is score-derived: it is stripped for callers without scores.view.
router.get('/periods', async (req, res) => {
  const { assignmentId } = req.query;
  if (!isUuid(assignmentId)) {
    return res.status(400).json({
      error: 'assignmentId must be a valid ID.',
      code: 'VALIDATION_INVALID_FORMAT',
      params: { field: 'assignmentId' },
    });
  }

  const assignment = await pool.query(
    'SELECT id FROM assignments WHERE id = $1',
    [assignmentId]
  );
  if (assignment.rowCount === 0) {
    return res.status(404).json({
      error: 'Assignment not found.',
      code: 'NOT_FOUND',
      params: { entity: 'assignment' },
    });
  }

  await syncAssignmentPeriods(pool, assignmentId);
  const periods = await listAssignmentPeriods(pool, assignmentId);
  res.json({
    periods: userCan(req, 'scores.view')
      ? periods
      : periods.map(({ answeredCount, ...rest }) => rest),
  });
});

export default router;
