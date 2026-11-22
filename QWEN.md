# Sealflare — Qwen Code context

[AGENTS.md](AGENTS.md) loads alongside this file and is the canonical rule set: the three lanes,
the frozen agreements, and the rules that hold everywhere. This file does not repeat them. It adds
the verified commands, the toolchain pins, and the current state of the repo.

Sealflare is a security registry and AI skill firewall on BNB Chain. Hackathon deadline:
9 December 2026, 15:00 WIB. When documents disagree, `docs/architecture.md` wins over
`sealflare.md`, and the frozen code in `shared/` and `contracts/src/interfaces/` wins over prose.

## Toolchain

- Node 24 (`.nvmrc`), pnpm 12.10.1 (`packageManager` field).
- Foundry v1.7.1 (the CI pin): `forge`, `anvil`, `cast`. Solidity 0.8.28, EVM `cancun`,
  optimizer 200 runs, fuzz 512 runs (`contracts/foundry.toml`).
- `contracts/lib/forge-std` is a git submodule (v1.17.0). Clone with `--recurse-submodules`.
- TypeScript strict with `noUncheckedIndexedAccess`, `noEmit` (`tsconfig.base.json`).
  Tests are Vitest; validation is Zod v4; chain reads use viem.

## Commands

Quoted from the root `package.json`; CI (`.github/workflows/ci.yml`) runs the same `pnpm verify`.

```bash
pnpm install
pnpm verify        # pnpm -r test && pnpm -r typecheck && forge test --root contracts && pnpm abi:check

pnpm --filter @sealflare/shared test        # vitest run
pnpm --filter @sealflare/shared typecheck   # tsc --noEmit
forge test --root contracts                 # all Solidity tests
forge test --root contracts --match-path test/Rules.t.sol   # one test file

pnpm chain         # Anvil on 127.0.0.1:8545 with the stub contracts; wait for "Local chain ready"
pnpm chain:seed    # Agent IDs for five local accounts and three sample targets
pnpm chain:warp 43200   # move the chain clock forward, here by 12 hours

pnpm abi:export    # regenerate shared/abi from the Solidity interfaces
pnpm abi:check     # export, then fail if git diff shows any change in shared/abi
```

`abi:check` failing means the interfaces and the exported ABIs drifted. Both sides are frozen;
do not fix it by editing either side on your own. Stop and ask the founder.

## Current state (verified 2026-11-22)

- The only workspace package is `shared/` (`@sealflare/shared`). `apps/` and `packages/` do not
  exist yet; the lane plans create them.
- `contracts/` holds the frozen interfaces and libs (`Constants`, `Rules`, `Ids`, `BindTypes`),
  local-only stubs (`CoreStub`, `CourtStub`, `VaultStub`, `MockAgentID`), deploy and seed scripts,
  and the vector tests. The production `Core`, `Court`, `Vault` are not written yet.
- Plan 0 (foundation) is done and tagged `v0-frozen`. The next work is in
  `docs/plans/2026-11-22-onchain.md`, `-scanning.md`, `-application.md`, executed task by task.
- `shared/rules/vectors/*.json` is the single source of truth for tier, weight, XP, flags and
  target ids. TypeScript tests (`shared/test`) and Solidity tests (`contracts/test/VectorTest.sol`)
  run against the same files; `foundry.toml` grants read access to that folder. Import the rules,
  never copy them.
- Import surface of the shared package: `@sealflare/shared/rules`, `/schemas`, `/abi`,
  `/fixtures/*`. Local chain addresses land in `shared/abi/addresses.local.json` (not committed).

## Where to read next

| You need | Read |
| :--- | :--- |
| What the system is and why (binding spec, Indonesian) | [docs/architecture.md](docs/architecture.md) |
| Every screen, its states and exact UI strings | [docs/ux.md](docs/ux.md) |
| Tokens, components, and the rules that are easy to break | [docs/design/README.md](docs/design/README.md) |
| What to build next in your lane | [docs/plans](docs/plans) |
| How to run things | [README.md](README.md) |
