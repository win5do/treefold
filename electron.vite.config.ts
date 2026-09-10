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
        input: path.resolve('src/main/index.ts'), output: { format: 'cjs' as const, entryFileNames: 'index.cjs' },
      } },
    },
    preload: {
      build: { sourcemap: true, rollupOptions: {
        input: path.resolve('src/preload/index.ts'), output: { format: 'cjs' as const, entryFileNames: 'index.cjs', inlineDynamicImports: true },
      } },
    },
    renderer: { ...renderer, build: { outDir: path.resolve('out/renderer'), emptyOutDir: true, rollupOptions: { input: path.resolve('src/renderer/index.html') } } },
  };
});
