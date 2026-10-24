import 'dotenv/config';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import process from 'node:process';
import { assertRuntimeDependencies } from './runtime-diagnostics.mjs';
import {
  allocateRuntimePorts,
  createRuntimeEnvironment,
  createRuntimeManifest,
  launchManagedProcess,
  normalizeLocalAIBaseUrl,
  readLocalAIModels,
  waitForLocalAIModel,
  writeRuntimeManifest,
} from './runtime-supervisor.mjs';

const projectRoot = process.cwd();
const diagnostics = assertRuntimeDependencies(projectRoot);
const paths = diagnostics.paths;
const python = diagnostics.python;
const ports = await allocateRuntimePorts('development');
const runtimeId = randomUUID();
const localAIBaseUrl = normalizeLocalAIBaseUrl(
  process.env.LOCAL_AI_BASE_URL?.trim() || 'http://127.0.0.1:11434',
);
const localAIModel = process.env.LOCAL_AI_MODEL?.trim() || 'qwen-q4kp';

if ((await readLocalAIModels(localAIBaseUrl)) === null) {
  await new Promise((resolvePromise) => {
    execFile('open', ['-gja', 'Ollama'], () => resolvePromise());
  });
}
if (!(await waitForLocalAIModel(localAIBaseUrl, localAIModel))) {
  throw new Error(`Local Ollama model ${localAIModel} is unavailable.`);
}
const env = createRuntimeEnvironment({
  mode: 'development',
  ports,
  runtimeId,
  supervisorPid: process.pid,
});
let shuttingDown = false;

function launch(command, args, role, port, cwd = projectRoot) {
  const child = launchManagedProcess({ command, args, cwd, env, detached: false });
  child.on('exit', (code) => {
    if (!shuttingDown && code && code !== 0) {
      console.error(`[Voice Mind Map] ${role} exited with code ${code}.`);
      shutdown(code);
    }
  });
  return { role, port, commandToken: args[0], child };
}

const children = [
  launch(python, [paths.httpAsr], 'http-asr', ports.httpAsr),
  launch(
    python,
    [
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
    'realtime-asr',
    ports.realtimeAsr,
    paths.realtimeDirectory,
  ),
  launch(process.execPath, [paths.tsx, 'watch', paths.server], 'web-api', ports.api),
  launch(process.execPath, [paths.vite], 'frontend-dev', ports.web),
];

const manifest = createRuntimeManifest({
  mode: 'development',
  runtimeId,
  projectRoot,
  ports,
  processes: children.map(({ role, port, commandToken, child }) => ({
    role,
    port,
    commandToken,
    pid: child.pid ?? 0,
  })),
});
writeRuntimeManifest(paths.manifest, manifest);
console.log(`[Voice Mind Map] Development web: ${manifest.webUrl}`);

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) child.kill('SIGTERM');
  if (existsSync(paths.manifest)) rmSync(paths.manifest, { force: true });
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
