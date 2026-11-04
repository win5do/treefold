import { userInfo } from 'node:os';
import path from 'node:path';
import { isExecutable } from './executable.ts';

export async function selectShell(env = process.env, loginShell?: string | null): Promise<string> {
  if (loginShell === undefined) {
    try { loginShell = userInfo().shell; } catch { loginShell = null; }
  }
  for (const candidate of [env.SHELL, loginShell, '/bin/bash', '/bin/sh']) {
    if (candidate && path.isAbsolute(candidate) && await isExecutable(candidate)) return candidate;
  }
  throw new Error('No executable login shell, bash, or sh is available');
}
