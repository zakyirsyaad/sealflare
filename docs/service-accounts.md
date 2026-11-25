# Service accounts and keys

Every outside account Sealflare needs, the variable each one fills, where that variable lives, and
by when. The founder creates and holds the production accounts (lane 1). Secrets never go into the
repository, and a paid key never gets the `NEXT_PUBLIC_` prefix (architecture 5.6).

## Development keys

Developers do not wait for production keys. For local work and tests, each developer uses a free
tier key of their own in an untracked `.env` file (`.env` and `.env.*` are in `.gitignore`), or
the fakes and fixtures the plans already provide. Production keys are set only in Vercel, on the
VPS, or as GitHub Actions secrets, by the founder.

## Accounts

| # | Service | What to create | Needed by |
| :---: | :--- | :--- | :--- |
| 1 | BSC RPC provider | Two providers with paid or generous plans, for fallback. At least one must serve archive state for the fork tests | 27 Nov (M1), CI any time |
| 2 | BscScan (Etherscan API v2) | One API key, used to read verified source and creation data | 27 Nov (M1) |
| 3 | GitHub | A fine-grained token with read access to public repositories only, no write scopes | 27 Nov (M1) |
| 4 | Pinata | A scoped API key (JWT) limited to pinning JSON and files | 27 Nov (M1) |
| 5 | WalletConnect (Reown) | A project, with the production domain on its allow list | 27 Nov (M1) |
| 6 | Anthropic | An API key for the sandbox worker, with a monthly spend limit set in the console | 4 Dec (scanning Task 11) |
| 7 | Vercel | Done: project `sealflare`, root `apps/web`, see [deploy/README.md](../deploy/README.md) | 1 Dec (release) |
| 8 | VPS | Oracle VPS `vps-oracle`, set up in [deploy/README.md](../deploy/README.md): Postgres and daily `pg_dump` run; the internal service, indexer and worker are added when built. Copying dumps off the VPS is still to be decided | 1 Dec for the indexer and internal service, 4 Dec for the worker |
| 9 | Treasury | An address (ideally a multisig) that receives fees; passed as `TREASURY` to `DeployModules` | testnet rehearsal |
| 10 | Deployer | The hardware wallet that deploys `Core` and calls `setModules` once | testnet rehearsal |

## Variables

| Variable | Filled from | Vercel | VPS | GitHub Actions | Public |
| :--- | :--- | :---: | :---: | :---: | :---: |
| `NEXT_PUBLIC_CHAIN_ID` | `56`, or `97` for testnet | yes | | | yes |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | account 5; a project id, not a secret | yes | | | yes |
| `NEXT_PUBLIC_MODULES_LIVE` | `false` until `setModules` has run on mainnet | yes | | | yes |
| `NEXT_PUBLIC_AGENT_ID_URL` | the official page for getting an Agent ID | yes | | | yes |
| `RPC_URLS` | account 1, comma separated, in fallback order | yes | yes (indexer) | | no |
| `BSCSCAN_KEY` | account 2 | yes | | | no |
| `GITHUB_TOKEN` | account 3 | yes | | | no |
| `PINATA_JWT` | account 4 | yes | yes (worker) | | no |
| `INTERNAL_URL` | the HTTPS address of the internal service on the VPS | yes | | | no |
| `INTERNAL_KEY` | generated, see below; same value on both sides | yes | yes (internal service) | | no |
| `WORKER_BEARER_KEY` | generated, at least 32 characters; internal service to worker | | yes (internal, worker) | | no |
| `ANTHROPIC_API_KEY` | account 6 | | yes (worker only) | | no |
| `DAILY_LLM_CALLS` | the daily cap on LLM calls; set from the measured cost per run | | yes (worker) | | no |
| `SCANNER` | `real` in production, `mock` in tests | yes | | | no |
| `BSC_RPC_URL` | account 1, an archive endpoint, for the daily fork tests | | | yes (secret) | no |
| `TREASURY`, `AGENT_ID` | account 9; `AGENT_ID` only on testnet | | | | local shell at deploy |

The internal service and the indexer also need database settings. Lane 3 defines their exact names
in `apps/internal/src/env.ts` and `apps/indexer/src/env.ts` (application plan Tasks 4 and 5); they
live only in the Compose file on the VPS.

Generate the two service keys with:

```bash
openssl rand -base64 48
```

## Rules

- `ANTHROPIC_API_KEY` exists only in the worker container. Nothing on Vercel can call the LLM.
- The worker container may reach only the LLM API and Pinata (architecture 5.2).
- Postgres is never exposed to the internet; only containers on the VPS reach it.
- Rotate any key that appears in a log, a screenshot, a chat, or a commit. Push protection and the
  gitleaks check in CI catch the common formats, not all of them.
- The deployer key never exists as a file. Deploy scripts accept only `--ledger`.
