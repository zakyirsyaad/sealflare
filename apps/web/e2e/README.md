# The end-to-end suite

The end-to-end suite has two parts: milestone one (Task 11) and milestone two (Task 22). The whole stack runs on the local machine and
Playwright drives it in a real browser: a visitor scans a contract, a new Guardian attests, the
indexer reads the vote, and the page shows it.

Nothing leaves the machine. No key of a real account is used, no paid service is called, and no
transaction reaches a public network.

## What the harness starts

`harness.mjs` starts the stack, runs the suite against it and stops the stack again:

| Piece | What it is |
| --- | --- |
| Postgres | A throwaway cluster in a temporary folder, or the database `E2E_DATABASE_URL` names |
| Anvil | The stub contracts of `contracts/`, deployed by the local script, then seeded |
| The internal service | The API of the app, with the migrations applied |
| The indexer | It reads the chain and writes the rows the internal service serves |
| The storage | A local service with the shape of the Pinata API, so the evidence of a vote is pinned on the machine |
| The web app | A production build for the local chain, with the mock scanner. A run against the real contracts builds it twice: with the modules open (`modulesLive` on) and without (port 3103), because the flag is part of the bundle |

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
- Postgres, for `initdb`, `pg_ctl` and `createdb`, or an `E2E_DATABASE_URL` of a database the suite may
  use. The suite never touches a database that holds anything else.
- The Chromium of Playwright.

| Variable | What it does |
| --- | --- |
| `E2E_RUNS` | How many times the suite runs, one after the other. Every round votes with another account, because an account that has voted on a target cannot vote on it again. Default 1 |
| `E2E_KEEP` | `1` keeps the stack running after the suite, also when the suite failed, so a failure can be looked at in the browser |
| `E2E_MODULES_LIVE` | `true` or `false`. Whether the main app has the modules open. Default `true` with `E2E_REAL=1`, else `false`. A run with the modules open also serves the app without them on `E2E_WEB_OFF_PORT` (default the web port plus one) |
| `E2E_REAL` | `1` runs the suite against the real contracts of `contracts/src` instead of the stubs. The scanner stays the mock one, because the real scanner needs a paid key |
| `E2E_DATABASE_URL` | The database to use. A throwaway cluster is started when it is not given. A `DATABASE_URL` in the shell is never read, so the database of a developer cannot receive the votes of a run |
| `E2E_PG_PORT` | The port of that cluster. A free port is taken when it is not given |
| `FOUNDRY_BIN` | The directory of the Foundry programs, when they are not on the path |

The suite runs one worker, because the tests share one chain and one database. A test has three
minutes, because the slowest path scans, signs the evidence, sends the transaction, mines the
blocks and waits for the indexer.

## The files

| File | What it holds |
| --- | --- |
| `harness.mjs` | The stack: what it starts, in what order, and when it is ready |
| `harness/postgres.mjs` | The throwaway database |
| `harness/storage.mjs` | The local storage of the evidence |
| `fixtures.ts` | The helpers: the accounts, the scan, the wallet, the chain, the indexer |
| `chainTools.ts` | Setup straight on the chain: deploy a target, vote, open a challenge, commit, reveal, move the clock |
| `actors.ts` | One browser per person, the wallet connection, the withdrawal from the vault |
| `seed.ts` | A closed dispute, a bounty and a sponsor, put on the chain once for the screen tests |
| `scan-attest.spec.ts` | The four tests of milestone one |
| `dispute.spec.ts` | The dispute and the expired dispute of milestone two |
| `publish-bond.spec.ts` | Bind, bond, request and finalize the withdrawal |
| `narrow.spec.ts` | 375 px, the accessibility scan, and the app with the modules closed |

## What the four tests prove

1. A visitor scans a contract and reads the result without a wallet.
2. A new Guardian scans, attests and sees the vote after the block is final: the address is pasted,
   the target page opens, the verdict is picked, the vote is signed twice and the panel says
   "Waiting for finality". Blocks are mined, the indexer reads the vote, and the row of the
   attestations tab shows the verdict, no flag and the evidence.
3. An account without an Agent ID is offered both paths, and can continue after it gets one.
4. The sixth attestation in a day shows the daily limit sentence and closes the button.

The label of the app says "finality", because that is what a public chain gives. A local node has
none: it answers the `finalized` tag with the genesis block, so the indexer of the suite reads the
chain up to its tip. The finality of a public chain is therefore not proved by this suite.

## The real contracts

`E2E_REAL=1` runs the suite against the real Core, Court and Vault instead of the stubs. The
stack is the same, and the seed script works against both.

Two things are different, and they are what the founder checks at the milestone meeting:

- The stub keeps no daily quota of its own, so the suite sets the number the contract answers
  with. The real Core keeps the quota itself and has no such function, so the fourth test is
  skipped against the real contracts. The real Core refuses the sixth vote itself.
- The scanner of the suite is the mock one. The real scanner needs a paid key and the keys of the
  explorer and of GitHub, so the founder runs the suite with `SCANNER=real` and the keys of the
  deployment.

## Notes

- The suite waits for the indexer through the internal service, so it never sleeps for a fixed
  time. A wait that runs out fails the test with a message that says what did not happen.
- The evidence of a vote is pinned in the local storage, so the row of the attestations tab links to
  an `ipfs://` address without a request leaving the machine.

## Milestone two

Run it with `E2E_REAL=1 pnpm e2e`. The specs of milestone two skip themselves against the stubs,
which have no working Court.

| Test | What it proves |
| --- | --- |
| `scan, attest, challenge, jury, verdict, withdraw` | A visitor scans a contract, three Guardians vote safe, a challenger opens a dispute from the page, three jurors save a reveal code and commit, the clock moves 12 hours, they reveal from the code the browser kept, the clock moves 12 hours again, anyone resolves, the target reads Confirmed danger, the penalties are applied, and the challenger withdraws the stake |
| `a challenge with two reveals expires and the challenger gets 80% back` | Fewer than three reveals offers Expire, not Resolve, and the first expiry on a target returns 80% of the stake |
| `a publisher binds, deposits a bond, requests withdrawal and finalizes after 7 days` | The deployer signs once and binds, the bond reaches the vault, the clock moves seven days, and the bond comes back to the wallet |
| `every app screen at 375 px has no horizontal overflow` | Ten routes, with and without a wallet |
| `every app screen passes an automated accessibility scan in both themes` | axe, WCAG 2.0 and 2.1 level A and AA, ten routes, two themes, with and without a wallet |
| `with modulesLive off, dispute, bounty and bond actions are disabled everywhere` | The app built without the modules: every action is closed and says why |

The votes of the Guardians, the opening of the second dispute and the jury of the expired dispute
are setup and go straight to the chain. The attest flow is the subject of milestone one, and the
action each test is about goes through the app.

### What the suite found

- The panel of the bond judges "can be withdrawn now" by the clock of the browser, not by the clock
  of the chain, while the challenge action judges the cooldown by the last block. After the node
  moves seven days the test gives the browser the time of the node. A browser with a wrong clock
  shows the wrong state of the bond.
- The internal service answers `500` for a dispute whose evidence address is empty: the Court
  accepts such a challenge, and the dispute page cannot be built from it.
- In the light theme the red flag chip had a contrast of 3.56:1. The chip is darkened in the light
  theme only, so the text reaches 4.5:1. The design tokens are unchanged.
