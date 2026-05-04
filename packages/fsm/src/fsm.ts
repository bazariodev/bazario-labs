import type {
  FsmConfig,
  FsmCore,
  FsmEvent,
  FsmSnapshot,
  FsmSubscriber,
  Logger,
  StateDefinition,
  TransitionDefinition,
  TransitionMap,
  Unsubscribe,
} from './types.js';

const WILDCARD_STATE: '*' = '*';

const NOOP_LOGGER: Logger = {
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const hasOwn = <TObject extends object>(
  object: TObject,
  key: PropertyKey,
): key is keyof TObject => Object.hasOwn(object, key);

type TransitionSource<TState extends string> = TState | typeof WILDCARD_STATE;

type TransitionBucket<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Partial<
  Record<
    TEvent['type'],
    ReadonlyArray<TransitionDefinition<TState, TEvent, TContext>>
  >
>;

type NormalizedTransitionMap<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Partial<
  Record<TransitionSource<TState>, TransitionBucket<TState, TEvent, TContext>>
>;

export class Fsm<TState extends string, TEvent extends FsmEvent, TContext>
  implements FsmCore<TState, TEvent, TContext>
{
  readonly name: string;

  readonly #logger: Logger;
  readonly #states: Record<TState, StateDefinition<TState, TEvent, TContext>>;
  readonly #transitions: NormalizedTransitionMap<TState, TEvent, TContext>;
  readonly #subscribers = new Set<FsmSubscriber<TState, TContext>>();

  #snapshotRef: FsmSnapshot<TState, TContext>;
  #isTransitionLocked = false;

  constructor(config: FsmConfig<TState, TEvent, TContext>) {
    this.name = config.name;
    this.#logger = config.logger ?? NOOP_LOGGER;

    const normalizedTransitions = this.#normalizeTransitions(
      config.transitions,
    );

    this.#validateConfig(config, normalizedTransitions);

    this.#states = config.states;
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

    this.#throwRuntimeError(
      `Fsm.send is not implemented yet for event "${event.type}".`,
      {
        name: this.name,
        state: this.state,
        eventType: event.type,
      },
    );
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
    const definition = this.#states[this.state];

    if (!definition.onEnter) return;

    try {
      definition.onEnter({
        from: null,
        to: this.state,
        event: null,
        context: this.context,
      });
    } catch (error) {
      this.#logAndRethrow(error, 'fsm: initial enter hook failed', {
        name: this.name,
        state: this.state,
      });
    }
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
    return (
      this.#transitions[state]?.[eventType] ||
      this.#transitions[WILDCARD_STATE]?.[eventType]
    );
  }

  #normalizeTransitions(
    transitions: TransitionMap<TState, TEvent, TContext>,
  ): NormalizedTransitionMap<TState, TEvent, TContext> {
    const normalized: NormalizedTransitionMap<TState, TEvent, TContext> = {};

    for (const source in transitions) {
      if (!hasOwn(transitions, source)) continue;

      const eventMap = transitions[source];
      const bucket: TransitionBucket<TState, TEvent, TContext> = {};

      for (const eventType in eventMap) {
        if (!hasOwn(eventMap, eventType) || !eventMap[eventType]) continue;

        const entry = eventMap[eventType];

        bucket[eventType] = Array.isArray(entry) ? [...entry] : [entry];
      }

      normalized[source] = bucket;
    }

    return normalized;
  }

  #validateConfig(
    config: FsmConfig<TState, TEvent, TContext>,
    transitions: NormalizedTransitionMap<TState, TEvent, TContext>,
  ): void {
    if (!config.name.trim()) throw new Error('fsm: name must not be empty');

    if (!(config.initial in config.states)) {
      throw new Error(
        `fsm: initial state "${config.initial}" must exist in states`,
      );
    }

    if (WILDCARD_STATE in config.states) {
      throw new Error(
        'fsm: "*" is reserved and cannot be used as a state name',
      );
    }

    for (const source in transitions) {
      if (!hasOwn(transitions, source)) continue;

      const eventMap = transitions[source];
      if (eventMap === undefined) continue;

      if (source !== WILDCARD_STATE && !(source in config.states)) {
        throw new Error(
          `fsm: transition source state "${source}" must exist in states`,
        );
      }

      for (const eventType in eventMap) {
        if (!hasOwn(eventMap, eventType)) continue;

        const definitions = eventMap[eventType];
        if (!definitions) continue;

        for (const definition of definitions) {
          if (definition.target === WILDCARD_STATE) {
            throw new Error('fsm: "*" cannot be used as a transition target');
          }

          if (!(definition.target in config.states)) {
            throw new Error(
              `fsm: transition target "${definition.target}" must exist in states`,
            );
          }
        }
      }
    }
  }

  #logAndRethrow(error: unknown, message: string, meta?: unknown): never {
    this.#logger.error(
      message,
      meta === undefined ? { error } : { meta, error },
    );
    throw error;
  }

  #throwRuntimeError(message: string, meta?: unknown): never {
    this.#logger.error(message, meta);
    throw new Error(message);
  }
}
