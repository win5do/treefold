import { readlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';

// electron-vite starts the replacement before the previous Electron has exited.
// On macOS, contacting Chromium's singleton socket during that shutdown can
// return a lock but leave app.whenReady() pending. Wait for its owner first.
export async function waitForPreviousDevInstance(userData: string, timeout = 15000): Promise<boolean> {
  let target: string;
  try { target = await readlink(path.join(userData, 'SingletonLock')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
  const prefix = `${hostname()}-`;
  if (!target.startsWith(prefix)) return true; // Let Chromium handle a foreign host.
  const pid = Number(target.slice(prefix.length));
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return true;
  const deadline = Date.now() + timeout;
  do {
    try { process.kill(pid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  return false;
}
