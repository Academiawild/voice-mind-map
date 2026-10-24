import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const cwd = process.cwd();
const lockPath = resolve(cwd, 'package-lock.json');
const markerPath = resolve(cwd, 'node_modules', '.voice-mind-map-lock-hash');
const npmCommand = 'npm';

function lockHash() {
  return createHash('sha256').update(readFileSync(lockPath)).digest('hex');
}

const expectedHash = lockHash();
const installedHash = existsSync(markerPath) ? readFileSync(markerPath, 'utf8').trim() : '';
if (existsSync(resolve(cwd, 'node_modules')) && installedHash === expectedHash) {
  process.exit(0);
}

console.log('[Voice Mind Map] Installing exact npm dependencies from package-lock.json...');
const result = spawnSync(npmCommand, ['ci'], {
  cwd,
  stdio: 'inherit',
  shell: false,
});
if (result.error) {
  console.error(`[Voice Mind Map] Could not start npm: ${result.error.message}`);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

writeFileSync(markerPath, `${expectedHash}\n`, 'utf8');
