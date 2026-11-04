import path from 'node:path';

export function packagedExecutable() {
  return process.env.TREEFOLD_ELECTRON_APP || (process.platform === 'linux'
    ? path.resolve('release', process.arch === 'x64' ? 'linux-unpacked' : `linux-${process.arch}-unpacked`, 'treefold-desktop')
    : path.resolve('release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Treefold.app/Contents/MacOS/Treefold'));
}

export function packagedResources(executable = packagedExecutable()) {
  return process.platform === 'linux' ? path.join(path.dirname(executable), 'resources') : path.resolve(path.dirname(executable), '../Resources');
}
