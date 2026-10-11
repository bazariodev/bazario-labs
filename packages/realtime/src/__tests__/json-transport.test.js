import { expect, it, vi } from 'vitest';
import { JsonTransport } from '../json-transport.js';
import { StubTransport } from './direct-client-helpers.js';

it('encodes and decodes flat JSON frames without changing their payloads', () => {
  const raw = new StubTransport();
  const transport = new JsonTransport(raw);
  const received = [];
  transport.start({ onMessage: (message) => received.push(message) });
  const request = { id: 'r1', method: 'chat.send', params: { text: 'hello' } };

  transport.send(request);
  raw.receive(JSON.stringify({ id: 'r1', result: { accepted: true } }));

  expect(raw.sent).toEqual([JSON.stringify(request)]);
  expect(received).toEqual([{ id: 'r1', result: { accepted: true } }]);
  transport[Symbol.dispose]();
});

it.each([
  null,
  true,
  7,
  'text',
  [1, null],
  { newField: { value: 1 } },
])('passes the valid JSON value %j through unchanged', (value) => {
  const raw = new StubTransport();
  const transport = new JsonTransport(raw);
  const messages = [];
  transport.start({ onMessage: (message) => messages.push(message) });

  raw.receive(JSON.stringify(value));

  expect(messages).toEqual([value]);
  transport[Symbol.dispose]();
});

it('logs and skips malformed or non-text frames', () => {
  const raw = new StubTransport();
  const warn = vi.fn();
  const transport = new JsonTransport(raw, { warn });
  const messages = [];
  transport.start({ onMessage: (message) => messages.push(message) });

  raw.receive('{');
  raw.receive(new Uint8Array([123]));

  expect(messages).toEqual([]);
  expect(warn).toHaveBeenCalledTimes(2);
  transport[Symbol.dispose]();
});

it('skips frames above the default incoming byte limit', () => {
  const raw = new StubTransport();
  const warn = vi.fn();
  const transport = new JsonTransport(raw, { warn });
  const messages = [];
  transport.start({ onMessage: (message) => messages.push(message) });
  raw.receive(JSON.stringify('x'.repeat(1_048_576)));
  raw.receive('{"ok":true}');

  expect(messages).toEqual([{ ok: true }]);
  expect(warn).toHaveBeenCalledTimes(1);
  transport[Symbol.dispose]();
});

it('accepts an ASCII frame at the configured byte boundary', () => {
  const raw = new StubTransport();
  const warn = vi.fn();
  const frame = JSON.stringify('x'.repeat(6));
  const transport = new JsonTransport(raw, {
    maxIncomingBytes: frame.length,
    warn,
  });
  const messages = [];
  transport.start({ onMessage: (message) => messages.push(message) });

  raw.receive(frame);

  expect(messages).toEqual(['xxxxxx']);
  expect(warn).not.toHaveBeenCalled();
  transport[Symbol.dispose]();
});

it('accepts a multibyte UTF-8 frame at the configured byte boundary', () => {
  const frame = JSON.stringify('😀');
  const byteLength = new TextEncoder().encode(frame).byteLength;
  const raw = new StubTransport();
  const warn = vi.fn();
  const transport = new JsonTransport(raw, {
    maxIncomingBytes: byteLength,
    warn,
  });
  const messages = [];
  transport.start({ onMessage: (message) => messages.push(message) });

  raw.receive(frame);

  expect(messages).toEqual(['😀']);
  expect(warn).not.toHaveBeenCalled();
  transport[Symbol.dispose]();
});

it('skips a multibyte UTF-8 frame when it exceeds the byte limit by one', () => {
  const frame = JSON.stringify('😀');
  const byteLength = new TextEncoder().encode(frame).byteLength;
  const raw = new StubTransport();
  const warn = vi.fn();
  const transport = new JsonTransport(raw, {
    maxIncomingBytes: byteLength - 1,
    warn,
  });
  const messages = [];
  transport.start({ onMessage: (message) => messages.push(message) });

  raw.receive(frame);
  raw.receive('0');

  expect(messages).toEqual([0]);
  expect(warn).toHaveBeenCalledOnce();
  transport[Symbol.dispose]();
});

it('accepts an explicit incoming byte limit above the default', () => {
  const raw = new StubTransport();
  const warn = vi.fn();
  const frame = JSON.stringify('x'.repeat(1_048_576));
  const transport = new JsonTransport(raw, {
    maxIncomingBytes: new TextEncoder().encode(frame).byteLength,
    warn,
  });
  const messages = [];
  transport.start({ onMessage: (message) => messages.push(message) });

  raw.receive(frame);

  expect(messages).toEqual(['x'.repeat(1_048_576)]);
  expect(warn).not.toHaveBeenCalled();
  transport[Symbol.dispose]();
});

it.each([
  null,
  0,
  -1,
  1.5,
  '2',
  Number.MAX_SAFE_INTEGER + 1,
  Number.NaN,
  Infinity,
])('rejects invalid incoming byte limit %s', (maxIncomingBytes) => {
  expect(
    () => new JsonTransport(new StubTransport(), { maxIncomingBytes }),
  ).toThrow(TypeError);
});

it('rejects values that JSON cannot serialize and permits a later valid write', () => {
  const raw = new StubTransport();
  const transport = new JsonTransport(raw);
  transport.start({ onMessage() {} });

  expect(() => transport.send(undefined)).toThrow(TypeError);
  expect(() => transport.send(() => {})).toThrow(TypeError);
  expect(raw.sent).toEqual([]);
  transport.send({ ok: true });
  expect(raw.sent).toEqual(['{"ok":true}']);
  transport[Symbol.dispose]();
});

it('does not serialize a message from a cleanup callback', () => {
  const raw = new StubTransport();
  const transport = new JsonTransport(raw);
  transport.start({ onMessage() {} });
  let cleanupError;
  raw.onDispose = () => {
    try {
      transport.send('late');
    } catch (cause) {
      cleanupError = cause;
    }
  };

  transport[Symbol.dispose]();

  expect(cleanupError).toBeInstanceOf(Error);
  expect(raw.sent).toEqual([]);
});

it('does not report application callback errors as parse errors', () => {
  const raw = new StubTransport();
  const warn = vi.fn();
  const transport = new JsonTransport(raw, { warn });
  const cause = new Error('application failed');
  transport.start({
    onMessage() {
      throw cause;
    },
  });

  expect(() => raw.receive('{"valid":true}')).toThrow(cause);
  expect(warn).not.toHaveBeenCalled();
  transport[Symbol.dispose]();
});

it('does not write if serialization reenters disposal', () => {
  const raw = new StubTransport();
  const transport = new JsonTransport(raw);
  transport.start({ onMessage() {} });
  const value = {
    toJSON() {
      transport[Symbol.dispose]();
      return { stale: true };
    },
  };

  expect(() => transport.send(value)).toThrow(/disposed/i);
  expect(raw.sent).toEqual([]);
  expect(raw.disposed).toBe(true);
});

it('sets disposed before delegating cleanup and suppresses late callbacks', () => {
  const raw = new StubTransport();
  const transport = new JsonTransport(raw);
  const onMessage = vi.fn();
  transport.start({ onMessage });
  const handlers = raw.handlers;
  transport[Symbol.dispose]();
  handlers.onMessage('{"late":true}');

  expect(onMessage).not.toHaveBeenCalled();
  expect(raw.disposed).toBe(true);
});
