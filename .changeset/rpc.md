---
'@bazariodev/rpc': minor
---

Send flat `{ id, method, params? }` requests and `{ method, params? }` notifications. Match flat result and error responses through the `RealtimeClient` message and snapshot subscriptions. RPC ignores malformed and unrelated incoming frames. It preserves bounded READY and response waits, cancellation, capacity, and no-replay behavior. A correlated server error can prove a probe round trip without making the application request successful.
