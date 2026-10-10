import type { LaunchCommand } from './service.ts';

export function ghosttyLaunchCommand(appPath: string, directory: string): LaunchCommand {
  // Only the discovered bundle path is script source. User directories stay in argv.
  const application = `"${appPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`;
  const script = `on run argv
  tell application ${application}
    set cfg to new surface configuration
    set initial working directory of cfg to item 1 of argv
    new window with configuration cfg
    activate
  end tell
end run`;
  // Apple Events launch Ghostty if needed and otherwise address the existing app.
  // Do not fall back to open -n: a denied request must not create another instance.
  return { command: '/usr/bin/osascript', args: ['-e', script, directory] };
}
