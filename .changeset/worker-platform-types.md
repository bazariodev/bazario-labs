---
'@bazariodev/transport': minor
'@bazariodev/fsm-effects': major
'@bazariodev/fsm-delays': major
---

Stop forcing the DOM library into consumers through public declarations. Use the consumer's
platform types so WebWorker projects compile without conflicting globals. Check both browser and
Worker consumer interfaces with library checking enabled.

This is a breaking type change for consumers that relied on the previous implicit DOM library.
TypeScript consumers must include `DOM` or `WebWorker` in `compilerOptions.lib`, or supply equivalent
platform declarations. Node projects using FSM Effects or FSM Delays need Node typings that provide `AbortSignal`;
Node projects using Transport also need declarations for its exposed Web APIs, including WebTransport.
Consumers already providing these types need no configuration change. Runtime behavior is unchanged.

FSM Delays advances its FSM Effects peer dependency to the new major version.
