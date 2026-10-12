---
'@bazariodev/coordination': minor
---

Add `defaultScheduler` and `createBackoffScheduler` for stateless timer access and independently
cancellable backoff callbacks with configurable ratio jitter. The caller counts attempts and
decides whether to retry.
