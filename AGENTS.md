# Sealflare: notes for coding agents

Sealflare is a security registry and AI skill firewall on BNB Chain. Agent ID holders attest to
contracts and skills, disputes are settled by a staked commit-reveal jury, and any contract can
read the result through `IFirewall`. It is a hackathon project with a hard deadline:
9 December 2026, 15:00 WIB.

## Where things are

| You need | Read |
| :--- | :--- |
| What the system is and why | [docs/architecture.md](docs/architecture.md) (Indonesian; the binding spec) |
| What every screen does, its states and exact UI strings | [docs/ux.md](docs/ux.md) (Indonesian prose, English UI strings) |
| How it looks | [docs/design/README.md](docs/design/README.md), then the files it points to |
| What to build next in your lane | [docs/plans](docs/plans): `onchain`, `scanning`, `application` |
| How to run things | [README.md](README.md) |

If two documents disagree: `docs/architecture.md` wins over `sealflare.md`, and the frozen code in
`shared/` and `contracts/src/interfaces/` wins over any prose about it.

## Design

Before building or changing any screen, read [docs/design/README.md](docs/design/README.md). It
lists the eight designed screens with their routes, the tokens, the components, and the rules that
are easy to break. Live versions, for Claude users (private until the founder shares them):

- Visual canvas: https://claude.ai/artifact/X8KxdB8hnoQr342ivZnU1d
- Sealflare Design System: https://claude.ai/artifact/FmyjzsWpiP1fKSe44foWvZ

The short version: neutral greys, one lime, radius 0, hairlines instead of shadows, Instrument Sans
and Geist Mono, dark and light themes, and a round seal as the only round shape.

## Three lanes

| Lane | Folders | Owner |
| :--- | :--- | :--- |
| 1. On-chain | `contracts/`, plus the landing page, the docs page, and all service accounts and keys | founder |
| 2. Scanning | `packages/scanner-core`, `packages/sandbox-worker` | second developer |
| 3. Application | `apps/` except landing and docs, `packages/sdk`, `packages/skill` | third developer |

Stay inside your lane's folders. Two lanes never edit the same files.

## Frozen agreements

Everything under `shared/` and `contracts/src/interfaces/`, and the libraries `Constants`, `Rules`,
`Ids` and `BindTypes` in `contracts/src/lib/`, is frozen at the git tag `v0-frozen`. The other
lanes build on them. Do not change them. If your work needs a change there, stop, write it under
"Perubahan yang perlu disetujui founder" in your lane's plan, and ask the founder.

Tier, weight, XP, flags and target ids exist in both TypeScript and Solidity and are tested against
the same vectors in `shared/rules/vectors`. Import them; never write a second copy.

## Rules that hold everywhere

- The server never signs a transaction. Every on-chain write comes from the user's wallet.
- No unlimited token approval, anywhere.
- No failure path may produce a SAFE result. When in doubt, the answer is CAUTION or no verdict.
- A skill's scripts are never executed. The sandbox only reads `SKILL.md` as text.
- No proxy, no owner, no pause, no token in the contracts.
- No secret in the repository, and no paid key in a `NEXT_PUBLIC_` variable.
- Validate every input at a boundary with the shared Zod schemas.
- All UI text is English, sentence case, with no em dash and no emoji.
- Files stay under about 400 lines and functions under 50. Do not mutate inputs.

## Working here

```bash
pnpm install
pnpm verify        # TypeScript tests and typecheck, Foundry tests, ABI sync check
pnpm chain         # local Anvil with the stub contracts; wait for "Local chain ready"
pnpm chain:seed    # Agent IDs for five local accounts and three sample targets
```

- Write the failing test first, watch it fail, then implement. `pnpm verify` must pass before a commit.
- Commit messages: `<type>: <description>` with type one of feat, fix, refactor, docs, test, chore,
  perf, ci. No `Co-Authored-By` trailer.
- Commit only when asked. Never push, deploy, or send a mainnet transaction on your own.
- The plans are written to be executed task by task. Each task lists its files, the exact
  signatures it produces, and its tests.
