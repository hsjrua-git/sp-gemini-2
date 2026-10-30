import pool from '../db/pool.js';
import { generatePassword } from '../lib/passwords.js';
import { createUser } from '../lib/users.js';
import { parseUsername } from '../validation/user.js';

function fail(message) {
  console.error(message);
  process.exit(1);
}

const [rawUsername, rawFullName, roleName = 'Administrator'] =
  process.argv.slice(2);

const username = parseUsername(rawUsername);
if (username.error) fail(username.error);

const fullName = (rawFullName ?? '').trim();
if (fullName.length < 1 || fullName.length > 100) {
  fail('Give a full name of 1 to 100 characters, in quotes.');
}

const roleResult = await pool.query(
  'SELECT id, name FROM roles WHERE lower(name) = lower($1)',
  [roleName]
);
if (roleResult.rowCount === 0) {
  const all = await pool.query('SELECT name FROM roles ORDER BY lower(name)');
  fail(
    `No role named "${roleName}". Available roles: ${all.rows
      .map((row) => row.name)
      .join(', ')}.`
  );
}
const role = roleResult.rows[0];

const password = generatePassword();
try {
  await createUser({
    username: username.value,
    fullName,
    roleId: role.id,
    password,
    mustChangePassword: true,
  });
} catch (err) {
  if (err.code === '23505') fail('That username already exists.');
  throw err;
}

console.log(`Created ${role.name} "${username.value}".`);
console.log(`Temporary password (shown once): ${password}`);
console.log('The user must choose a new password at first login.');
await pool.end();
