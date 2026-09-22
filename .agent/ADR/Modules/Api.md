# ADR: Declarative API Client Module

- Status: Proposed
- Date: 2026-08-03

## Context

Most applications eventually grow an `api.ts`, `apiClient.ts`, or `api/**` layer around
`fetch`/axios. It usually begins as response parsing and then accumulates unrelated but interacting
responsibilities:

- base URLs, path interpolation, query serialization, headers, and body encoding
- TypeScript response assertions that are not runtime guarantees
- request and response validation
- authentication and token/session refresh
- concurrent refresh races
- retries, backoff, `Retry-After`, timeouts, and cancellation
- deciding whether a write is safe to retry
- proactive rate and concurrency limiting
- caching and request coalescing
- logging, tracing, redaction, and API-contract drift detection

The result is a critical module that was never designed as a system. Each new concern changes the
correctness of the others. A retry can duplicate a `POST`; a timeout can expire while a request is
still waiting in a throttle queue; ten `401` responses can trigger ten token refreshes; a useful
debug interceptor can leak credentials or PII; a cache can cross user boundaries; and
`api<User>(...)` can return anything while TypeScript continues to report `User`.

The motivating DOU article, [“На пенсію api.ts: викликай майже будь-який API як локальну
функцію”](https://dou.ua/forums/topic/60943/), presents StitchAPI as a declarative solution. For
this ADR we also reviewed the actual StitchAPI repository at commit
[`abf4677`](https://github.com/rejifald/StitchAPI/tree/abf467736c1ecf331b1a77c2165ba15f90732446),
including its endpoint/config composition, execution engine, resilience, auth, validation, drift,
trace, cache, adapters, and tests. The useful architectural ideas are:

- an endpoint declaration is itself the callable client
- runtime schemas are the source of static input/output types
- a service-level object owns shared policy and runtime state
- transport is an adapter below the declaration, not the public abstraction
- auth, retry, throttle, timeout, cache, and observation are policies around one execution pipeline
- contract drift is separate from fatal validation
- one endpoint can be adopted without replacing the existing API layer

The audit also found choices we should not inherit (links pin the reviewed source revision):

- [request validation discards the validator's normalized
  value](https://github.com/rejifald/StitchAPI/blob/abf467736c1ecf331b1a77c2165ba15f90732446/packages/core/src/engine.ts#L383-L412),
  so coercions and defaults do not reach the wire
- [RFC 6570 expansion can silently omit a missing path
  value](https://github.com/rejifald/StitchAPI/blob/abf467736c1ecf331b1a77c2165ba15f90732446/packages/core/src/util.ts#L303-L380)
  at runtime instead of failing before transport
- [transport errors and configured statuses can be
  retried](https://github.com/rejifald/StitchAPI/blob/abf467736c1ecf331b1a77c2165ba15f90732446/packages/core/src/engine.ts#L587-L768)
  without the engine first proving the HTTP operation is safe to replay
- [a custom trace sink receives the raw
  event](https://github.com/rejifald/StitchAPI/blob/abf467736c1ecf331b1a77c2165ba15f90732446/packages/core/src/trace.ts#L390-L404),
  including secret-bearing request input, and must remember to redact it itself
- [total deadlines use wall-clock
  time](https://github.com/rejifald/StitchAPI/blob/abf467736c1ecf331b1a77c2165ba15f90732446/packages/core/src/engine.ts#L453-L487)
  while other policy timing uses the injected clock
- the broad multi-surface engine and highly polymorphic config make the core harder to reason about
  than Bazario's small-package conventions allow

This repository needs the capability, but not a copy of StitchAPI's implementation or product
surface. We need a focused, HTTP-first Bazario foundation with fail-closed safety rules,
deterministic ports, and independently testable policies.

The article is therefore requirements-discovery input, not the target API. Success means Bazario
owns a durable API boundary that works for ordinary REST calls, HTTP-based RPC/GraphQL calls,
multi-tenant browser and Node runtimes, uploads, typed error responses, pagination metadata, and
custom authentication/serialization without weakening the guarantees of the common path. A feature
is not “supported” merely because an interceptor can mutate a request until it works; the behavior,
ordering, cancellation, privacy, and type consequences must be part of an explicit contract.

## Decision

We will build `@bazariodev/api` as a dependency-free, declarative HTTP API runtime and extension
foundation.

Its two public primitives are:

- `createApi<TContext>(config)` — owns a service/trust boundary's shared base URL, allowed origins,
  typed call context, adapter, auth strategy, retry/timeout
  ceilings, throttle buckets, cache store, clock, and observer
- `api.endpoint(definition)` — declares one operation and returns a typed callable whose input and
  output types are inferred from runtime schemas

Endpoint construction compiles and freezes the declaration into an immutable execution plan.
Calls consume the plan; they do not repeatedly merge open-ended configuration or expose a mutable
middleware context.

The package sits above `fetch`/axios and below application server-state tools:

- the adapter answers **how bytes cross the HTTP boundary**
- `@bazariodev/api` answers **what operation is being called and how that call is made safe**
- TanStack Query/SWR/application state answers **when to call and how UI-visible server state is
  retained and invalidated**

The default transport is global `fetch`. An existing `fetch`, axios instance, test double, or future
transport can be supplied through the `HttpAdapter` port. The package does not depend on React,
`@bazariodev/fsm`, `@bazariodev/realtime`, a server, a code generator, or a schema library.

## Architectural guarantees

The public design is accepted only if it preserves all of these qualities:

- **Sound boundary:** static types come from runtime contracts; `unknown` remains `unknown` until
  decoded and validated.
- **Deterministic execution:** one documented stage order owns auth, cache, throttling, retries,
  decoding, validation, and observation.
- **Least authority:** endpoint code cannot access credentials, stores, clocks, or raw observer
  payloads unless its named port requires that capability.
- **Bounded work:** attempts, queue depth, waits, response/error bytes, cache size, drift traversal,
  and diagnostic cardinality have finite defaults and configurable ceilings.
- **Trust-boundary safety:** credentials, refresh flights, caches, retry budgets, and rate limits are
  scoped to a client and origin/principal rather than hidden module globals.
- **Monotonic policy:** client policy sets ceilings, endpoints may tighten them, and individual calls
  may only narrow deadlines or bypass optional behavior; a call cannot silently add retries, weaken
  auth, or expand an origin allowlist.
- **Explicit extensibility:** new wire formats and integrations enter through typed named ports or
  companion packages, never by rearranging private pipeline stages.
- **Incremental adoption:** one endpoint can be introduced or removed without a generator, runtime
  service, framework migration, or global rewrite.

## Resolved decisions

### 1. Runtime schemas are the only source of trusted types

`input.params`, `input.query`, `input.headers`, `input.body`, `output`, optional `outputHeaders`, and
status-specific `errors` accept [Standard Schema v1](https://standardschema.dev/) validators. Zod,
Valibot, ArkType, and other compliant validators work without a runtime dependency in this package.

Rules:

- the endpoint result type is inferred from `output`; no `endpoint<T>()` overload may assert an
  unchecked response type
- when `output` is absent, the result is `unknown`, never an author-selected generic
- request-part types are inferred from their input schemas; undeclared parts do not appear, and the
  endpoint input itself is omitted only when no declared part requires a value
- schema **input** types describe what a caller may pass while schema **output** types describe the
  normalized values used by codecs, auth/signing, idempotency, and cache keys
- declared response headers and error bodies are also schema-derived; `.response()` and `.safe()`
  preserve their status-specific types instead of collapsing them into `Record<string, string>` or
  `any`
- validation returns normalized values, and those normalized values are what URL expansion,
  query serialization, headers, and body encoding consume
- invalid input fails before auth, cache, throttle, or transport
- invalid output fails at the API boundary with an `ApiContractError`; invalid data never reaches
  application code as the declared type

This removes the `as Promise<T>` failure mode rather than hiding it behind a different helper.

### 2. Path and wire construction fail closed

Endpoint paths use [RFC 6570 URI Templates](https://www.rfc-editor.org/rfc/rfc6570.html). Literal
template variables are inferred into the call type where TypeScript can see the literal, but runtime
checks remain authoritative.

- every required path variable must exist after input normalization and must not be `null` or
  `undefined`; otherwise the call throws `ApiInputError` before transport
- a value is percent-encoded according to the URI-template operator; raw string interpolation is not
  used
- query serialization is centralized and explicitly selects an array format (`repeat`, `brackets`,
  or `indices`; default `repeat`)
- `undefined` and empty arrays are omitted, `null` is encoded as an empty value, booleans are
  `true`/`false`, nested objects use bracket paths, and array/duplicate-value order is preserved
- request body encoding is explicit: `json` (default), `form`, `multipart`, or a registered named
  `RequestCodec`; response decoding similarly uses a registered `ResponseCodec`
- `Content-Type` is set by the active codec; callers cannot accidentally set a multipart boundary
- header merging is case-insensitive
- system-owned headers (`Authorization`, idempotency, tracing, body length/type) have one documented
  owner; conflicting caller/codec/auth writes fail instead of depending on merge order
- a retryable codec produces a fresh body for each attempt; arbitrary one-shot streams are outside
  v1 and cannot opt into retry through a type assertion

Built-ins cover JSON, text, `application/x-www-form-urlencoded`, multipart, and bounded binary
responses. XML, Protobuf, vendor media types, and legacy query dialects register explicit codecs at
client construction. Codecs transform only their declared request/response slot; they cannot see
auth state, retry counters, cache stores, or the mutable pipeline.

### 3. One ordered execution pipeline owns concern interaction

Every call runs the same fixed pipeline:

1. create run identity and one total deadline
2. validate and normalize all request parts
3. resolve the typed call context/base URL and enforce the origin trust boundary
4. expand the URI template and construct the normalized logical request
5. derive one idempotency key for the logical call, when configured
6. resolve the non-secret cache partition and check/coalesce the cache, when enabled
7. acquire the abortable rate/concurrency gate for an attempt
8. produce a fresh encoded body, then resolve/apply auth or request signing to the finalized attempt
9. execute the adapter under the remaining total budget and per-attempt timeout
10. release the concurrency gate in `finally`
11. handle at most one auth refresh/replay for a rejected credential revision
12. admit a safe retry through the shared retry budget, then apply `Retry-After`, backoff, and jitter
13. decode the accepted/error response with byte limits and select the declared value
14. validate output, declared response metadata, or the status-specific error contract and emit drift
15. write a successful validated value to cache
16. emit the terminal report and return the validated value

There are no general-purpose mutating interceptors in v1. Cross-cutting behavior enters through
named ports (`auth`, `adapter`, `codec`, `cache`, `observer`, `clock`) so ordering remains owned and
testable. A later capability may add a named stage, but cannot let consumers reorder existing
stages or reach their mutable internal state.

### 4. Auth refresh uses revision-aware single flight

The article's “ten simultaneous requests” problem is not solved by a mutex alone. A simple
in-flight promise stops simultaneous refreshes, but a late `401` that arrives just after the promise
settles can start a second refresh for the same rejected token.

An `AuthStrategy<TContext>` therefore resolves an `AuthSnapshot` containing:

- headers to apply
- a non-secret `revision` identifying the credential version used for this attempt

It separately exposes an optional non-secret `partition()` resolver for principal-scoped auth
flights and cache keys. Partition resolution must not resolve, refresh, or expose the credential, so
a cache hit does not perform unnecessary token work.

A refresh-capable strategy without `partition()` is explicitly client-scoped and single-principal.
A strategy that can serve more than one principal must provide `partition()`; construction fails
otherwise. Authenticated caching remains stricter: it bypasses unless a partition is available or
the endpoint is explicitly public.

On an auth-rejection response, the client compares the failed revision with the latest snapshot:

- if the revision has already changed, another call refreshed it; replay without refreshing
- otherwise enter a single-flight refresh keyed by strategy and partition
- after refresh, resolve again and require a changed usable snapshot
- replay the endpoint once with the same idempotency key
- if the replay is rejected, fail; never enter a refresh loop

The built-in `refreshingBearer()` strategy owns this protocol. Static `bearer()` and custom
strategies use the same port. API-key, Basic, cookie-mode, OAuth/OIDC session adapters, and
request-signing strategies can implement it without entering the endpoint definition. A signer sees
the finalized method, URL, declared headers, and a codec-provided body digest, but never mutable
retry/cache state. Refresh state is client-owned and shared by all endpoints created by that client.
Flights are removed on both success and failure, so a failed refresh does not poison future calls.

Per-call cancellation stops that caller waiting for a shared refresh but does not cancel the refresh
needed by other callers. `api.close()` aborts the shared runtime. Refresh requests have their own
bounded timeout and are still charged to the caller's total deadline while awaited.

`@bazariodev/api` manages the mechanical credential boundary. A future `auth-session` package owns
product-level states such as signed-out, authenticating, active, expired, and interactive recovery;
it can provide an `AuthStrategy` without moving those states into the HTTP engine.

### 5. Retries are safe by construction

[RFC 9110 §9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2) says a client should not
automatically retry a non-idempotent method unless it knows the operation is idempotent or knows the
original request was not applied. The package follows that rule.

- retry is off unless configured (`attempts: 1`)
- GET, HEAD, OPTIONS, TRACE, PUT, and DELETE are eligible by method semantics
- POST and PATCH are not automatically replayed
- a POST/PATCH becomes eligible only when the endpoint declares idempotency and the request carries
  a stable server-supported idempotency key, or when the endpoint explicitly supplies a reviewed
  `retry.safety: 'application-idempotent'` override
- an idempotency key is minted once per logical call and reused across auth replay and retries
- the logical body is normalized once, but its codec creates a fresh replayable transport body for
  every attempt; an already-consumed `Request`, stream, or iterator is never reused
- transport failures, timeouts, and statuses are separate retry predicates
- default retryable statuses are `408`, `429`, `502`, `503`, and `504`; validation, parsing,
  auth-configuration, and contract errors are never retried
- `Retry-After` supports delta-seconds and HTTP-date, is capped by policy, and still cannot exceed
  the total deadline
- backoff uses full jitter by default and is injectable/deterministic in tests
- all retries also consume a client/origin retry budget; first attempts and the single auth replay
  do not. An exhausted budget suppresses the retry and records the reason, preventing a failing
  dependency from multiplying load across otherwise independent calls

Enabling `idempotency` cannot make a server idempotent. The endpoint documentation must identify the
server contract and header. Construction fails when an unsafe method asks for retry without either
form of replay proof.

HTTP method is the safe default, not the only possible semantic. An endpoint such as a GraphQL
query transported by `POST` may explicitly declare reviewed application idempotency. The declaration
affects retry/cache eligibility only; it does not claim the server honors an idempotency-key header.

### 6. Timeout and cancellation cover the whole call

`timeout.total` is a monotonic deadline covering validation, cache lookup, throttle waiting, auth,
every transport attempt, backoff, response parsing, and output validation. `timeout.attempt` bounds
one adapter attempt. The smaller remaining budget always wins.

The caller's `AbortSignal`, client close signal, total deadline, and attempt deadline are composed
into the signal passed to the adapter. Cancellation also removes throttle waiters and interrupts
backoff sleeps. No retry starts after cancellation or deadline expiry.

One injected `Clock` supplies `now`, timers, sleeps, report timestamps, and deadline math. Tests do
not mix an injected scheduler with `Date.now()`.

Async third-party validators cannot necessarily be physically cancelled because Standard Schema
does not require an `AbortSignal`; the call can stop awaiting them, but their internal work may run
to completion. Validators used on this boundary must be side-effect free.

### 7. Throttling is proactive, shared, bounded, and abortable

The client runtime owns a FIFO limiter shared by its endpoints. It supports:

- minimum-spacing rate limits such as `10/s`
- maximum in-flight concurrency
- client-wide pools and optional origin pools
- endpoint-local policies that may tighten, never loosen, the shared ceiling
- cancellation that removes a queued waiter without later consuming a phantom slot
- a finite maximum queue length and queue-wait ceiling; overflow fails with a typed error rather
  than retaining unbounded promises during an outage

There is no module-global host registry: two unrelated clients do not silently share budgets.
The default is in-memory and zero-infrastructure. A `RateStore` port can later support distributed
budgets; distributed concurrency requires leases and is not pretended by a counter-only store.

### 8. Cache is transport-level, optional, and principal-safe

Caching is off by default and does not replace TanStack Query/SWR. When enabled it provides bounded
read-through storage and optional in-process coalescing for endpoint calls that are expensive even
outside a UI.

- GET/HEAD only by default; other methods require explicit reviewed opt-in
- key derived from the normalized method, URL/query, body when allowed, declared vary headers,
  endpoint id, cache contract version, and non-secret principal partition
- custom query/request codecs must provide deterministic canonical key material for caching; when
  they cannot, the call bypasses cache instead of guessing from object identity or JSON key order
- credentials, cookies, trace headers, and request IDs never enter the key
- authenticated calls default to principal scope; if auth supplies no partition, the cache refuses
  the operation rather than treating every user as one anonymous principal
- `scope: 'public'` is an explicit opt-in for responses safe to share across principals
- `Vary: *` is never stored; an undeclared response `Vary` header bypasses storage with a diagnostic
- successful validated values only; no raw or error response caching in v1
- every cached endpoint declares `version`; changing its output contract, selection, or semantics
  requires a version bump
- cached values are revalidated on read before return; invalid entries are evicted and treated as a
  miss
- exact endpoint-input invalidation and whole-endpoint invalidation are public
- in-memory entries have TTL and LRU bounds

Coalescing is keyed by the same principal-safe key. Participants are reference-counted: one caller's
abort stops only that caller; the shared adapter call is aborted only when every participant has
left. A failed leader is not cached and all waiters receive a typed failure; the package does not
silently create a retry storm by making each waiter re-run independently.

### 9. Validation and drift are separate signals

`output` is the hard contract. A missing required field or incompatible value throws
`ApiContractError` at the endpoint boundary.

`drift(output, options)` adds non-fatal findings by comparing the raw decoded value with the
validator's normalized output:

- `undeclared` — a field the schema projected away
- `coerced` — a raw value changed during validation
- `defaulted` — a value was introduced by a default

Findings carry a path and severity, support ignore rules for acknowledged fields, collapse repeated
array findings, and have traversal/finding limits so a huge payload cannot create unbounded work.
Raw payloads are discarded after validation/diff and never sent to observers.

This mechanism can only detect differences visible in raw-to-normalized output. A passthrough
schema that preserves unknown keys cannot report those keys as undeclared. Consumers wanting that
signal must use a projecting/stripping schema. The package documents this limitation instead of
claiming validator-independent schema introspection.

### 10. Observability is useful without exposing payloads

Every call emits a typed event sequence to an optional `ApiObserver`:

- run start and terminal success/failure
- throttle wait
- transport attempt and latency
- auth refresh/replay
- retry reason and delay
- response status
- cache hit/miss/bypass/coalesced
- drift findings

Observer events contain operation id, method, path template, origin, status, attempt counters,
durations, cache outcome, and drift metadata. They never contain:

- resolved URL query values
- request or response headers
- request/response/error bodies
- credentials, cookies, tokens, or auth revisions/partitions

Default drift telemetry contains counts/classification/severity, not arbitrary server-provided field
names. Paths may be emitted only through an endpoint-declared safe allowlist; array indices and
dynamic map keys are normalized. This keeps both privacy and metrics cardinality bounded.

Sanitization happens before the event reaches **every** observer, including custom observers. There
is no “raw custom sink” escape hatch in v1. An observer throw is contained and cannot change call
behavior. Observation is off by default and never reads environment variables or opens files.

`api.report()` returns safe aggregate client metadata. `endpoint.inspect()` executes once and
returns `{ result, report }`: `result` is explicitly data-bearing, while `report` uses the same
payload-free shape as observer diagnostics. W3C
[Trace Context](https://www.w3.org/TR/trace-context/) propagation may be enabled explicitly through
a trace-context port; the library never overwrites a caller-supplied valid context.

### 11. One endpoint at a time, no flag-day migration

An endpoint declaration can coexist with the current API module. The adoption path is:

1. create one client around the existing `fetch` or axios transport
2. migrate one high-value endpoint
3. add its request/output schemas and policies
4. use the callable from existing application code or as a TanStack Query `queryFn`
5. repeat only when the prior endpoint is proven

No generated SDK, global config file, runtime server, or all-at-once rewrite is required.

### 12. Context and origins are explicit trust boundaries

`createApi<TContext>()` gives every dynamic port the same readonly, application-defined call
context. A browser may use `{ locale, tenantId, session }`; SSR code may pass a request-scoped
context; a worker may provide a service identity. The library never discovers identity through a
module global, ambient singleton, or Node-only `AsyncLocalStorage`.

The context comes either from a client resolver or `CallOptions.context`. Supplying it per call
wins, but its type is fixed by the client. Ports receive only the view they need: the query codec
does not receive the session, and the observer never receives the context object. A context resolver
runs after input validation and is subject to the total deadline.

A client is also an origin trust boundary:

- `baseUrl` resolves only to configured HTTPS origins (localhost development opt-in remains)
- inherited auth, cookies, principal cache, and retry/rate budgets never cross to a different origin
- an absolute cross-origin endpoint requires an allowlisted origin and an explicit auth decision;
  it cannot inherit credentials accidentally
- redirects are checked on every hop by an adapter that exposes redirect decisions; a final URL is
  not trusted merely because the initial URL was trusted
- dynamic tenant/service routing selects from an allowlist, not from unvalidated call input

This makes a shared client safe for multi-tenant SSR only when the application supplies a stable
principal partition. A global singleton with implicit “current user” state is explicitly
unsupported.

### 13. Extensibility is capability-based, not interceptor-based

The module must support different APIs without making pipeline order a public free-for-all.
Extension belongs to one of three layers:

1. **Stable ports:** `HttpAdapter`, `AuthStrategy`, `RequestCodec`, `ResponseCodec`, `QueryCodec`,
   `CacheStore`, `RateStore`, `ApiObserver`, `TraceContext`, `Clock`, and `RandomSource`.
2. **Declarative compilers:** companion packages may turn OpenAPI operations, GraphQL documents, or
   organization conventions into ordinary endpoint definitions. They produce data; they do not
   receive engine internals.
3. **Separate execution models:** SSE, duplex streams, durable workflows, transports, RPC, MCP, and
   shell execution use their own packages when their lifetime/cancellation/trust semantics differ.
   They may share descriptors, schemas, error shapes, or observer conventions without sharing the
   HTTP attempt engine.

Ports are structural, versioned, minimal, and accompanied by conformance tests in
`@bazariodev/api/testing`. Registered codecs and adapters have stable string keys in serializable
descriptors, while executable functions remain private to the owning client. A port may fail a call
but cannot mutate another port's configuration, swallow cancellation, change an operation id, or
emit unsanitized diagnostics.

New cross-cutting concerns such as a circuit breaker require a named policy and an ADR amendment
that fixes its position in the pipeline. We deliberately do not expose `beforeRequest`,
`afterResponse`, or Koa-style `next()` middleware: those hooks make authentication, retries,
redaction, and execution count dependent on registration order—the exact class of pain this module
is intended to remove.

### 14. Configuration compiles once and resources have ownership

Client defaults, endpoint declarations, and call options are three distinct layers:

- client config establishes trust boundaries, implementations, defaults, and hard ceilings
- endpoint config selects capabilities and may only preserve or tighten client guarantees
- call options provide input context, cancellation/trace context, a shorter deadline, or explicit
  cache bypass; they cannot change auth strategy, origin, codec registry, retry safety, or limits

`api.endpoint()` validates, resolves registered capability keys, derives template variables and
type metadata, checks impossible policy combinations, then freezes a plan. This keeps hot calls
predictable and makes configuration errors fail during composition rather than under load.

`api.close()` is idempotent: it rejects new calls, aborts queues/backoffs/active calls, detaches
observers, clears owned in-memory state, and waits for bounded cleanup. Injected adapters/stores are
borrowed by default and are not closed; an explicit owned-resource wrapper transfers disposal
responsibility. Endpoint values become closed with their client and cannot retain a hidden runtime.

## Problem coverage

| Problem/pain | Package rule |
| --- | --- |
| repeated `.json()` and status handling | adapter + centralized response codec/error taxonomy |
| base URL, headers, methods | shared `createApi` config + endpoint declaration |
| `as Promise<T>` lies | output type inferred only from runtime schema; absent schema → `unknown` |
| invalid/missing path params | inferred RFC 6570 vars + authoritative runtime fail-fast check |
| inconsistent query/body encoding | centralized, explicit codecs with pinned array/null semantics |
| bad input reaches server | validate **and use normalized values** before request construction |
| ten concurrent token refreshes | revision-aware, principal-keyed single flight |
| late stale `401` refresh storm | compare failed vs current credential revision before refreshing |
| retries conflict with auth | fixed pipeline; one auth replay, separate retry budget and counters |
| retries duplicate writes | idempotent-method gate or stable server-supported idempotency key |
| retries amplify an outage | client/origin retry budget in addition to per-call attempt limits |
| `Retry-After`, backoff, jitter | declarative retry policy with total-deadline cap |
| timeout only covers fetch | one total deadline across all waits/stages + per-attempt timeout |
| request cancellation | composed signal through queues, sleeps, auth wait, and adapter |
| production `429` surprises | proactive shared rate/concurrency limiter |
| missing cache | opt-in bounded cache/coalescing with schema version and invalidation |
| cross-user cache leak | fail-closed principal partition; explicit public scope |
| SSR/global “current user” leakage | typed request-scoped context; no ambient identity lookup |
| bearer token sent to another host | origin allowlist; cross-origin calls cannot inherit auth |
| `console.log` grows into credential leak | payload-free sanitized observer events for all sinks |
| silent API shape change | hard output validation + non-fatal bounded drift findings |
| pagination/rate metadata is untyped | opt-in schema-validated response metadata via `.response()` |
| every status has the same error type | status-specific error schemas preserved by `.safe()` |
| vendor/XML/Protobuf API needs a hack | named request/response/query codec ports with conformance tests |
| custom behavior becomes a monolith | named strategy/adapter/store/observer/clock ports; no generic interceptor |
| plugin order changes correctness | immutable compiled plans and a package-owned stage order |
| outage creates unbounded work | finite queue/body/cache/drift/retry/diagnostic budgets |
| cannot adopt incrementally | endpoint-at-a-time callables beside legacy code |
| library requires infrastructure | in-process defaults, global fetch, zero runtime dependencies |
| excessive boilerplate | one client declaration plus one small endpoint object; inferred types |

## Scope

### In scope for v1

- bounded HTTP endpoint declarations over global `fetch`
- full URL or `baseUrl` + RFC 6570 path under an explicit origin allowlist
- typed call context for browser, SSR, worker, multi-tenant, and service clients
- runtime input/output/error schemas through Standard Schema
- normalized-input request construction
- JSON, form, multipart, text, and bounded binary codecs plus named codec ports
- typed, schema-validated response headers/metadata and status-specific error contracts
- typed error taxonomy and never-throwing `.safe()`
- payload-free observer/run reports plus an explicit data-bearing `.inspect()` envelope
- static bearer and revision-aware refreshing bearer auth strategies
- auth single-flight and one replay
- safe retry/backoff/jitter/`Retry-After`
- client/origin retry budgets
- idempotency-key policy
- total/per-attempt timeouts and cancellation
- client-wide and endpoint-tightened throttles
- optional memory cache, principal partitioning, invalidation, and request coalescing
- hard validation plus leveled drift detection
- finite byte, queue, cache, attempt, wait, traversal, and diagnostic limits
- `HttpAdapter`, auth, query/request/response codec, clock/random, cache/rate store, trace, and
  observer ports
- testing helpers: mock adapter, manual clock, captured observer

### Out of scope for v1

- React hooks or application server-state management
- OpenAPI generation/ingestion and code generation
- GraphQL-specific document parsing (GraphQL-over-HTTP is still expressible as a POST endpoint)
- SSE/raw streaming/download/LLM/shell/postMessage “universal surfaces”
- CLI, HTTP-server, or MCP front doors
- workflow orchestration, queues, durable jobs, or sagas
- distributed cache/coalescing/rate-limit implementations
- circuit breaker (add after retry/throttle production evidence; do not overload v1)
- cookie-jar emulation in browsers (the platform owns browser cookies)
- arbitrary request/response mutation interceptors
- per-call overrides that loosen client/endpoint security or resilience ceilings
- retrying one-shot streaming request bodies

These exclusions do not leave the article's `api.ts` pains unsolved for HTTP calls. They keep
unrelated protocols and deployment surfaces from turning the first Bazario implementation into the
same kind of monolith it replaces. Future packages such as `@bazariodev/api-sse`,
`@bazariodev/api-mcp`, or `@bazariodev/api-openapi` may consume the endpoint/observer ports without
expanding the core.

## Contracts

Illustrative names; exact conditional types may change without changing the decisions above.

```ts
interface StandardSchemaV1<TInput = unknown, TOutput = TInput> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardResult<TOutput> | Promise<StandardResult<TOutput>>;
    readonly types?: { readonly input: TInput; readonly output: TOutput };
  };
}

type ApiCallInput = Readonly<{
  params?: unknown;
  query?: unknown;
  headers?: unknown;
  body?: unknown;
}>;

type CallOptions<TContext = void> = Readonly<{
  context?: TContext;
  signal?: AbortSignal;
  traceContext?: Readonly<{ traceparent: string; tracestate?: string }>;
  timeoutMs?: number; // may only shorten the endpoint total deadline
  cache?: 'default' | 'bypass';
}>;

type EncodedBody = Readonly<{
  mediaType?: string;
  replayable: boolean;
  create: () => unknown; // a fresh adapter body for every attempt
  fingerprint?: string; // deterministic cache/coalescing material when the codec can provide it
  digest?: string; // optional signer input; never observer input
}>;

type RequestCodec = Readonly<{
  key: string;
  encode: (value: unknown, signal: AbortSignal) => EncodedBody | Promise<EncodedBody>;
}>;

type ResponseCodec = Readonly<{
  key: string;
  decode: (response: HttpResponse, limits: DecodeLimits) => unknown | Promise<unknown>;
}>;

type QueryCodec = Readonly<{
  key: string;
  encode: (value: unknown) => string;
}>;

type HttpRequest = Readonly<{
  url: string;
  method: string;
  headers: Readonly<Record<string, string>>;
  body?: unknown; // one body instance created for this attempt
  signal: AbortSignal;
}>;

type HttpResponse = Readonly<{
  status: number;
  headers: Readonly<Record<string, string>>;
  body: unknown; // bounded raw adapter value consumed by the selected response codec
  url: string;
}>;

type HttpAdapter = (request: HttpRequest) => Promise<HttpResponse>;

type AuthSnapshot = Readonly<{
  headers: Readonly<Record<string, string>>;
  revision: string | number; // non-secret credential generation
}>;

type AuthStrategy<TContext = void> = Readonly<{
  key: string;
  partition?: (ctx: AuthContext<TContext>) => string | undefined | Promise<string | undefined>;
  resolve: (ctx: AuthContext<TContext>) => AuthSnapshot | Promise<AuthSnapshot>;
  rejects?: (response: HttpResponse) => boolean; // default 401
  refresh?: (ctx: RefreshContext<TContext>) => void | Promise<void>;
}>;

type RetryPolicy = Readonly<{
  attempts?: number; // total resilience attempts, including the first; default 1
  statuses?: readonly number[];
  transportErrors?: boolean;
  timeouts?: boolean;
  safety?: 'http-idempotent' | 'application-idempotent';
  backoff?: Readonly<{
    baseMs?: number;
    maxMs?: number;
    jitter?: 'full' | 'none';
    respectRetryAfter?: boolean;
  }>;
}>;

type RetryBudgetPolicy = Readonly<{
  capacity: number;
  refillPerSecond: number;
}>;

type TimeoutPolicy = Readonly<{
  totalMs?: number;
  attemptMs?: number;
}>;

type CachePolicy = Readonly<{
  ttlMs: number;
  version: string | number;
  scope?: 'principal' | 'public';
  vary?: readonly string[];
  coalesce?: boolean;
}>;

type ApiLimits = Readonly<{
  responseBytes?: number;
  errorBytes?: number;
  throttleQueue?: number;
  throttleWaitMs?: number;
  cacheEntries?: number;
  driftDepth?: number;
  driftFindings?: number;
}>;

type ApiClientConfig<TContext = void> = Readonly<{
  baseUrl?: string | ((ctx: ContextResolverContext<TContext>) => string | Promise<string>);
  // Inferred as the exact static base origin; required for dynamic or additional origins.
  allowedOrigins?: readonly string[];
  context?: (signal: AbortSignal) => TContext | Promise<TContext>;
  adapter?: HttpAdapter | Owned<HttpAdapter>;
  auth?: AuthStrategy<TContext>;
  queryCodecs?: readonly QueryCodec[];
  requestCodecs?: readonly RequestCodec[];
  responseCodecs?: readonly ResponseCodec[];
  retry?: RetryPolicy;
  retryBudget?: RetryBudgetPolicy;
  timeout?: TimeoutPolicy;
  throttle?: ThrottlePolicy;
  cache?: CacheStore | Owned<CacheStore>;
  observer?: ApiObserver;
  traceContext?: TraceContextPort;
  clock?: Clock;
  random?: RandomSource;
  limits?: ApiLimits; // every omitted field still receives a finite package default
}>;

declare function createApi<TContext = void>(
  config: ApiClientConfig<TContext>,
): ApiClient<TContext>;

// Runtime accepts exact status keys plus an optional default. Conditional types preserve
// each declared status and its schema output in ErrorsOf<TDefinition>.
type ErrorContracts = Readonly<Record<number | 'default', StandardSchemaV1>>;

type InputContracts = Readonly<{
  params?: StandardSchemaV1;
  query?: StandardSchemaV1;
  headers?: StandardSchemaV1;
  body?: StandardSchemaV1;
}>;

type EndpointDefinition<
  TContext = void,
  TInputContracts extends InputContracts = InputContracts,
> = Readonly<{
  id: string;
  description?: string;
  method?: string;
  path: string;
  input?: TInputContracts;
  output?: StandardSchemaV1 | DriftContract;
  outputHeaders?: StandardSchemaV1;
  errors?: ErrorContracts;
  select?: string; // dot path, e.g. "data"; no opaque transform in v1
  queryCodec?: string;
  requestCodec?: string;
  responseCodec?: string;
  acceptedStatuses?: readonly number[];
  auth?: 'inherit' | 'none' | AuthStrategy<TContext>;
  retry?: RetryPolicy | false;
  timeout?: TimeoutPolicy;
  throttle?: ThrottlePolicy | false;
  idempotency?: boolean | Readonly<{
    header?: string;
    keyOf?: (input: NormalizedInputOf<TInputContracts>) => string;
  }>;
  cache?: CachePolicy | false;
}>;

type ApiResponse<TData, THeaders = never> = Readonly<{
  data: TData;
  status: number;
  // Only schema-declared, normalized response headers; an undeclared contract yields an empty map.
  headers: [THeaders] extends [never] ? Readonly<Record<string, never>> : THeaders;
}>;

type ApiResult<T, TFailure extends ApiError = ApiError> =
  | Readonly<{ ok: true; data: T; error: null }>
  | Readonly<{ ok: false; data: null; error: TFailure }>;

type ApiRunReport = Readonly<{
  operationId: string;
  runId: string;
  outcome: 'success' | 'failure';
  errorKind?: ApiError['kind'];
  status?: number;
  transportAttempts: number;
  resilienceAttempts: number;
  authRefreshes: number;
  cache: 'disabled' | 'bypass' | 'miss' | 'hit' | 'coalesced';
  drift: readonly DriftFinding[];
  timing: Readonly<{ totalMs: number; throttleMs: number; backoffMs: number }>;
}>;

type ApiExecution<T, TFailure extends ApiError = ApiError> = Readonly<{
  result: ApiResult<T, TFailure>; // explicitly data-bearing
  report: ApiRunReport; // structurally payload-free
}>;

interface Endpoint<TInput, TOutput, TFailure extends ApiError, THeaders, TContext> {
  (...args: EndpointArgs<TInput, TContext>): Promise<TOutput>;
  response(...args: EndpointArgs<TInput, TContext>): Promise<ApiResponse<TOutput, THeaders>>;
  safe(...args: EndpointArgs<TInput, TContext>): Promise<ApiResult<TOutput, TFailure>>;
  inspect(...args: EndpointArgs<TInput, TContext>): Promise<ApiExecution<TOutput, TFailure>>;
  invalidate(input?: TInput): Promise<void>;
  readonly descriptor: EndpointDescriptorV1; // versioned, redacted, payload-free, no live handles
}

interface ApiClient<TContext = void> {
  endpoint<
    const TInputContracts extends InputContracts,
    const TDefinition extends EndpointDefinition<TContext, TInputContracts>,
  >(
    definition: TDefinition,
  ): Endpoint<
    InputOf<TDefinition>,
    OutputOf<TDefinition>,
    FailureOf<TDefinition>,
    OutputHeadersOf<TDefinition>,
    TContext
  >;
  report(): Readonly<ApiClientReport>;
  close(): Promise<void>;
}
```

The published conditional types have compile-time contract tests:

- `InputOf` uses each schema's **input** type and preserves required/optional request parts
- `NormalizedInputOf` uses each schema's **output** type for internal policy callbacks
- `OutputOf` and `OutputHeadersOf` come only from their runtime schemas
- `FailureOf` is the union of stable runtime failures plus one discriminated `ApiHttpError` variant
  for every declared status; an unmodeled status carries no body as `unknown`
- `EndpointArgs` makes input/context arguments omittable only when their contracts genuinely permit
  omission

Every invocation of the callable, `.response()`, `.safe()`, or `.inspect()` is exactly one independent
run. Unlike a custom thenable, attaching promise handlers cannot accidentally execute a request
twice.

## Request and response rules

- `baseUrl` may be a value or a typed-context resolver; secrets do not belong in it and every result
  must match the client's origin allowlist
- a full absolute endpoint may opt out of `baseUrl`; a relative endpoint without a base is a
  construction error, and a different origin cannot inherit client auth
- endpoint definitions are normalized and frozen at construction; caller config is never mutated
- the runtime never mutates caller input; validator output is assembled into a fresh normalized
  input
- `select` runs before output validation; a missing selected path is `undefined` and therefore
  succeeds only if the output schema explicitly accepts it
- codecs are registered once by stable key; an unknown key or duplicate conflicting registration is
  a construction error
- the default response codec parses JSON only for JSON media types, returns text for text media
  types, returns bounded binary for declared binary media, and returns `undefined` for `204`, `205`,
  or an empty body
- each retry/refresh replay asks the request codec for a fresh body; `replayable: false` makes any
  configuration that can replay the operation invalid
- an adapter returns all HTTP statuses normally and throws only transport failures
- default success is `200..299`; an endpoint may declare additional accepted statuses, whose body
  still passes through `select` and `output`
- `.response()` exposes the numeric status and only headers selected by `outputHeaders`; the ordinary
  callable still returns only validated `data`
- non-accepted statuses throw `ApiHttpError`; if `errors[status]` or `errors.default` exists, its
  validated value is exposed as typed `error.data`, otherwise the bounded raw body is discarded
- a malformed declared error payload remains an `ApiHttpError` with a nested contract issue and no
  asserted data; the server's failure to honor an error schema must not masquerade as that type

## Error policy

The public taxonomy is stable and machine-readable:

- `ApiConfigError` — invalid trusted declaration; thrown at endpoint/client construction when
  possible
- `ApiInputError` — bad call input, missing template variables, or encoding failure; zero network
- `ApiAuthError` — credential resolution/refresh failure or unusable post-refresh revision
- `ApiThrottleError` — limiter/store failure, queue overflow, or queue-wait ceiling, distinct from
  ordinary waiting
- `ApiTimeoutError` — total or per-attempt deadline, with its phase
- `ApiHttpError<TStatus, TData>` — non-accepted HTTP status; status-specific validated `data` when
  its declared error contract succeeds
- `ApiContractError` — response parser/output schema failure with structured issues
- `ApiTransportError` — adapter failure after retries
- `ApiClosedError` — use after client close

Caller abort preserves the platform abort reason when it is an `Error`; otherwise it becomes an
`AbortError`. All errors include operation id, run id, and attempt counts, but never credentials,
headers, query values, raw bodies, auth revisions, or cache partitions. Causes may be retained as
non-enumerable `cause`; error serialization is explicitly sanitized.

`.safe()` catches only package/runtime failures and returns the inferred discriminated `ApiResult`;
callers may narrow a declared HTTP failure by `error.kind` and `error.status` without casts.
Programmer errors thrown by the caller's own `idempotency.keyOf`, context resolver, codec, or schema
implementation are wrapped with the appropriate package error and cause so observability remains
consistent.

## Composition and package boundaries

```ts
import { bearer, createApi, drift } from '@bazariodev/api';
import { z } from 'zod';

const User = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

const NotFound = z.object({ code: z.literal('USER_NOT_FOUND'), message: z.string() });
const ResponseHeaders = z.object({
  'x-rate-limit-remaining': z.coerce.number().int().nonnegative(),
});

const api = createApi({
  baseUrl: 'https://api.example.com',
  auth: bearer(() => session.token),
  retry: { attempts: 3 },
  timeout: { totalMs: 30_000, attemptMs: 10_000 },
  throttle: { rate: '10/s', concurrency: 6 },
  observer: metricsObserver,
});

const getUser = api.endpoint({
  id: 'users.get',
  method: 'GET',
  path: '/users/{id}',
  input: {
    params: z.object({ id: z.string().min(1) }),
    query: z.object({ expand: z.string().optional() }),
  },
  select: 'data',
  output: drift(User),
  outputHeaders: ResponseHeaders,
  errors: { 404: NotFound },
  cache: { ttlMs: 60_000, version: 1 },
});

const user = await getUser({
  params: { id: '42' },
  query: { expand: 'roles' },
});

const result = await getUser.safe({ params: { id: 'missing' }, query: {} });
if (!result.ok && result.error.kind === 'http' && result.error.status === 404) {
  result.error.data.code; // "USER_NOT_FOUND", backed by the NotFound runtime schema
}
```

The endpoint is a valid TanStack Query `queryFn` body, but `@bazariodev/api` does not import or
wrap TanStack Query.

This module is distinct from planned repository packages:

- `@bazariodev/transport` — one-attempt duplex transport contract and platform adapters
- `@bazariodev/realtime` — long-lived logical connection lifecycle and validated message channel
- `@bazariodev/rpc` — correlated request/response messages over that realtime channel
- `@bazariodev/auth-session` — application session state and interactive recovery
- `@bazariodev/api` — bounded HTTP operation declarations over a request adapter

`@bazariodev/api` does not reuse the realtime `Transport` port: an HTTP request/response operation and
a long-lived ordered duplex attempt have different lifecycle, cancellation, metadata, and streaming
contracts. Both use dependency inversion, but through purpose-specific ports.

The package does not use the FSM family internally: an individual HTTP call is an async pipeline,
not a long-lived externally driven state machine. Ports remain structural so an application may
drive calls from FSM effects without coupling the packages.

## Security

- HTTPS is required by the built-in adapter outside localhost; insecure HTTP requires explicit
  development opt-in
- every resolved URL is checked against the client's normalized origin allowlist before cache,
  auth, signing, or transport; cross-origin endpoints cannot inherit credentials
- auth headers are applied after cache-key construction and immediately before transport
- credential values never enter endpoint descriptors, reports, observer events, errors, or cache
  keys
- authenticated/signed requests use `redirect: 'error'` in the built-in fetch adapter; an adapter
  that supports redirects must expose and enforce an allowlisted hop policy before forwarding
  credentials
- custom observers receive sanitized events only
- typed call context is capability-filtered by the engine and is never forwarded wholesale to
  codecs, adapters, descriptors, errors, or observers
- request/response bodies are never observed or cached unless their explicit feature is enabled;
  cached values are already validated
- a successfully validated `errors[status]`/`errors.default` contract is the only way a response
  error body crosses the boundary
- principal cache partitions are stable non-secret identifiers; their stored key representation is
  hashed
- dynamic base/header/auth resolvers execute at call time; the public descriptor contains only
  non-secret static metadata
- custom codecs are trusted code but receive only their declared slot and finite limits; their
  output is still subject to header ownership, replayability, deadline, and byte rules
- body and drift traversal limits prevent payload-driven memory amplification
- cache size, TTL, response decode size, and error-body read size are bounded
- throttle queues and observer cardinality are bounded; retry budgets are client/origin scoped
- idempotency keys and trace IDs use `globalThis.crypto.randomUUID()`; absence of secure randomness
  is a construction/runtime error for those features, not a `Math.random()` fallback

## Validation

Client construction fails fast for malformed/duplicate adapters and codecs, clocks, stores,
observers, auth strategies, retry budgets, throttle/timeout/resource bounds, invalid owned-resource
declarations, empty origin allowlists, and insecure production base URLs.

Endpoint construction fails fast for empty/duplicate ids, malformed templates, relative paths
without a base, unsupported methods/codecs, impossible policy combinations, cache without a positive
TTL/version, retry of an unsafe or non-replayable request without proof, idempotency on a read,
invalid/duplicate error status contracts, reserved-header ownership conflicts, cross-origin auth
inheritance, and endpoint policy that attempts to loosen a client ceiling.

The implementation test plan must include:

1. **Contract boundary:** exact required/optional call arguments; distinct schema input vs normalized
   output types; output/header/status-error inference; typed context requiredness; no unchecked
   generic escape; invalid input performs zero context/auth/cache/throttle/adapter work;
   normalized/coerced/defaulted input is what reaches params/query/headers/body/policy callbacks;
   invalid/renamed/missing output fails before return.
2. **URI/wire:** missing or `undefined` template variables fail; reserved characters encode per RFC
   6570; every array/null/nested query mode; case-insensitive and reserved headers;
   JSON/form/multipart/text/binary plus custom codec conformance; a replay produces a distinct but
   equivalent body; empty/204 and wrong-content-type responses; response/error byte caps.
3. **Auth races:** ten cold calls share one refresh; ten simultaneous `401`s share one refresh; a
   late `401` for an old revision triggers no second refresh; different principals do not share;
   refresh failure releases the flight; a later call can retry; one waiter abort does not cancel
   others; refresh replay is capped at one.
4. **Retry safety:** GET retries transport/status failures; POST/PATCH do not by default; a write
   with idempotency reuses the exact key across auth replay and retries; application-idempotent
   override is explicit; `Retry-After` delta/date, cap, exponential/full-jitter math; contract and
   parse errors never retry; shared retry budget prevents amplification and refills deterministically.
5. **Timing/cancellation:** total deadline includes throttle/auth/backoff/attempt/validation; attempt
   deadline clamps to remaining total; abort while queued removes waiter; abort during backoff
   cancels timer; abort reaches adapter; no work begins after abort; every assertion uses manual
   clock with no real sleeps.
6. **Throttle:** FIFO concurrency, exact rate spacing, shared client bucket across endpoints,
   endpoint tightening, no unrelated-client sharing, release on every throw/abort, no retained idle
   keys/waiters, bounded queue overflow, and queue-wait deadline.
7. **Cache:** principal A never hits B; missing principal partition bypasses authenticated cache;
   explicit public scope shares; invalid input cannot hit; version changes miss; cached value is
   revalidated; `Vary:*`/undeclared Vary bypass; TTL/LRU/invalidation; coalesced success/failure;
   one participant abort vs all participants abort.
8. **Drift:** undeclared/coerced/defaulted classification, fatal invalid contract, ignore/severity,
   optional/nullable/empty arrays are not false drift, array summarization, traversal/finding caps,
   passthrough-schema limitation documented and tested.
9. **Privacy:** every built-in and custom observer sees no headers/query/body/revision/partition;
   URL is template/origin only; context never appears; unknown error body is discarded; typed error
   output only; observer throw cannot break the call; descriptor/report/error JSON serialization
   contains no secrets or high-cardinality caller values.
10. **Execution count:** callable, `.response()`, `.safe()`, and `.inspect()` each execute exactly
    once; promise `then`/`catch`/`finally` attachment never creates a second adapter call.
11. **Adapter contract:** fetch adapter status/body/header mapping, caller abort, timeout abort,
    redirect credential behavior, response size cap, and an axios-shaped adapter conformance fixture.
12. **Migration:** two endpoints can share one client/runtime while a legacy API function uses the
    same underlying adapter; neither changes the other's behavior.
13. **Trust boundaries:** allowed base/absolute origins, dynamic allowlisted routing, cross-origin
    auth rejection, redirect-hop rejection, principal-separated refresh/cache/retry/rate state, and
    concurrent SSR calls with different contexts never share identity-bearing state.
14. **Policy monotonicity:** endpoint tightening succeeds; every attempted loosening fails at
    construction; call options can shorten/bypass but cannot add attempts, disable auth, change a
    codec, or expand trust.
15. **Lifecycle/extensions:** compiled plans are immutable; registered port keys and descriptors are
    stable; official and fixture ports pass conformance tests; `close()` is idempotent, aborts all
    phases, rejects new calls, disposes only owned resources, and leaves borrowed resources usable.

## Packaging

- package: `@bazariodev/api`, initial version `0.1.0`
- runtime dependencies: none
- schema interop: local type-only Standard Schema v1 interface; no bundled validator
- platform: browsers and Node.js 20+
- default adapter: global `fetch`
- exports: root runtime, `@bazariodev/api/testing`, and optional focused codec/adapter subpaths only
  when they produce a measurable bundle boundary
- build: tsup, ESM + CJS + declarations + source maps, `sideEffects: false`
- tests: Vitest, public behavior first; compile-time inference tests in a dedicated type-test config
- CI: typecheck, Biome, tests, build, package-export validation, and a recorded min+gzip core budget
- compatibility: versioned serializable descriptors and port conformance suites; engine internals
  and compiled plans are not public extension APIs
- docs: README with one-endpoint migration, TanStack Query composition, typed context/SSR, custom
  codec, typed status error/metadata, refresh race, safe write retry/retry budget, origin safety,
  cache partitioning, close/ownership, and observer privacy examples
- license: MIT; concepts are informed by StitchAPI, but no Apache-licensed source is copied without
  an explicit provenance/license review

## Alternatives considered

### Adopt StitchAPI directly

Rejected for the first Bazario package. It is currently a release candidate with a much broader
product surface (HTTP, GraphQL, SSE, streams, downloads, LLM, shell, postMessage, CLI, serve, MCP,
OpenAPI, framework integrations). Its implementation demonstrates the concept well, but its runtime
and config complexity, current safety gaps identified above, and release-stage churn are not a fit
for a small Bazario foundational package. Reconsider adoption if it reaches stable and its guarantees
match this ADR; avoiding unnecessary local maintenance remains valuable.

### Keep a project-local fetch/axios wrapper

Rejected. It recreates the entropy this ADR exists to stop and has no independently versioned,
tested ownership boundary.

### Use only Zodios/ts-rest/a typed contract client

Useful for schema typing, but incomplete for the requested problem: auth refresh concurrency, retry
safety, throttle, total deadlines, drift, redacted observability, and principal-safe cache still need
another coordinated runtime. We use Standard Schema so consumers can bring those validators.

### Generate a client from OpenAPI

Preferred when a complete, accurate, maintained spec exists, but not sufficient for undocumented or
incrementally integrated APIs. Generated clients also do not inherently solve runtime drift,
credential lifecycle, or resilience interaction. A future OpenAPI adapter may generate endpoint
declarations instead of competing with them.

### Build a universal operation engine in v1

Rejected. HTTP, SSE, long-lived transports, LLM streams, shell commands, and MCP tools have
materially different cancellation, buffering, trust, and retry rules. A single broad engine would
front-load abstractions before Bazario has real call sites. v1 solves the concrete HTTP boundary and
leaves structural ports for later packages.

## Consequences

Positive:

- application code receives types backed by runtime guarantees, not assertions
- request normalization, auth, retry, timeout, throttle, cache, and observation have one tested
  ordering instead of per-endpoint reinvention
- refresh storms, unsafe write retries, cross-user cache entries, and credential-bearing logs fail
  closed by design
- typed contexts, origin boundaries, status-specific failures, declared response metadata, and codec
  ports cover real browser/SSR/service integrations without an interceptor escape hatch
- immutable plans, conformance-tested ports, and companion compilers allow the ecosystem to grow
  without making private pipeline state a compatibility obligation
- one endpoint can migrate at a time and still compose with existing transports and query tools
- zero runtime dependencies and structural ports match Bazario Labs package conventions

Tradeoffs:

- this is a substantial package even with an HTTP-only scope; the execution pipeline and race suite
  need a higher review bar than a thin fetch wrapper
- status-specific errors, codec registries, context propagation, resource ownership, and policy
  monotonicity increase type-level and construction-time complexity; that complexity must remain in
  the library and its tests rather than leak into ordinary endpoint declarations
- runtime schemas cost CPU and require consumers to author contracts; that cost buys the guarantee
- safe caching needs explicit version and identity metadata; the deliberate configuration is more
  verbose than an unsafe `cache: true`
- Standard Schema cannot expose a validator's AST, so drift detection is limited to observable
  raw-to-normalized differences and future MCP/OpenAPI export may need schema-specific adapters
- no v1 circuit breaker, universal stream surface, CLI, or agent tool; these remain separate,
  evidence-driven modules

## Next steps

1. Review and accept this ADR before scaffolding; choose final public names only at that checkpoint.
2. Add the package to the roadmap as a Layer 1 HTTP-operation module without changing the existing
   `realtime`/`rpc` boundaries.
3. Scaffold only the schema/type contracts, immutable plan compiler, config normalization, fetch
   adapter, JSON/query codecs, manual clock, and mock adapter.
4. Implement the pipeline vertically: one validated same-origin GET first, then typed
   status/metadata, context/origin enforcement, auth revision/single-flight, safe
   retry/idempotency/budget, timeout/cancellation, throttle, observer, drift, and cache in that order.
5. Keep each policy in a separate source module and test it through public endpoint behavior; the
   pipeline module coordinates but does not reimplement policy algorithms inline.
6. Add the exact race, time, cache-isolation, replay-safety, and privacy tests listed above before a
   `0.1.0` changeset.
7. Migrate one real endpoint beside the legacy API layer and use its findings to decide whether the
   public API is ready; do not batch a wider migration into the first PR.

## Summary

`@bazariodev/api` turns one HTTP endpoint declaration into a callable whose input, normalized
policies, success value, response metadata, and status-specific failures are backed by runtime
contracts. A client-owned immutable plan and fixed execution pipeline coordinate typed call context,
origin safety, named codecs, revision-aware auth/signing, idempotency-gated retries and retry
budgets, total/per-attempt deadlines, cancellation, proactive throttling, principal-safe caching,
drift detection, and payload-free observability. Stable capability ports and companion compilers let
the module grow without exposing reorderable middleware or a universal engine. It remains a library
over `fetch`/axios—not a server, workflow engine, query-state manager, or long-lived protocol
runtime—and can replace a legacy `api.ts` one endpoint at a time.
