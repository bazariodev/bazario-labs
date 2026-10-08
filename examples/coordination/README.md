# Coordination example

Run the assertions from the workspace root after building packages:

```sh
pnpm build
pnpm --filter @bazariodev/example-coordination test
```

`index.js` demonstrates direct FIFO storage, synchronous reentrant execution, serial async work with
handled stop results, and a class that publishes events through a private Emitter.
