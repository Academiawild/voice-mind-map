import { resolve } from 'node:path';
import process from 'node:process';

export function getVenvPythonPath(root = process.cwd()) {
  return resolve(root, 'dependencies', 'local', 'asr-venv', 'bin', 'python');
}
