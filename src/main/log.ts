import fs from 'node:fs';
import path from 'node:path';
export function createLog(home: string, { debug = false } = {}) {
  const directory = path.join(home, 'logs');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'desktop.log');
  return (level: string, message: string, source = 'main') => {
    if (!['debug', 'info', 'warn', 'error'].includes(level) || typeof message !== 'string') return;
    if (!['main', 'renderer'].includes(source)) return;
    if (level === 'debug' && !debug) return;
    try {
      if (fs.existsSync(file) && fs.statSync(file).size >= 5 * 1024 * 1024) {
        fs.rmSync(`${file}.5`, { force: true });
        for (let i = 4; i >= 1; i--) if (fs.existsSync(`${file}.${i}`)) fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
        fs.renameSync(file, `${file}.1`);
      }
      fs.appendFileSync(file, `${new Date().toISOString()} ${level.toUpperCase()} [${source}] ${message.slice(0, 65536)}\n`);
    } catch (error) { console.error('Desktop log write failed', error); }
  };
}

