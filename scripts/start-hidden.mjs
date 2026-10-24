import 'dotenv/config';
import { execFile, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { assertRuntimeDependencies } from './runtime-diagnostics.mjs';
import {
  RUNTIME_MANIFEST_VERSION,
  allocateRuntimePorts,
  createRuntimeEnvironment,
  createRuntimeManifest,
  launchManagedProcess,
  readRuntimeManifest,
  readRuntimeStatus,
  readLocalAIModels,
  normalizeLocalAIBaseUrl,
  terminateManagedProcesses,
  waitForLocalAIModel,
  waitForRuntime,
  writeRuntimeManifest,
} from './runtime-supervisor.mjs';

const projectRoot = process.cwd();
const diagnostics = assertRuntimeDependencies(projectRoot);
const paths = diagnostics.paths;
const python = diagnostics.python;
const node = process.execPath;
const localAIBaseUrl = normalizeLocalAIBaseUrl(
  process.env.LOCAL_AI_BASE_URL?.trim() || 'http://127.0.0.1:11434',
);
const localAIModel = process.env.LOCAL_AI_MODEL?.trim() || 'qwen-q4kp';

function buildFrontend() {
  const result = spawnSync(node, [paths.vite, 'build'], { cwd: projectRoot, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Frontend production build failed.');
}

async function openBrowser(url) {
  if (process.env.VOICE_MIND_MAP_SKIP_BROWSER === 'true') return;
  await new Promise((resolvePromise) => {
    execFile('open', [url], () => resolvePromise());
  });
}

async function ensureLocalAI() {
  const installedModels = await readLocalAIModels(localAIBaseUrl);
  if (installedModels === null) {
    await new Promise((resolvePromise) => {
      execFile('open', ['-gja', 'Ollama'], () => resolvePromise());
    });
  }
  if (!(await waitForLocalAIModel(localAIBaseUrl, localAIModel))) {
    throw new Error(
      `Local Ollama model ${localAIModel} is unavailable. Start Ollama or set LOCAL_AI_MODEL to an installed model.`,
    );
  }
}

await ensureLocalAI();

const existing = readRuntimeManifest(paths.manifest);
if (existing?.runtimeId && existing?.healthUrl && existing?.webUrl) {
  const status = await readRuntimeStatus(existing.healthUrl);
  if (status?.runtimeId === existing.runtimeId) {
    if (existing.version === RUNTIME_MANIFEST_VERSION) {
      await openBrowser(existing.webUrl);
      console.log(`[Voice Mind Map] Existing app opened at ${existing.webUrl}`);
      process.exit(0);
    }
    if (resolve(existing.projectRoot ?? '') !== projectRoot || !status.shutdownToken) {
      throw new Error('An incompatible runtime is active and could not be verified for upgrade.');
    }
    const shutdownResponse = await fetch(`${existing.webUrl}/api/runtime/shutdown`, {
      method: 'POST',
      headers: { 'x-local-shutdown-token': status.shutdownToken },
    });
    if (!shutdownResponse.ok) {
      throw new Error('The previous runtime could not be stopped for upgrade.');
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!(await readRuntimeStatus(existing.healthUrl))) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
    if (await readRuntimeStatus(existing.healthUrl)) {
      throw new Error('The previous runtime is still active; stop it before upgrading.');
    }
  }
}

buildFrontend();
const ports = await allocateRuntimePorts('production');
const runtimeId = randomUUID();
const env = createRuntimeEnvironment({ mode: 'production', ports, runtimeId });
const processes = [];
const launchedChildren = [];

try {
  const httpAsr = launchManagedProcess({
    command: python,
    args: [paths.httpAsr],
    // Keep generated project artifacts (for example coverage/) out of Python's
    // import search path; they can shadow FunASR's transitive dependencies.
    cwd: dirname(paths.httpAsr),
    env,
    detached: true,
    logPrefix: resolve(projectRoot, 'asr-http'),
  });
  launchedChildren.push(httpAsr);
  processes.push({
    role: 'http-asr',
    pid: httpAsr.pid ?? 0,
    port: ports.httpAsr,
    commandToken: paths.httpAsr,
  });

  const realtimeAsr = launchManagedProcess({
    command: python,
    args: [
      paths.realtimeAsr,
      '--host',
      '127.0.0.1',
      '--port',
      String(ports.realtimeAsr),
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
    cwd: paths.realtimeDirectory,
    env,
    detached: true,
    logPrefix: resolve(projectRoot, 'asr-realtime'),
  });
  launchedChildren.push(realtimeAsr);
  processes.push({
    role: 'realtime-asr',
    pid: realtimeAsr.pid ?? 0,
    port: ports.realtimeAsr,
    commandToken: paths.realtimeAsr,
  });

  const webApi = launchManagedProcess({
    command: node,
    args: [paths.tsx, paths.server],
    cwd: projectRoot,
    env,
    detached: true,
    logPrefix: resolve(projectRoot, 'web-api'),
  });
  launchedChildren.push(webApi);
  processes.push({
    role: 'web-api',
    pid: webApi.pid ?? 0,
    port: ports.api,
    commandToken: paths.server,
  });

  const manifest = createRuntimeManifest({
    mode: 'production',
    runtimeId,
    projectRoot,
    ports,
    processes,
  });
  writeRuntimeManifest(paths.manifest, manifest);
  if (!(await waitForRuntime(manifest))) {
    throw new Error('Startup timed out. Check web-api.err.log and ASR logs.');
  }
  await openBrowser(manifest.webUrl);
  console.log(`[Voice Mind Map] App opened at ${manifest.webUrl}`);
} catch (error) {
  terminateManagedProcesses(launchedChildren);
  const currentManifest = readRuntimeManifest(paths.manifest);
  if (currentManifest?.runtimeId === runtimeId) {
    rmSync(paths.manifest, { force: true });
  }
  throw error;
}
