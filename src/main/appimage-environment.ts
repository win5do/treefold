import path from 'node:path';

const appImagePathVariables = ['PATH', 'LD_LIBRARY_PATH', 'XDG_DATA_DIRS', 'GSETTINGS_SCHEMA_DIR'] as const;

// AppRun prepends its transient mount to these variables. Children such as
// external editors and the persistent amux daemon must use the host environment
// after the AppImage exits and its mount disappears. Return a copy so callers
// can retain APPIMAGE separately as the desktop relaunch target.
export function cleanAppImageEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned = { ...env };
  const appDir = env.APPDIR && path.isAbsolute(env.APPDIR) ? path.normalize(env.APPDIR) : undefined;
  if (appDir && appDir !== path.parse(appDir).root) {
    const root = appDir.replace(/\/+$/, '');
    const belongsToAppImage = (entry: string) => {
      if (!path.isAbsolute(entry)) return false;
      // A raw mount/../host path still requires the mount directory to exist.
      return [entry, path.normalize(entry)].some(value => value === root || value.startsWith(`${root}${path.sep}`));
    };
    for (const key of appImagePathVariables) {
      if (cleaned[key] === undefined) continue;
      const entries = cleaned[key].split(path.delimiter);
      const retained = entries.filter(entry => !belongsToAppImage(entry));
      if (retained.length === entries.length) continue;
      const value = retained.join(path.delimiter);
      if (value) cleaned[key] = value;
      else delete cleaned[key];
    }
  }
  delete cleaned.APPIMAGE;
  delete cleaned.APPDIR;
  return cleaned;
}
