import { execFile } from 'node:child_process';
import { execFileSync } from 'node:child_process';

export function runBoundedChild(file, {
  cwd,
  env = process.env,
  timeoutMs = 300_000,
  stdio = 'inherit',
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error(`invalid child timeout ${timeoutMs}`);
  return execFileSync(process.execPath, [file], { cwd, env, stdio, timeout: timeoutMs, killSignal: 'SIGKILL' });
}

export function runBoundedChildAsync(file, {
  cwd,
  env = process.env,
  timeoutMs = 300_000,
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) return Promise.reject(new Error(`invalid child timeout ${timeoutMs}`));
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [file], { cwd, env, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) { error.stdout = stdout; error.stderr = stderr; reject(error); return; }
      resolve({ stdout, stderr });
    });
  });
}

export async function runBoundedChildrenSettled(children) {
  const settled = await Promise.allSettled(children.map(({ file, options }) => runBoundedChildAsync(file, options)));
  return settled.map((result, index) => ({ name: children[index].name, ...result }));
}
