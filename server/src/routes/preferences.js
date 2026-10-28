import { Router } from 'express';
import pool from '../db/pool.js';
import {
  mergePreferences,
  parsePreferencesUpdate,
} from '../lib/preferences.js';

const router = Router();

router.get('/', async (req, res) => {
  const result = await pool.query(
    'SELECT settings FROM user_preferences WHERE user_id = $1',
    [req.user.id]
  );
  res.json({ preferences: mergePreferences(result.rows[0]?.settings) });
});

router.put('/', async (req, res) => {
  const parsed = parsePreferencesUpdate(req.body);
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }

  const result = await pool.query(
    `INSERT INTO user_preferences (user_id, settings)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (user_id)
     DO UPDATE SET settings = user_preferences.settings || EXCLUDED.settings,
                   updated_at = now()
     RETURNING settings`,
    [req.user.id, JSON.stringify(parsed.values)]
  );
  res.json({ preferences: mergePreferences(result.rows[0].settings) });
});

router.delete('/', async (req, res) => {
  await pool.query('DELETE FROM user_preferences WHERE user_id = $1', [
    req.user.id,
  ]);
  res.json({ preferences: mergePreferences({}) });
});

export default router;