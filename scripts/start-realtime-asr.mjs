import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { getVenvPythonPath } from './runtime-paths.mjs';

const cwd = process.cwd();
const pythonPath = getVenvPythonPath(cwd);
const installLauncher = 'install.command';
const websocketDir = resolve(
  cwd,
  'dependencies',
  'local',
  'FunASR',
  'runtime',
  'python',
  'websocket',
);
const websocketServerPath = resolve(websocketDir, 'funasr_wss_server.py');
const requirementsServerPath = resolve(websocketDir, 'requirements_server.txt');
const websocketPort = String(Number(process.env.FUNASR_WS_PORT ?? 10095));

function printHeader() {
  console.log('[Voice Mind Map] Starting FunASR realtime websocket service...');
}

function printMissingVendorHelp() {
  console.error('[Voice Mind Map] Missing dependencies/local/FunASR.');
  console.error('[Voice Mind Map] Please run:');
  console.error(`  ${installLauncher}`);
}

function printMissingPythonHelp() {
  console.error(`[Voice Mind Map] Missing Python runtime: ${pythonPath}`);
}

function printDependencyHelp() {
  console.error('[Voice Mind Map] If websocket dependencies are missing, run:');
  console.error(`  "${pythonPath}" -m pip install websockets websocket-client`);
  if (existsSync(requirementsServerPath)) {
    console.error(`  "${pythonPath}" -m pip install -r "${requirementsServerPath}"`);
  }
}

function fail(message) {
  console.error(`[Voice Mind Map] ${message}`);
  process.exit(1);
}

printHeader();

if (!existsSync(pythonPath)) {
  printMissingPythonHelp();
  process.exit(1);
}

if (!existsSync(websocketDir)) {
  printMissingVendorHelp();
  process.exit(1);
}

if (!existsSync(websocketServerPath)) {
  console.error('[Voice Mind Map] Missing realtime server file:');
  console.error(`  ${websocketServerPath}`);
  printMissingVendorHelp();
  process.exit(1);
}

const child = spawn(
  pythonPath,
  [
    'funasr_wss_server.py',
    '--host',
    '127.0.0.1',
    '--port',
    websocketPort,
    '--asr_model_online',
    'paraformer-zh-streaming',
    '--vad_model',
    'fsmn-vad',
    '--punc_model',
    'ct-punc',
    '--device',
    'cpu',
    '--ngpu',
    '0',
    '--certfile',
    '',
    '--keyfile',
    '',
  ],
  {
    cwd: websocketDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
  },
);

child.on('error', (error) => {
  console.error(`[Voice Mind Map] Failed to start FunASR websocket service: ${error.message}`);
  printDependencyHelp();
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    fail(`FunASR websocket service exited because of signal ${signal}.`);
  }
  if (code && code !== 0) {
    console.error(`[Voice Mind Map] FunASR websocket service exited with code ${code}.`);
    printDependencyHelp();
    process.exit(code);
  }
  process.exit(code ?? 0);
});
