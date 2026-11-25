# @sealflare/skill

The read only Sealflare companion skill. It reads the registry, runs the Layer 1 checks on a skill
bundle that is already on the machine, and prepares the parameters of an attestation.

It never holds a key, it never signs and it never puts a transaction on the chain. The wallet of the
user does that. The publisher address in [SKILL.md](SKILL.md) is the zero address until the founder
replaces it with the release address.

## Commands

Every command needs the address of the deployed `Core` contract. The RPC endpoint comes from
`RPC_URL` in the environment or from `--rpc <url>`.

```bash
pnpm --filter @sealflare/skill scan-contract <address> --core <core address>
pnpm --filter @sealflare/skill scan-skill <folder> --core <core address>
pnpm --filter @sealflare/skill prepare-attestation <address> --verdict <SAFE|CAUTION|DANGER> --core <core address>
```

`scan-contract` prints the tier, the flags and the community signal. `scan-skill` prints the
canonical bundle hash and the findings of the Layer 1 checks, which read the files of the bundle as
text and never run a script of it. `prepare-attestation` prints the parameters of `attest()` and a
summary, then stops.

## Tests

```bash
pnpm --filter @sealflare/skill test
```

The suite runs the scripts against a fake chain, checks that no script signs or writes a file, and
scans this package with the Layer 1 checks of `@sealflare/scanner-core`. The skill has to pass its
own scan.
