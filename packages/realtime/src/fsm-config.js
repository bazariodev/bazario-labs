export function createFsmConfig(logger) {
  const resetAttempt = () => ({ attempt: 0 });
  const incrementAttempt = (context) => ({ attempt: context.attempt + 1 });
  const reconnect = { target: 'connecting' };
  const disconnect = { target: 'idle', reducer: resetAttempt };
  const stop = { target: 'stopped', reducer: resetAttempt };

  return {
    name: 'RealtimeClient',
    initial: 'idle',
    context: { attempt: 0 },
    states: { idle: {}, connecting: {}, ready: {}, backoff: {}, stopped: {} },
    transitions: {
      idle: {
        CONNECT: { target: 'connecting' },
        RECONNECT: reconnect,
        STOP: stop,
      },
      connecting: {
        READY: { target: 'ready', reducer: resetAttempt },
        FAIL: { target: 'backoff', reducer: incrementAttempt },
        DISCONNECT: disconnect,
        RECONNECT: reconnect,
        STOP: stop,
      },
      ready: {
        FAIL: { target: 'backoff', reducer: incrementAttempt },
        DISCONNECT: disconnect,
        RECONNECT: reconnect,
        STOP: stop,
      },
      backoff: {
        RETRY: { target: 'connecting' },
        DISCONNECT: disconnect,
        RECONNECT: reconnect,
        STOP: stop,
      },
    },
    logger,
  };
}
