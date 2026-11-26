# Deploy

Where Sealflare runs and how it was set up. Secrets never enter this folder; they live in
`~/sealflare/.env` on the VPS (mode 600) and in the Vercel project settings.
[docs/service-accounts.md](../docs/service-accounts.md) lists every variable.

## Vercel

Project `sealflare` in the `zakyirsyaads-projects` scope, linked to `zakyirsyaad/sealflare`,
root directory `apps/web`, Node 24. Only `main` deploys, to production, and only when
`apps/web` or a workspace package it depends on changed ("skip unaffected projects").

Preview deployments are off (26 Nov). The Hobby plan allows 100 deployments a day, and one day of
PR pushes made 88 previews, which blocked production deploys. Test PRs locally with
`pnpm --filter ./apps/web dev`. To turn previews back on, for example on a paid plan:

```bash
echo '{"previewDeploymentsDisabled":false}' | vercel api /v9/projects/sealflare --scope zakyirsyaads-projects -X PATCH --input -
```

| Variable | Value |
| :--- | :--- |
| `NEXT_PUBLIC_CHAIN_ID` | `97` until the mainnet release, then `56` |
| `NEXT_PUBLIC_MODULES_LIVE` | `false` until `setModules` has run on that chain |
| `INTERNAL_URL` | `https://internal.zorvolabs.xyz` |
| `INTERNAL_KEY` | sensitive; copied from the VPS `.env`, never displayed |

Still to add when the accounts exist: `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`,
`NEXT_PUBLIC_AGENT_ID_URL`, `RPC_URLS`, `BSCSCAN_KEY`, `GITHUB_TOKEN`, `PINATA_JWT`, `SCANNER`.

## VPS

Oracle Cloud, Ubuntu 24.04 on arm64, user `jeki`, host alias `vps-oracle`. The server also runs
other projects, so Sealflare stays inside its own Compose project (`sealflare`) and folder.

```
~/sealflare/
  compose.yml   from deploy/compose.yml
  backup.sh     from deploy/backup.sh
  .env          generated on the server: POSTGRES_PASSWORD, DATABASE_URL, INTERNAL_KEY,
                WORKER_BEARER_KEY; RPC_URLS, PINATA_JWT, ANTHROPIC_API_KEY, DAILY_LLM_CALLS
                are filled in by the founder
  backups/      daily pg_dump, last 7 kept
```

- Postgres 17 runs on the `sealflare_internal` network, which has no route to the internet, and
  publishes no port.
- `backup.sh` runs from the `jeki` crontab at 19:15 UTC (02:15 WIB). Copying dumps off the VPS is
  still to be decided.
- The internal service, indexer and worker are commented out in `compose.yml` until lanes 2 and 3
  build them. The internal service will listen on `127.0.0.1:3040`.

Update the files on the server after changing them here:

```bash
scp deploy/compose.yml deploy/backup.sh vps-oracle:sealflare/
ssh vps-oracle 'cd ~/sealflare && docker compose up -d'
```

## The internal subdomain

`internal.zorvolabs.xyz` points at the VPS, where the shared nginx proxies it to the internal
service. These steps need the founder: the DNS lives at Hostinger and nginx needs `sudo`.

1. At Hostinger, DNS for `zorvolabs.xyz`: add an `A` record, name `internal`, value
   `161.118.244.234`, TTL 300.
2. Check that it resolves:

   ```bash
   dig +short A internal.zorvolabs.xyz
   ```

3. Install the nginx site and get a certificate (asks for the `jeki` sudo password):

   ```bash
   scp deploy/nginx/internal.zorvolabs.xyz.conf vps-oracle:/tmp/
   ssh -t vps-oracle 'sudo mv /tmp/internal.zorvolabs.xyz.conf /etc/nginx/sites-available/ && sudo ln -sf /etc/nginx/sites-available/internal.zorvolabs.xyz.conf /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx && sudo certbot --nginx -d internal.zorvolabs.xyz --redirect'
   ```

Until the internal service runs, the subdomain answers 502. That is expected.
