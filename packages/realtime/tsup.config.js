import { copyFile } from 'node:fs/promises';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.js', 'src/core.js'],
  format: ['esm', 'cjs'],
  splitting: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022',
  onSuccess: async () => {
    await Promise.all([
      copyFile('src/index.d.ts', 'dist/index.d.ts'),
      copyFile('src/index.d.ts', 'dist/index.d.cts'),
      copyFile('src/core.d.ts', 'dist/core.d.ts'),
      copyFile('src/core.d.ts', 'dist/core.d.cts'),
    ]);
  },
});
