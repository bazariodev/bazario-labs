---
'@bazariodev/coordination': minor
---

Add `createJitter`, a timer-free function factory for bounded integer durations with injected
randomness. Bounds are inclusive positive integers from 1 through 2_147_483_647. Invalid bounds,
including zero, fail at construction; each draw validates its random result. Equal bounds skip
randomness. The returned function can be injected into idle-duration consumers.
