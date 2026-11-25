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

That stop is a `ChainMismatchError`, and the process exits with code 1 on it. Every other error,
such as an RPC node that is briefly unreachable, is logged and the same range is read again after
`POLL_INTERVAL_MS`. A fatal mismatch therefore shows up in the restart policy or the alert of
whoever runs the indexer, and does not look like an RPC blip. The same stop happens at start-up if
the RPC node serves another chain than `CHAIN_ID`.

The first read of a new database starts at `START_BLOCK` and not at block 0. A cursor, once it
exists, always wins over `START_BLOCK`.

Strings that come from calldata are cleaned before they are stored. Any Agent ID holder writes the
`evidenceURI` of an attestation and the contract does not check it, and Postgres refuses U+0000 in
text and in jsonb. Each U+0000 becomes U+FFFD, so one odd `attest` cannot stop the indexer for good.
The raw log keeps the cleaned string too.

### The RPC endpoint must be one consistent node

`finalized`, `getLogs` and `getBlock` are separate requests. Behind a load balancer they can reach
nodes at different heights, and a node that lags clamps `toBlock` to its own head and returns fewer
logs. The cursor would then move past events that were never read, and the hash check cannot
notice. The client cannot tell which node answered, so this cannot be checked from here. Point
`RPC_URL` at one node, or at a provider that gives consistent reads, and do not put a round-robin
or fallback list of different providers behind it.

The service and the indexer both run the migrations against the same database, so each migration
takes an advisory lock first and the second process waits instead of crashing.

## Run it

```bash
DATABASE_URL=postgres://sealflare:secret@127.0.0.1:5432/sealflare \
RPC_URL=https://bsc-dataseed.bnbchain.org \
CHAIN_ID=56 \
CORE_ADDRESS=0x... \
START_BLOCK=<the block Core was deployed in> \
pnpm --filter @sealflare/indexer start
```

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `RPC_URL` | One consistent RPC node (see above) |
| `CHAIN_ID` | The chain the node must serve. The indexer exits if it does not |
| `CORE_ADDRESS` | The Core contract |
| `START_BLOCK` | The block Core was deployed in. Digits only. Required unless `CHAIN_ID` is 31337, where it defaults to 0, so a deploy never walks the chain from block 0 by accident |
| `BATCH_SIZE` | How many blocks one range holds (1 to 2000, default 2000) |
| `POLL_INTERVAL_MS` | How long the indexer waits when it is caught up (default 5000) |

The deploy block of Core is in the transaction of its deployment. The deploy scripts do not write
it into `shared/abi/addresses.*.json` yet.

## Tests

```bash
pnpm --filter @sealflare/indexer test
```

The tests start an Anvil with the stub contracts, so they need `anvil` and `forge`. They run
against PGlite, an in-memory Postgres, so no database is needed.
