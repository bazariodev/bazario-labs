import Keepalive = require('@bazariodev/keepalive');

const options: Keepalive.KeepaliveOptions = {
  probe: async (signal) => {
    if (signal.aborted) return;
  },
  idleMs: 1000,
  deadlineMs: 500,
};
const keepalive = new Keepalive.Keepalive(options);
keepalive.start();
keepalive.activity();
keepalive.stop();
