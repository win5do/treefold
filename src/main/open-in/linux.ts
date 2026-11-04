import type { OpenInApp } from '../../preload/bridge.d.ts';
import { findExecutable } from '../executable.ts';
import type { DetectedApp } from './service.ts';

type Launcher = { commands: string[]; args: (directory: string) => string[] };
type LinuxApp = OpenInApp & Launcher;
const workingDirectory = (directory: string) => [`--working-directory=${directory}`];
const terminalLaunchers: Launcher[] = [
  { commands: ['xdg-terminal-exec'], args: directory => [`--dir=${directory}`] },
  { commands: ['x-terminal-emulator'], args: () => [] },
  { commands: ['konsole'], args: directory => ['--workdir', directory] },
  { commands: ['gnome-terminal'], args: workingDirectory },
  { commands: ['xfce4-terminal'], args: workingDirectory },
  { commands: ['ghostty'], args: workingDirectory },
  { commands: ['kitty'], args: directory => ['--directory', directory] },
  { commands: ['foot', 'alacritty'], args: workingDirectory },
];
export const linuxAppCatalog: LinuxApp[] = [
  { id: 'files', label: 'Files', group: 'fileManager', commands: ['xdg-open'], args: directory => [directory] },
  { id: 'ghostty', label: 'Ghostty', group: 'terminal', commands: ['ghostty'], args: workingDirectory },
  { id: 'vscode', label: 'VS Code', group: 'editor', commands: ['code', 'code-oss'], args: directory => ['--new-window', directory] },
  { id: 'zed', label: 'Zed', group: 'editor', commands: ['zed', 'zeditor'], args: directory => ['--new', directory] },
];

async function resolveLauncher(launchers: Launcher[], searchPath?: string) {
  for (const launcher of launchers) {
    for (const name of launcher.commands) {
      const executable = await findExecutable(name, searchPath);
      if (executable) return { executable, args: launcher.args };
    }
  }
  return undefined;
}

export async function detectLinuxApps(searchPath?: string): Promise<DetectedApp[]> {
  const apps: DetectedApp[] = [];
  const add = (definition: OpenInApp, executable: string, args: Launcher['args']) => {
    apps.push({ ...definition, bundles: [], appPath: executable,
      launch: directory => ({ command: executable, args: args(directory), cwd: directory, detached: true }) });
  };
  for (const definition of linuxAppCatalog) {
    const launcher = await resolveLauncher([definition], searchPath);
    if (launcher) add(definition, launcher.executable, launcher.args);
  }
  const terminal = await resolveLauncher(terminalLaunchers, searchPath);
  if (terminal) add({ id: 'terminal', label: 'Terminal', group: 'terminal' }, terminal.executable, terminal.args);
  return apps;
}
