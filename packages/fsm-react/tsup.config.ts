import { readFile, writeFile } from 'node:fs/promises';

import { defineConfig } from 'tsup';

const USE_CLIENT_DIRECTIVE = "'use client';\n";

const addUseClientDirective = async (
  filePath: string,
  mapPath: string,
): Promise<void> => {
  const source = await readFile(filePath, 'utf8');
  if (source.startsWith(USE_CLIENT_DIRECTIVE)) return;

  const rawMap = await readFile(mapPath, 'utf8');
  const map = JSON.parse(rawMap) as { mappings?: string };

  if (typeof map.mappings === 'string') {
    map.mappings = `;${map.mappings}`;
  }

  await Promise.all([
    writeFile(filePath, `${USE_CLIENT_DIRECTIVE}${source}`),
    writeFile(mapPath, JSON.stringify(map)),
  ]);
};

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022',
  async onSuccess() {
    await Promise.all([
      addUseClientDirective('dist/index.js', 'dist/index.js.map'),
      addUseClientDirective('dist/index.cjs', 'dist/index.cjs.map'),
    ]);
  },
});
