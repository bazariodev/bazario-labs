import type { FsmCore, FsmEvent, Logger, Unsubscribe } from '@bazariodev/fsm';

import { ActiveSpine } from './active-spine.js';
import {
  childConfigFor,
  validateConfigTree as validateHierarchyConfigTree,
} from './config-validation.js';
import {
  HierarchyNotifier,
  type NodeNotification,
} from './hierarchy-notifier.js';
import { MESSAGES } from './internal/messages.js';
import { NOOP_LOGGER } from './internal/predicates.js';
import { NodeLifecycle, type RuntimeNode } from './runtime-node.js';
import type {
  AnyHierarchyConfig,
  FsmHierarchyOptions,
  HierarchySnapshot,
  HierarchySubscriber,
} from './types.js';

export class FsmHierarchy<TEvent extends FsmEvent> {
  readonly #logger: Logger;
  readonly #tree: ActiveSpine<TEvent>;
  readonly #lifecycle: NodeLifecycle<TEvent>;
  readonly #notifier: HierarchyNotifier;

  #stopped = false;
  #isReconciling = false;

  constructor(
    config: AnyHierarchyConfig<TEvent>,
    options: FsmHierarchyOptions<TEvent> = {},
  ) {
    this.#logger = options.logger ?? NOOP_LOGGER;
    this.#tree = new ActiveSpine<TEvent>();
    this.#notifier = new HierarchyNotifier(this.#logger);
    this.#lifecycle = new NodeLifecycle<TEvent>({
      logger: this.#logger,
      onNodeSpawned: options.onNodeSpawned,
      registerActiveNode: (node) => this.#tree.register(node),
      unregisterActiveNode: (node) => this.#tree.unregister(node),
      sendFrom: (node, event) => this.#sendFrom(node, event),
      canFrom: (node, event) => this.#canFrom(node, event),
    });

    validateHierarchyConfigTree(config);

    try {
      this.#runReconciliation(() => {
        this.#tree.setRoot(this.#lifecycle.spawn(null, null, config));
        this.#tree.refreshPaths();
        this.#reconcileFromRoot(new Set());
        if (this.#stopped) return;
        this.#tree.refreshPaths();
        this.#tree.rebuildSnapshot();
      });
    } catch (error) {
      if (this.#tree.hasRoot) this.#stopAfterFailure();
      throw error;
    }
  }

  get snapshot(): HierarchySnapshot {
    return this.#tree.snapshot;
  }

  send(event: TEvent): void {
    const leaf = this.#stopped ? null : this.#tree.activeLeaf();
    if (!leaf) return;
    this.#sendFrom(leaf, event);
  }

  can(event: TEvent): boolean {
    const leaf = this.#stopped ? null : this.#tree.activeLeaf();
    return leaf ? this.#canFrom(leaf, event) : false;
  }

  matches(path: string): boolean {
    return this.#tree.matches(path);
  }

  subscribe(listener: HierarchySubscriber): Unsubscribe {
    if (this.#stopped) return () => undefined;
    return this.#notifier.subscribe(listener);
  }

  nodeFor(path: string): FsmCore<string, TEvent, unknown> | undefined {
    return this.#tree.nodeFor(path);
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#lifecycle.dispose(this.#tree.root);
    this.#tree.clearRegistry();
    this.#notifier.clear();
  }

  [Symbol.dispose](): void {
    this.stop();
  }

  #sendFrom(start: RuntimeNode<TEvent>, event: TEvent): void {
    if (this.#stopped || start.disposed) return;
    if (this.#isReconciling) throw new Error(MESSAGES.sendWhileReconciling);

    for (
      let node: RuntimeNode<TEvent> | null = start;
      node;
      node = node.parent
    ) {
      if (node.disposed) continue;
      if (!node.machine.can(event)) continue;

      const beforeVersion = node.machine.snapshot.version;
      node.machine.send(event);

      if (this.#stopped || node.disposed) return;

      if (node.machine.snapshot.version !== beforeVersion) {
        this.#afterAcceptedTransition(node);
      }
      return;
    }

    this.#logger.debug(MESSAGES.eventRejected, {
      path: start.path,
      eventType: event.type,
    });
  }

  #canFrom(start: RuntimeNode<TEvent>, event: TEvent): boolean {
    if (this.#stopped || this.#isReconciling || start.disposed) return false;

    for (
      let node: RuntimeNode<TEvent> | null = start;
      node;
      node = node.parent
    ) {
      if (!node.disposed && node.machine.can(event)) {
        return true;
      }
    }

    return false;
  }

  #afterAcceptedTransition(changedNode: RuntimeNode<TEvent>): void {
    const affectedNodes = new Set<RuntimeNode<TEvent>>([changedNode]);
    let snapshotToNotify: HierarchySnapshot | null = null;
    let nodeNotifications: NodeNotification<TEvent>[] = [];

    try {
      this.#runReconciliation(() => {
        // Load-bearing: the accepted transition may change parent paths before
        // reconciliation spawns children and runs onNodeSpawned.
        this.#tree.refreshPaths();
        this.#reconcileFromRoot(affectedNodes);
        if (this.#stopped) return;
        this.#tree.refreshPaths();
        this.#tree.bumpTreeVersion();
        snapshotToNotify = this.#tree.rebuildSnapshot();
        nodeNotifications = this.#nodeNotificationsFor(affectedNodes);
      });
      if (this.#stopped || !snapshotToNotify) return;
      this.#notifier.notifyNodeSubscribers(nodeNotifications);
      this.#notifier.notifyHierarchySubscribers(snapshotToNotify);
    } catch (error) {
      this.#stopAfterFailure();
      throw error;
    }
  }

  #runReconciliation(work: () => void): void {
    const wasReconciling = this.#isReconciling;
    this.#isReconciling = true;
    try {
      work();
    } finally {
      this.#isReconciling = wasReconciling;
    }
  }

  #reconcileFromRoot(affectedNodes: Set<RuntimeNode<TEvent>>): void {
    this.#reconcileNode(this.#tree.root, affectedNodes);
  }

  #reconcileNode(
    node: RuntimeNode<TEvent>,
    affectedNodes: Set<RuntimeNode<TEvent>>,
  ): void {
    if (this.#stopped || node.disposed) return;

    const childConfig = childConfigFor(node.config, node.machine.state);

    if (!childConfig) {
      if (node.child) {
        this.#lifecycle.dispose(node.child);
        node.child = null;
      }
      return;
    }

    if (
      node.child &&
      !node.child.disposed &&
      node.child.ownerState === node.machine.state &&
      node.child.config === childConfig
    ) {
      this.#reconcileNode(node.child, affectedNodes);
      return;
    }

    if (node.child) {
      this.#lifecycle.dispose(node.child);
      node.child = null;
      if (this.#stopped || node.disposed) return;
    }

    const child = this.#lifecycle.spawn(node, node.machine.state, childConfig);
    if (this.#stopped || node.disposed) {
      this.#lifecycle.dispose(child);
      return;
    }

    node.child = child;
    affectedNodes.add(child);
    this.#reconcileNode(child, affectedNodes);
  }

  #nodeNotificationsFor(
    affectedNodes: ReadonlySet<RuntimeNode<TEvent>>,
  ): NodeNotification<TEvent>[] {
    return this.#tree
      .activeSpine()
      .filter((node) => affectedNodes.has(node))
      .map((node) => ({
        node,
        path: node.path,
        snapshot: node.machine.snapshot,
      }));
  }

  #stopAfterFailure(): void {
    this.#stopped = true;
    if (this.#tree.hasRoot) this.#lifecycle.dispose(this.#tree.root);
    this.#tree.clearRegistry();
    this.#notifier.clear();
  }
}
