# Sealflare web

Task 2 provides the App Router shell, shared design tokens, base UI components, UX copy,
formatting helpers and validated environment boundaries. Task 3 adds the chain layer: wallet
connection, the user states and contract error messages. Landing and Docs belong to the founder.

## Versions and official installation references

Checked on 22 November 2026 against the official documentation and npm registry:

| Package | Installed | Notes |
| --- | --- | --- |
| Next.js | 16.4.6 | App Router, `next dev`, `next build`, `next start` |
| React / React DOM | 19.3.1 | Installed together, matching versions |
| TypeScript | 7.0.2 | Strict, inherited from the workspace |
| Vitest | 5.1.1 | jsdom 27.4.0, Testing Library React 16.3.3 |
| Playwright | 1.65.1 | Chromium smoke tests on the production build |
| wagmi | 3.7.11 | Task 3. The connection hook is `useConnection`; `useAccount` is deprecated in v3 |
| viem | 2.58.4 | Peer of wagmi |
| TanStack Query | 5.108.4 | Peer of wagmi |
| WalletConnect Ethereum provider | 2.26.0 | Used by wagmi's `walletConnect` connector; needs a founder project ID |
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

Open `/app`. The scan service is supplied by a later task. The Connect wallet control opens the
connect prompt, and the shell shows no fabricated results or counts.
Navigation destinations for later tasks intentionally have no placeholder result pages.

## Environment

`lib/env.public.ts` is the client-safe entry point. Next.js needs explicit references to public
variables at build time. Public values are fixed at build time; rebuild when they change.

| Public variable | Value |
| --- | --- |
| `NEXT_PUBLIC_CHAIN_ID` | `56` (default), `97` (BNB testnet, what Vercel uses until the mainnet release) or `31337` (local Anvil); anything else fails at startup naming the variable |
| `NEXT_PUBLIC_MODULES_LIVE` | `true` or `false` (default `false`) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Optional. Without it the connect prompt offers only the browser wallet and no QR option |
| `NEXT_PUBLIC_AGENT_ID_URL` | Optional HTTP(S) link for "Get an Agent ID". Unset shows plain text and a note |

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
the connect prompt, horizontal overflow and browser runtime errors. Screenshots go to the
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

## Task 3: chain layer

Files: `lib/chain/{addresses,config,errors,modules,userState}.ts` and `components/wallet/*`.
`Web3Provider` wraps only `app/app/layout.tsx`, so the landing page and docs stay wallet free.

- **Addresses.** `shared/abi/addresses.local.json` is gitignored and `addresses.bsc.json` and
  `addresses.bsc-testnet.json` do not exist until the founder deploys, so they cannot be imported
  statically. `next.config.ts` reads whichever exists and inlines only the known fields as
  `NEXT_PUBLIC_ADDRESSES_LOCAL`, `NEXT_PUBLIC_ADDRESSES_BSC` and `NEXT_PUBLIC_ADDRESSES_BSC_TESTNET`.
  Run `pnpm chain` first and restart `next dev` after the file changes. `addresses(chainId)` throws
  a message that says what to run when the file is missing. A zero `court` or `vault` becomes `null`.
- **User states.** `useUserState()` reads `Core.isAgentIdHolder` and `Core.attestationsLeftToday`
  directly, never the indexer, pinned to the expected chain. Reads are disabled without a wallet,
  on the wrong network, or when the address file is missing. In those cases, and while a read is
  loading or failed, the state is `checking` with `isLoading` or `isError` set, never `no-agent-id`.
  `attestationsLeft` is `null` until the quota read succeeds. `isLoading` is also true while wagmi
  reconnects after a reload, so the header shows a disabled button instead of flashing "Connect wallet".
  `error` carries a developer-facing message; render a sentence from `copy`, not this text.
- **Contract errors.** `translateContractError()` returns `null` when the user rejects in the
  wallet and a sentence otherwise. A test fails if an error is added to the Core, Court or Vault ABI
  without a sentence in `copy.errors`.
- **Modules.** `moduleGate(modulesLive)` returns the disabled state and the fixed sentence.
- **Environment.** `NEXT_PUBLIC_AGENT_ID_URL` is the official Agent ID link. Until the founder sets
  it, `NoAgentId` shows the label as plain text and says the link is not published yet.

### Decisions that differ from the plan

- `UserState` has a fifth kind, `checking`. Without it a wallet whose holder check is still loading
  or has failed would be shown as having no Agent ID, which sends real holders to the wrong panel.
  The hook also returns `isLoading` and `isError`. Cost if wrong: consumers must handle one more
  kind. The plan types the quota as a number; it is `number | null` here because 0 would tell a
  holder with an unknown quota that the daily limit is used up.
- `translateContractError` never throws and never shows a revert string, only ABI-decoded names
  with sentences from `copy`. `retry` is true for `TransferFailed` and for errors it cannot name,
  because every other revert repeats identically. ux.md section 5 asks for a retry button in the
  failed state; the panel can show one regardless of this flag. Cost if wrong: Task 10 may need it
  true for more errors.
- `moduleGate` lives in `lib/chain/modules.ts`, not in `config.ts`, so it can be tested without
  mocking the wallet config.
- `WalletButton` takes `pendingCount` as a prop and the header passes nothing yet. The count comes
  from the activity endpoint, which a later task builds.

### Stub and real contract differences

Probed on a local Anvil with the same reads and simulated `attest` calls, once per deployment:

| Check | `pnpm chain` (stub) | `pnpm chain:real` |
| --- | --- | --- |
| `isAgentIdHolder` after `chain:seed` | true for accounts 0 to 4, false for account 5 | same |
| `attestationsLeftToday`, account 1 | 5 | 2 (the seed script attested three times) |
| `attest` from a wallet without an Agent ID | does not revert | reverts with `NotAgentIdHolder` |
| `attest` with invalid arguments | does not revert | reverts (`InvalidFlags` for the probe used) |

The stub never decrements the quota and accepts any caller, as documented. The No Agent ID panel
can be driven on the stub through the read alone, but write errors and the daily limit only show up
on `chain:real`.

### Open items

- Public reads use viem's default BNB Chain RPC. A dedicated endpoint cannot go in a
  `NEXT_PUBLIC_` variable if it is paid, so the founder needs to decide on one before release.
- WalletConnect metadata (name, URL, icon) is not set, so wallets show generic app details.
- `@reown/appkit`, pulled in by the WalletConnect provider, has a build script that pnpm blocks.
  It was not approved, and pairing is untested because no project ID exists yet.
- Node 26 prints an `ExperimentalWarning` about `localStorage` during the production build. The
  build succeeds.
- `moduleGate(modulesLive)` trusts the flag. With the flag on and a zero Court or Vault address in
  the file, actions would be enabled against a missing contract. Keeping the flag honest is the
  founder's release step; Task 12 or later can also check the addresses.
- Task 10 must render a `copy` sentence when `useUserState().isError` is true, and show a loading
  state on "Check again" (the hook does not expose `isFetching`).

### Verified result

- TDD: the four new suites failed on missing modules first. All 117 web tests pass; typecheck and
  the production build pass; Chromium e2e passes 3 tests at 375 and 1280 px.
- An independent review found no critical issues and five important ones, each reproduced before
  fixing: the connect prompt reappeared after connect and disconnect, the prompt promised a QR code
  without a WalletConnect connector and hid connection failures, the attestation quota read as 0
  while unknown, the translator could throw, and the menu lost focus. `wallet.integration.test.tsx`
  uses a real `WagmiProvider` with wagmi's `mock` connector because the mocked suite could not
  see the first of these.
- Against `chain:real`, the app's ABI reads returned the expected holders and quota as `number`, and
  two real reverts translated to the right sentences.
- Not tested: a real wallet connection, because no browser wallet or WalletConnect project ID is
  available in this environment.

## Task 9: target page

The page at `/app/t/[id]` shows one target: its identity, its status, the community signal, the
actions a holder can take, and the tabs with the findings, the attestations and the history. It
builds from an id alone, from `?src=` alone, or from both.

### Files

- `app/app/t/[id]/page.tsx`, `app/app/t/[id]/loading.tsx`: the route and the skeleton.
- `components/target/`: `Identity`, `StatusCard`, `SignalBreakdown`, `ActionColumn`, `Banners`,
  `FindingsTab`, `AttestationsTab`, `HistoryTab`, `StaleNotice`, `TargetTabs`, `TargetScreen`,
  `TargetMissing`, `TargetError`, `TargetSkeleton`.
- `server/chain.ts`: the only place that reads Core and Vault.
- `server/scanStore.ts`: the in-memory cache of the last scan per target.
- `server/target.ts`: the read model assembly.
- `test/target.test.tsx`, `test/target.server.test.ts`.

### Decisions that differ from the plan

- The plan expects the indexer of Task 5 to supply the data. That task does not exist yet, so the
  page reads Core and Vault itself, server side, with viem. The tier always comes from
  `Core.tierOf` and is never recomputed from the votes. When the indexer lands, `server/target.ts`
  is the only file that changes. Cost if wrong: one more read path to remove.
- The findings come from an in-memory store that the Task 8 scan routes fill. Without a cached scan
  and without `?src=`, the page honestly says "This version has not been scanned yet." A scan that
  fails leaves the page without findings and never becomes a safe verdict. Cost if wrong: the store
  does not survive a restart, so a page opened without `?src=` can lack findings.
- The Attest button opens only when the wallet holds an Agent ID and has quota left. The panel of
  Task 10 does not exist yet, so the button has no form. "Open a challenge" and "Fund an audit
  bounty" stay disabled and say the modules are not live. Cost if wrong: Task 10 replaces the
  button with its panel.
- The evidence of a vote lives in the event log, not in Core. `server/chain.ts` reads the
  `Attested` events from the block of the target and joins them with the votes by index. A vote
  without a matching log shows no evidence URI and no evidence link. Cost if wrong: the join is by
  index, so a reindexed history would shift the evidence.
- The lag notice counts the blocks between the head of the chain and the block of the scan. It only
  applies to a contract scan, because a skill bundle has no block. Cost if wrong: the indexer
  would know the lag of the whole database, not of one scan.

### Verified result

- TDD: the two new suites failed on the missing modules first. All 183 web tests pass across
  fourteen files; the coverage thresholds hold (components/target 85.62%).
- Typecheck and the production build pass. The build lists `/app/t/[id]` as a dynamic route.
- Not tested: the Playwright check at 375 px from the plan. It needs the local chain with the stub
  contracts and the seeded targets, which the CI web server does not start. The CSS keeps the
  action column sticky below 760 px, but the check itself is still open.
