// The secrets table (schema-4 infrastructure): exactly one of the two value
// columns is filled — password hashes in value_hash (never plaintext), API
// keys and similar in value_encrypted (app-side encryption). No UI exists
// yet; the kiosk/agent work reads and writes through these helpers.
//
// Encryption is AES-256-GCM keyed by a scrypt stretch of SESSION_SECRET —
// derived once per process, never stored, never logged. Hashes use argon2id
// (the dependency the password stack already uses) so a hash-backed secret
// can be verified without decryption. The stored blob is
// [authTag (16 bytes)][iv (12 bytes)][ciphertext].
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const AUTH_TAG_LENGTH = 16;
const IV_LENGTH = 12;

export function createSecretsStore(db, { sessionSecret }) {
  const key = scryptSync(sessionSecret, 'student-panel:secrets:v1', KEY_LENGTH);

  function encryptBlob(plaintext) {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([cipher.getAuthTag(), iv, ciphertext]);
  }

  function decryptBlob(blob) {
    const authTag = blob.subarray(0, AUTH_TAG_LENGTH);
    const iv = blob.subarray(AUTH_TAG_LENGTH, AUTH_TAG_LENGTH + IV_LENGTH);
    const ciphertext = blob.subarray(AUTH_TAG_LENGTH + IV_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      'utf8'
    );
  }

  return {
    // Store an encrypted secret (API keys, SMTP passwords, …). Replaces any
    // previous value for the key.
    async setSecret(name, plaintext) {
      await db.query(
        `INSERT INTO secrets (key, value_encrypted)
         VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE
           SET value_encrypted = $2, value_hash = NULL, updated_at = now()`,
        [name, encryptBlob(plaintext)]
      );
    },

    async getSecret(name) {
      const result = await db.query(
        'SELECT value_encrypted FROM secrets WHERE key = $1',
        [name]
      );
      const blob = result.rows[0]?.value_encrypted;
      return blob ? decryptBlob(blob) : null;
    },

    // Store a verify-only secret (a machine credential that is checked,
    // never read back).
    async setHashedSecret(name, plaintext) {
      const valueHash = await hash(plaintext);
      await db.query(
        `INSERT INTO secrets (key, value_hash)
         VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE
           SET value_hash = $2, value_encrypted = NULL, updated_at = now()`,
        [name, valueHash]
      );
    },

    async verifyHashedSecret(name, plaintext) {
      const result = await db.query(
        'SELECT value_hash FROM secrets WHERE key = $1',
        [name]
      );
      const hash = result.rows[0]?.value_hash;
      if (!hash) return false;
      return verify(hash, plaintext);
    },

    async deleteSecret(name) {
      await db.query('DELETE FROM secrets WHERE key = $1', [name]);
    },
  };
}
