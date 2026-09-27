---
'@bazariodev/idle-watchdog': minor
---

Add a dependency-free one-shot inactivity watchdog with explicit `arm()`, restartable cancellation,
idle subscriptions, and terminal disposal. Injected scheduling, stale-callback protection, and
listener-error isolation support deterministic use in realtime and other activity-driven lifecycles.
Ship plain JavaScript ESM/CJS with public TypeScript declarations.
Require integer durations from 1 through 2,147,483,647 milliseconds and reject invalid values with
RangeError. Unsubscribe functions cannot remove later registrations of the same listener.
