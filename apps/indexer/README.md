# Indexer

The indexer copies the chain into Postgres. It reads the `Core` events of the last final blocks
and writes them into the tables the internal service and the public API read.

It reads only. It never sends a transaction and it never holds a key.

## How it reads

One range at a time, at most 2,000 blocks, and never past the last final block. The events, the
raw log and the cursor go into one Postgres transaction, so a failure anywhere leaves the cursor
where it was and the range is read again.

The cursor keeps the hash of the block it stopped at. If the chain no longer has that block, the
indexer stops with a clear message instead of writing events that belong to another chain.

The service and the indexer both run the migrations against the same database, so each migration
takes an advisory lock first and the second process waits instead of crashing.

## Run it

```bash
DATABASE_URL=postgres://sealflare:secret@127.0.0.1:5432/sealflare \
RPC_URL=https://bsc-dataseed.bnbchain.org \
CHAIN_ID=56 \
CORE_ADDRESS=0x... \
pnpm --filter @sealflare/indexer start
```

`BATCH_SIZE` changes how many blocks one range holds, and `POLL_INTERVAL_MS` how long the indexer
waits when it is caught up.

## Tests

```bash
pnpm --filter @sealflare/indexer test
```

The tests start an Anvil with the stub contracts, so they need `anvil` and `forge`. They run
against PGlite, an in-memory Postgres, so no database is needed.
