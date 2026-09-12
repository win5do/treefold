import { access, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { appCatalog, type AppDefinition } from './catalog.ts';
import type { OpenInApp } from '../../preload/bridge.d.ts';

const execute = promisify(execFile);
export type DetectedApp = AppDefinition & { appPath: string; cli?: string };
export type LaunchCommand = { command: string; args: string[] };
export type DiscoveryOptions = { roots?: string[]; toolboxRoot?: string; platform?: string };
async function isDirectory(file: string) { return (await stat(file).catch(() => null))?.isDirectory() ?? false; }
async function executable(file: string) {
  try { await access(file, constants.X_OK); return (await stat(file)).isFile(); } catch { return false; }
}
async function bundlesIn(root: string, depth = 0): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const results = await Promise.all(entries.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true })).map(async entry => {
    const file = path.join(root, entry.name);
    if (entry.name.toLowerCase().endsWith('.app')) return await isDirectory(file) ? [file] : [];
    return depth > 0 && entry.isDirectory() ? bundlesIn(file, depth - 1) : [];
  }));
  return results.flat();
}
export async function detectApps(options: DiscoveryOptions = {}): Promise<DetectedApp[]> {
  if ((options.platform ?? process.platform) !== 'darwin') return [];
  const roots = options.roots ?? ['/Applications', path.join(homedir(), 'Applications')];
  const toolbox = options.toolboxRoot ?? path.join(homedir(), 'Library/Application Support/JetBrains/Toolbox/apps');
  const installed = (await Promise.all(roots.map(root => bundlesIn(root)))).flat();
  const toolboxApps = await bundlesIn(toolbox, 4);
  const result = await Promise.all(appCatalog.map(async definition => {
    const candidates = definition.bundles.flatMap(bundle => path.isAbsolute(bundle) ? [bundle] : roots.map(root => path.join(root, bundle)));
    if (definition.jetbrains) candidates.push(...[...installed, ...toolboxApps].filter(file => {
      const name = path.basename(file).toLowerCase();
      return name.startsWith(definition.label.toLowerCase()) && name.endsWith('.app');
    }));
    for (const appPath of candidates) {
      if (!await isDirectory(appPath)) continue;
      if (definition.id === 'cmux') {
        const cli = path.join(appPath, 'Contents/Resources/bin/cmux');
        if (!await executable(cli)) continue;
        return { ...definition, appPath, cli };
      }
      return { ...definition, appPath };
    }
    return null;
  }));
  return result.filter((app): app is DetectedApp => app !== null);
}
export async function listOpenInApps(): Promise<OpenInApp[]> {
  return (await detectApps()).map(({ id, label, group }) => ({ id, label, group }));
}
export function launchCommand(app: DetectedApp, directory: string): LaunchCommand {
  const open = (...args: string[]) => ({ command: '/usr/bin/open', args });
  switch (app.id) {
    case 'ghostty': return open('-na', app.appPath, '--args', `--working-directory=${directory}`);
    case 'kitty': return open('-na', app.appPath, '--args', '--directory', directory);
    case 'warp': return open('-a', app.appPath, `warp://action/new_window?path=${encodeURIComponent(directory)}`);
    case 'cmux': return { command: app.cli!, args: ['new-workspace', '--cwd', directory] };
    default: return open('-a', app.appPath, directory);
  }
}
export type OpenInDependencies = {
  detect?: () => Promise<DetectedApp[]>;
  run?: (command: string, args: string[]) => Promise<void>;
};
export async function openInApp(id: unknown, directory: unknown, dependencies: OpenInDependencies = {}) {
  if (typeof id !== 'string' || !appCatalog.some(app => app.id === id)) throw new Error('Unknown application');
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.includes('\0') || !await isDirectory(directory)) {
    throw new Error('The target directory no longer exists');
  }
  const app = (await (dependencies.detect ?? detectApps)()).find(app => app.id === id);
  if (!app) throw new Error('The selected application is no longer installed');
  const run = dependencies.run ?? (async (command: string, args: string[]) => {
    const env = { ...process.env };
    // Do not target the cmux workspace/socket that happened to launch Treefold.
    for (const key of Object.keys(env)) if (key.startsWith('CMUX_')) delete env[key];
    await execute(command, args, { timeout: args[0] === 'ping' ? 1_000 : 15_000, env });
  });
  if (app.id === 'cmux') {
    await run('/usr/bin/open', ['-a', app.appPath]);
    // Opening the App returns before its socket is ready. Retry only the read-only ping.
    for (let attempt = 0; ; attempt++) {
      try { await run(app.cli!, ['ping']); break; }
      catch (error) { if (attempt === 4) throw error; await delay(250); }
    }
  }
  const command = launchCommand(app, directory);
  await run(command.command, command.args);
}
