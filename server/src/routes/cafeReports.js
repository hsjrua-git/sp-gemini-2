import { Router } from 'express';
import pool from '../db/pool.js';
import { getRangeReport } from '../lib/cafeReports.js';
import { isValidIsoDate } from '../lib/periods.js';

const router = Router();

router.get('/', async (req, res) => {
  const { from, to } = req.query;
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
    return res.status(400).json({
      error: 'from and to must be dates (YYYY-MM-DD).',
      code: 'VALIDATION_INVALID_DATE',
    });
  }
  res.json(await getRangeReport(pool, { from, to }));
});

export default router;
