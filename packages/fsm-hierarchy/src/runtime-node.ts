import {
  Fsm,
  type FsmConfig,
  type FsmCore,
  type FsmEvent,
  type FsmSnapshot,
  type FsmSubscriber,
  type Logger,
} from '@bazariodev/fsm';

import { MESSAGES } from './internal/messages.js';
import type {
  AnyHierarchyConfig,
  FsmHierarchyOptions,
  HierarchyNodeCleanup,
} from './types.js';

export type RuntimeNode<TEvent extends FsmEvent> = {
  readonly config: AnyHierarchyConfig<TEvent>;
  readonly ownerState: string | null;
  readonly parent: RuntimeNode<TEvent> | null;
  readonly machine: Fsm<string, TEvent, unknown>;
  readonly handle: FsmCore<string, TEvent, unknown>;
  readonly subscribers: Set<FsmSubscriber<string, unknown>>;
  child: RuntimeNode<TEvent> | null;
  cleanup: HierarchyNodeCleanup | null;
  path: string;
  lastSnapshot: FsmSnapshot<string, unknown>;
  disposed: boolean;
};

type NodeLifecycleDeps<TEvent extends FsmEvent> = Readonly<{
  logger: Logger;
  onNodeSpawned?: FsmHierarchyOptions<TEvent>['onNodeSpawned'];
  registerActiveNode: (node: RuntimeNode<TEvent>) => void;
  unregisterActiveNode: (node: RuntimeNode<TEvent>) => void;
  sendFrom: (node: RuntimeNode<TEvent>, event: TEvent) => void;
  canFrom: (node: RuntimeNode<TEvent>, event: TEvent) => boolean;
}>;

export class NodeLifecycle<TEvent extends FsmEvent> {
  readonly #logger: Logger;
  readonly #onNodeSpawned?: FsmHierarchyOptions<TEvent>['onNodeSpawned'];
  readonly #registerActiveNode: (node: RuntimeNode<TEvent>) => void;
  readonly #unregisterActiveNode: (node: RuntimeNode<TEvent>) => void;
  readonly #sendFrom: (node: RuntimeNode<TEvent>, event: TEvent) => void;
  readonly #canFrom: (node: RuntimeNode<TEvent>, event: TEvent) => boolean;

  constructor(deps: NodeLifecycleDeps<TEvent>) {
    this.#logger = deps.logger;
    this.#onNodeSpawned = deps.onNodeSpawned;
    this.#registerActiveNode = deps.registerActiveNode;
    this.#unregisterActiveNode = deps.unregisterActiveNode;
    this.#sendFrom = deps.sendFrom;
    this.#canFrom = deps.canFrom;
  }

  spawn(
    parent: RuntimeNode<TEvent> | null,
    ownerState: string | null,
    config: AnyHierarchyConfig<TEvent>,
  ): RuntimeNode<TEvent> {
    const parentPath = parent?.path;
    const path = parentPath
      ? `${parentPath}.${config.initial}`
      : config.initial;
    const machineConfig = this.#toFsmConfig(config);

    let machine: Fsm<string, TEvent, unknown>;
    try {
      machine = new Fsm<string, TEvent, unknown>(machineConfig);
    } catch (error) {
      this.#logger.error(MESSAGES.nodeConstructionFailed, {
        path,
        name: config.name,
        error,
      });
      throw error;
    }

    let node!: RuntimeNode<TEvent>;
    const handle = this.#createHandle(() => node);

    node = {
      config,
      ownerState,
      parent,
      machine,
      handle,
      subscribers: new Set(),
      child: null,
      cleanup: null,
      path,
      lastSnapshot: machine.snapshot,
      disposed: false,
    };

    this.#registerActiveNode(node);

    try {
      const cleanup = this.#onNodeSpawned?.({
        path,
        handle,
      });
      if (cleanup) node.cleanup = cleanup;
    } catch (error) {
      this.#logger.error(MESSAGES.nodeSpawnCallbackFailed, {
        path,
        error,
      });
    }

    return node;
  }

  dispose(node: RuntimeNode<TEvent>): void {
    if (node.disposed) return;

    if (node.child) {
      this.dispose(node.child);
      node.child = null;
    }

    node.lastSnapshot = node.machine.snapshot;
    node.disposed = true;
    node.subscribers.clear();
    this.#unregisterActiveNode(node);

    const cleanup = node.cleanup;
    node.cleanup = null;
    if (!cleanup) return;

    try {
      cleanup();
    } catch (error) {
      this.#logger.error(MESSAGES.nodeCleanupFailed, {
        path: node.path,
        error,
      });
    }
  }

  #createHandle(
    getNode: () => RuntimeNode<TEvent>,
  ): FsmCore<string, TEvent, unknown> {
    return {
      get name(): string {
        return getNode().machine.name;
      },
      get snapshot(): FsmSnapshot<string, unknown> {
        const node = getNode();
        return node.disposed ? node.lastSnapshot : node.machine.snapshot;
      },
      get state(): string {
        return this.snapshot.value;
      },
      get context(): Readonly<unknown> {
        return this.snapshot.context;
      },
      send: (event: TEvent) => this.#sendFrom(getNode(), event),
      can: (event: TEvent) => this.#canFrom(getNode(), event),
      subscribe: (listener: FsmSubscriber<string, unknown>) => {
        const node = getNode();
        if (node.disposed) return () => undefined;

        node.subscribers.add(listener);
        return () => {
          node.subscribers.delete(listener);
        };
      },
    };
  }

  #toFsmConfig(
    config: AnyHierarchyConfig<TEvent>,
  ): FsmConfig<string, TEvent, unknown> {
    return {
      name: config.name,
      initial: config.initial,
      context: config.context,
      states: config.states as FsmConfig<string, TEvent, unknown>['states'],
      transitions: config.transitions as FsmConfig<
        string,
        TEvent,
        unknown
      >['transitions'],
      onTransitionStart: config.onTransitionStart as FsmConfig<
        string,
        TEvent,
        unknown
      >['onTransitionStart'],
      onTransitionBeforeCommit: config.onTransitionBeforeCommit as FsmConfig<
        string,
        TEvent,
        unknown
      >['onTransitionBeforeCommit'],
      logger: config.logger ?? this.#logger,
    };
  }
}
