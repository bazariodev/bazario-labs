---
'@bazariodev/realtime': minor
---

Provide one injected `RealtimeClient` with a small default factory. The client owns connection intent, readiness, attempt replacement, and recovery. It passes opaque messages and defines no handshake, packet envelope, ping/pong protocol, or tracing IDs. `JsonTransport` is an opt-in text codec. Keepalive runs only when the application supplies a probe or monitor. The `/core` entry has no imports from the default implementation packages; the root factory uses the selected defaults.

Release attempt message subscriptions even if monitor construction fails. Limit incoming JSON text to 1,048,576 UTF-8 bytes by default, with a configurable `maxIncomingBytes`. Share client and JSON transport classes between root and core exports in ESM and CommonJS.

Keep transport diagnostics separate from terminal attempt close. A transport `onError` reports a diagnostic and leaves the current attempt active; `onClose`, failed start, timeout, or monitor failure ends the attempt and allows recovery. The client reports terminal close details through its public `onError` event.

The default retry driver uses coordination's `createBackoffScheduler`. The top-level `random`
option supplies its fallback source. `reconnect.jitter` accepts `false` or ratio settings; an explicit
nested random function takes precedence, and disabled jitter makes no random draw.
