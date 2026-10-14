import { valid } from 'semver';

export function resolveBuildVersion(packageVersion: string, options: {
  localInstall?: boolean; override?: string; now?: Date;
} = {}) {
  let version = options.override ?? packageVersion;
  if (options.override === undefined && options.localInstall) {
    const timestamp = (options.now ?? new Date()).toISOString().replace(/\D/g, '').slice(0, 14);
    const [base, metadata] = packageVersion.split('+');
    version = `${base}${base.includes('-') ? '.' : '-'}dev.${timestamp}${metadata ? `+${metadata}` : ''}`;
  }
  if (valid(version) !== version.split('+')[0]) throw new Error(`TREEFOLD_BUILD_VERSION must be valid SemVer, received: ${version}`);
  return version;
}
