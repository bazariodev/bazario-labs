# Bazario Labs Roadmap

- Status: Draft for review
- Date: 2026-07-04
- Revised: 2026-10-11

## Vision

Build a catalog of small, composable TypeScript SDK modules — "lego bricks" — covering everything a telecom / UCaaS web application needs: state, connectivity, calling, messaging, presence. A working UCaaS client should be assemblable from published `@bazariodev/*` packages plus thin app glue, instead of hand-written orchestration.

The roadmap ends at a concrete stop line: **a reference UCaaS web app with basic softphone, chat, and presence functionality, built exclusively from published packages.** Everything past that line is backlog.

## Where we are today

Shipped (current versions and release notes live in each package's `package.json` and `CHANGELOG.md`):

- `@bazariodev/fsm` — flat, synchronous, typed FSM core (`ADR/Base/CoreFSM.md`, Accepted)
- `@bazariodev/fsm-effects` — state-entry effects with `AbortSignal` cancellation (`ADR/Modules/Effects.md`)
- `@bazariodev/fsm-delays` — declarative `after`/`every` timers on top of effects (`ADR/Modules/Delays.md`)
- `@bazariodev/fsm-hierarchy` — tree of flat machines, deepest-first routing, composed snapshot (`ADR/Modules/Hierarchy.md`, Accepted)
- `@bazariodev/fsm-react` — React snapshot, selector, and component-lifecycle hooks (`ADR/Modules/React.md`)
- `@bazariodev/fsm-persist` — snapshot storage and restoration by construction (`ADR/Modules/Persist.md`)
- `@bazariodev/fsm-inspect` — transition timelines, source recording, and Mermaid diagrams (`ADR/Modules/Inspect.md`)
- `@bazariodev/transport` — one-attempt WebSocket, HTTP, and WebTransport adapters (`ADR/Modules/Transport.md`)
- `@bazariodev/idle-watchdog` — one-shot inactivity timer with explicit arming (`ADR/Modules/IdleWatchdog.md`)
- `@bazariodev/keepalive` — published `0.1.1` has the probe-only API. The current implementation
  preserves that contract and adds duration functions for idle jitter. The next release is minor
  (`ADR/Modules/RealtimeComposition.md`).
- `@bazariodev/coordination` — FIFO storage, serial executors, typed event subscriptions, jitter, and caller-owned backoff scheduling; `1.0.0` verified on npm on 2026-10-10 (`ADR/Modules/Coordination.md`). The additive exports await `1.1.0`.

Review notes:

- The layering thesis is proven: core → effects → delays each composed over the previous package's public seams without core changes. Domain modules below follow the same rule (ports and adapters, composition over subclassing).
- Remaining deferred items named by ADRs: retry/backoff policy DSL (Delays ADR), parallel regions and history (Hierarchy ADR). Hierarchy composition and persistence are shipped.
- React bindings, connectivity primitives, and coordination `1.0.0` are shipped. Coordination's
  example is complete; jitter and backoff scheduling await release. RealtimeClient is implemented
  in the workspace and awaits a package release; signaling, media, chat, and presence are planned.

## Next tasks — remaining R2 work

[Coordination](ADR/Modules/Coordination.md) is implemented first within the existing R2 connectivity
milestone. Its initial `1.0.0` release is published. This changes task priority, not the R1–R5
milestone identifiers or shipped history.

1. [x] Scaffold `@bazariodev/coordination` at `0.0.0` and implement `Emitter<Events>` first, with
   RealtimeClient as its first planned package consumer.
2. [x] Implement public `Queue<T>` as reusable FIFO storage with no execution behavior.
3. [x] Implement `SyncExecutor` over a private Queue, with reentrant FIFO draining.
4. [x] Implement `AsyncExecutor` over a private Queue, with serial execution, per-task promises,
   and a fresh AbortSignal for each started task; stop aborts only the active task.
5. [x] Validate public behavior and declarations (including interface/type-alias event maps), create
   the private, versionless `examples/coordination` workspace package with a `workspace:^` dependency and
   `test: node index.js`, update the lockfile, and prove the example runs directly and through
   `pnpm health`. Document handled stop in the package README and prepare the first release notes.
6. [x] Prepare `1.0.0` as the first public release; confirm the
   ESM/CommonJS package contents with a dry-run pack.
7. [x] Publish `@bazariodev/coordination@1.0.0`; exact version verified in the npm registry on 2026-10-10.
8. [x] Implement `realtime` using one injected client and opaque messages.
9. [ ] Review and release `realtime@0.1.0`, `rpc@0.1.0`, `keepalive@0.2.0`,
   `coordination@1.1.0`, and `idle-watchdog@0.2.0`. Then continue with `auth-session`,
   `net-monitor`, and the integration demo; build `fsm-retry` on coordination's shared
   backoff scheduler, which Realtime now uses as a runtime consumer.

Queue and the executors are shipped SDK primitives with example consumers; no existing
package migration is assumed. Review compatibility separately before adopting them in shipped code.

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
| `fsm-inspect` | dev-time transition trace, timeline log, Mermaid diagram export | shipped | R1 stretch |
| `fsm-retry` | declarative retry/backoff policy (max attempts, jitter, give-up event) built on coordination's scheduler | planned | R2 |

### Layer 1 — Connectivity and session

Current ownership: [Realtime composition ADR](ADR/Modules/RealtimeComposition.md). Earlier
[Realtime](ADR/Modules/Realtime.md), [Keepalive](ADR/Modules/Keepalive.md), and
[RPC](ADR/Modules/Rpc.md) records preserve historical decisions.

| Package | Purpose | Status | Release |
| --- | --- | --- | --- |
| `transport` | shared one-attempt contract with WebSocket, streaming HTTP (GET + POST), and reliable-stream WebTransport adapters | shipped | R2 |
| `idle-watchdog` | re-armable one-shot inactivity timer; consumers own arming and idle-event policy | shipped | R2 |
| `keepalive` | abortable promise probe with idle and fixed response deadlines; optional duration function for idle jitter | shipped; minor release pending | R2 |
| `realtime` | injected logical client over opaque messages; optional JSON codec, readiness, attempt replacement, and recovery | implemented, release pending | R2 |
| `rpc` | flat request/result/error frames; private IDs, bounded waits, cancellation, notifications, and correlated probes | implemented, release pending | R2 |
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
| `examples/coordination` | runnable Node assertions for FIFO storage, both executors, and an observable class | R2 first |
| `examples/server` | tiny Node backend for demos: auth, presence, and chat fan-out over `realtime` + `rpc` | grows R2→R5 |
| `docker/pbx` | compose file with a SIP server (Asterisk/FreeSWITCH) for real calls in dev | R3 |
| `examples/softphone` | the reference UCaaS MVP app (React) — the stop line | R5 |

### Shared primitives (opt-in)

These are independent SDK tools. Their placement does not imply a dependency beneath the FSM or
other shipped packages; each owner adopts only what its contract needs.

| Package | Purpose | Status | Release |
| --- | --- | --- | --- |
| `coordination` | FIFO Queue, separate SyncExecutor and AsyncExecutor, typed Emitter, duration jitter, and one-shot backoff; additive exports pending; [ADR](ADR/Modules/Coordination.md) | shipped (1.0.0) | R2 first |

## Releases

Packages version independently via Changesets, so a "release" here is a milestone, not a lockstep version bump. `1.0.0` means API freeze for that package. The FSM family freezes in R1; domain packages stay `0.x` until the reference app proves them in R5, then get promoted — that promotion is "Bazario Platform 1.0".

Coordination starts at `1.0.0`: its four public primitives carry a stable API commitment from the
first release. Track real-consumer validation of normal, failure, and disposal paths in the
[Coordination adoption table](ADR/Modules/Coordination.md#adoption-evidence); that evidence guides
future changes rather than gating the initial release. Additive jitter and backoff exports planned
for `1.1.0` are also stable within the `1.x` line.

### R1 — State Platform 1.0

- Goal: finish and freeze the FSM family.
- Build: `fsm-react`; stretch: `fsm-persist`, `fsm-inspect`.
- Chores: flip Effects/Delays ADR statuses, docs pass, promote the FSM family to `1.0.0`. Shared structural types (`FsmSubscribable`, hierarchy config/snapshot shapes, diagram config shapes) are promoted into `@bazariodev/fsm`; keep dependent package exports as compatibility aliases.
- Exit criteria: a nested call-flow example (`connected.active` / `connected.onHold` / `connected.muted`) running in React, built only from published packages.

### R2 — Connectivity

- Goal: a session that survives the real internet.
- Next: complete release review for realtime, keepalive, RPC, and the additive coordination/watchdog changes; then build the protocol demo and verify a Ringotel backend adapter.
- Build: `coordination`, `transport` (shared contract and WebSocket, HTTP, WebTransport adapters), `idle-watchdog`, `keepalive`, `realtime`, `rpc`, `auth-session`, `net-monitor`; build `fsm-retry` on coordination's `createBackoffScheduler` (Realtime is its current runtime consumer). Start `examples/server`.
- Decision gate: keep `transport` limited to one physical attempt and keep logical lifecycle policy in `realtime`. HTTP and WebTransport share the package and a documented binary framing contract; validate deployment servers against it.
- Exit criteria: coordination public contracts and declarations pass validation, the private `examples/coordination/` workspace package runs through `pnpm health`, and coordination is documented and released at `1.0.0`; the connectivity demo signs in, stays connected through network flaps and laptop sleep, re-authenticates silently, and shows connection state.

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
