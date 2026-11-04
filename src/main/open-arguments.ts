import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Desktop entries pass a directory as a positional argument; the CLI uses an
// explicit flag so paths cannot be confused with Electron switches.
export function directoryFromArguments(argv: string[], cwd: string, packaged: boolean): string | undefined {
  const args = argv.slice(packaged ? 1 : 2);
  const explicit = args.indexOf('--open-directory');
  const named = args.find(arg => arg.startsWith('--open-directory='));
  // Chromium reorders switches ahead of positional arguments when forwarding
  // a second instance. Prefer the atomic flag form, but accept separate values
  // even if Chromium has inserted its own switches between flag and directory.
  const candidates = named ? [named.slice('--open-directory='.length)]
    : (explicit >= 0 ? args.slice(explicit + 1) : args).filter(arg => !arg.startsWith('-'));
  for (const candidate of candidates) {
    try {
      const directory = candidate.startsWith('file:') ? fileURLToPath(candidate) : path.resolve(cwd, candidate);
      if (statSync(directory).isDirectory()) return directory;
    } catch { /* Ignore missing paths and malformed desktop-entry URLs. */ }
  }
  return undefined;
}
