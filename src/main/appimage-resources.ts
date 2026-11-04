import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Agent integration installs symlinks and amux can outlive the GUI. Neither may
// depend on an AppImage mount that disappears when the desktop process exits.
export async function persistentAppImageResources(source: string, home: string, appImage: string): Promise<string> {
  const hash = createHash('sha256').update(path.resolve(appImage));
  async function fingerprint(directory: string) {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      hash.update(path.relative(source, file)).update('\0');
      hash.update(String((await stat(file)).mode)).update('\0');
      if (entry.isDirectory()) await fingerprint(file);
      else for await (const chunk of createReadStream(file)) hash.update(chunk);
    }
  }
  for (const name of ['bin', 'agent-integration']) await fingerprint(path.join(source, name));
  const parent = path.join(home, 'data', 'bundled-resources');
  const destination = path.join(parent, hash.digest('hex'));
  if (await stat(destination).then(value => value.isDirectory(), () => false)) return destination;
  await mkdir(parent, { recursive: true });
  const temporary = await mkdtemp(path.join(parent, '.staging-'));
  try {
    for (const name of ['bin', 'agent-integration']) await cp(path.join(source, name), path.join(temporary, name), { recursive: true });
    await writeFile(path.join(temporary, 'desktop-path'), path.resolve(appImage));
    await rename(temporary, destination);
  } finally { await rm(temporary, { recursive: true, force: true }); }
  return destination;
}
