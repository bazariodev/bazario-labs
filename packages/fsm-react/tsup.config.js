import { copyFile } from 'node:fs/promises';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.js'],
  format: ['esm', 'cjs'],
  clean: true,
  sourcemap: true,
  // Rollup's tree-shaking pass drops module-level directives, and a
  // single-module package has nothing to shake.
  treeshake: false,
  banner: { js: "'use client';" },
  target: 'es2022',
  onSuccess: async () => {
    await Promise.all([
      copyFile('src/index.d.ts', 'dist/index.d.ts'),
      copyFile('src/index.d.ts', 'dist/index.d.cts'),
    ]);
  },
});
