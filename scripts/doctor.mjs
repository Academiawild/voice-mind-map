import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { inspectRuntimeDependencies } from './runtime-diagnostics.mjs';
import { containsLocalModel, readLocalAIModels } from './runtime-supervisor.mjs';

const cwd = process.cwd();
const installLauncher = 'install.command';
const checks = [];
const runtimeDependencies = inspectRuntimeDependencies(cwd);

function addCheck(status, title, detail = '') {
  checks.push({ status, title, detail });
}

function commandExists(command, args = ['--version']) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
  });
  return result.status === 0;
}

function readRuntimeFile() {
  const runtimePath = resolve(cwd, '.runtime-pids.json');
  if (!existsSync(runtimePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(runtimePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return 'invalid';
  }
}

function checkPackageLockInstall() {
  const lockPath = resolve(cwd, 'package-lock.json');
  const markerPath = resolve(cwd, 'node_modules', '.voice-mind-map-lock-hash');
  const nodeModulesPath = resolve(cwd, 'node_modules');

  if (!existsSync(lockPath)) {
    addCheck('fail', 'package-lock.json missing', 'This project should be installed with npm ci.');
    return;
  }
  if (!existsSync(nodeModulesPath)) {
    addCheck('fail', 'npm dependencies not installed', `Run ${installLauncher}.`);
    return;
  }
  if (!existsSync(markerPath)) {
    addCheck(
      'warn',
      'npm lock marker missing',
      `Run ${installLauncher} if startup behaves strangely.`,
    );
    return;
  }
  addCheck('pass', 'npm dependencies installed');
}

function checkEnv() {
  const envPath = resolve(cwd, '.env');
  const examplePath = resolve(cwd, '.env.example');
  if (!existsSync(envPath)) {
    addCheck(
      'warn',
      '.env not found',
      existsSync(examplePath)
        ? 'The launcher can create it from .env.example; local AI defaults will be used.'
        : '.env.example is also missing.',
    );
    return;
  }

  addCheck('pass', 'local environment file found');
}

async function checkLocalAI() {
  const baseUrl = process.env.LOCAL_AI_BASE_URL?.trim() || 'http://127.0.0.1:11434';
  const model = process.env.LOCAL_AI_MODEL?.trim() || 'qwen-q4kp';
  const models = await readLocalAIModels(baseUrl);
  if (models === null) {
    addCheck('warn', 'Ollama is not running', 'Open Ollama.app, then run doctor again.');
    return;
  }
  addCheck(
    containsLocalModel(models, model) ? 'pass' : 'fail',
    containsLocalModel(models, model)
      ? `local model ${model} is installed`
      : `local model ${model} is missing`,
    containsLocalModel(models, model)
      ? ''
      : `Set LOCAL_AI_MODEL to one of: ${models.join(', ') || '(no installed models)'}`,
  );
}

function checkPythonRuntime() {
  const pythonPath = runtimeDependencies.python;
  if (!existsSync(pythonPath)) {
    addCheck(
      'fail',
      'local Python runtime missing',
      `Run ${installLauncher}. Expected: ${pythonPath}`,
    );
    return;
  }
  if (!commandExists(pythonPath)) {
    addCheck('fail', 'local Python runtime cannot run', `Run ${installLauncher} again.`);
    return;
  }
  addCheck('pass', 'local Python runtime installed');
}

function checkAsrFiles() {
  const httpAsrScript = runtimeDependencies.paths.httpAsr;
  const realtimeAsrScript = runtimeDependencies.paths.realtimeAsr;

  addCheck(
    existsSync(httpAsrScript) ? 'pass' : 'fail',
    existsSync(httpAsrScript)
      ? 'HTTP transcription script found'
      : 'HTTP transcription script missing',
    existsSync(httpAsrScript) ? '' : httpAsrScript,
  );
  addCheck(
    existsSync(realtimeAsrScript) ? 'pass' : 'fail',
    existsSync(realtimeAsrScript) ? 'realtime ASR files installed' : 'realtime ASR files missing',
    existsSync(realtimeAsrScript) ? '' : `Run ${installLauncher}.`,
  );
}

function checkRuntimeState() {
  const runtime = readRuntimeFile();
  if (runtime === 'invalid') {
    addCheck(
      'warn',
      'runtime record is unreadable',
      'Delete .runtime-pids.json only if the app is fully closed.',
    );
    return;
  }
  if (!runtime) {
    addCheck('pass', 'no existing runtime record');
    return;
  }

  addCheck(
    'pass',
    'existing runtime record found',
    runtime.webUrl
      ? `Current saved browser URL: ${runtime.webUrl}`
      : 'The app may already be running.',
  );
}

const supportedNode = runtimeDependencies.nodeSupported;
addCheck(
  supportedNode ? 'pass' : 'fail',
  `Node.js ${process.versions.node}`,
  supportedNode ? '' : 'Requires Node.js 22.12 or newer.',
);
checkPackageLockInstall();
checkEnv();
await checkLocalAI();
const gitAvailable = commandExists('git');
addCheck(
  gitAvailable ? 'pass' : 'fail',
  'Git available',
  gitAvailable ? '' : `Install Git, then run ${installLauncher}.`,
);
const ffmpegAvailable = commandExists('ffmpeg', ['-version']);
addCheck(
  ffmpegAvailable ? 'pass' : 'fail',
  'ffmpeg available',
  ffmpegAvailable ? '' : `Install ffmpeg, then run ${installLauncher}.`,
);
checkPythonRuntime();
checkAsrFiles();
checkRuntimeState();

const symbolByStatus = {
  pass: '[OK]',
  warn: '[WARN]',
  fail: '[FAIL]',
};

console.log('\n[Voice Mind Map] Doctor report\n');
for (const check of checks) {
  console.log(`${symbolByStatus[check.status]} ${check.title}`);
  if (check.detail) {
    console.log(`       ${check.detail}`);
  }
}

const failures = checks.filter((check) => check.status === 'fail');
const warnings = checks.filter((check) => check.status === 'warn');

console.log('');
if (failures.length > 0) {
  console.log(
    `[Voice Mind Map] ${failures.length} blocking issue(s). Run ${installLauncher}, then run npm run doctor again.`,
  );
  process.exit(1);
}
if (warnings.length > 0) {
  console.log(
    '[Voice Mind Map] No blocking issues. Review the warnings above if a feature does not work.',
  );
  process.exit(0);
}

console.log('[Voice Mind Map] Everything looks ready.');
