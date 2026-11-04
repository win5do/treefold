import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

export async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return (await stat(file)).isFile();
  } catch { return false; }
}

export async function findExecutable(name: string, searchPath = process.env.PATH ?? ''): Promise<string | undefined> {
  if (path.isAbsolute(name)) return await isExecutable(name) ? name : undefined;
  for (const directory of searchPath.split(path.delimiter)) {
    // Desktop discovery must not depend on the application's working directory.
    if (!path.isAbsolute(directory)) continue;
    const file = path.join(directory, name);
    if (await isExecutable(file)) return file;
  }
  return undefined;
}
