// Replaced by Vite for both desktop builds and the deterministic UI fixture.
declare const __TREEFOLD_BUILD_INFO__: {
  version: string;
  commit: string | null;
  repository: string;
  website: string;
  author: { name: string; url: string };
  copyright: string;
};

export const buildInfo = __TREEFOLD_BUILD_INFO__;
