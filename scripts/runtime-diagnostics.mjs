import { existsSync } from 'node:fs';
import { getVenvPythonPath } from './runtime-paths.mjs';
import { runtimePaths } from './runtime-supervisor.mjs';

export function inspectRuntimeDependencies(projectRoot) {
  const paths = runtimePaths(projectRoot);
  const python = getVenvPythonPath(projectRoot);
  const [major, minor] = process.versions.node.split('.').map(Number);
  const requiredFiles = {
    python,
    httpAsr: paths.httpAsr,
    realtimeAsr: paths.realtimeAsr,
    tsx: paths.tsx,
    vite: paths.vite,
  };
  return {
    nodeVersion: process.versions.node,
    nodeSupported: major > 22 || (major === 22 && minor >= 12),
    paths,
    python,
    requiredFiles,
    missingFiles: Object.entries(requiredFiles)
      .filter(([, file]) => !existsSync(file))
      .map(([name, file]) => ({ name, file })),
  };
}

export function assertRuntimeDependencies(projectRoot) {
  const diagnostics = inspectRuntimeDependencies(projectRoot);
  if (!diagnostics.nodeSupported) {
    throw new Error(
      `Node.js ${diagnostics.nodeVersion} is too old. Requires Node.js 22.12 or newer.`,
    );
  }
  if (diagnostics.missingFiles.length) {
    throw new Error(
      `Required runtime files are missing:\n${diagnostics.missingFiles
        .map((item) => `- ${item.name}: ${item.file}`)
        .join('\n')}`,
    );
  }
  return diagnostics;
}
