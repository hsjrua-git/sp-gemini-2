// Retained transcripts (the audio itself is ephemeral). Two sinks:
//   1. always — a JSONL file under agent/logs/ (one line per turn);
//   2. optionally — the voice_transcripts table (migration 027) when
//      AGENT_DATABASE_URL is set. The connection uses pg borrowed from the
//      server's node_modules (same repo, no duplicate install); if it is
//      unavailable the file sink keeps working alone.

import { appendFile, chmod, mkdir, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { config } from './config.js';

const repoServerDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server');
const requireFromServer = createRequire(join(repoServerDir, 'package.json'));

export async function createTranscripts() {
  const logsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'logs');
  await mkdir(logsDir, { recursive: true, mode: 0o700 });
  await chmod(logsDir, 0o700);
  const file = join(logsDir, `transcripts-${new Date().toISOString().slice(0, 10)}.jsonl`);
  const fileHandle = await open(file, 'a', 0o600);
  await fileHandle.chmod(0o600);
  await fileHandle.close();

  let db = null;
  if (config.databaseUrl) {
    try {
      const { Pool } = requireFromServer('pg');
      const pool = new Pool({ connectionString: config.databaseUrl, max: 2 });
      db = {
        async record(entry) {
          await pool.query(
            `INSERT INTO voice_transcripts (session_id, role, text, meta, audio_kept)
             VALUES ($1, $2, $3, $4, $5)`,
            [entry.sessionId, entry.role, entry.text, entry.meta ?? null, entry.audioKept ?? false]
          );
        },
      };
    } catch (err) {
      console.error('[transcripts] Postgres sink unavailable, file only:', err.message);
    }
  }

  return {
    sinks: db ? ['file', 'postgres'] : ['file'],
    async record(entry) {
      const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
      await appendFile(file, `${line}\n`, { mode: 0o600 }).catch(() => {});
      if (db) await db.record(entry).catch(() => {});
    },
  };
}
