# Native WebTransport close verification

Date: 2026-09-22.

Environment: Google Chrome 152.0.7977.83, headless on macOS, and aioquic 1.3.0 running a local
HTTP/3 server over QUIC. The browser used its native `WebTransport` implementation. A temporary
ECDSA certificate was pinned through `serverCertificateHashes`; certificate verification remained
enabled. Browser automation and server dependencies were isolated outside the repository.

## Procedure

Each scenario ran first with raw WebTransport and then with `WebTransportAdapter` imported from the
package's JavaScript source. The client opened one bidirectional stream, sent framed text `hello`,
and received its echo. The server then performed one of these operations:

1. Sent a session-close capsule with code `42` and reason `server shutdown`, followed by FIN on
   the CONNECT stream, without closing the underlying QUIC connection from the server.
2. Reset the bidirectional stream with application error `0`, then sent the same session-close
   capsule 100 ms later.
3. Closed the underlying QUIC connection with an HTTP/3 connection error.

The raw client observed read errors, writer closure, and `session.closed`. The adapter client observed
its public callbacks and the native session's `closed` promise. No adapter internals or simulated
streams were used.

## Reproduced issue

For a normal server session close, Chrome delivered these native results in order:

```text
read error:   WebTransportError, source = "session", "The session is closed."
writer error: WebTransportError, source = "session", "The session is closed."
closed:      { closeCode: 42, reason: "server shutdown" }
```

Before the fix, the adapter reported the stream error and then `onClose({ clean: false })`, losing
the server's code and reason even though the native session provided them.

## Fix and native rerun

Read/write errors with `source: 'session'` leave the result to the already-observed `session.closed`
promise. Stream-specific errors still fail immediately. This adds no timeout, retry, or event buffer.

| Server behavior | Adapter result after the fix |
| --- | --- |
| Normal session close | `onClose({ code: 42, reason: 'server shutdown', clean: true })`; no `onError` |
| Stream reset before session close | One `onError` with `source: 'stream'`, followed by `onClose({ clean: false })` |
| QUIC connection failure | One `onError` with `source: 'session'`, followed by `onClose({ clean: false })` |

All three scenarios delivered the echoed `hello` before termination. A genuine stream reset still
retires the attempt immediately, so its later session metadata is intentionally not collected.

Coverage is limited to the browser/server versions above. The session error distinction follows the
[WebTransport cleanup procedure](https://www.w3.org/TR/webtransport/); the server
used the [HTTP/3 session-close capsule](https://ietf-wg-webtrans.github.io/draft-ietf-webtrans-http3/draft-ietf-webtrans-http3.html).
