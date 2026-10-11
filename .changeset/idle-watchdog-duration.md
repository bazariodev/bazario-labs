---
'@bazariodev/idle-watchdog': minor
---

Allow `idleMs` to be a function returning a fresh positive integer duration for each arm. Validate
each result before scheduling, preserve cancellation during a draw, and propagate invalid or
throwing draws to the caller without leaving a timer armed. Fixed numeric durations remain supported.
