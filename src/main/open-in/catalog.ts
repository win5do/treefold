import type { OpenInApp } from '../../preload/bridge.d.ts';

export type AppDefinition = OpenInApp & { bundles: string[]; jetbrains?: boolean };
const editor = (id: string, label: string, bundles = [`${label}.app`], jetbrains = false): AppDefinition =>
  ({ id, label, group: 'editor', bundles, jetbrains });
const terminal = (id: string, label: string, bundles = [`${label}.app`]): AppDefinition =>
  ({ id, label, group: 'terminal', bundles });
export const appCatalog: AppDefinition[] = [
  { id: 'finder', label: 'Finder', group: 'fileManager', bundles: ['/System/Library/CoreServices/Finder.app'] },
  editor('vscode', 'VS Code', ['Visual Studio Code.app', 'Code.app']),
  editor('vscode-insiders', 'VS Code Insiders', ['Visual Studio Code - Insiders.app']),
  editor('cursor', 'Cursor'),
  editor('zed', 'Zed', ['Zed.app', 'Zed Preview.app', 'Zed Nightly.app']),
  editor('sublime-text', 'Sublime Text'),
  editor('windsurf', 'Windsurf'),
  ...[
    ['intellij', 'IntelliJ IDEA'], ['goland', 'GoLand'], ['rustrover', 'RustRover'],
    ['webstorm', 'WebStorm'], ['pycharm', 'PyCharm'], ['phpstorm', 'PhpStorm'],
    ['rider', 'Rider'], ['clion', 'CLion'], ['android-studio', 'Android Studio'],
  ].map(([id, label]) => editor(id, label, [`${label}.app`], true)),
  terminal('terminal', 'Terminal', ['/System/Applications/Utilities/Terminal.app']),
  terminal('iterm2', 'iTerm2', ['iTerm.app', 'iTerm2.app']),
  terminal('ghostty', 'Ghostty'),
  terminal('cmux', 'cmux'),
  terminal('warp', 'Warp'),
  terminal('kitty', 'Kitty', ['kitty.app']),
];
