# @bazariodev/transport

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
