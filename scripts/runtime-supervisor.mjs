import { spawn } from 'node:child_process';
import { existsSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

export const RUNTIME_MANIFEST_VERSION = 4;
export const RUNTIME_HOST = '127.0.0.1';

export function preferredPort(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value > 0 && value <= 65535 ? value : fallback;
}

function canListen(port) {
  return new Promise((resolvePromise) => {
    const tester = createServer();
    tester.unref();
    tester.once('error', () => resolvePromise(false));
    tester.listen({ host: RUNTIME_HOST, port, exclusive: true }, () => {
      tester.close(() => resolvePromise(true));
    });
  });
}

export async function findAvailablePort(preferred, reserved = new Set()) {
  for (let port = preferred; port <= Math.min(65535, preferred + 99); port += 1) {
    if (!reserved.has(port) && (await canListen(port))) {
      reserved.add(port);
      return port;
    }
  }
  throw new Error(`No available local port found near ${preferred}.`);
}

export async function allocateRuntimePorts(mode) {
  const reserved = new Set();
  if (mode === 'development') {
    return {
      web: await findAvailablePort(preferredPort('VITE_PORT', 5173), reserved),
      api: await findAvailablePort(preferredPort('PORT', 8787), reserved),
      realtimeAsr: await findAvailablePort(preferredPort('FUNASR_WS_PORT', 10095), reserved),
      httpAsr: await findAvailablePort(preferredPort('FUNASR_HTTP_PORT', 10096), reserved),
    };
  }
  const webApi = await findAvailablePort(preferredPort('PORT', 8787), reserved);
  return {
    web: webApi,
    api: webApi,
    realtimeAsr: await findAvailablePort(preferredPort('FUNASR_WS_PORT', 10095), reserved),
    httpAsr: await findAvailablePort(preferredPort('FUNASR_HTTP_PORT', 10096), reserved),
  };
}

export function createRuntimeEnvironment({ mode, ports, runtimeId, supervisorPid = '' }) {
  return {
    ...process.env,
    NODE_ENV: mode === 'production' ? 'production' : 'development',
    SERVE_STATIC: mode === 'production' ? 'true' : 'false',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PORT: String(ports.api),
    VITE_PORT: String(ports.web),
    FUNASR_HTTP_PORT: String(ports.httpAsr),
    FUNASR_WS_PORT: String(ports.realtimeAsr),
    RUNTIME_ID: runtimeId,
    DEV_SUPERVISOR_PID: String(supervisorPid),
  };
}

export function launchManagedProcess(input) {
  const output = input.logPrefix ? openSync(`${input.logPrefix}.out.log`, 'a') : 'inherit';
  const error = input.logPrefix ? openSync(`${input.logPrefix}.err.log`, 'a') : 'inherit';
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    detached: Boolean(input.detached),
    stdio: input.detached ? ['ignore', output, error] : ['inherit', output, error],
    env: input.env,
  });
  if (input.detached) child.unref();
  return child;
}

export function terminateManagedProcesses(children) {
  for (const child of [...children].reverse()) {
    if (!child || child.killed || child.exitCode !== null) continue;
    try {
      child.kill('SIGTERM');
    } catch {
      // A process can exit between the health failure and rollback.
    }
  }
}

export function createRuntimeManifest(input) {
  return {
    version: RUNTIME_MANIFEST_VERSION,
    mode: input.mode,
    runtimeId: input.runtimeId,
    projectRoot: input.projectRoot,
    startedAt: new Date().toISOString(),
    webUrl: `http://${RUNTIME_HOST}:${input.ports.web}`,
    healthUrl: `http://${RUNTIME_HOST}:${input.ports.api}/api/status`,
    ports: input.ports,
    processes: input.processes,
  };
}

export function writeRuntimeManifest(manifestPath, manifest) {
  const temporary = `${manifestPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  renameSync(temporary, manifestPath);
}

export function readRuntimeManifest(manifestPath) {
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

export async function readRuntimeStatus(url) {
  try {
    const response = await fetch(url);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export function containsLocalModel(models, expectedModel) {
  const normalize = (value) =>
    String(value)
      .trim()
      .replace(/:latest$/i, '');
  const expected = normalize(expectedModel);
  return models.some((model) => normalize(model) === expected);
}

export function normalizeLocalAIBaseUrl(value) {
  const url = new URL(String(value));
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
  ) {
    throw new Error('LOCAL_AI_BASE_URL must use a loopback HTTP address.');
  }
  return url.toString().replace(/\/+$/, '');
}

export async function readLocalAIModels(baseUrl) {
  try {
    const response = await fetch(`${normalizeLocalAIBaseUrl(baseUrl)}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!Array.isArray(payload?.models)) return [];
    return payload.models
      .map((model) => (typeof model?.name === 'string' ? model.name : ''))
      .filter(Boolean);
  } catch {
    return null;
  }
}

export async function waitForLocalAIModel(baseUrl, model, attempts = 30) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const models = await readLocalAIModels(baseUrl);
    if (models && containsLocalModel(models, model)) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  return false;
}

export async function waitForRuntime(manifest, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await readRuntimeStatus(manifest.healthUrl);
    if (
      status?.ok === true &&
      status.service === 'voice-mind-map' &&
      status.runtimeId === manifest.runtimeId
    )
      return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 750));
  }
  return false;
}

export function runtimePaths(projectRoot) {
  const realtimeDirectory = resolve(
    projectRoot,
    'dependencies',
    'local',
    'FunASR',
    'runtime',
    'python',
    'websocket',
  );
  return {
    manifest: resolve(projectRoot, '.runtime-pids.json'),
    httpAsr: resolve(projectRoot, 'scripts', 'asr', 'http_asr_server.py'),
    realtimeDirectory,
    realtimeAsr: resolve(realtimeDirectory, 'funasr_wss_server.py'),
    server: resolve(projectRoot, 'server', 'index.ts'),
    tsx: resolve(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    vite: resolve(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
  };
}
