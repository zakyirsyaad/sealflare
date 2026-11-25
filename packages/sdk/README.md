# @sealflare/guard

The Sealflare guard reads the registry on BNB Chain and answers one question: is this safe?

It works on two kinds of target:

- a smart contract, by address
- an AI skill bundle, by its files

The guard never signs a transaction, never sends one, and never executes a skill. It only reads.

## Install

```bash
pnpm add @sealflare/guard
```

## Use

```ts
import { createGuard } from '@sealflare/guard'
const guard = createGuard({ client, core })
const verdict = await guard.checkContract(address)
```

`client` is a viem public client, `core` is the address of the Sealflare Core contract, which also
implements `IFirewall`. Pass `vault` as well when you want the warranty bond of a publisher.

## The contract verdict

`guard.checkContract(address)` resolves with:

| Field | Meaning |
| :--- | :--- |
| `tier` | The tier of the registry: `UNRATED`, `COMMUNITY_SAFE`, `WARRANTY_BACKED_SAFE`, `CAUTION_FLAGGED`, `DISPUTED_CAUTION`, `CONFIRMED_DANGER` or `STALE_CODEHASH_DRIFT`. |
| `safe` | True only for `COMMUNITY_SAFE` and `WARRANTY_BACKED_SAFE`, and never for a proxy. |
| `isUpgradeableProxy` | True when the address is a proxy, either by the slot or by the registry marker. |
| `implementationChanged` | True when the code behind the proxy differs from the code that the registry pinned, and null when the target is not a proxy. |
| `flags` | The active flags of the target, by name. |
| `warrantyBond` | The active warranty bond of the publisher, in wei, or zero without a vault. |
| `reasons` | Plain English sentences that explain the verdict. |

A contract can be a proxy that changes its implementation without anyone noticing. The on-chain
firewall cannot see that, because a contract cannot read the storage of another contract. The guard
reads the implementation slot over RPC, so it can tell you that the address is a proxy at all.

`Core` pins the code hash of the target itself and cannot read the implementation slot, so the
registry cannot prove that an implementation is unchanged since the last scan. The guard therefore
compares the code of the implementation with the pinned hash and reports the difference it can
see. A proxy is never safe in any case, and a caller that wants to know whether the implementation
moved should compare the code hash with the one in the last scan report.

## The skill verdict

`guard.checkSkill(entries)` takes the files of a skill bundle and resolves with:

| Field | Meaning |
| :--- | :--- |
| `tier` | The tier of the registry for this bundle. |
| `safe` | True only for `COMMUNITY_SAFE` and `WARRANTY_BACKED_SAFE`. |
| `canonicalBundleHash` | The canonical hash of the bundle, computed here from the entries. |
| `publisher` | The publisher that the root `SKILL.md` declares, or null. |
| `flags` | The active flags of the bundle target, by name. |
| `warrantyBond` | The active warranty bond of the publisher, in wei, or zero without a vault. |
| `reasons` | Plain English sentences that explain the verdict. |

The hash is computed from the files, so a changed file changes the answer. The entries are the same
ones the scanner produces: a path, a kind of `file` or `symlink`, and the bytes.

## The community signal

`guard.signal(targetId)` resolves with the signal of a target, with the two groups apart:

| Field | Meaning |
| :--- | :--- |
| `newIds` | The votes of the Agent IDs that carry weight 1. |
| `guardians` | The votes of the Guardians that carry weight 2 or more. |

Each group holds the `votes` per verdict, the combined `weight` per verdict and the `flags` that
the group reported. The signal is never collapsed into one number.

## When a read fails

Every read either answers or throws. A failed read never becomes a safe verdict, and it never
becomes a quiet no. If the node does not answer, the promise rejects and the caller decides what to
do.

## Notes

- The guard reads only. It never signs, never sends a transaction, and never approves a token.
- The tier names, the flags and the target ids come from the shared rules, so they never drift from
  the contracts.
- The proxy inspection comes from the scanner, so both read the same slots.
- The package is private to this workspace for now. Publishing it to the registry needs a build
  step for the SDK and for the workspace packages it depends on, because they ship TypeScript
  sources.
