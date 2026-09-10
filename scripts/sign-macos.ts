import path from 'node:path';
import { signAsync } from '@electron/osx-sign';
import type { CustomMacSignOptions } from 'app-builder-lib';
import { execFileSync } from 'node:child_process';

// electron-builder loads this hook with require; keep this module free of top-level await.
// Local distributables use an explicit ad-hoc identity, without Keychain lookup.
export default async function sign(options: CustomMacSignOptions) {
  await signAsync({
    ...options,
    identity: '-', identityValidation: false,
    preAutoEntitlements: false, preEmbedProvisioningProfile: false,
    optionsForFile: () => ({
      entitlements: path.resolve(import.meta.dirname, '../build/entitlements.mac.plist'),
      hardenedRuntime: true, timestamp: 'none',
    }),
  });
  execFileSync('codesign', ['--verify', '--deep', '--strict', options.app], { stdio: 'inherit' });
}
