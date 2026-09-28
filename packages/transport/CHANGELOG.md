# @bazariodev/transport

## 0.2.1

### Patch Changes

- Rewrite the package README so it stands on its own: install steps with peer dependencies, a minimal
  example first, behavior as short rules, and option tables. Document behavior that was missing, such
  as effect ordering, hierarchy child re-creation and node paths, persistence options and restore
  order, and inspection entry types. Link related packages to their npm pages. Include `CHANGELOG.md`
  in the published package. In FSM Delays, correct the `Resolvable` doc comment. These documentation
  and packaging changes don't change runtime behavior or types.

## 0.2.0

### Minor Changes

- a27d012: Stop forcing the DOM library into consumers through public declarations. Use the consumer's
  platform types so WebWorker projects compile without conflicting globals. Check both browser and
  Worker consumer interfaces with library checking enabled.

  This is a breaking type change for consumers that relied on the previous implicit DOM library.
  TypeScript consumers must include `DOM` or `WebWorker` in `compilerOptions.lib`, or supply equivalent
  platform declarations. Node projects using FSM Effects or FSM Delays need Node typings that provide `AbortSignal`;
  Node projects using Transport also need declarations for its exposed Web APIs, including WebTransport.
  Consumers already providing these types need no configuration change. Runtime behavior is unchanged.

  FSM Delays advances its FSM Effects peer dependency to the new major version.

## 0.1.0

### Minor Changes

- Add the one-attempt transport contract and WebSocketAdapter, HttpAdapter, and WebTransportAdapter in
  one package, implemented in JavaScript with public TypeScript declarations. Support ordered
  text/binary messages, bounded local write admission, close/disposal, and injected platform APIs.
  HTTP uses a streaming GET and sequential POSTs; WebTransport uses one reliable bidirectional stream.
  Both use documented binary message framing. `send()` returns no value on acceptance and throws on
  immediate rejection; asynchronous failures notify through the transport handlers. Closing before
  start is terminal; close notifications are asynchronous and suppressed by disposal. Constructors
  are the only runtime exports, with native API injection and public TypeScript options.
  Synchronous start failures are terminal and silent, preserving the original error. Lifecycle handlers
  must not throw; their exceptions have adapter-specific effects.
  Preserve WebTransport session close metadata when native session closure also errors its streams.
  Support an optional injected logger for adapter lifecycle and errors, with silent defaults.
