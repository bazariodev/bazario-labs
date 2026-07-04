import type { FsmCore, FsmEvent } from '@bazariodev/fsm';

import { MESSAGES } from './internal/messages.js';
import type { RuntimeNode } from './runtime-node.js';
import type { HierarchyNodeSnapshot, HierarchySnapshot } from './types.js';

export class ActiveSpine<TEvent extends FsmEvent> {
  readonly #activeByPath = new Map<string, RuntimeNode<TEvent>>();

  #root: RuntimeNode<TEvent> | null = null;
  #snapshotRef: HierarchySnapshot | null = null;
  #treeVersion = 0;

  get hasRoot(): boolean {
    return this.#root !== null;
  }

  get root(): RuntimeNode<TEvent> {
    if (!this.#root) throw new Error(MESSAGES.rootNotInitialized);
    return this.#root;
  }

  get snapshot(): HierarchySnapshot {
    if (!this.#snapshotRef) {
      throw new Error(MESSAGES.snapshotNotInitialized);
    }
    return this.#snapshotRef;
  }

  setRoot(root: RuntimeNode<TEvent>): void {
    this.#root = root;
  }

  bumpTreeVersion(): void {
    this.#treeVersion += 1;
  }

  register(node: RuntimeNode<TEvent>): void {
    this.#activeByPath.set(node.path, node);
  }

  unregister(node: RuntimeNode<TEvent>): void {
    if (this.#activeByPath.get(node.path) === node) {
      this.#activeByPath.delete(node.path);
    }
  }

  clearRegistry(): void {
    this.#activeByPath.clear();
  }

  nodeFor(path: string): FsmCore<string, TEvent, unknown> | undefined {
    return this.#activeByPath.get(path)?.handle;
  }

  matches(path: string): boolean {
    const activePath = this.snapshot.path;
    return (
      path.length > 0 &&
      (activePath === path || activePath.startsWith(`${path}.`))
    );
  }

  refreshPaths(): void {
    this.#activeByPath.clear();

    let prefix = '';

    for (
      let node: RuntimeNode<TEvent> | null = this.root;
      node && !node.disposed;
      node = node.child
    ) {
      node.path = prefix
        ? `${prefix}.${node.machine.state}`
        : node.machine.state;
      node.lastSnapshot = node.machine.snapshot;
      this.#activeByPath.set(node.path, node);
      prefix = node.path;
    }
  }

  activeSpine(): RuntimeNode<TEvent>[] {
    const spine: RuntimeNode<TEvent>[] = [];

    for (
      let node: RuntimeNode<TEvent> | null = this.root;
      node && !node.disposed;
      node = node.child
    ) {
      spine.push(node);
    }

    return spine;
  }

  activeLeaf(): RuntimeNode<TEvent> | null {
    if (!this.#root) return null;

    let leaf: RuntimeNode<TEvent> | null = this.#root;
    while (leaf?.child && !leaf.child.disposed) leaf = leaf.child;

    return leaf && !leaf.disposed ? leaf : null;
  }

  rebuildSnapshot(): HierarchySnapshot {
    const root = this.#buildNodeSnapshot(this.root);
    this.#snapshotRef = Object.freeze({
      treeVersion: this.#treeVersion,
      path: this.#activeLeafPath(root),
      root,
    });
    return this.#snapshotRef;
  }

  #buildNodeSnapshot(node: RuntimeNode<TEvent>): HierarchyNodeSnapshot {
    const snapshot = node.disposed ? node.lastSnapshot : node.machine.snapshot;
    return Object.freeze({
      value: snapshot.value,
      context: snapshot.context,
      version: snapshot.version,
      path: node.path,
      child: node.child ? this.#buildNodeSnapshot(node.child) : null,
    });
  }

  #activeLeafPath(snapshot: HierarchyNodeSnapshot): string {
    let current = snapshot;
    while (current.child) current = current.child;
    return current.path;
  }
}
