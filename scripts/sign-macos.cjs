const path = require('node:path');
const { signAsync } = require('@electron/osx-sign');
const { execFileSync } = require('node:child_process');

// Local distributables use an explicit ad-hoc identity, without Keychain lookup.
module.exports = async function sign(options) {
  await signAsync({
    ...options,
    identity: '-', identityValidation: false,
    preAutoEntitlements: false, preEmbedProvisioningProfile: false,
    optionsForFile: () => ({
      entitlements: path.resolve(__dirname, '../build/entitlements.mac.plist'),
      hardenedRuntime: true, timestamp: 'none',
    }),
  });
  execFileSync('codesign', ['--verify', '--deep', '--strict', options.app], { stdio: 'inherit' });
};
