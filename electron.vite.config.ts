import path from 'node:path';
import { defineConfig } from 'electron-vite';
import renderer from './vite.config';
import { rustSidecars } from './scripts/rust-sidecars';

export default defineConfig(async ({ command }) => {
  if (command === 'serve') {
    process.env.TREEFOLD_HOME ||= process.env.TREEFOLD_DEV_HOME || path.resolve('.treefold-dev');
    process.env.TREEFOLD_API_ADDR ||= `127.0.0.1:${process.env.TREEFOLD_API_PORT || '0'}`;
    delete process.env.ELECTRON_RUN_AS_NODE;
  }
  return {
    main: {
      plugins: command === 'serve' ? [await rustSidecars()] : [],
      build: { sourcemap: true, rollupOptions: {
        input: path.resolve('electron/main.ts'), output: { format: 'cjs' as const, entryFileNames: 'index.cjs' },
      } },
    },
    preload: {
      build: { sourcemap: true, rollupOptions: {
        input: path.resolve('electron/preload.ts'), output: { format: 'cjs' as const, entryFileNames: 'index.cjs', inlineDynamicImports: true },
      } },
    },
    renderer: { ...renderer, root: '.', build: { outDir: 'out/renderer', rollupOptions: { input: path.resolve('index.html') } } },
  };
});
