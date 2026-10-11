/// <reference lib="esnext.disposable" />

type Unsubscribe = () => void;

export type JitterOptions = Readonly<{
  /** Inclusive integer bounds in [1, 2_147_483_647], minMs <= maxMs. */
  minMs: number;
  maxMs: number;
  /** Called without a receiver on each draw. Must return a finite number in [0, 1). */
  random?: () => number;
}>;
/** Draw integer durations uniformly. Owns no timers. Equal bounds skip randomness.
 * Construction validates bounds; each draw validates the random result. */
export declare function createJitter(options: JitterOptions): () => number;

export declare class Queue<Value> {
  readonly size: number;
  enqueue(value: Value): void;
  dequeue(): Value | undefined;
  peek(): Value | undefined;
  clear(): void;
}

export declare class SyncExecutor implements Disposable {
  enqueue(task: () => void): void;
  stop(): void;
  [Symbol.dispose](): void;
}

export declare class AsyncExecutor implements Disposable {
  enqueue<Result>(
    task: (signal: AbortSignal) => Result,
  ): Promise<Awaited<Result>>;
  enqueue<Result>(
    task: (signal: AbortSignal) => Result | PromiseLike<Result>,
  ): Promise<Awaited<Result>>;
  stop(): void;
  [Symbol.dispose](): void;
}

export type EmitterLogger = Readonly<{
  error(
    message: string,
    metadata: Readonly<{ type: string | symbol; error: unknown }>,
  ): void;
}>;

export type EmitterOptions = Readonly<{
  /** Must not throw. Defaults to a no-op logger. */
  logger?: EmitterLogger;
}>;

type EventKey<Events extends object> = keyof Events & (string | symbol);
type PayloadArguments<Payload> =
  | [payload: Payload]
  | ([Payload] extends [never]
      ? never
      : [Payload] extends [undefined]
        ? [payload?: Payload]
        : never);
type EmitArguments<Events extends object> = {
  [Type in EventKey<Events>]: [Type, ...PayloadArguments<Events[Type]>];
}[EventKey<Events>];

export declare class Emitter<Events extends object> implements Disposable {
  constructor(options?: EmitterOptions);
  on<Type extends EventKey<Events>>(
    type: Type,
    listener: (payload: Events[Type]) => void,
  ): Unsubscribe;
  emit(...args: EmitArguments<Events>): void;
  stop(): void;
  [Symbol.dispose](): void;
}

// Keep the public export explicit so declaration helpers above remain private.
export type { Unsubscribe };
