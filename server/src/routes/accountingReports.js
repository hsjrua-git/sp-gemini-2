import { Router } from 'express';
import pool from '../db/pool.js';
import {
  balanceSheet,
  generalLedger,
  incomeStatement,
  trialBalance,
} from '../lib/accountingReports.js';
import { isUuid } from '../lib/ids.js';
import { isValidIsoDate } from '../lib/periods.js';

const router = Router();

function dateRange(req) {
  const { from, to } = req.query;
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
    return {
      error: {
        status: 400,
        body: {
          error: 'from and to must be dates (YYYY-MM-DD).',
          code: 'VALIDATION_INVALID_DATE',
        },
      },
    };
  }
  if (from > to) {
    return {
      error: {
        status: 400,
        body: {
          error: 'from must not be after to.',
          code: 'VALIDATION_INVALID_RANGE',
        },
      },
    };
  }
  return { from, to };
}

router.get('/trial-balance', async (req, res) => {
  const range = dateRange(req);
  if (range.error) return res.status(range.error.status).json(range.error.body);
  res.json(await trialBalance(pool, range));
});

router.get('/ledger', async (req, res) => {
  const range = dateRange(req);
  if (range.error) return res.status(range.error.status).json(range.error.body);
  if (!isUuid(req.query.accountId)) {
    return res.status(400).json({
      error: 'accountId must be a valid ID.',
      code: 'VALIDATION_INVALID_FORMAT',
    });
  }
  const ledger = await generalLedger(pool, {
    accountId: req.query.accountId,
    ...range,
  });
  if (ledger.error) {
    return res.status(404).json({
      error: 'Account not found.',
      code: 'NOT_FOUND',
      params: { entity: 'account' },
    });
  }
  res.json(ledger);
});

router.get('/income-statement', async (req, res) => {
  const range = dateRange(req);
  if (range.error) return res.status(range.error.status).json(range.error.body);
  res.json(await incomeStatement(pool, range));
});

router.get('/balance-sheet', async (req, res) => {
  if (!isValidIsoDate(req.query.asOf)) {
    return res.status(400).json({
      error: 'asOf must be a date (YYYY-MM-DD).',
      code: 'VALIDATION_INVALID_DATE',
    });
  }
  res.json(await balanceSheet(pool, { asOf: req.query.asOf }));
});

export default router;
