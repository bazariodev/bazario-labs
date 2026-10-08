import { AsyncExecutor } from '../index.js';

const executor = new AsyncExecutor();
let observed;

process.once('unhandledRejection', (reason) => {
  observed = reason;
});

switch (process.argv[2]) {
  case 'failure':
    executor.enqueue(() => {
      throw new Error('unhandled task');
    });
    break;
  case 'pending':
    executor.enqueue(() => 'discarded');
    executor.stop();
    break;
  case 'post-stop':
    executor.stop();
    executor.enqueue(() => 'rejected');
    break;
  default:
    throw new Error('Unknown test scenario');
}

setTimeout(() => {
  if (observed) {
    console.log(`unhandled:${observed.name}`);
  } else {
    console.log('no unhandled rejection');
    process.exitCode = 1;
  }
}, 25);
