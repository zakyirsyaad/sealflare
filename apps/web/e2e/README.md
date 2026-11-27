# The end-to-end suite

Task 11 adds the end-to-end suite of milestone one. The whole stack runs on the local machine and
Playwright drives it in a real browser: a visitor scans a contract, a new Guardian attests, the
indexer reads the vote, and the page shows it.

Nothing leaves the machine. No key of a real account is used, no paid service is called, and no
transaction reaches a public network.

## What the harness starts

`harness.mjs` starts the stack, runs the suite against it and stops the stack again:

| Piece | What it is |
| --- | --- |
| Postgres | A throwaway cluster in a temporary folder, or the database `DATABASE_URL` names |
| Anvil | The stub contracts of `contracts/`, deployed by the local script, then seeded |
| The internal service | The API of the app, with the migrations applied |
| The indexer | It reads the chain and writes the rows the internal service serves |
| The storage | A local service with the shape of the Pinata API, so the evidence of a vote is pinned on the machine |
| The web app | A production build for the local chain, with the mock scanner |

The chain is read up to its tip: a local node has no finality and answers the `finalized` tag with
the genesis block, so the indexer is started with `BLOCK_TAG=latest`.

## The wallet of the suite

No key is in the browser. The test names one of the accounts of Anvil before the page loads, and
the wallet of the suite is a wagmi connector that sends every call to the local node. The node
signs with the account it holds, so the browser never sees a key.

The connector is only built for a build that says it is an end-to-end build
(`NEXT_PUBLIC_E2E=true`), so a deployment never offers it. The tests pick it by its name, "End-to-end
wallet".

## Run it

From the repository root:

```bash
pnpm install
pnpm --filter @sealflare/web exec playwright install chromium
pnpm e2e
```

The run needs:

- Foundry 1.7.1 or newer, for `anvil` and `forge`. A program of another name called `forge` on the
  path is ignored, and a Foundry that is too old is refused with a message. `FOUNDRY_BIN` names the
  directory of the programs when they are not on the path.
- Postgres, for `initdb`, `pg_ctl` and `createdb`, or a `DATABASE_URL` of a database the suite may
  use. The suite never touches a database that holds anything else.
- The Chromium of Playwright.

| Variable | What it does |
| --- | --- |
| `E2E_RUNS` | How many times the suite runs, one after the other. Default 1 |
| `E2E_KEEP` | `1` keeps the stack running after the suite, also when the suite failed, so a failure can be looked at in the browser |
| `DATABASE_URL` | The database to use. A throwaway cluster is started when it is not given |
| `E2E_PG_PORT` | The port of that cluster. A free port is taken when it is not given |
| `FOUNDRY_BIN` | The directory of the Foundry programs, when they are not on the path |

The suite runs one worker, because the tests share one chain and one database.

## The files

| File | What it holds |
| --- | --- |
| `harness.mjs` | The stack: what it starts, in what order, and when it is ready |
| `harness/postgres.mjs` | The throwaway database |
| `harness/storage.mjs` | The local storage of the evidence |
| `fixtures.ts` | The helpers: the accounts, the scan, the wallet, the chain, the indexer |
| `scan-attest.spec.ts` | The four tests of milestone one |

## What the four tests prove

1. A visitor scans a contract and reads the result without a wallet.
2. A new Guardian scans, attests and sees the vote after the block is final: the address is pasted,
   the target page opens, the verdict is picked, the vote is signed twice and the panel says
   "Waiting for finality". Blocks are mined, the indexer reads the vote, and the row of the
   attestations tab shows the verdict, no flag and the evidence.
3. An account without an Agent ID is offered both paths, and can continue after it gets one.
4. The sixth attestation in a day shows the daily limit sentence and closes the button.

## Notes

- The suite waits for the indexer through the internal service, so it never sleeps for a fixed
  time. A wait that runs out fails the test with a message that says what did not happen.
- The evidence of a vote is pinned in the local storage, so the row of the attestations tab links to
  an `ipfs://` address without a request leaving the machine.
