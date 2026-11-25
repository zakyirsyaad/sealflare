# Scanner core

Layer 1 deterministic scanning for Sealflare. The core holds no state and reads no environment.
Skill scripts are read as bytes and never executed. A failed or skipped check prevents a SAFE
suggestion. These heuristics are not a contract audit or proof that a skill is safe.

## Start your lane

Lane 3 can replace the fake scanner with `createScanner()`. Supply the runtime adapters separately:

```ts
import { createScanner, parseScanInput } from '@sealflare/scanner-core'
import { createRpcAdapter, createExplorerAdapter, createGitHubFetcher } from '@sealflare/scanner-core/adapters'

// These configuration values are supplied and validated by the calling service.
const scanner = createScanner()
const rpc = createRpcAdapter(bnbChainRpcUrls, { timeoutMs: 1500 })
const explorer = createExplorerAdapter(explorerOptions)
const repo = createGitHubFetcher({ token: optionalGitHubToken })
const input = parseScanInput(pastedText)
const report = input.kind === 'contract'
  ? await scanner.scanContract(input.address, { rpc, explorer })
  : await scanner.scanSkill(input, { repo })
```

The explorer options supply the Etherscan V2 key in the `apiKey` field.
The adapters are supplied by Scanning Task 5. Integrate after both Task 5 and Task 6 are merged.
The GitHub adapter uses Node and is intended for the calling service, while the core entry point
has no Node or ambient network imports. Never expose paid API keys through public client variables.

Accepted inputs include a 20-byte contract address, `https://github.com/owner/repo`, its `.git`
variant, `github.com/owner/repo/tree/main/skill-folder`, and commit-pinned references:

```text
https://github.com/owner/repo/tree/<40-character commit>/skill-folder
gh:owner/repo@<40-character commit>:skill-folder
```

An empty path in the compact form selects the repository root. Bare repository links resolve
the default branch. Explicit `tree/main` links retain branch `main`, even if the default is
another branch. A tree URL with no folder discovers the available skill folders. Use a
40-character commit to select an exact revision; other named tree references are rejected.
The report records the actual resolved commit.
GitHub links also accept `http`, the `www` host, and query strings or fragments copied from
the browser. Queries and fragments do not select revisions. Mixed-case contract addresses must
have a valid EIP-55 checksum; all-lowercase and all-uppercase addresses remain accepted.
Compact `gh:` references follow the shared `decodeSrc` format exactly: commits use lowercase
hex, repository names are preserved verbatim, and folder paths have no trailing slash.

`ScanError` from `@sealflare/shared/schemas` exposes `code` and optional `details`. In particular,
`MULTIPLE_SKILL_FOLDERS` carries `details.folders`, and GitHub rate limits carry
`details.retryAfterSeconds`. An explorer outage returns a partial report with failed/skipped
checks; unavailable RPC or an address without code throws without producing a verdict.

GitHub downloads use up to four concurrent blob requests (configure `maxConcurrency` from 1 to 8)
and a 15-second deadline for each complete listing or bundle operation (`timeoutMs`, up to
120 seconds). A failed download or deadline cancels the remaining requests and returns no
partial bundle. Bundles above 40 files require a GitHub token; an observed insufficient API
quota fails before blob downloads. Both cases use `RATE_LIMITED`. Token access never permits
scanning a private repository.

For a pinned folder, the adapter walks its directory trees and downloads only that subtree.
A truncated selected subtree is rejected. Folder discovery still requires a complete repository
tree, so discovery in a truncated repository needs an explicit pinned folder reference instead.
Renamed repository redirects are followed only within `https://api.github.com`, for at most
three hops per request. Credentials are never forwarded to another origin.

The SDK can import `suggestVerdict`, `hasDelegatecall`, and `inspectProxy` from the core entry point.
Contract `blockNumber` is the observed RPC head, not an atomic snapshot across multiple reads.
