import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const defaultPackages = [
  '@bazariodev/coordination',
  '@bazariodev/fsm',
  '@bazariodev/keepalive',
  '@bazariodev/fsm-delays',
  '@bazariodev/fsm-effects',
  '@bazariodev/transport',
];
const defaultPackageDirectories = [
  'coordination',
  'fsm',
  'keepalive',
  'idle-watchdog',
];

it('packs an isolated core for ESM, CJS, and strict TypeScript consumers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'realtime-core-consumer-'));
  const packDirectory = join(directory, 'pack');
  const projectDirectory = join(directory, 'project');
  const packageDirectory = join(
    projectDirectory,
    'node_modules',
    '@bazariodev',
    'realtime',
  );
  await mkdir(packDirectory, { recursive: true });
  await mkdir(projectDirectory, { recursive: true });

  try {
    const pack = spawnSync(
      'pnpm',
      ['pack', '--pack-destination', packDirectory, '--silent'],
      { cwd: packageRoot, encoding: 'utf8' },
    );
    expect(pack.status, pack.stderr).toBe(0);
    const filename = pack.stdout.trim().split('\n').at(-1);
    execFileSync('tar', ['-xzf', resolve(filename), '-C', projectDirectory]);
    await mkdir(join(projectDirectory, 'node_modules', '@bazariodev'), {
      recursive: true,
    });
    await rm(packageDirectory, { recursive: true, force: true });
    await cp(join(projectDirectory, 'package'), packageDirectory, {
      recursive: true,
    });
    await rm(join(projectDirectory, 'package'), {
      recursive: true,
      force: true,
    });
    await writeFile(
      join(projectDirectory, 'package.json'),
      JSON.stringify({ type: 'module' }),
    );

    const dependencyProbe = spawnSync(
      process.execPath,
      [
        '--no-global-search-paths',
        '-e',
        `for (const name of ${JSON.stringify(defaultPackages)}) { try { require.resolve(name); process.exitCode = 1; } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; } }`,
      ],
      {
        cwd: projectDirectory,
        env: { ...process.env, NODE_PATH: '' },
        encoding: 'utf8',
      },
    );
    expect(dependencyProbe.status, dependencyProbe.stderr).toBe(0);

    await writeFile(join(projectDirectory, 'consumer.mjs'), esmConsumer);
    await writeFile(join(projectDirectory, 'consumer.cjs'), cjsConsumer);
    for (const filename of ['consumer.mjs', 'consumer.cjs']) {
      const result = spawnSync(
        process.execPath,
        ['--no-global-search-paths', join(projectDirectory, filename)],
        {
          cwd: projectDirectory,
          env: { ...process.env, NODE_PATH: '' },
          encoding: 'utf8',
        },
      );
      expect(result.status, result.stderr).toBe(0);
    }

    await writeFile(join(projectDirectory, 'consumer.mts'), esmTypes);
    await writeFile(join(projectDirectory, 'consumer.cts'), cjsTypes);
    await writeFile(
      join(projectDirectory, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          skipLibCheck: false,
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          types: [],
        },
        include: ['consumer.mts', 'consumer.cts'],
      }),
    );
    const require = createRequire(import.meta.url);
    const tsc = require.resolve('typescript/bin/tsc');
    const typecheck = spawnSync(
      process.execPath,
      [tsc, '--project', join(projectDirectory, 'tsconfig.json')],
      { cwd: projectDirectory, encoding: 'utf8' },
    );
    expect(typecheck.status, typecheck.stdout + typecheck.stderr).toBe(0);

    for (const name of defaultPackageDirectories) {
      const source = resolve(packageRoot, '..', name);
      const destination = join(
        projectDirectory,
        'node_modules',
        '@bazariodev',
        name,
      );
      await mkdir(destination, { recursive: true });
      await cp(join(source, 'dist'), join(destination, 'dist'), {
        recursive: true,
      });
      await cp(join(source, 'package.json'), join(destination, 'package.json'));
    }

    await writeFile(
      join(projectDirectory, 'identity.mjs'),
      esmIdentityConsumer,
    );
    await writeFile(
      join(projectDirectory, 'identity.cjs'),
      cjsIdentityConsumer,
    );
    for (const filename of ['identity.mjs', 'identity.cjs']) {
      const result = spawnSync(
        process.execPath,
        ['--no-global-search-paths', join(projectDirectory, filename)],
        {
          cwd: projectDirectory,
          env: { ...process.env, NODE_PATH: '' },
          encoding: 'utf8',
        },
      );
      expect(result.status, result.stderr).toBe(0);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const esmConsumer = `
import assert from 'node:assert/strict';
import { createRetry, JsonTransport, RealtimeClient } from '@bazariodev/realtime/core';
const listeners = new Set();
let state = 'idle';
let snapshot = { value: state, previousValue: null, context: { attempt: 0 }, version: 0 };
const fsm = {
  get state() { return state; },
  get snapshot() { return snapshot; },
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  send({ type }) {
    const next = { CONNECT: 'connecting', READY: 'ready', DISCONNECT: 'idle', STOP: 'stopped' }[type];
    if (!next) return;
    const previousValue = state;
    state = next;
    snapshot = { value: state, previousValue, context: { attempt: 0 }, version: snapshot.version + 1 };
    for (const listener of [...listeners]) listener(snapshot);
  },
};
const events = { on() { return () => {}; }, emit() {}, stop() {} };
let handlers;
const raw = {
  start(value) { handlers = value; },
  send(value) { assert.equal(value, '{"value":"text"}'); },
  [Symbol.dispose]() {},
};
const transport = new JsonTransport(raw);
const client = new RealtimeClient({ fsm, events, createTransport: () => transport, retry: null, createKeepalive: null });
client.connect();
handlers.onOpen();
assert.equal(client.state, 'ready');
assert.equal(client.send({ value: 'text' }), true);
client.stop();
assert.equal(client.state, 'stopped');
const cancel = createRetry({ initialDelayMs: 1, maxDelayMs: 1, random: () => 0 }).schedule(1, () => {});
cancel();
`;

const esmIdentityConsumer = `
import assert from 'node:assert/strict';
import * as Root from '@bazariodev/realtime';
import * as Core from '@bazariodev/realtime/core';
assert.equal(Root.RealtimeClient, Core.RealtimeClient);
assert.equal(Root.JsonTransport, Core.JsonTransport);
const client = Root.createRealtimeClient({ createTransport: () => ({ start() {}, send() {}, [Symbol.dispose]() {} }) });
assert.ok(client instanceof Core.RealtimeClient);
client.stop();
`;

const cjsIdentityConsumer = `
const assert = require('node:assert/strict');
const Root = require('@bazariodev/realtime');
const Core = require('@bazariodev/realtime/core');
assert.equal(Root.RealtimeClient, Core.RealtimeClient);
assert.equal(Root.JsonTransport, Core.JsonTransport);
const client = Root.createRealtimeClient({ createTransport: () => ({ start() {}, send() {}, [Symbol.dispose]() {} }) });
assert.ok(client instanceof Core.RealtimeClient);
client.stop();
`;

const cjsConsumer = `
const assert = require('node:assert/strict');
const { createRetry, JsonTransport, RealtimeClient } = require('@bazariodev/realtime/core');
const listeners = new Set();
let state = 'idle';
let snapshot = { value: state, previousValue: null, context: { attempt: 0 }, version: 0 };
const fsm = {
  get state() { return state; },
  get snapshot() { return snapshot; },
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  send({ type }) {
    const next = { CONNECT: 'connecting', READY: 'ready', DISCONNECT: 'idle', STOP: 'stopped' }[type];
    if (!next) return;
    const previousValue = state;
    state = next;
    snapshot = { value: state, previousValue, context: { attempt: 0 }, version: snapshot.version + 1 };
    for (const listener of [...listeners]) listener(snapshot);
  },
};
const events = { on() { return () => {}; }, emit() {}, stop() {} };
let handlers;
const raw = { start(value) { handlers = value; }, send(value) { assert.equal(value, '{"value":"text"}'); }, [Symbol.dispose]() {} };
const transport = new JsonTransport(raw);
const client = new RealtimeClient({ fsm, events, createTransport: () => transport, retry: null, createKeepalive: null });
client.connect();
handlers.onOpen();
assert.equal(client.state, 'ready');
client.send({ value: 'text' });
client.stop();
assert.equal(client.state, 'stopped');
const cancel = createRetry({ initialDelayMs: 1, maxDelayMs: 1, random: () => 0 }).schedule(1, () => {});
cancel();
`;

const esmTypes = `
import { createRetry, JsonTransport, RealtimeClient, type RealtimeClientDeps, type RealtimeLifecycle, type RealtimeEventPublisher, type RealtimeEventMap, type RealtimeTransport } from '@bazariodev/realtime/core';
declare const lifecycle: RealtimeLifecycle;
declare const events: RealtimeEventPublisher<RealtimeEventMap<number>>;
declare const transport: RealtimeTransport<number>;
const deps: RealtimeClientDeps<number> = { fsm: lifecycle, events, createTransport: () => transport, retry: null, createKeepalive: null };
const client = new RealtimeClient(deps);
client.send(1);
// @ts-expect-error Core payloads keep their injected type.
client.send('wrong');
declare const raw: RealtimeTransport<string | Uint8Array>;
const jsonTransport = new JsonTransport(raw);
const jsonEvents: RealtimeEventPublisher<RealtimeEventMap> = {
  on() { return () => {}; }, emit() {}, stop() {},
};
const jsonDeps: RealtimeClientDeps = { fsm: lifecycle, events: jsonEvents, createTransport: () => jsonTransport, retry: null, createKeepalive: null };
new RealtimeClient(jsonDeps);
const cancel = createRetry().schedule(1, () => {});
cancel();
`;

const cjsTypes = `
import Core = require('@bazariodev/realtime/core');
declare const deps: Core.RealtimeClientDeps<number>;
const client = new Core.RealtimeClient(deps);
client.send(1);
// @ts-expect-error Core payloads keep their injected type.
client.send('wrong');
declare const raw: Core.RealtimeTransport<string | Uint8Array>;
const jsonTransport = new Core.JsonTransport(raw);
const jsonEvents: Core.RealtimeEventPublisher<Core.RealtimeEventMap> = {
  on() { return () => {}; }, emit() {}, stop() {},
};
const jsonDeps: Core.RealtimeClientDeps = { fsm: deps.fsm, events: jsonEvents, createTransport: () => jsonTransport, retry: null, createKeepalive: null };
new Core.RealtimeClient(jsonDeps);
const cancel = Core.createRetry().schedule(1, () => {});
cancel();
`;
