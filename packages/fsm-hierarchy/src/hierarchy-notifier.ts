import type {
  FsmEvent,
  FsmSnapshot,
  Logger,
  Unsubscribe,
} from '@bazariodev/fsm';

import { MESSAGES } from './internal/messages.js';
import type { RuntimeNode } from './runtime-node.js';
import type { HierarchySnapshot, HierarchySubscriber } from './types.js';

export type NodeNotification<TEvent extends FsmEvent> = Readonly<{
  node: RuntimeNode<TEvent>;
  path: string;
  snapshot: FsmSnapshot<string, unknown>;
}>;

export class HierarchyNotifier {
  readonly #logger: Logger;
  readonly #hierarchySubscribers = new Set<HierarchySubscriber>();

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  subscribe(listener: HierarchySubscriber): Unsubscribe {
    this.#hierarchySubscribers.add(listener);
    return () => {
      this.#hierarchySubscribers.delete(listener);
    };
  }

  clear(): void {
    this.#hierarchySubscribers.clear();
  }

  notifyNodeSubscribers<TEvent extends FsmEvent>(
    notifications: Iterable<NodeNotification<TEvent>>,
  ): void {
    for (const { node, path, snapshot } of notifications) {
      const subscribers = [...node.subscribers];

      for (const subscriber of subscribers) {
        if (node.disposed) break;
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

  notifyHierarchySubscribers(snapshot: HierarchySnapshot): void {
    const subscribers = [...this.#hierarchySubscribers];

    for (const subscriber of subscribers) {
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
