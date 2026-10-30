// Service-layer test for saved result views — real service functions against a
// fresh in-memory PGlite.
//
//   node --test src/core/services/savedViews.test.js
//
// saved_views.user_id is a NOT NULL FK to users(id), so freshDb() calls
// ensureLocalUser() after migrations to seed the single local user. A view
// config pins ONE assignment's grid (assignmentId is required; seq null =
// the assignment's latest period).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createPglitePool } from '../../db/pglite.js';
import { initDb } from '../db.js';
import { resetLocalUser } from '../context.js';
import { ensureLocalUser } from '../bootstrap.js';
import {
  listViews,
  createView,
  updateView,
  deleteView,
} from './savedViews.js';

const migrationsDir = path.join(import.meta.dirname, '..', '..', 'db', 'migrations');
const ASSIGNMENT = '00000000-0000-4000-8000-000000000001';
const PARAMETER = '00000000-0000-4000-8000-000000000002';

async function freshDb() {
  const pool = createPglitePool(); // in-memory
  await pool.ready();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const files = (await fs.readdir(migrationsDir))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  initDb(pool);
  resetLocalUser();
  await ensureLocalUser(pool);
  return pool;
}

async function expectCode(code, fn) {
  await assert.rejects(fn, (err) => {
    assert.equal(err.name, 'ServiceError', `expected a ServiceError, got ${err}`);
    assert.equal(err.code, code, `expected code ${code}, got ${err.code}`);
    return true;
  });
}

test('createView: validates name and config', async () => {
  const pool = await freshDb();
  try {
    await expectCode('VALIDATION', () => createView({ name: '', config: {} }));
    await expectCode('VALIDATION', () => createView({ name: 'x', config: null }));
    // The new config schema: assignmentId is required.
    await expectCode('VALIDATION', () =>
      createView({ name: 'x', config: { dimension: 'quality' } })
    );
    await expectCode('VALIDATION', () =>
      createView({ name: 'x', config: { assignmentId: 'nope' } })
    );
    // Bad seq / dimension / filter op / sort key are all refused.
    await expectCode('VALIDATION', () =>
      createView({ name: 'x', config: { assignmentId: ASSIGNMENT, seq: 0 } })
    );
    await expectCode('VALIDATION', () =>
      createView({ name: 'x', config: { assignmentId: ASSIGNMENT, dimension: 'depth' } })
    );
    await expectCode('VALIDATION', () =>
      createView({
        name: 'x',
        config: {
          assignmentId: ASSIGNMENT,
          filters: [{ parameterId: PARAMETER, op: 'like', value: 1 }],
        },
      })
    );
    await expectCode('VALIDATION', () =>
      createView({
        name: 'x',
        config: { assignmentId: ASSIGNMENT, sort: { key: 'depth', direction: 'asc' } },
      })
    );
    // A value-taking filter without a whole number is refused.
    await expectCode('VALIDATION', () =>
      createView({
        name: 'x',
        config: {
          assignmentId: ASSIGNMENT,
          filters: [{ parameterId: PARAMETER, op: 'lt', value: 'x' }],
        },
      })
    );
  } finally {
    await pool.end();
  }
});

test('createView + listViews: normalizes, defaults, stores and lists alphabetically', async () => {
  const pool = await freshDb();
  try {
    await createView({ name: 'Beta', config: { assignmentId: ASSIGNMENT } });
    const { view } = await createView({
      name: 'alpha',
      config: {
        assignmentId: ASSIGNMENT,
        seq: 2,
        dimension: 'quantity',
        parameterIds: [PARAMETER],
        filters: [{ parameterId: PARAMETER, op: 'gte', value: 5 }],
        showChange: true,
      },
    });
    assert.ok(view.id);
    assert.equal(view.name, 'alpha');
    // What was sent survives…
    assert.equal(view.config.assignmentId, ASSIGNMENT);
    assert.equal(view.config.seq, 2);
    assert.equal(view.config.dimension, 'quantity');
    assert.deepEqual(view.config.parameterIds, [PARAMETER]);
    assert.deepEqual(view.config.filters, [
      { parameterId: PARAMETER, op: 'gte', value: 5 },
    ]);
    assert.equal(view.config.showChange, true);
    // …and what was omitted got the defaults.
    assert.deepEqual(view.config.sort, { key: 'name', direction: 'asc' });
    assert.equal(view.config.search, '');

    const { views } = await listViews();
    assert.deepEqual(views.map((v) => v.name), ['alpha', 'Beta']);
  } finally {
    await pool.end();
  }
});

test('createView: duplicate name collides', async () => {
  const pool = await freshDb();
  try {
    await createView({ name: 'My View', config: { assignmentId: ASSIGNMENT } });
    await expectCode('CONFLICT', () =>
      createView({ name: 'My View', config: { assignmentId: ASSIGNMENT } })
    );
  } finally {
    await pool.end();
  }
});

test('updateView: guards, renames, and rejects duplicate names', async () => {
  const pool = await freshDb();
  try {
    const { view } = await createView({
      name: 'First',
      config: { assignmentId: ASSIGNMENT },
    });
    await createView({ name: 'Second', config: { assignmentId: ASSIGNMENT } });

    // Bad id (not a uuid) and unknown id both read as not found.
    await expectCode('NOT_FOUND', () => updateView('not-a-uuid', { name: 'x' }));
    await expectCode('NOT_FOUND', () =>
      updateView(crypto.randomUUID(), { name: 'x' })
    );
    // Nothing to change.
    await expectCode('VALIDATION', () => updateView(view.id, {}));
    // Invalid new name.
    await expectCode('VALIDATION', () => updateView(view.id, { name: '' }));
    // Renaming onto an existing sibling name collides.
    await expectCode('CONFLICT', () => updateView(view.id, { name: 'Second' }));
    // A config update must still satisfy the schema.
    await expectCode('VALIDATION', () =>
      updateView(view.id, { config: { dimension: 'quality' } })
    );

    // A clean rename + config change works.
    const out = await updateView(view.id, {
      name: 'First renamed',
      config: { assignmentId: ASSIGNMENT, dimension: 'quantity' },
    });
    assert.equal(out.view.name, 'First renamed');
    assert.equal(out.view.config.dimension, 'quantity');
  } finally {
    await pool.end();
  }
});

test('deleteView: guards and removes', async () => {
  const pool = await freshDb();
  try {
    const { view } = await createView({
      name: 'Temp',
      config: { assignmentId: ASSIGNMENT },
    });

    await expectCode('NOT_FOUND', () => deleteView('not-a-uuid'));
    await expectCode('NOT_FOUND', () => deleteView(crypto.randomUUID()));

    await deleteView(view.id); // resolves (no throw)
    const { views } = await listViews();
    assert.equal(views.length, 0);

    // Second delete now misses.
    await expectCode('NOT_FOUND', () => deleteView(view.id));
  } finally {
    await pool.end();
  }
});
