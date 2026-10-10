import { readFileSync } from 'node:fs';
import path from 'node:path';
import { valid } from 'semver';

export function validateReleaseVersion(version: string) {
  if (valid(version) !== version || version.includes('+')) {
    throw new Error(`Expected a SemVer release version without a v prefix or build metadata: ${version}`);
  }
}

// Build the complete edit set before writing anything. Only Treefold's own
// package records change; dependency pins and independently versioned Skills stay intact.
export function releaseVersionFiles(root: string, version: string, check = false) {
  validateReleaseVersion(version);
  const files = new Map<string, string>();
  const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
  const setVersion = (record: Record<string, unknown>, key: string, file: string) => {
    if (typeof record[key] !== 'string' || !valid(record[key])) {
      throw new Error(`Missing or invalid ${key} in ${file}`);
    }
    if (check && record[key] !== version) {
      throw new Error(`Version mismatch in ${file}: ${key}=${record[key]}, expected ${version}`);
    }
    record[key] = version;
  };
  for (const file of ['package.json', 'package-lock.json']) {
    const data = JSON.parse(read(file));
    setVersion(data, 'version', file);
    if (file === 'package-lock.json') setVersion(data.packages[''], 'version', file);
    files.set(file, `${JSON.stringify(data, null, 2)}\n`);
  }
  for (const [directory, name] of [['src/backend', 'treefold-backend'], ['src/cli', 'treefold-cli']]) {
    for (const filename of ['Cargo.toml', 'Cargo.lock']) {
      const file = `${directory}/${filename}`;
      const header = filename === 'Cargo.toml' ? '[package]' : '[[package]]';
      let matches = 0;
      const contents = read(file).split(/(?=^\[)/m).map((section) => {
        if (!section.startsWith(`${header}\n`) || !section.includes(`\nname = "${name}"\n`)) return section;
        matches++;
        const match = /^version = "([^"]+)"$/m.exec(section);
        if (!match) throw new Error(`Missing package version in ${file}`);
        setVersion({ version: match[1] }, 'version', file);
        return section.replace(/^version = "[^"]+"$/m, `version = "${version}"`);
      }).join('');
      if (matches !== 1) throw new Error(`Expected exactly one ${name} package in ${file}, found ${matches}`);
      files.set(file, contents);
    }
  }
  const file = 'src/backend/resources/agent-integration/manifest.json';
  const manifest = JSON.parse(read(file));
  setVersion(manifest, 'bundle_version', file);
  setVersion(manifest.components, 'treefold_cli', file);
  files.set(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return files;
}
