---
'@bazariodev/keepalive': minor
---

Keep the probe-only Keepalive contract and allow `idleMs` to be a duration function for bounded jitter. The function is called for each idle window. A probe deadline remains fixed, and activity cannot extend an active probe. Keepalive stops on failure or `stop()`, aborts active work, and ignores late promise results.
