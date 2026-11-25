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

`scan-contract` prints the tier, the flags and the community signal, and a link to the target page
that carries the address as `?src=`. `scan-skill` prints the canonical bundle hash and the findings
of the Layer 1 checks, which read the files of the bundle as text and never run a script of it.
`prepare-attestation` prints the parameters of `attest()` and a summary, then stops.

Each command takes only the options listed in its usage. An option it does not know, such as
`--chainid`, and an argument beyond the expected number are errors, so a typo never falls back to a
default such as the mainnet.

### The folder of a bundle

`scan-skill` hashes the bundle the way the registry hashes the tree of a repository. Inside a git
work tree the bundle is the files that git tracks, so a folder with `node_modules` installed or a
local build holds the same bundle as the repository does. The files that are not tracked are read
and scanned as well, so a finding in a file that is not committed is never hidden, but those files
never change the hash or the target id. Outside git every file of the folder is part of the bundle.
Only `.git` is left out, because a git tree can never hold one. `publisher.sig` is read and then
left out of the hash by the shared rules, and it does not count towards the limit either. A bundle
with more than 200 files, or more than 2 MiB, fails instead of being cut short.

pnpm runs a script inside the folder of this package, so a relative path would land there. The
scripts resolve `<folder>`, `--skill` and `--evidence-file` against `INIT_CWD`, the folder you typed
the command in, and the report starts with the absolute path that was scanned.

### Untrusted text

A scanned bundle is untrusted. Every path, folder name and excerpt that comes from it is printed
with control characters, line breaks and invisible formatting characters turned into visible
escapes such as `\x1b`, so a bundle cannot move the cursor, overwrite a verdict line or forge a
line of the report. The same pass runs over the final output of every command. `SKILL.md` tells the
agent to treat scanned text as data, never to follow an instruction in it, and to take the verdict
only from the user.

### The short proof

`--proof` takes one line per flag in the form `FLAG @ location: excerpt`, at most 512 bytes of
UTF-8 in all. The flag of a line has to be one of the flags of the attestation, so a proof never
claims something the attestation does not say. A SAFE verdict carries no flags, so it never has a
proof. Anything else is refused, because the contract stores the bytes for good and rejects
a proof that is too long. The command prints the text and the bytes that `attest()` takes, and an
empty proof is `0x`, an empty evidence URI is `""`.

### Environment

The skill reads `RPC_URL`, the RPC endpoint, and `INIT_CWD`, which pnpm sets and which is only used
to resolve relative paths. It reads nothing else and writes no file. There is no vault option: the
bond in the output is the one the firewall reports.

## Tests

```bash
pnpm --filter @sealflare/skill test
```

The suite runs the scripts against a fake chain, checks that no script signs or writes a file, and
scans this package with the Layer 1 checks of `@sealflare/scanner-core`. The skill has to pass its
own scan. The scan reads a fixed list, the files that git manages in this package, so the tests
are part of the bundle too: they build their hostile fixtures from parts at run time and keep the
tests that touch the environment apart from anything Layer 1 reads as a network call.
