import { MESSAGES } from './internal/messages.js';
import { NOOP_LOGGER, WILDCARD_STATE } from './internal/predicates.js';
import { compileConfig } from './internal/validation.js';

export class Fsm {
  name;

  #logger;
  #states;
  #transitions;
  #onTransitionStart;
  #onTransitionBeforeCommit;
  #subscribers = new Set();

  #snapshot;
  #sending = false;

  constructor(config) {
    const { states, transitions } = compileConfig(config);
    this.name = config.name;
    this.#logger = config.logger ?? NOOP_LOGGER;
    this.#states = states;
    this.#transitions = transitions;
    this.#onTransitionStart = config.onTransitionStart;
    this.#onTransitionBeforeCommit = config.onTransitionBeforeCommit;
    this.#snapshot = Object.freeze({
      value: config.initial,
      previousValue: null,
      context: config.context,
      version: 0,
    });

    states.get(config.initial)?.onEnter?.({
      from: null,
      to: config.initial,
      event: null,
      context: config.context,
    });
  }

  get snapshot() {
    return this.#snapshot;
  }

  get state() {
    return this.#snapshot.value;
  }

  get context() {
    return this.#snapshot.context;
  }

  send(event) {
    if (this.#sending) throw new Error(MESSAGES.sendWhileLocked);

    this.#sending = true;
    let next;
    try {
      next = this.#transition(event);
    } finally {
      this.#sending = false;
    }

    if (next) this.#notify(next);
  }

  can(event) {
    return !!this.#select(this.#snapshot, event);
  }

  subscribe(listener) {
    this.#subscribers.add(listener);
    return () => this.#subscribers.delete(listener);
  }

  #select({ value, context }, event) {
    // A state's own entry wins even when every guard fails; no wildcard fallback.
    const candidates =
      this.#transitions.get(value)?.get(event.type) ??
      this.#transitions.get(WILDCARD_STATE)?.get(event.type);
    return candidates?.find((t) => !t.guard || t.guard(context, event));
  }

  #transition(event) {
    const current = this.#snapshot;
    const transition = this.#select(current, event);
    if (!transition) {
      this.#logger.debug(MESSAGES.transitionRejected, {
        name: this.name,
        state: current.value,
        eventType: event.type,
      });
      return null;
    }

    const { value: from, context } = current;
    const to = transition.target;
    const changesState = to !== from;
    const payload = { from, to, event, context };

    this.#onTransitionStart?.(payload);
    if (changesState) this.#states.get(from)?.onLeave?.(payload);

    const next = Object.freeze({
      value: to,
      previousValue: from,
      context: transition.reducer
        ? transition.reducer(context, event)
        : context,
      version: current.version + 1,
    });

    if (changesState) {
      this.#states.get(to)?.onEnter?.({ ...payload, context: next.context });
    }
    this.#onTransitionBeforeCommit?.({
      from,
      to,
      event,
      previousContext: context,
      nextContext: next.context,
    });

    this.#snapshot = next;
    return next;
  }

  #notify(snapshot) {
    for (const subscriber of [...this.#subscribers]) {
      // A nested send() already delivered a newer snapshot to every subscriber.
      if (this.#snapshot !== snapshot) return;
      try {
        subscriber(snapshot);
      } catch (error) {
        this.#logger.error(MESSAGES.subscriberNotificationFailed, {
          name: this.name,
          state: snapshot.value,
          version: snapshot.version,
          error,
        });
      }
    }
  }
}
