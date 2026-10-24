import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { getVenvPythonPath } from './runtime-paths.mjs';

const cwd = process.cwd();
const FUNASR_COMMIT = '516c4f770496a5cbb89c8e2e447211bbb7b0db71';
const FUNASR_FETCH_SOURCES = [
  'https://gitcode.com/modelscope/FunASR.git',
  'https://github.com/modelscope/FunASR.git',
];
const installLauncher = 'install.command';

function run(command, args, options = {}) {
  const { allowFailure = false, ...spawnOptions } = options;
  console.log(`\n[Voice Mind Map] ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
    ...spawnOptions,
  });

  if (result.status !== 0) {
    if (allowFailure) {
      return false;
    }
    process.exit(result.status ?? 1);
  }
  return true;
}

function normalizeCandidate(candidate) {
  return typeof candidate === 'string'
    ? { command: candidate, args: [], testArgs: ['--version'] }
    : {
        command: candidate.command,
        args: candidate.args ?? [],
        testArgs: candidate.testArgs ?? [...(candidate.args ?? []), '--version'],
      };
}

function findCommand(candidates) {
  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate);
    const result = spawnSync(normalized.command, normalized.testArgs, {
      cwd,
      stdio: 'ignore',
      shell: false,
    });
    if (result.status === 0) {
      return normalized;
    }
  }
  return null;
}

function ensureTool(name, command) {
  if (!command) {
    console.error(
      `[Voice Mind Map] ${name} was not found. Please install ${name}, then run ${installLauncher} again.`,
    );
    process.exit(1);
  }
}

function ensureNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) {
    console.error(
      `[Voice Mind Map] Node.js ${process.versions.node} is too old. Install Node.js 22.12 or newer.`,
    );
    process.exit(1);
  }
}

const npmCli = resolve(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const supportedPythonCheck = [
  '-c',
  'import sys; raise SystemExit(0 if sys.version_info[:2] in [(3, 11), (3, 12)] else 1)',
];
const pythonCandidate = (command, args = []) => ({
  command,
  args,
  testArgs: [...args, ...supportedPythonCheck],
});
const pythonCmd = findCommand([
  pythonCandidate('python3.12'),
  pythonCandidate('python3.11'),
  pythonCandidate('python3'),
  pythonCandidate('python'),
]);
const gitCmd = findCommand(['git']);
const ffmpegCmd = findCommand([{ command: 'ffmpeg', testArgs: ['-version'] }]);
const ollamaCmd = findCommand([
  { command: '/Applications/Ollama.app/Contents/Resources/ollama', testArgs: ['--version'] },
  'ollama',
]);
const dependencyDir = resolve(cwd, 'dependencies', 'local');
const asrRequirementsPath = resolve(cwd, 'dependencies', 'asr-requirements.txt');
const venvDir = resolve(dependencyDir, 'asr-venv');
const funasrDir = resolve(dependencyDir, 'FunASR');
const funasrCommitMarker = resolve(funasrDir, '.voice-mind-map-commit');

function patchFunAsrRuntime() {
  const serverPath = resolve(funasrDir, 'runtime', 'python', 'websocket', 'funasr_wss_server.py');
  if (!existsSync(serverPath)) {
    return;
  }

  let source = readFileSync(serverPath, 'utf8');
  source = source.replaceAll(
    '    disable_log=True,\n)',
    '    disable_log=True,\n    disable_update=True,\n)',
  );
  source = source.replace(
    `# sv
model_sv = AutoModel(
    model="iic/speech_campplus_sv_zh-cn_16k-common",
    ngpu=args.ngpu,
    device=args.device,
    disable_pbar=True,
    disable_log=True,
    disable_update=True,
)`,
    `# Speaker verification is optional and unused unless a local speaker database exists.
model_sv = None
if os.path.exists(SPEAKER_DB_PATH):
    model_sv = AutoModel(
        model="iic/speech_campplus_sv_zh-cn_16k-common",
        ngpu=args.ngpu,
        device=args.device,
        disable_pbar=True,
        disable_log=True,
        disable_update=True,
    )`,
  );
  source = source.replace(
    `    try:
        spk_name, best_score = await run_blocking(
            _sv_and_match_sync,
            audio_in,
            int(args.speaker_db_reload_sec),
            sem=SEM_SV,
        )
    except Exception as e:
        print(f"声纹识别失败: {e}")`,
    `    if model_sv is not None:
        try:
            spk_name, best_score = await run_blocking(
                _sv_and_match_sync,
                audio_in,
                int(args.speaker_db_reload_sec),
                sem=SEM_SV,
            )
        except Exception as e:
            print(f"声纹识别失败: {e}")`,
  );
  writeFileSync(serverPath, source, 'utf8');
}

ensureTool('Python 3.11 or 3.12', pythonCmd?.command);
ensureTool('Git', gitCmd?.command);
ensureTool('ffmpeg', ffmpegCmd?.command);
ensureTool('Ollama', ollamaCmd?.command);
ensureNodeVersion();

if (!existsSync(resolve(cwd, '.env')) && existsSync(resolve(cwd, '.env.example'))) {
  console.log('[Voice Mind Map] Creating .env from .env.example...');
  copyFileSync(resolve(cwd, '.env.example'), resolve(cwd, '.env'));
}

if (existsSync(npmCli)) {
  run(process.execPath, [npmCli, 'ci']);
} else {
  run('npm', ['ci']);
}
const lockHash = createHash('sha256')
  .update(readFileSync(resolve(cwd, 'package-lock.json')))
  .digest('hex');
writeFileSync(resolve(cwd, 'node_modules', '.voice-mind-map-lock-hash'), `${lockHash}\n`, 'utf8');

const venvPython = getVenvPythonPath(cwd);
if (!existsSync(venvPython)) {
  mkdirSync(dependencyDir, { recursive: true });
  run(pythonCmd.command, [...pythonCmd.args, '-m', 'venv', venvDir]);
} else {
  console.log(
    '[Voice Mind Map] dependencies/local/asr-venv already exists. Skipping Python venv creation.',
  );
}

const installedFunasrCommit = existsSync(funasrCommitMarker)
  ? readFileSync(funasrCommitMarker, 'utf8').trim()
  : null;
if (installedFunasrCommit !== FUNASR_COMMIT) {
  if (!existsSync(funasrDir)) {
    mkdirSync(dirname(funasrDir), { recursive: true });
    run(gitCmd.command, ['init', funasrDir]);
    run(gitCmd.command, [
      '-C',
      funasrDir,
      'remote',
      'add',
      'origin',
      'https://github.com/modelscope/FunASR.git',
    ]);
  }
  run(gitCmd.command, ['-C', funasrDir, 'sparse-checkout', 'init', '--cone']);
  run(gitCmd.command, ['-C', funasrDir, 'sparse-checkout', 'set', 'runtime/python/websocket']);
  const shallowLockPath = resolve(funasrDir, '.git', 'shallow.lock');
  let fetched = false;
  for (const source of FUNASR_FETCH_SOURCES) {
    rmSync(shallowLockPath, { force: true });
    run(gitCmd.command, ['-C', funasrDir, 'remote', 'set-url', 'origin', source]);
    fetched = run(
      gitCmd.command,
      [
        '-c',
        'http.version=HTTP/1.1',
        '-C',
        funasrDir,
        'fetch',
        '--depth',
        '1',
        '--filter=blob:none',
        'origin',
        FUNASR_COMMIT,
      ],
      { allowFailure: true },
    );
    if (fetched) {
      break;
    }
    console.warn(
      `[Voice Mind Map] FunASR download from ${source} failed. Trying the next source...`,
    );
  }
  if (!fetched) {
    console.error('[Voice Mind Map] FunASR could not be downloaded from any configured source.');
    process.exit(1);
  }
  run(gitCmd.command, ['-C', funasrDir, 'checkout', '--detach', FUNASR_COMMIT]);
  writeFileSync(funasrCommitMarker, `${FUNASR_COMMIT}\n`, 'utf8');
} else {
  console.log(`[Voice Mind Map] FunASR ${FUNASR_COMMIT} already exists. Skipping checkout.`);
}
patchFunAsrRuntime();

const pipPython = existsSync(venvPython) ? venvPython : pythonCmd.command;
run(pipPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);

const requirementsPath = resolve(
  funasrDir,
  'runtime',
  'python',
  'websocket',
  'requirements_server.txt',
);
if (existsSync(requirementsPath)) {
  run(pipPython, ['-m', 'pip', 'install', '-r', requirementsPath]);
}
run(pipPython, ['-m', 'pip', 'install', '-r', asrRequirementsPath]);

console.log('\n[Voice Mind Map] First-time install finished.');
