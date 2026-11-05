export const siteLinks = {
  github: 'https://github.com/win5do/treefold',
  releases: 'https://github.com/win5do/treefold/releases',
  homebrewTap: 'https://github.com/win5do/homebrew-tap',
  license: 'https://github.com/win5do/treefold/blob/main/LICENSE',
} as const;

export const installCommand = 'brew install --cask win5do/tap/treefold';

const releaseVersion = '0.3.0';
const dmgFilename = `Treefold-${releaseVersion}-arm64.dmg`;
const assetUrl = (filename: string) => `${siteLinks.releases}/download/v${releaseVersion}/${filename}`;

export const currentRelease = {
  version: releaseVersion,
  url: `${siteLinks.releases}/tag/v${releaseVersion}`,
  dmgFilename,
  dmgUrl: assetUrl(dmgFilename),
  zipUrl: assetUrl(`Treefold-${releaseVersion}-arm64.zip`),
  appImageUrl: assetUrl(`Treefold-${releaseVersion}-x86_64.AppImage`),
  debUrl: assetUrl(`Treefold-${releaseVersion}-amd64.deb`),
  rpmUrl: assetUrl(`Treefold-${releaseVersion}-x86_64.rpm`),
} as const;
