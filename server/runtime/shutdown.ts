import { exec } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ShutdownRuntimeOptions {
  runtimePidFile?: string;
  runtimeId: string;
  projectRoot: string;
}

function execCommand(command: string) {
  return new Promise<string>((resolveResponse) => {
    exec(command, (_error, stdout) => {
      resolveResponse(stdout ?? '');
    });
  });
}

async function findListeningPids(targetPort: number) {
  const output = await execCommand(`lsof -nP -tiTCP:${targetPort} -sTCP:LISTEN`);
  return output
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

async function readProcessDetails(pid: number) {
  const commandLine = (await execCommand(`ps -p ${pid} -o command=`)).trim();
  if (!commandLine) {
    return null;
  }
  return {
    commandLine,
    executablePath: '',
  };
}

async function readAllProcessDetails() {
  const output = await execCommand('ps -axo pid=,command=');
  return output
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^(\d+)\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      ProcessId: Number(match[1]),
      CommandLine: match[2],
      ExecutablePath: '',
    }));
}

async function readParentPid(pid: number) {
  const output = await execCommand(`ps -p ${pid} -o ppid=`);
  const parentPid = Number(output.trim());
  return Number.isInteger(parentPid) ? parentPid : 0;
}

async function isDescendantPid(pid: number, ancestorPid: number) {
  let currentPid = pid;
  for (let index = 0; index < 20; index += 1) {
    const parentPid = await readParentPid(currentPid);
    if (parentPid === ancestorPid) {
      return true;
    }
    if (!Number.isInteger(parentPid) || parentPid <= 0 || parentPid === currentPid) {
      return false;
    }
    currentPid = parentPid;
  }
  return false;
}

async function killPid(pid: number) {
  if (pid === process.pid) {
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // The managed process may have exited between inspection and termination.
  }
}

export async function shutdownRuntime(serverPid: number, options: ShutdownRuntimeOptions) {
  const runtimePidFile = options.runtimePidFile ?? resolve(process.cwd(), '.runtime-pids.json');
  if (!existsSync(runtimePidFile)) {
    return;
  }

  let runtime: {
    runtimeId?: string;
    projectRoot?: string;
    processes?: Array<{ pid?: number; port?: number; role?: string; commandToken?: string }>;
  };
  try {
    runtime = JSON.parse(
      readFileSync(runtimePidFile, 'utf8').replace(/^\uFEFF/, ''),
    ) as typeof runtime;
  } catch {
    return;
  }

  const normalizePath = (value: string) => resolve(value).toLowerCase();
  const expectedRoot = normalizePath(options.projectRoot);
  if (
    runtime.runtimeId !== options.runtimeId ||
    normalizePath(runtime.projectRoot ?? '') !== expectedRoot
  ) {
    return;
  }

  const processSnapshot = await readAllProcessDetails();
  const killedPids = new Set<number>();

  for (const record of runtime.processes ?? []) {
    if (record.role === 'backend' || record.role === 'web-api') {
      continue;
    }

    const normalizedToken = record.commandToken?.toLowerCase();
    const candidatePids = new Set<number>();
    const recordedPid = Number(record.pid);
    if (Number.isInteger(recordedPid) && recordedPid > 0) {
      candidatePids.add(recordedPid);
    }
    if (normalizedToken) {
      for (const processDetails of processSnapshot) {
        const identity =
          `${processDetails.CommandLine ?? ''} ${processDetails.ExecutablePath ?? ''}`.toLowerCase();
        if (identity.includes(normalizedToken) && Number.isInteger(processDetails.ProcessId)) {
          candidatePids.add(processDetails.ProcessId as number);
        }
      }
    }

    for (const pid of candidatePids) {
      if (pid === serverPid || killedPids.has(pid)) {
        continue;
      }

      const details = await readProcessDetails(pid);
      if (!details) {
        continue;
      }

      const identity = `${details.commandLine ?? ''} ${details.executablePath ?? ''}`.toLowerCase();
      if (
        !identity.includes(expectedRoot) ||
        (normalizedToken && !identity.includes(normalizedToken))
      ) {
        continue;
      }

      if (record.port) {
        const listeningPids = await findListeningPids(record.port);
        if (listeningPids.length > 0 && !listeningPids.includes(pid)) {
          const ownedByDescendant = (
            await Promise.all(
              listeningPids.map((listeningPid) => isDescendantPid(listeningPid, pid)),
            )
          ).some(Boolean);
          if (!ownedByDescendant) {
            continue;
          }
        }
      }

      await killPid(pid);
      killedPids.add(pid);
    }
  }

  rmSync(runtimePidFile, { force: true });
}
