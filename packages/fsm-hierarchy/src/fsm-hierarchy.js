import { Fsm } from '@bazariodev/fsm';

import { MESSAGES } from './internal/messages.js';
import { childConfigFor, validateConfigTree } from './internal/validation.js';

const NOOP_LOGGER = { debug() {}, warn() {}, error() {} };

/**
 * A tree of ordinary Fsm nodes. The active spine runs from the root through
 * each node's child for its current state. Events route deepest-first and bubble
 * up; after a node commits, the spine is reconciled, then subscribers are notified.
 */
export class FsmHierarchy {
  #logger;
  #onNodeSpawned;
  #subscribers = new Set();
  #activeByPath = new Map();
  #root = null;
  #snapshot = null;
  #treeVersion = 0;
  #publishedTreeVersion = -1;
  #stopped = false;
  #reconciling = false;

  constructor(config, options = {}) {
    this.#logger = options.logger ?? NOOP_LOGGER;
    this.#onNodeSpawned = options.onNodeSpawned;
    validateConfigTree(config);

    try {
      this.#reconcile(() => {
        this.#root = this.#spawn(null, null, config);
        this.#refreshPaths();
        this.#reconcileNode(this.#root, new Set());
        if (this.#stopped) return;
        this.#refreshPaths();
        this.#rebuildSnapshot();
      });
    } catch (error) {
      this.#teardown();
      throw error;
    }
  }

  get snapshot() {
    return this.#snapshot;
  }

  send(event) {
    const leaf = this.#activeLeaf();
    if (leaf) this.#sendFrom(leaf, event);
  }

  can(event) {
    const leaf = this.#activeLeaf();
    return leaf ? this.#canFrom(leaf, event) : false;
  }

  /** Segment-aware: `matches('a')` is true for `a` and `a.b`, never for `ab`. */
  matches(path) {
    const active = this.#snapshot.path;
    return (
      path.length > 0 && (active === path || active.startsWith(`${path}.`))
    );
  }

  subscribe(listener) {
    if (this.#stopped) return () => undefined;
    this.#subscribers.add(listener);
    return () => {
      this.#subscribers.delete(listener);
    };
  }

  nodeFor(path) {
    return this.#activeByPath.get(path)?.handle;
  }

  stop() {
    if (!this.#stopped) this.#teardown();
  }

  [Symbol.dispose]() {
    this.stop();
  }

  // Routing

  #sendFrom(start, event) {
    if (this.#stopped || start.disposed) return;
    if (this.#reconciling) throw new Error(MESSAGES.sendWhileReconciling);

    for (let node = start; node; node = node.parent) {
      if (node.disposed || !node.machine.can(event)) continue;

      const version = node.machine.snapshot.version;
      node.machine.send(event);
      if (this.#stopped || node.disposed) return;
      if (node.machine.snapshot.version !== version) this.#afterCommit(node);
      return;
    }

    this.#logger.debug(MESSAGES.eventRejected, {
      path: start.path,
      eventType: event.type,
    });
  }

  #canFrom(start, event) {
    if (this.#stopped || this.#reconciling || start.disposed) return false;
    for (let node = start; node; node = node.parent) {
      if (!node.disposed && node.machine.can(event)) return true;
    }
    return false;
  }

  // Reconciliation

  #afterCommit(changed) {
    const affected = new Set([changed]);
    let snapshot = null;
    let notifications = [];

    try {
      this.#reconcile(() => {
        // Load-bearing: the commit may change parent paths before reconciliation
        // spawns children and runs onNodeSpawned.
        this.#refreshPaths();
        this.#reconcileNode(this.#root, affected);
        if (this.#stopped) return;
        this.#refreshPaths();
        this.#treeVersion += 1;
        snapshot = this.#rebuildSnapshot();
        notifications = this.#spine()
          .filter((node) => affected.has(node))
          .map((node) => ({
            node,
            path: node.path,
            snapshot: node.machine.snapshot,
          }));
      });
      if (this.#stopped || !snapshot) return;
      this.#notifyNodes(notifications);
      this.#notifyHierarchy(snapshot);
    } catch (error) {
      this.#teardown();
      throw error;
    }
  }

  // Sends are rejected while this runs, so reconciliation never nests.
  #reconcile(work) {
    this.#reconciling = true;
    try {
      work();
    } finally {
      this.#reconciling = false;
    }
  }

  // Make the subtree under `node` match the committed states: keep a matching
  // child, otherwise dispose it and spawn the declared child for the new state.
  #reconcileNode(node, affected) {
    if (this.#stopped || node.disposed) return;

    const state = node.machine.state;
    const childConfig = childConfigFor(node.config, state);
    const current = node.child;

    if (
      current &&
      !current.disposed &&
      current.ownerState === state &&
      current.config === childConfig
    ) {
      this.#reconcileNode(current, affected);
      return;
    }

    if (current) {
      this.#dispose(current);
      node.child = null;
      if (this.#stopped || node.disposed) return;
    }
    if (!childConfig) return;

    const child = this.#spawn(node, state, childConfig);
    if (this.#stopped || node.disposed) {
      this.#dispose(child);
      return;
    }
    node.child = child;
    affected.add(child);
    this.#reconcileNode(child, affected);
  }

  #refreshPaths() {
    this.#activeByPath.clear();
    let prefix = '';
    for (const node of this.#spine()) {
      node.path = prefix
        ? `${prefix}.${node.machine.state}`
        : node.machine.state;
      this.#activeByPath.set(node.path, node);
      prefix = node.path;
    }
  }

  // Nodes

  #spawn(parent, ownerState, config) {
    const path = parent ? `${parent.path}.${config.initial}` : config.initial;

    let machine;
    try {
      machine = new Fsm({ ...config, logger: config.logger ?? this.#logger });
    } catch (error) {
      this.#logger.error(MESSAGES.nodeConstructionFailed, {
        path,
        name: config.name,
        error,
      });
      throw error;
    }

    const node = {
      config,
      ownerState,
      parent,
      machine,
      handle: null,
      subscribers: new Set(),
      child: null,
      cleanup: null,
      path,
      lastSnapshot: machine.snapshot,
      publishedVersion: -1,
      disposed: false,
    };
    node.handle = this.#createHandle(node);
    // Registered before onNodeSpawned so the callback can look the node up.
    this.#activeByPath.set(path, node);

    try {
      const cleanup = this.#onNodeSpawned?.({ path, handle: node.handle });
      if (cleanup) node.cleanup = cleanup;
    } catch (error) {
      // An attachment failure; the node itself is healthy and stays active.
      this.#logger.error(MESSAGES.nodeSpawnCallbackFailed, { path, error });
    }
    return node;
  }

  // Deepest-first, so descendants are gone before their ancestors' cleanups run.
  #dispose(node) {
    if (node.disposed) return;
    if (node.child) {
      this.#dispose(node.child);
      node.child = null;
    }

    node.lastSnapshot = node.machine.snapshot;
    node.disposed = true;
    node.subscribers.clear();
    if (this.#activeByPath.get(node.path) === node) {
      this.#activeByPath.delete(node.path);
    }

    const { cleanup } = node;
    node.cleanup = null;
    try {
      cleanup?.();
    } catch (error) {
      this.#logger.error(MESSAGES.nodeCleanupFailed, {
        path: node.path,
        error,
      });
    }
  }

  // An FsmCore view of one node. Sends route through the hierarchy; after
  // disposal the handle is inert and keeps reporting its last snapshot.
  #createHandle(node) {
    return {
      get name() {
        return node.machine.name;
      },
      get snapshot() {
        return node.disposed ? node.lastSnapshot : node.machine.snapshot;
      },
      get state() {
        return this.snapshot.value;
      },
      get context() {
        return this.snapshot.context;
      },
      send: (event) => this.#sendFrom(node, event),
      can: (event) => this.#canFrom(node, event),
      subscribe: (listener) => {
        if (node.disposed) return () => undefined;
        node.subscribers.add(listener);
        return () => {
          node.subscribers.delete(listener);
        };
      },
    };
  }

  #teardown() {
    this.#stopped = true;
    if (this.#root) this.#dispose(this.#root);
    this.#activeByPath.clear();
    this.#subscribers.clear();
  }

  // Snapshot and notification

  #spine() {
    const spine = [];
    for (let node = this.#root; node && !node.disposed; node = node.child) {
      spine.push(node);
    }
    return spine;
  }

  #activeLeaf() {
    return this.#stopped ? null : (this.#spine().at(-1) ?? null);
  }

  #rebuildSnapshot() {
    const root = buildNodeSnapshot(this.#root);
    let leaf = root;
    while (leaf.child) leaf = leaf.child;
    this.#snapshot = Object.freeze({
      treeVersion: this.#treeVersion,
      path: leaf.path,
      root,
    });
    return this.#snapshot;
  }

  // Same rule as core Fsm, per source: a subscriber that sends again triggers a
  // nested, synchronous publish of newer snapshots, and the outer pass then skips
  // anything older, so no source ever delivers an older snapshot after a newer one.
  // A node affected only by the outer commit is still delivered.
  #notifyNodes(notifications) {
    for (const { node, path, snapshot } of notifications) {
      if (snapshot.version < node.publishedVersion) continue;
      node.publishedVersion = snapshot.version;
      for (const subscriber of [...node.subscribers]) {
        if (node.disposed || node.publishedVersion !== snapshot.version) break;
        try {
          subscriber(snapshot);
        } catch (error) {
          this.#logger.error(MESSAGES.nodeSubscriberFailed, {
            path,
            version: snapshot.version,
            error,
          });
        }
      }
    }
  }

  #notifyHierarchy(snapshot) {
    if (snapshot.treeVersion < this.#publishedTreeVersion) return;
    this.#publishedTreeVersion = snapshot.treeVersion;
    for (const subscriber of [...this.#subscribers]) {
      if (this.#publishedTreeVersion !== snapshot.treeVersion) return;
      try {
        subscriber(snapshot);
      } catch (error) {
        this.#logger.error(MESSAGES.subscriberFailed, {
          treeVersion: snapshot.treeVersion,
          path: snapshot.path,
          error,
        });
      }
    }
  }
}

function buildNodeSnapshot(node) {
  const { value, context, version } = node.disposed
    ? node.lastSnapshot
    : node.machine.snapshot;
  return Object.freeze({
    value,
    context,
    version,
    path: node.path,
    child: node.child ? buildNodeSnapshot(node.child) : null,
  });
}
