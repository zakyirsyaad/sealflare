# Sealflare web

Task 2 provides the App Router shell, shared design tokens, base UI components, UX copy,
formatting helpers and validated environment boundaries. Landing and Docs belong to the founder.

## Versions and official installation references

Checked on 22 November 2026 against the official documentation and npm registry:

| Package | Installed | Notes |
| --- | --- | --- |
| Next.js | 16.4.6 | App Router, `next dev`, `next build`, `next start` |
| React / React DOM | 19.3.1 | Installed together, matching versions |
| TypeScript | 7.0.2 | Strict, inherited from the workspace |
| Vitest | 5.1.1 | jsdom 27.4.0, Testing Library React 16.3.3 |
| Playwright | 1.65.1 | Chromium smoke tests on the production build |
| wagmi | 3.7.11 available | Integrate in Task 3 with viem 2 and TanStack Query |
| WalletConnect Ethereum provider | 2.26.0 available | Task 3 uses wagmi's WalletConnect connector and a founder project ID |
| Reown AppKit | 2.0.0 available | Current WalletConnect App SDK docs use AppKit; no extra wallet UI installed in Task 2 |

Official references:

- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation): install
  `next`, `react` and `react-dom`; the App Router requires a root layout.
- [Next.js layouts](https://nextjs.org/docs/app/getting-started/layouts-and-pages): nested
  `app/app/layout.tsx` isolates app navigation from the site's root layout.
- [Next.js route handlers](https://nextjs.org/docs/app/getting-started/route-handlers): future API
  endpoints use `app/api/**/route.ts` and standard Request/Response APIs.
- [Next.js fonts](https://nextjs.org/docs/app/getting-started/fonts): `next/font/google` self-hosts
  Instrument Sans (400/500/600) and Geist Mono (400/500), with `display: swap`.
  A first build needs network access to download these fonts. Browsers do not call Google Fonts.
- [wagmi installation](https://wagmi.sh/react/installation) and
  [getting started](https://wagmi.sh/react/getting-started): `pnpm add wagmi viem@2.x @tanstack/react-query`.
- [wagmi WalletConnect connector](https://wagmi.sh/react/api/connectors/walletConnect): a public
  project ID is required for mobile QR pairing; no private key belongs in this app.
- [WalletConnect App SDK](https://docs.walletconnect.com/apps/react/installation): the SDK docs now
  use Reown AppKit. This is a distinct UI integration from wagmi's EVM connector.

## Run

From the repository root:

```bash
pnpm install
pnpm --filter @sealflare/web test
pnpm --filter @sealflare/web test:coverage
pnpm --filter @sealflare/web typecheck
pnpm --filter @sealflare/web build
pnpm --filter @sealflare/web dev
```

Open `/app`. The scan service and wallet connection are supplied by later tasks. The Connect
wallet control is disabled until Task 3, and the shell shows no fabricated results or counts.
Navigation destinations for later tasks intentionally have no placeholder result pages.

## Environment

`lib/env.public.ts` is the client-safe entry point. Next.js needs explicit references to public
variables at build time. Chain ID defaults to 56, modules default to false, and the WalletConnect
project ID can be omitted until wallet integration is enabled. Modules accept only `true` or
`false`. Public values are fixed at build time; rebuild when they change.

`lib/env.ts` is guarded by `server-only` and exposes `publicEnv` and `serverEnv`. It validates
server values on import, and `instrumentation.ts` imports it at Node server startup. Missing or
invalid variables fail with variable names only. Required server configuration:

| Variable | Value |
| --- | --- |
| `INTERNAL_URL` | HTTP(S) internal-service URL |
| `INTERNAL_KEY` | Internal-service authentication key |
| `RPC_URLS` | One or more comma-separated HTTP(S) RPC URLs |
| `BSCSCAN_KEY` | BscScan API key |
| `GITHUB_TOKEN` | GitHub API token |
| `PINATA_JWT` | Pinata JWT |
| `SCANNER` | `mock` or `real` |

Supply real values through the founder's environment/secret manager. Never prefix server keys
with `NEXT_PUBLIC_`. The startup requirement also applies to the shell before the services are
connected. Playwright supplies clearly marked dummy values for its local server and makes no
service requests.

## Browser checks

```bash
pnpm --filter @sealflare/web exec playwright install chromium
pnpm --filter @sealflare/web build
pnpm --filter @sealflare/web e2e
```

The smoke suite checks `/app` at 375px and 1280px in both themes, keyboard focus, navigation,
disabled wallet state, horizontal overflow and browser runtime errors. Screenshots go to the
ignored `test-results/` directory. These checks cover the shell, not the future scan/wallet flows.
The Panel component uses a native modal dialog for focus containment, Escape and background
inertness. Tabs support ArrowLeft, ArrowRight, Home and End.

## Implementation ledger

- Followed the approved Task 2 inline with TDD, using the requested main checkout. No staging,
  commit, push, changes to frozen shared contracts, or modifications to other workers' files.
- Ruling: keep wallet/scanning behavior in Tasks 3/8. Task 2 displays an honest shell and a disabled
  wallet control. Cost if wrong: reviewers may expect those later integrations in this scaffold.
- Ruling: use the canonical full-name tokens from `system/tokens.css` as required by the design
  guide; these are the Main screen's values with standardized names. Copy component classes from
  `bundle.css`, replace the active-tab shadow with a border, and apply crop pseudo-elements only
  when `crop` is true. Cost if wrong: exact source selectors differ while the specified appearance
  is preserved.
- Ruling: keep the current wallet SDK installation differences documented here and install the
  wallet packages in Task 3. Cost if wrong: Task 3 must confirm its chosen connector's peers again.
- Author review checks the component contracts, environment boundaries, tier presentation,
  exact wei formatting, both themes, scoped diff and staged-work preservation. No separate
  reviewer agent was used for this bounded scaffold.

## Verified result

- TDD: the first test run failed on the absent implementation modules, then the implemented suite
  passed 37 tests across four files. Typecheck and the production build pass.
- Measured UI/helper coverage: 100% lines, 100% functions, 97.87% statements, 92.64% branches.
  The coverage target is `components/` and `lib/`; it excludes the static copy catalog, server
  environment facade and export barrel. App layouts, configuration and instrumentation are
  verified through build/start/browser checks rather than included in this coverage percentage.
- Production Chromium smoke: two tests pass, each checks both themes at 375px or 1280px. The
  screenshots were also inspected. Navigation scrolls within its row at the narrow width.
- Root `pnpm verify` passes: shared 284, scanner 104, web 37 tests; all workspace typechecks;
  Solidity 99 passed with two existing skips; ABI sync check clean. The skipped tests are
  `test_attest_safeOnConfirmedDanger_reverts` and
  `test_verifySkillBundle_sponsorOnly_publisherIsZero` in the parallel on-chain work.
- The first sandboxed root verification reached ABI export but tsx could not create its IPC pipe
  (`EPERM`). Re-running with the permitted sandbox escalation completed successfully.
- The lockfile preserves the staged Task 1 importer and adds the web importer and required
  package/peer snapshots. pnpm also refreshes Vitest optional-peer snapshots in shared/scanner.
