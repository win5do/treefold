import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir, userInfo } from 'node:os';

type Options = {
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  onWarning?: (message: string) => void;
};

// Finder launches do not inherit terminal startup files. Read PATH once using
// the user's login + interactive shell so zshrc and version managers participate.
export async function readShellPath({ env = process.env, timeout = 5000, onWarning = () => {} }: Options = {}): Promise<string | undefined> {
  try {
    const shell = env.SHELL || userInfo().shell || '/bin/zsh';
    const token = `TREEFOLD_PATH_${randomUUID()}`;
    const marker = `\0${token}\0`;
    const delimiter = `\\000${token}\\000`;
    // printenv preserves a colon-separated PATH even in shells with list syntax
    // (fish). Frame it separately from banners and other startup/shutdown output.
    const command = `/usr/bin/printf '${delimiter}'; /usr/bin/printenv PATH; /usr/bin/printf '${delimiter}'`;
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(shell, ['-ilc', command], {
        cwd: env.HOME || homedir(), env, detached: true, stdio: ['ignore', 'pipe', 'ignore'],
      });
      const chunks: Buffer[] = [];
      let size = 0, settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Kill the probe's process group too: a startup script may be waiting on
        // a child that inherited stdout, which would otherwise keep startup stuck.
        if (child.pid) {
          try { process.kill(-child.pid, 'SIGKILL'); }
          catch { child.kill('SIGKILL'); }
        }
        child.stdout.destroy();
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error(`shell PATH probe timed out after ${timeout}ms`)), timeout);
      child.on('error', error => fail(new Error(`shell PATH probe could not start (${(error as NodeJS.ErrnoException).code || 'unknown error'})`)));
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1024 * 1024) { fail(new Error('shell PATH probe output exceeded 1 MiB')); return; }
        chunks.push(chunk);
      });
      child.on('exit', (code, signal) => {
        if (code !== 0) fail(new Error(`shell PATH probe exited (${signal || code})`));
      });
      child.on('close', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    const framed = output.split(marker);
    const value = framed[1]?.replace(/\n$/, '');
    if (framed.length !== 3 || !value || value.includes('\0')) throw new Error('shell PATH probe returned no valid PATH');
    return value;
  } catch (error) {
    // Do not include startup output: shell configuration may print credentials.
    onWarning(`Keeping inherited PATH: ${(error as Error).message}`);
    return undefined;
  }
}
