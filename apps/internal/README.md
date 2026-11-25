# Internal service

The only door to Postgres. The public API on Vercel and the indexer talk to it over HTTPS with
the inter-service key, so nothing else can read the database or write to it.

It holds no key that can move money and it never signs anything.

## Run it

```bash
DATABASE_URL=postgres://sealflare:secret@127.0.0.1:5432/sealflare \
INTERNAL_KEY=<at least 32 characters and 16 different ones> \
pnpm --filter @sealflare/internal start
```

The service listens on port 3040 by default. `PORT` changes it.

Every request except `GET /health` needs the key:

```bash
curl -H "Authorization: Bearer $INTERNAL_KEY" http://127.0.0.1:3040/health
```

The key is compared in constant time and never appears in an answer, an error message or a log
line. Generate one with `openssl rand -base64 48`.

## Routes

| Route | What it does |
| :--- | :--- |
| `GET /health` | Says the service is up. It reads nothing and needs no key. |
| `POST /rate/take` | Counts a request in the window that contains it and says whether it may pass. |
| `POST /nonce/use` | Reserves a nonce for one signed request. The first use is fresh, a replay is not. |
| `POST /nonce/commit` | Marks a reserved nonce as done. A spent nonce stays spent until it expires. |
| `POST /nonce/release` | Gives a reservation back, so a request that failed can be signed again. |
| `PUT /scans/:targetId` | Stores the last scan of a target. |
| `GET /scans/:targetId` | Returns the last scan of a target, or 404 `RESULT_NOT_CACHED`. |

Every answer has the same shape: `{ success: true, data }` or `{ success: false, error }`.

The rate window is at most one hour, and the caller hashes the address of the caller with a
daily salt, so no raw address reaches the `rate` table.

## How a signed request uses a nonce

The nonce is what stops the same signed request from being used twice, and the check lives
here and not only in the public API.

1. `POST /nonce/use` reserves the nonce. The answer is `{ fresh: true }` for the first use and
   `{ fresh: false }` for a replay.
2. The work happens: the evidence is pinned, or the sandbox run is queued.
3. `POST /nonce/commit` marks the nonce as spent. From then on a replay is refused until the
   nonce expires.
4. If the work failed, `POST /nonce/release` gives the reservation back instead, so the request
   can be signed again. Release only when you know the work did not happen. If the outcome is
   unknown, leave the reservation in place: a blocked request can be signed again later, a
   replay cannot be undone.

A caller that holds the inter-service key can release a reservation, but it cannot release a
spent nonce, so a request that was committed cannot be replayed.

If the caller dies between step 1 and step 3, the reservation sits until it expires, which is
at most ten minutes. That nonce cannot be used again in the meantime. That is the safe
direction: a request happens at most once, not at least once.

## Migrations

`migrations/` holds numbered SQL files. The service runs them on start and records them in
`schema_migrations`, so running it again does nothing. The indexer calls the same runner.

A migration and its record go into one transaction, so a migration that fails leaves the
database exactly as it was and runs again on the next start. The service and the indexer both
run the migrations against the same database, so each migration takes an advisory lock first
and the second process waits instead of crashing. The bookkeeping table is created under that
same lock, because `CREATE TABLE IF NOT EXISTS` is not safe against another process creating
the same table at the same moment.

## Housekeeping

Every five minutes the service removes the expired nonces and the rate rows whose window has
passed. A rate row carries no window length of its own, because the caller decides it, so a row
is kept for the longest window the service allows.

## Tests

```bash
pnpm --filter @sealflare/internal test
```

The tests run against PGlite, an in-memory Postgres, so no Docker and no database are needed.
