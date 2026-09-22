# Bazario Labs Roadmap

- Status: Draft for review
- Date: 2026-07-04

## Vision

Build a catalog of small, composable TypeScript SDK modules — "lego bricks" — covering everything a telecom / UCaaS web application needs: state, connectivity, calling, messaging, presence. A working UCaaS client should be assemblable from published `@bazariodev/*` packages plus thin app glue, instead of hand-written orchestration.

The roadmap ends at a concrete stop line: **a reference UCaaS web app with basic softphone, chat, and presence functionality, built exclusively from published packages.** Everything past that line is backlog.

## Where we are today

Shipped (all `0.1.0`, tested, per ADR):

- `@bazariodev/fsm` — flat, synchronous, typed FSM core (`ADR/Base/CoreFSM.md`, Accepted)
- `@bazariodev/fsm-effects` — state-entry effects with `AbortSignal` cancellation (`ADR/Modules/Effects.md`)
- `@bazariodev/fsm-delays` — declarative `after`/`every` timers on top of effects (`ADR/Modules/Delays.md`)
- `@bazariodev/fsm-hierarchy` — tree of flat machines, deepest-first routing, composed snapshot (`ADR/Modules/Hierarchy.md`, Accepted)

Review notes:

- The layering thesis is proven: core → effects → delays each composed over the previous package's public seams without core changes. Domain modules below follow the same rule (ports and adapters, composition over subclassing).
- Deferred items already named by ADRs and picked up by this roadmap: retry/backoff policy DSL (Delays ADR), spawn-child primitive → hierarchy (Effects ADR), persistence module (Effects and Hierarchy ADRs), parallel regions and history (Hierarchy ADR).
- Nothing yet covers the UCaaS domain itself (signaling, media, chat, presence) or framework bindings — that is what this roadmap adds.

## Module map

Status legend: `shipped` / `implemented, release pending` / `adr` (written, not implemented) / `planned` / `backlog`. Package names are provisional.

### Layer 0 — State platform

| Package | Purpose | Status | Release |
| --- | --- | --- | --- |
| `fsm` | flat typed FSM core | shipped | R1 freeze |
| `fsm-effects` | state-entry effects, cancellation, guarded send | shipped | R1 freeze |
| `fsm-delays` | declarative `after`/`every` timers | shipped | R1 freeze |
| `fsm-hierarchy` | nested machines, event bubbling, composed snapshot | shipped | R1 |
| `fsm-react` | React bindings (`useFsm`, selector subscriptions via `useSyncExternalStore`) | shipped | R1 |
| `fsm-persist` | snapshot serialize + rehydrate-by-construction (page refresh survival) | shipped | R1 stretch |
| `fsm-inspect` | dev-time transition trace, timeline log, Mermaid diagram export | adr | R1 stretch |
| `fsm-retry` | declarative retry/backoff policy (max attempts, jitter, give-up event) | planned | R2 |

### Layer 1 — Connectivity and session

Responsibility and dependency guide: [`docs/realtime-client-hierarchy.html`](../docs/realtime-client-hierarchy.html).

| Package | Purpose | Status | Release |
| --- | --- | --- | --- |
| `transport` | shared one-attempt contract with WebSocket, streaming HTTP (GET + POST), and reliable-stream WebTransport adapters | implemented, release pending | R2 |
| `idle-watchdog` | re-armable one-shot inactivity timer; consumers own reset and idle-event policy | adr | R2 |
| `keepalive` | protocol-configurable ping/pong state driven by idle or immediate probes; owns one response deadline, never the transport | adr | R2 |
| `realtime` | logical `RealtimeClient` over `transport`: JSON handshake, readiness, idle keepalive composition, and reconnect backoff across attempts | adr | R2 |
| `rpc` | request/response correlation, timeouts, and typed methods over `RealtimeClient` messages | planned | R2 |
| `auth-session` | token lifecycle machine (login, refresh, expiry, logout) with storage port | planned | R2 |
| `net-monitor` | online/offline, tab visibility, sleep/wake detection | planned | R2 |
| `scheduler-worker` | Worker-backed `Scheduler` for `fsm-delays` that survives background-tab timer throttling | backlog | post-MVP improvement |

### Layer 2 — Calling

| Package | Purpose | Status | Release |
| --- | --- | --- | --- |
| `media-devices` | permissions, device enumeration/selection, persistence, hot-plug | planned | R3 |
| `rtc-session` | `RTCPeerConnection` lifecycle FSM: offer/answer, ICE + restart, tracks, stats | planned | R3 |
| `call-signaling` | unified signaling interface (the port): invite/answer/hangup/hold/DTMF commands and events, designed around call semantics, not any library's API | planned | R3 |
| `signaling-<lib>` | per-library adapters implementing the port (`signaling-sipjs`, `signaling-jssip`, …) — adopting a new SIP stack means writing an adapter, telephony modules stay untouched | planned | R3 (first), rest on demand |
| `call` | single-call machine composing signaling + media: dialing/ringing/connected(hold, mute)/ended, DTMF | planned | R3 |
| `audio-kit` | ringtone/ringback/DTMF tones via WebAudio, output routing | planned | R3 |
| `call-manager` | multi-call orchestration: N concurrent calls, one active, switch/hold rules | planned | R4 |
| `call-history` | local call log with storage port | planned | R4 |

### Layer 3 — Collaboration

| Package | Purpose | Status | Release |
| --- | --- | --- | --- |
| `presence` | own status publishing + roster subscriptions, protocol port | planned | R4 |
| `chat` | conversations, message delivery FSM (sending→sent→delivered→read), optimistic outbox with retry, pagination/sync ports | planned | R4 |
| `contacts` | directory cache + search port | planned | R4 |
| `notify` | browser Notifications + in-app notification center + sound/badge policy | planned | R4 |
| `settings` | typed preferences store with storage port | planned | R4 |
| `voicemail` | message list + MWI | backlog | — |

### Layer 4 — Assembly (repo apps, not published packages)

| Item | Purpose | Release |
| --- | --- | --- |
| `examples/server` | tiny Node backend for demos: auth, presence, and chat fan-out over `realtime` + `rpc` | grows R2→R5 |
| `docker/pbx` | compose file with a SIP server (Asterisk/FreeSWITCH) for real calls in dev | R3 |
| `examples/softphone` | the reference UCaaS MVP app (React) — the stop line | R5 |

## Releases

Packages version independently via Changesets, so a "release" here is a milestone, not a lockstep version bump. `1.0.0` means API freeze for that package. The FSM family freezes in R1; domain packages stay `0.x` until the reference app proves them in R5, then get promoted — that promotion is "Bazario Platform 1.0".

### R1 — State Platform 1.0

- Goal: finish and freeze the FSM family.
- Build: `fsm-react`; stretch: `fsm-persist`, `fsm-inspect`.
- Chores: flip Effects/Delays ADR statuses, docs pass, promote the FSM family to `1.0.0`. Shared structural types (`FsmSubscribable`, hierarchy config/snapshot shapes, diagram config shapes) are promoted into `@bazariodev/fsm`; keep dependent package exports as compatibility aliases.
- Exit criteria: a nested call-flow example (`connected.active` / `connected.onHold` / `connected.muted`) running in React, built only from published packages.

### R2 — Connectivity

- Goal: a session that survives the real internet.
- Build: `transport` (shared contract and WebSocket, HTTP, WebTransport adapters), `idle-watchdog`, `keepalive`, `realtime`, `rpc`, `auth-session`, `net-monitor`; extract `fsm-retry` from the realtime client's backoff implementation (the "real call site" the Delays ADR was waiting for). Start `examples/server`.
- Decision gate: keep `transport` limited to one physical attempt and keep logical lifecycle policy in `realtime`. HTTP and WebTransport share the package and a documented binary framing contract; validate deployment servers against it.
- Exit criteria: demo signs in, stays connected through network flaps and laptop sleep, re-authenticates silently, shows connection state.

### R3 — First call

- Goal: a real audio call in the browser.
- Build: `media-devices`, `rtc-session`, `call-signaling` port, first `signaling-<lib>` adapter, `call`, `audio-kit`, `docker/pbx`.
- Decision gate: which SIP library backs the first adapter (sip.js and JsSIP are the candidates) — the interface-plus-adapters shape itself is decided.
- Exit criteria: register to the dev PBX; place and receive a call; mute/hold/DTMF/hangup; ringback and device switching work; registration stays fresh and recovers after network changes.

### R4 — Multi-call and collaboration

- Goal: the rest of the UCaaS feature core.
- Build: `call-manager`, `call-history`, `presence`, `chat`, `contacts`, `notify`, `settings`.
- Exit criteria: two-browser demo — users see each other's presence, chat 1:1 with delivery states, run two concurrent calls with switching, get notified while the app is in the background.

### R5 — UCaaS MVP (the stop line)

- Goal: prove the lego thesis.
- Build: `examples/softphone` assembled exclusively from `@bazariodev/*` packages; fix every gap it exposes; write a "build a softphone" guide.
- Exit criteria: the MVP checklist below is fully green; proven domain packages promoted to `1.0.0`.

## UCaaS MVP definition (stop-line checklist)

Must have:

- [ ] sign in; session survives page refresh; silent re-auth
- [ ] auto-reconnect with visible connection state
- [ ] register for calls and keep registration fresh (background-tab hardening is a post-MVP improvement)
- [ ] outbound call via dialpad; inbound call with ring, accept/decline
- [ ] in-call: mute, hold, DTMF, hang up, call duration
- [ ] audio device selection, including mid-call switching
- [ ] call history
- [ ] set own presence status; see others' presence
- [ ] 1:1 text chat with delivery states
- [ ] browser notifications for incoming calls and messages

Should have (cut if risky): blind transfer, MWI badge.

Explicitly not in the MVP: conference, attended transfer, video, screen share, SMS, voicemail playback, call queues, analytics, CRM integrations.

## Decision points

1. **SIP stack — decided: unified interface + adapters.** We own the `call-signaling` interface; every SIP library (sip.js, JsSIP, any future one) plugs in through a thin adapter package, so adopting a new stack means writing an adapter, never touching telephony modules. The interface must be designed around call semantics (intents and events), not mirror any library's API shape, or the abstraction leaks. Still open at R3 start: which library backs the first adapter.
2. **Demo backend.** Tiny Node server in-repo + docker PBX keeps demos self-contained; an adapter against an existing platform could replace both. Decide by R2.
3. **Background throttling — deferred to post-MVP.** v1 relies on standard timers; `net-monitor`'s visibility/wake signals trigger an immediate refresh when a tab returns to the foreground, which is good enough for the MVP. `scheduler-worker` ships later as a drop-in `Scheduler` implementation — the injectable seam in `fsm-delays` means no API changes when it lands.
4. **Framework bindings.** React first; Vue/Svelte only on demand.
5. **UI kit.** Headless SDKs are the product. A component kit is post-stop-line backlog; the reference app uses plain React.

## Backlog (after the stop line)

Conference/merge, attended transfer, video, screen share, SMS/MMS ports, voicemail playback, call queues and supervisor views, CRM screen-pop hooks, E911 hooks, FSM parallel regions and history, cron/wall-clock scheduling, timer pause/resume, `scheduler-worker` (background-tab timer hardening), `fsm-testing` helpers, UI component kit, Vue bindings, additional `signaling-*` adapters, own SIP stack behind the same interface (only if the libraries prove limiting).

## Working agreements

- Every new module gets an ADR under `.agent/ADR/Modules/` before scaffolding; statuses are maintained (Proposed → Accepted when shipped).
- Domain modules are backend-agnostic via ports; concrete protocol/vendor adapters are separate packages, except related transport adapters share the `transport` package.
- Packages version independently; release trains are milestones; `1.0.0` = API freeze per package.
- Each release train ends with a runnable demo under `examples/` — the demo is the acceptance test for that train.
