import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Keep command output and exit status together. This does not interpret output
// as a pass/fail claim about the behavior the command purports to test.
const [phase, name, directory, executable, ...args] = process.argv.slice(2);
if (!phase || !name || !directory || !executable || !/^[\w-]+$/.test(phase + name)) {
  throw new Error('Usage: node audit/run-command.mjs PHASE NAME DIRECTORY EXECUTABLE [ARGS...]');
}
const root = path.resolve(import.meta.dirname, '..');
const cwd = path.resolve(root, directory);
if (cwd !== root && !cwd.startsWith(root + path.sep)) throw new Error('Directory must be inside the project');
const folder = path.join(root, 'audit', phase);
await fs.mkdir(folder, { recursive: true });
const started = new Date().toISOString();
const child = spawn(executable, args, { cwd, env: { ...process.env, npm_config_cache: path.join(root, 'audit/.npm-cache'), TMPDIR: path.join(root, 'audit/.tmp') }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', data => { output += data; });
child.stderr.on('data', data => { output += data; });
child.on('error', error => { output += error.message + '\n'; });
const { code, signal } = await new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
const result = { command: [executable, ...args], directory, started, ended: new Date().toISOString(), code, signal };
await fs.writeFile(path.join(folder, name + '.txt'), output);
await fs.writeFile(path.join(folder, name + '.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
console.log(output.slice(-6000));
process.exitCode = code ?? 1;
