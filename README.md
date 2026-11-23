# Sealflare

Sealflare is a security registry and AI skill firewall on BNB Chain. Agent ID holders attest to
contracts and skills, disputes are settled by a staked commit-reveal jury, and any contract can read
the result through `IFirewall`.

The design lives in [docs/architecture.md](docs/architecture.md) and [docs/ux.md](docs/ux.md); the look is in
[docs/design](docs/design/README.md). Coding agents start at [AGENTS.md](AGENTS.md).
The contracts have not had a third-party audit.

## Requirements

- Node 24 and pnpm
- Foundry 1.7 (`forge`, `anvil`, `cast`)

## Getting started

```bash
git clone --recurse-submodules <repository url>
pnpm install
pnpm verify
```

`pnpm verify` runs the TypeScript tests and typecheck, the Foundry tests, and checks that the ABIs
in `shared/abi` match the Solidity interfaces. CI runs the same command.

## Local chain

```bash
pnpm chain          # Anvil on 127.0.0.1:8545 with the stub contracts; wait for "Local chain ready"
pnpm chain:real     # the same, with the real Core, Vault and Court instead of the stubs
pnpm chain:seed     # Agent IDs for the first five Anvil accounts and three sample targets
pnpm chain:warp 43200   # move the clock forward, here by 12 hours
```

Both write the addresses to `shared/abi/addresses.local.json` in the same shape, and `chain:seed`
works with either. The stubs in `contracts/src/stubs` emit the final events and accept any caller,
which makes UI work quick. The real contracts enforce every rule: Agent ID checks, stakes, phase
windows, the 48 hour settlement delay. Use `chain:real` to check a flow end to end. Both are for
local development only.

## Start your lane

| Lane | You own | You read from `shared/` | What stands in for the other lanes |
| :--- | :--- | :--- | :--- |
| 1. On-chain | `contracts/`, the landing page and docs, service accounts and keys | `rules/vectors` | Nothing. The contracts depend on no other lane. |
| 2. Scanning | `packages/scanner-core`, `packages/sandbox-worker` | `rules` (bundle hash, flags), `schemas` (scan, sandbox, scanner, internal) | `fixtures/bundles`, `fixtures/scans`, `fixtures/sandbox`, and a fake LLM |
| 3. Application | `apps/` except the landing page and docs, `packages/sdk`, `packages/skill` | `abi`, `rules`, `schemas` (api, evidence, shortProof) | The stub contracts on the local chain, and `fixtures/api` as a fake API |

## What is frozen

Everything under `shared/` and `contracts/src/interfaces/` is an agreement between the three lanes:
the rules for weight, tier and XP, the bundle hash, the contract interfaces and events, and the
schemas. Tier, weight, XP and target ids are implemented in both TypeScript and Solidity and tested
against the same vectors in `shared/rules/vectors`.

After the `v0-frozen` tag, a change to either folder needs the founder's approval, because the
other lanes build on it.
