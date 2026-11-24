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
| Which outside accounts and keys exist, and where each variable lives | [docs/service-accounts.md](docs/service-accounts.md) |

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
| 1. On-chain | `contracts/`, plus the landing page, the docs page, and all service accounts and keys | founder (@zakyirsyaad) |
| 2. Scanning | `packages/scanner-core`, `packages/sandbox-worker` | second developer (@Nant361) |
| 3. Application | `apps/` except landing and docs, `packages/sdk`, `packages/skill` | third developer (@maziazi) |

Stay inside your lane's folders. Two lanes never edit the same files. Every pull request from a
developer needs the founder's approval: `.github/CODEOWNERS` names the founder on every path.

Work is tracked on the private [Sealflare project](https://github.com/users/zakyirsyaad/projects/6).
Every plan task is a card, named `[Lane n] title` after its plan task, and the founder's work outside
the plans has `[Founder]` cards. Each card has:

- **Lane**: `0. Foundation`, `1. On-chain`, `2. Scanning` or `3. Application`.
- **Status**: Todo, In Progress or Done.
- **Stage**: `M1`, `M2` or `Release`, the milestone the task must be finished for.
- **Assignee**: the lane owner.

Use one board view with Status as columns, sliced by Lane, and filter `assignee:@me` for your own
cards. Move your card to In Progress when you start a task and to Done when its commit lands on
`main`. Cards are drafts; convert one to an issue if it needs discussion. The board has no due
dates: the only deadline is the hackathon's.

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
- Every change reaches `main` through a pull request: one branch and one PR per plan task. Two
  rulesets guard `main`. "main: CI and history" requires the five CI checks (TypeScript, contracts,
  ABI, web build, secret scan) and blocks force pushes and deletion, with no bypass. "main:
  founder review" requires the founder's approval as code owner; only the founder, as repository
  admin, can bypass it, so the founder's own PRs merge on green CI alone. Merges are squash only,
  so the PR title becomes the commit message on `main` and must follow the format below.
- `pnpm verify` does not run the formatter: run `forge fmt` in `contracts/` before committing
  Solidity. Frozen files are excluded in `foundry.toml`.
- Commit messages: `<type>: <description>` with type one of feat, fix, refactor, docs, test, chore,
  perf, ci. No `Co-Authored-By` trailer.
- Commit only when asked. Never push, deploy, or send a mainnet transaction on your own.
- The plans are written to be executed task by task. Each task lists its files, the exact
  signatures it produces, and its tests.
