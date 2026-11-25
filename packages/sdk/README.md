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
implements `IFirewall`. The guard asks Core, never the vault, so the bond it reports is the bond
that the tier was decided on.

## The contract verdict

`guard.checkContract(address)` resolves with:

| Field | Meaning |
| :--- | :--- |
| `tier` | The tier of the registry: `UNRATED`, `COMMUNITY_SAFE`, `WARRANTY_BACKED_SAFE`, `CAUTION_FLAGGED`, `DISPUTED_CAUTION`, `CONFIRMED_DANGER` or `STALE_CODEHASH_DRIFT`. |
| `safe` | True only for `COMMUNITY_SAFE` and `WARRANTY_BACKED_SAFE`, and never for a proxy. |
| `isUpgradeableProxy` | True when the address can change its own code: a standard proxy, the marker of the registry, or code that holds the delegatecall opcode. |
| `implementationChanged` | True when the code behind the proxy moved since the baseline of the last scan, false when it did not, and null when there is no baseline. |
| `flags` | The active flags of the target, by name. |
| `warrantyBond` | The bond of the verified publisher, in wei, as the firewall reports it. Zero when the target has no verified publisher. |
| `reasons` | Plain English sentences that explain the verdict. |

A contract can be a proxy that changes its implementation without anyone noticing. The on-chain
firewall cannot see that, because a contract cannot read the storage of another contract. The guard
reads the implementation slot over RPC, so it can tell you that the address is a proxy at all.

The registry marker only lights up when someone probed the bytecode, so the guard also reads the
bytecode itself. Code that holds the `DELEGATECALL` opcode can run the code of another contract, so
the guard treats it as a proxy and never calls it safe.

`Core` pins the code hash of the target itself and cannot read the implementation slot, so the
pinned hash is no baseline for the implementation. The guard therefore reports `null` for
`implementationChanged` until it gets a real baseline. Pass the implementation that the last scan
found to get a real answer:

```ts
const verdict = await guard.checkContract(address, { address: implementation, codehash })
```

A proxy is never safe in any case, whatever the implementation does.

## The skill verdict

`guard.checkSkill(entries)` takes the files of a skill bundle and resolves with:

| Field | Meaning |
| :--- | :--- |
| `tier` | The tier of the registry for this bundle. |
| `safe` | True only for `COMMUNITY_SAFE` and `WARRANTY_BACKED_SAFE`. |
| `canonicalBundleHash` | The canonical hash of the bundle, computed here from the entries. |
| `publisher` | The publisher the registry verified, or null when it verified none. |
| `flags` | The active flags of the bundle target, by name. |
| `warrantyBond` | The bond of the verified publisher, in wei, as the firewall reports it. |
| `reasons` | Plain English sentences that explain the verdict. |

The hash is computed from the files, so a changed file changes the answer. The entries are the same
ones the scanner produces: a path, a kind of `file` or `symlink`, and the bytes.

The publisher is the one the registry verified on chain. The address that a bundle writes in its own
`SKILL.md` is only a claim, so the guard never reports it as the publisher of the bundle.

## The community signal

`guard.signal(targetId)` resolves with the signal of a target, with the two groups apart:

| Field | Meaning |
| :--- | :--- |
| `newIds` | The votes of the Agent IDs that carry weight 1. |
| `guardians` | The votes of the Guardians, that is weight 2 and above, and the votes that carry no weight after a penalty. |

Each group holds the `votes` per verdict, the combined `weight` per verdict and the `flags` that
the group reported. The signal is never collapsed into one number.

A vote of weight 0 comes from a Guardian whose score went negative. It is never a new Agent ID, so
it is counted with the Guardians. It adds no weight, but its verdict and its flags stay visible.

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
