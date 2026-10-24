import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { getVenvPythonPath } from './runtime-paths.mjs';

const cwd = process.cwd();
const pythonPath = getVenvPythonPath(cwd);
const serverPath = resolve(cwd, 'scripts', 'asr', 'http_asr_server.py');

if (!existsSync(pythonPath)) {
  console.error(`[Voice Mind Map] Python runtime was not found at ${pythonPath}.`);
  console.error('[Voice Mind Map] Please run install.command first.');
  process.exit(1);
}

const child = spawn(pythonPath, [serverPath], {
  // Keep Python's import search path out of the project root. A generated
  // `coverage/` report otherwise shadows the third-party `coverage` package
  // imported transitively by FunASR/numba.
  cwd: dirname(serverPath),
  stdio: 'inherit',
  env: {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  },
});

child.once('error', (error) => {
  console.error(`[Voice Mind Map] Failed to start HTTP ASR: ${error.message}`);
  process.exit(1);
});

child.once('exit', (code, signal) => {
  if (signal) {
    console.error(`[Voice Mind Map] HTTP ASR exited because of signal ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});
