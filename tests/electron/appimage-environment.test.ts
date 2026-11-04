import { expect, test } from '@playwright/test';
import { cleanAppImageEnvironment } from '../../src/main/appimage-environment.ts';

test('removes AppImage mount paths while preserving host entries and the original environment', () => {
  const mount = '/tmp/.mount_Treefold 123';
  const env = {
    APPDIR: `${mount}/`, APPIMAGE: '/home/user/Apps/Treefold.AppImage',
    PATH: `${mount}:${mount}/usr/sbin:/home/user/bin:/usr/bin:${mount}-other/bin`,
    LD_LIBRARY_PATH: `${mount}/usr/lib:/opt/user/lib::/usr/local/lib`,
    XDG_DATA_DIRS: `${mount}/usr/share/:./share/:/usr/share:/home/user/.local/share`,
    GSETTINGS_SCHEMA_DIR: `${mount}/usr/share/glib-2.0/schemas:/opt/user/schemas`,
    SHELL: '/bin/bash', CUSTOM_SETTING: 'preserved',
  };
  const original = { ...env };
  expect(cleanAppImageEnvironment(env)).toEqual({
    PATH: `/home/user/bin:/usr/bin:${mount}-other/bin`,
    LD_LIBRARY_PATH: '/opt/user/lib::/usr/local/lib',
    XDG_DATA_DIRS: './share/:/usr/share:/home/user/.local/share',
    GSETTINGS_SCHEMA_DIR: '/opt/user/schemas',
    SHELL: '/bin/bash', CUSTOM_SETTING: 'preserved',
  });
  expect(env).toEqual(original);
});

test('unsets mount-only variables, removes paths traversing the mount, and is idempotent', () => {
  const env = {
    APPDIR: '/tmp/mount', APPIMAGE: '/tmp/app.AppImage',
    PATH: '/tmp/mount/./usr/bin:/tmp/mount/../host/bin:/tmp/./mount/usr/bin:/usr/bin',
    LD_LIBRARY_PATH: '/tmp/mount/usr/lib:',
    GSETTINGS_SCHEMA_DIR: '/tmp/mount/usr/share/glib-2.0/schemas:',
  };
  const cleaned = cleanAppImageEnvironment(env);
  expect(cleaned).toEqual({ PATH: '/usr/bin' });
  expect(cleanAppImageEnvironment(cleaned)).toEqual(cleaned);
});

test('does not alter host search paths without a valid AppImage mount', () => {
  for (const appDir of [undefined, '', 'relative', '/']) {
    const env = { APPDIR: appDir, APPIMAGE: '/tmp/app.AppImage', PATH: '/usr/bin:/bin', LD_LIBRARY_PATH: '/opt/lib:' };
    expect(cleanAppImageEnvironment(env)).toEqual({ PATH: '/usr/bin:/bin', LD_LIBRARY_PATH: '/opt/lib:' });
  }
  expect(cleanAppImageEnvironment({ PATH: '/usr/bin', CUSTOM_SETTING: 'value' }))
    .toEqual({ PATH: '/usr/bin', CUSTOM_SETTING: 'value' });
});
