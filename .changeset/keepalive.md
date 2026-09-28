---
'@bazariodev/keepalive': minor
---

Add a connection liveness orchestrator composed over two idle watchdogs. Monitor inactivity and
invoke an injected abortable promise probe with a configured deadline. Consumers own request/response
matching and validation. Expose start, activity, probeNow, onFail, and terminal disposal. Abort pending
work and fail once on timeout, rejection, or synchronous error; explicit stop is silent and recovery
remains with the parent. Ignore late settlement and coalesce repeated probes.
Report missing or invalid probe results as operation errors when invoked.
Require integer idle and deadline durations from 1 through 2,147,483,647 milliseconds. Ship plain
JavaScript ESM/CJS with public TypeScript declarations and an idle-watchdog workspace dependency.
