export const siteLinks = {
  github: 'https://github.com/win5do/treefold',
  releases: 'https://github.com/win5do/treefold/releases',
  homebrewTap: 'https://github.com/win5do/homebrew-tap',
  linuxDevelopment: 'https://github.com/win5do/treefold/blob/main/docs/linux-development.md',
  license: 'https://github.com/win5do/treefold/blob/main/LICENSE',
} as const;

export const installCommand = 'brew install --cask win5do/tap/treefold';

const releaseVersion = '0.2.0';
const dmgFilename = `Treefold-${releaseVersion}-arm64.dmg`;

export const currentRelease = {
  version: releaseVersion,
  url: `${siteLinks.releases}/tag/v${releaseVersion}`,
  dmgFilename,
  dmgUrl: `${siteLinks.releases}/download/v${releaseVersion}/${dmgFilename}`,
} as const;
