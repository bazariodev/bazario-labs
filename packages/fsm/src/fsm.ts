import { hasOwn, NOOP_LOGGER, WILDCARD_STATE } from './internal/predicates.js';
import {
  type NormalizedStateMap,
  type NormalizedTransitionMap,
  normalizeStates,
  normalizeTransitions,
  validateConfig,
} from './internal/validation.js';
import type {
  FsmConfig,
  FsmCore,
  FsmEvent,
  FsmSnapshot,
  FsmSubscriber,
  Logger,
  TransitionDefinition,
  Unsubscribe,
} from './types.js';

export class Fsm<TState extends string, TEvent extends FsmEvent, TContext>
  implements FsmCore<TState, TEvent, TContext>
{
  readonly name: string;

  readonly #logger: Logger;
  readonly #states: NormalizedStateMap<TState, TEvent, TContext>;
  readonly #transitions: NormalizedTransitionMap<TState, TEvent, TContext>;
  readonly #onTransitionStart?: FsmConfig<
    TState,
    TEvent,
    TContext
  >['onTransitionStart'];
  readonly #onTransitionBeforeCommit?: FsmConfig<
    TState,
    TEvent,
    TContext
  >['onTransitionBeforeCommit'];
  readonly #subscribers = new Set<FsmSubscriber<TState, TContext>>();

  #snapshotRef: FsmSnapshot<TState, TContext>;
  #isTransitionLocked = false;

  constructor(config: FsmConfig<TState, TEvent, TContext>) {
    this.name = config.name;
    this.#logger = config.logger ?? NOOP_LOGGER;
    this.#onTransitionStart = config.onTransitionStart;
    this.#onTransitionBeforeCommit = config.onTransitionBeforeCommit;

    const normalizedStates = normalizeStates<TState, TEvent, TContext>(
      config.states,
    );
    const normalizedTransitions = normalizeTransitions(config.transitions);

    validateConfig(config, normalizedStates, normalizedTransitions);

    this.#states = normalizedStates;
    this.#transitions = normalizedTransitions;
    this.#snapshotRef = this.#freezeSnapshot({
      value: config.initial,
      previousValue: null,
      context: config.context,
      version: 0,
    });

    this.#invokeInitialEnter();

    this.#logger.debug('fsm: initialized', {
      name: this.name,
      initial: config.initial,
    });
  }

  get snapshot(): FsmSnapshot<TState, TContext> {
    return this.#snapshotRef;
  }

  get state(): TState {
    return this.#snapshotRef.value;
  }

  get context(): Readonly<TContext> {
    return this.#snapshotRef.context;
  }

  send(event: TEvent): void {
    if (this.#isTransitionLocked) {
      this.#throwRuntimeError(
        'fsm: cannot call send() while a transition is in progress',
        {
          name: this.name,
          state: this.state,
          eventType: event.type,
        },
      );
    }

    this.#isTransitionLocked = true;

    let snapshotToNotify: FsmSnapshot<TState, TContext> | null = null;

    try {
      const currentSnapshot = this.#snapshotRef;
      const from = currentSnapshot.value;
      const previousContext = currentSnapshot.context;
      const transitions = this.#resolveTransitions(from, event.type);
      const transition =
        transitions &&
        this.#findAcceptingTransition(transitions, previousContext, event);

      if (!transition) {
        this.#logger.debug('fsm: transition rejected', {
          name: this.name,
          state: from,
          eventType: event.type,
        });
        return;
      }

      const to = transition.target;
      const isStateChange = to !== from;

      this.#invokeHook(
        this.#onTransitionStart,
        { from, to, event, context: previousContext },
        'fsm: transition start hook failed',
        { name: this.name, from, to, eventType: event.type },
      );

      if (isStateChange) {
        this.#invokeHook(
          this.#states[from].onLeave,
          { from, to, event, context: previousContext },
          'fsm: state leave hook failed',
          { name: this.name, from, to, eventType: event.type },
        );
      }

      const nextContext = this.#applyContextReducer(
        transition,
        previousContext,
        event,
      );

      const nextSnapshot = this.#freezeSnapshot({
        value: to,
        previousValue: from,
        context: nextContext,
        version: currentSnapshot.version + 1,
      });

      if (isStateChange) {
        this.#invokeHook(
          this.#states[to].onEnter,
          { from, to, event, context: nextSnapshot.context },
          'fsm: state enter hook failed',
          { name: this.name, from, to, eventType: event.type },
        );
      }

      this.#invokeHook(
        this.#onTransitionBeforeCommit,
        {
          from,
          to,
          event,
          previousContext,
          nextContext: nextSnapshot.context,
        },
        'fsm: transition before commit hook failed',
        { name: this.name, from, to, eventType: event.type },
      );

      this.#snapshotRef = nextSnapshot;
      snapshotToNotify = nextSnapshot;
    } finally {
      this.#isTransitionLocked = false;
    }

    if (snapshotToNotify) this.#notifySubscribers(snapshotToNotify);
  }

  can(event: TEvent): boolean {
    const transitions = this.#resolveTransitions(this.state, event.type);
    return !!(
      transitions &&
      this.#findAcceptingTransition(transitions, this.context, event)
    );
  }

  subscribe(listener: FsmSubscriber<TState, TContext>): Unsubscribe {
    this.#subscribers.add(listener);

    return () => this.#subscribers.delete(listener);
  }

  #invokeHook<TPayload>(
    hook: ((payload: TPayload) => void) | undefined,
    payload: TPayload,
    errorMessage: string,
    errorMeta: Record<string, unknown>,
  ): void {
    if (!hook) return;

    try {
      hook(payload);
    } catch (error) {
      this.#logAndRethrow(error, errorMessage, errorMeta);
    }
  }

  #applyContextReducer(
    transition: TransitionDefinition<TState, TEvent, TContext>,
    context: Readonly<TContext>,
    event: TEvent,
  ): Readonly<TContext> {
    if (!transition.reducer) return context;

    try {
      return transition.reducer(context, event);
    } catch (error) {
      this.#logAndRethrow(error, 'fsm: context reducer failed', {
        name: this.name,
        state: this.state,
        eventType: event.type,
        target: transition.target,
      });
    }
  }

  #notifySubscribers(snapshot: FsmSnapshot<TState, TContext>): void {
    const subscribers = [...this.#subscribers];

    for (const subscriber of subscribers) {
      try {
        subscriber(snapshot);
      } catch (error) {
        this.#logger.error('fsm: subscriber notification failed', {
          name: this.name,
          state: snapshot.value,
          version: snapshot.version,
          error,
        });
      }
    }
  }

  #findAcceptingTransition(
    transitions: ReadonlyArray<TransitionDefinition<TState, TEvent, TContext>>,
    context: Readonly<TContext>,
    event: TEvent,
  ): TransitionDefinition<TState, TEvent, TContext> | null {
    for (const transition of transitions) {
      try {
        if (!transition.guard || transition.guard(context, event))
          return transition;
      } catch (error) {
        this.#logAndRethrow(error, 'fsm: guard evaluation failed', {
          name: this.name,
          state: this.state,
          eventType: event.type,
          target: transition.target,
        });
      }
    }

    return null;
  }

  #invokeInitialEnter(): void {
    this.#invokeHook(
      this.#states[this.state].onEnter,
      { from: null, to: this.state, event: null, context: this.context },
      'fsm: initial enter hook failed',
      { name: this.name, state: this.state },
    );
  }

  #freezeSnapshot(
    snapshot: FsmSnapshot<TState, TContext>,
  ): FsmSnapshot<TState, TContext> {
    return Object.freeze({ ...snapshot });
  }

  #resolveTransitions(
    state: TState,
    eventType: TEvent['type'],
  ): ReadonlyArray<TransitionDefinition<TState, TEvent, TContext>> | undefined {
    const stateTransitions = this.#transitions[state];

    if (stateTransitions && hasOwn(stateTransitions, eventType))
      return stateTransitions[eventType];

    const wildcardTransitions = this.#transitions[WILDCARD_STATE];

    if (wildcardTransitions && hasOwn(wildcardTransitions, eventType))
      return wildcardTransitions[eventType];

    return;
  }

  #logAndRethrow(
    error: unknown,
    message: string,
    meta: Record<string, unknown>,
  ): never {
    this.#logger.error(message, { ...meta, error });
    throw error;
  }

  #throwRuntimeError(message: string, meta: Record<string, unknown>): never {
    this.#logger.error(message, meta);
    throw new Error(message);
  }
}
