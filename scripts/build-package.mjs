import { copyFile, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollup } from 'rollup';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = await realpath(resolve(scriptDirectory, '..'));
const packagesDirectory = await realpath(join(repositoryRoot, 'packages'));
const packageDirectory = await realpath(process.cwd());

if (dirname(packageDirectory) !== packagesDirectory) {
  throw new Error('Run this script from a package directory under packages.');
}

const packageJson = JSON.parse(
  await readFile(join(packageDirectory, 'package.json'), 'utf8'),
);
const entries = Object.keys(packageJson.exports ?? {}).map((exportPath) => {
  if (exportPath !== '.' && !exportPath.startsWith('./')) {
    throw new Error(`Unsupported package export: ${exportPath}`);
  }

  const name = exportPath === '.' ? 'index' : exportPath.slice(2);
  return {
    name,
    source: join(packageDirectory, 'src', `${name}.js`),
    declaration: join(packageDirectory, 'src', `${name}.d.ts`),
  };
});

if (entries.length === 0) {
  throw new Error('The package must define at least one export.');
}

for (const entry of entries) {
  await readFile(entry.source);
  await readFile(entry.declaration);
}

const outputDirectory = join(packageDirectory, 'dist');
const clientBanner = process.argv.includes('--client')
  ? "'use client';"
  : undefined;
const isExternal = (id) => !id.startsWith('.') && !isAbsolute(id);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const bundle = await rollup({
  input: Object.fromEntries(entries.map(({ name, source }) => [name, source])),
  external: isExternal,
  treeshake: true,
});

try {
  for (const { format, extension } of [
    { format: 'es', extension: 'js' },
    { format: 'cjs', extension: 'cjs' },
  ]) {
    await bundle.write({
      dir: outputDirectory,
      format,
      entryFileNames: `[name].${extension}`,
      chunkFileNames: `chunk-[hash].${extension}`,
      sourcemap: true,
      exports: 'named',
      banner: clientBanner,
    });
  }

  for (const { name, declaration } of entries) {
    await copyFile(declaration, join(outputDirectory, `${name}.d.ts`));
    await copyFile(declaration, join(outputDirectory, `${name}.d.cts`));
  }
} finally {
  await bundle.close();
}
