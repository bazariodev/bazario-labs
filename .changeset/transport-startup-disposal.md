---
'@bazariodev/transport': patch
---

Prevent a WebSocket from starting after URL resolution or startup logging disposes its adapter. Close sockets returned after constructor re-entry, and suppress stale open or error callbacks when logging disposes the adapter. If a WebSocket error arrives while its `readyState` is `CLOSING` or `CLOSED`, report the diagnostic and then one unclean terminal close when the adapter still owns the socket. Do not wait for a native close event.
