# Rencana Implementasi 0: Fondasi Sealflare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membekukan enam perjanjian di `shared/` sebagai kode yang bisa dijalankan, ditambah kontrak stub dan jaringan lokal, supaya tiga jalur bisa mulai bekerja tanpa saling menunggu.

**Architecture:** Monorepo pnpm dengan satu paket `@sealflare/shared` (aturan, skema, ABI, fixture) dan satu proyek Foundry di `contracts/`. Aturan tier, bobot, XP, dan identitas target ditulis dua kali, TypeScript dan Solidity, lalu diuji terhadap vektor JSON yang sama. Kontrak stub memancarkan event final sehingga web dan indexer bisa dibangun sebelum kontrak asli ada.

**Tech Stack:** Node 24, pnpm 12, TypeScript (strict), Vitest, Zod, viem, yaml; Foundry 1.7 (forge, anvil, cast), Solidity 0.8.28, EVM `cancun`.

**Spec:** [docs/architecture.md](../architecture.md) (Bagian 3, 4, 5.3, 5.4, 9, 12.1) dan [docs/ux.md](../ux.md) (Bagian 6.6). Bila rencana ini dan spesifikasi berbeda, lihat "Keputusan yang dibuat rencana ini".

## Posisi rencana ini

| Rencana | Isi | Pemegang | Status |
| :--- | :--- | :--- | :--- |
| **0. Fondasi** (dokumen ini) | `shared/`, stub, jaringan lokal, CI | founder | ditulis |
| 1. On-chain | `Core`, `Court`, `Vault` versi lengkap, tes invarian dan fork, deploy | founder | ditulis setelah Rencana 0 selesai |
| 2. Pemindaian | `scanner-core`, `sandbox-worker` | developer kedua | sama |
| 3. Aplikasi | `apps/web`, `apps/internal`, `apps/indexer`, `sdk`, `skill` | developer ketiga | sama |

Jadwal yang mengikat: Rencana 0 selesai 23 November. Titik temu pertama 28 sampai 30 November. `Core` di mainnet paling lambat 1 Desember. Submisi 9 Desember 2026, 15:00 WIB.

## Global Constraints

- Solidity `0.8.28`, `evm_version = "cancun"`, optimizer aktif 200 run. Tidak ada proxy, tidak ada `Ownable`, tidak ada token, tidak ada `receive()` di `Vault`.
- Alamat Agent ID: `0x60b9262456de011f7d15a54cdd8c48baaa8b022f`. Chain ID mainnet `56`, lokal `31337`.
- Nilai nominal: `CHALLENGE_STAKE = 0.01 ether`, `JURY_STAKE = 0.005 ether`, `MAX_WARRANTY_BOND = 0.5 ether`, `MAX_BOUNTY = 0.2 ether`.
- Waktu: commit 12 jam, reveal 12 jam, penyelesaian XP 48 jam, jeda bond 7 hari, cooldown tantangan 7 hari, jendela kedaluwarsa berulang 30 hari, batas bounty 7 hari.
- Batas: 5 attestation per hari per alamat (hari UTC), 5 run sandbox per hari, kuorum 3 reveal, 3 sampai 5 slot bounty, `shortProof` maksimal 512 byte.
- Tidak ada jalur kode di mana kegagalan menghasilkan `SAFE`. Skema menolak laporan yang melanggar ini.
- Semua teks yang tampil ke pengguna berbahasa Inggris dan tidak memakai em dash.
- Tidak ada rahasia di repositori. Tidak ada variabel `NEXT_PUBLIC_` untuk kunci berbayar.
- Commit memakai format `<type>: <description>` tanpa trailer `Co-Authored-By`.
- Berkas sumber di bawah 400 baris bila memungkinkan, fungsi di bawah 50 baris, data tidak dimutasi di tempat.

## Keputusan yang dibuat rencana ini

Spesifikasi tidak menetapkan hal-hal berikut. Rencana ini memutuskannya karena perjanjian tidak bisa dibekukan tanpanya. Task 8 menuliskannya kembali ke `docs/architecture.md`.

| # | Keputusan | Alasan |
| :---: | :--- | :--- |
| K1 | `contentHash = keccak256(leaf_0 ‖ … ‖ leaf_n)`, dengan `leaf = keccak256(keccak256(pathUtf8) ‖ kindByte ‖ keccak256(bytes))`, `kindByte` 0 untuk file dan 1 untuk symlink | Lebar tetap, jadi tidak ambigu; path dan isi tidak bisa saling bergeser |
| K2 | Batas bundel: 200 file, 2.097.152 byte total. `SKILL.md` untuk sandbox maksimal 65.536 byte | Spesifikasi menyebut "ada batas" tanpa angka |
| K3 | Alamat penerbit dibaca dari frontmatter YAML `SKILL.md` di akar: `metadata.sealflare-publisher`. Apa pun yang tidak sah berarti `address(0)` | Field `metadata` diizinkan konvensi skill; kunci tingkat atas baru bisa ditolak validator |
| K4 | Flag harus berada di dalam mask jenis target. `SAFE` wajib tanpa flag; `CAUTION` dan `DANGER` wajib minimal satu flag | "Fakta biner" di blueprint; `SAFE` berflag adalah kontradiksi |
| K5 | `IFirewall.verifyContract` mengembalikan `pinnedCodehash`, bukan `pinnedImplHash` | `Core` tidak bisa membaca slot implementasi (arsitektur 4.5); nama lama menyesatkan pemanggil |
| K6 | `IVault` mendapat fungsi keempat khusus `Court`: `settleBond(challengeId, slashBps)` | `distribute` saja tidak bisa memotong bond lalu mengembalikan sisanya ke penyetor |
| K7 | `MAX_JURORS = 21` per sengketa | `resolve` membagi dana ke semua juri dalam satu transaksi; tanpa batas, juri tambahan bisa membuatnya melampaui gas blok selamanya |
| K8 | Urutan enum `PublisherRole`: `NONE`, `THIRD_PARTY_SPONSOR`, `VERIFIED_PUBLISHER` | Mengikuti urutan naik di arsitektur 4.4, bukan urutan blueprint |
| K9 | `evidenceHash = keccak256` atas byte persis yang diunggah ke IPFS | Pemeriksa cukup meng-hash berkas yang diunduh; tidak perlu aturan kanonisasi JSON |
| K10 | Repositori skill hanya GitHub. Sumber target ditulis `0x…` untuk kontrak dan `gh:<owner>/<repo>@<commit 40 hex>:<path>` untuk skill | Satu pengambil repositori cukup untuk hackathon |
| K11 | Layanan internal yang memanggil worker (`POST /runs`, lalu `GET /runs/:id`), bukan sebaliknya | Worker tidak boleh membuka koneksi ke layanan internal (arsitektur 5.2) |
| K12 | Skema baca (`targets`, `guardians`, `challenges`, `bounties`, `activity`) dan endpoint Vercel ke layanan internal tidak dibekukan di sini | Kedua sisinya milik Jalur 3; dibuat di Rencana 3 |
| K13 | Galat kustom dideklarasikan di dalam interface yang melemparnya, tanpa berkas galat terpisah | Galat tingkat berkas tidak ikut ke ABI interface, padahal web menerjemahkannya dari ABI |

## Review Focus

Lima masukan yang paling mungkin merusak tanpa disebut spesifikasi. Masing-masing punya tes di task pemiliknya.

1. Path bundel yang absolut, memuat segmen `..`, segmen kosong, atau byte NUL: ditolak dengan `INVALID_PATH`, bukan di-hash (Task 2).
2. Dua entri dengan path yang sama: ditolak dengan `DUPLICATE_PATH` (Task 2).
3. Flag dengan bit 16 ke atas, atau bit jenis target lain: `isValidFlags` mengembalikan `false` di TypeScript dan Solidity (Task 1 dan Task 3).
4. Karakter multibyte tepat di batas 512 byte `shortProof`: dipotong di batas karakter, hasilnya tetap UTF-8 sah (Task 6).
5. Hasil sandbox yang memuat satu pelanggaran dan beberapa run galat: statusnya `SANDBOX_FUZZ_FAILED`, tidak pernah `INCOMPLETE` (Task 6).

## Struktur berkas

```
package.json  pnpm-workspace.yaml  tsconfig.base.json  .nvmrc
shared/
  package.json  tsconfig.json  vitest.config.ts  index.ts
  rules/    flags.ts  weight.ts  tier.ts  xp.ts  constants.ts  ids.ts  bundleHash.ts  manifest.ts  index.ts
            vectors/  weight.json  tier.json  xp.json  flags.json  constants.json  ids.json
  schemas/  scan.ts  scanner.ts  evidence.ts  shortProof.ts  api.ts  internal.ts  index.ts
  abi/      ICore.json  ICourt.json  IVault.json  IFirewall.json  index.ts  addresses.local.json (tidak di-commit)
  fixtures/ bundles/*.json  scans/*.json  sandbox/*.json  evidence/*.json  api/*.json
  scripts/  export-abi.ts
  test/     satu berkas tes per berkas sumber
contracts/
  foundry.toml
  src/interfaces/  Types.sol  IFirewall.sol  ICore.sol  ICourt.sol  IVault.sol  IAgentID.sol
  src/lib/         Constants.sol  Rules.sol  Ids.sol
  src/stubs/       CoreStub.sol  CourtStub.sol  VaultStub.sol  MockAgentID.sol
  script/          DeployLocal.s.sol  SeedLocal.s.sol
  test/            Rules.t.sol  Ids.t.sol  Stubs.t.sol
scripts/  chain.sh  warp.sh
.github/workflows/ci.yml
```

---

### Task 1: Workspace dan aturan bersama (flag, bobot, tier, XP, konstanta)

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc`
- Create: `shared/package.json`, `shared/tsconfig.json`, `shared/vitest.config.ts`
- Create: `shared/rules/{flags,weight,tier,xp,constants,index}.ts`
- Create: `shared/rules/vectors/{weight,tier,xp,flags,constants}.json`
- Test: `shared/test/rules.test.ts`

**Interfaces:**
- Produces (dari `@sealflare/shared/rules`):
  - `FLAGS: Record<FlagName, number>`, `FLAG_NAMES: readonly FlagName[]`, `CONTRACT_FLAGS_MASK = 0x00ff`, `SKILL_FLAGS_MASK = 0xff00`
  - `isValidFlags(targetType: TargetType, verdict: Verdict, flags: number): boolean`
  - `flagNames(flags: number): FlagName[]`
  - `weightOf(score: number): 0 | 1 | 2 | 3 | 4 | 5`
  - `tierOf(input: TierInput): TrustTier`
  - `attestationXp(input: { verdict: Verdict; safeOrdinal: number; eligible: boolean; confirmedDanger: boolean }): number`
  - `XP = { JUROR_MAJORITY: 3, CHALLENGER_WON: 5, CHALLENGER_LOST: -5, SAFE_ON_DANGER: -15 }`
  - `CONSTANTS` (lihat Step 1), `TRUST_TIERS`, `VERDICTS`, `TARGET_TYPES` sebagai tuple `as const` dengan urutan sama seperti enum Solidity
  - `type TierInput = { confirmedDanger: boolean; codehashDrift: boolean; activeDispute: boolean; safeWeight: number; cautionWeight: number; dangerWeight: number; proxyMarker: boolean; verifiedPublisherBond: boolean }`

- [ ] **Step 1: Tulis vektor uji**

`flags.json`, nama dan bit: `UNVERIFIED_SOURCE` 0, `HIDDEN_MINT` 1, `PAUSE_OR_FREEZE_FUNDS` 2, `MUTABLE_OR_HIGH_TAX` 3, `HONEYPOT_OR_BLACKLIST` 4, `UPGRADEABLE_NO_TIMELOCK` 5, `UNPINNABLE_DELEGATECALL` 6, `PERMIT_OR_DRAINER_PATTERN` 7, `PROMPT_BYPASS_CONFIRMATION` 8, `UNLIMITED_APPROVAL_REQUEST` 9, `HIDDEN_FIXED_TRANSFER` 10, `CREDENTIAL_OR_KEY_HARVESTING` 11, `EXTERNAL_MUTABLE_DEPENDENCY` 12, `TROJAN_HELPER_SCRIPT` 13, `OBFUSCATED_UNICODE_INJECTION` 14, `SANDBOX_FUZZ_FAILED` 15.

`weight.json`, baris `{ "score", "weight" }`: `-2147483648→0`, `-1→0`, `0→1`, `9→1`, `10→2`, `24→2`, `25→3`, `49→3`, `50→4`, `99→4`, `100→5`, `2147483647→5`.

`tier.json`, baris `{ "name", "confirmedDanger", "codehashDrift", "activeDispute", "safeWeight", "cautionWeight", "dangerWeight", "proxyMarker", "verifiedPublisherBond", "tier", "tierIndex" }`. Indeks tier: `UNRATED` 0, `COMMUNITY_SAFE` 1, `WARRANTY_BACKED_SAFE` 2, `CAUTION_FLAGGED` 3, `DISPUTED_CAUTION` 4, `CONFIRMED_DANGER` 5, `STALE_CODEHASH_DRIFT` 6. Kolom yang tidak disebut bernilai `false` atau `0`:

| name | masukan | tier |
| :--- | :--- | :--- |
| empty | (semua nol) | `UNRATED` |
| two-safe | safe 2 | `UNRATED` |
| three-safe | safe 3 | `COMMUNITY_SAFE` |
| three-safe-bond | safe 3, bond | `WARRANTY_BACKED_SAFE` |
| two-safe-bond | safe 2, bond | `UNRATED` |
| caution-equals-safe | safe 3, caution 3 | `CAUTION_FLAGGED` |
| caution-below-safe | safe 4, caution 3 | `COMMUNITY_SAFE` |
| danger-three | safe 42, danger 3 | `CAUTION_FLAGGED` |
| danger-two | safe 42, danger 2 | `COMMUNITY_SAFE` |
| lone-caution | caution 1 | `CAUTION_FLAGGED` |
| proxy-safe | safe 5, proxy | `CAUTION_FLAGGED` |
| proxy-bond | safe 5, bond, proxy | `CAUTION_FLAGGED` |
| proxy-only | proxy | `CAUTION_FLAGGED` |
| dispute-safe | safe 5, dispute | `DISPUTED_CAUTION` |
| dispute-over-danger | danger 3, dispute | `DISPUTED_CAUTION` |
| drift-over-dispute | drift, dispute | `STALE_CODEHASH_DRIFT` |
| danger-over-all | confirmedDanger, drift, dispute, safe 42, bond | `CONFIRMED_DANGER` |

`xp.json`, baris `{ "verdict", "safeOrdinal", "eligible", "confirmedDanger", "xp" }`: `SAFE,1,true,false→2`; `SAFE,3,true,false→2`; `SAFE,4,true,false→1`; `SAFE,10,true,false→1`; `SAFE,11,true,false→0`; `SAFE,1,false,false→0`; `SAFE,1,true,true→-15`; `SAFE,11,false,true→-15`; `CAUTION,0,true,false→0`; `CAUTION,0,true,true→0`; `DANGER,0,true,true→5`; `DANGER,0,true,false→0`.

`constants.json`, nilai wei dan detik sebagai string desimal: `CHALLENGE_STAKE "10000000000000000"`, `JURY_STAKE "5000000000000000"`, `MAX_WARRANTY_BOND "500000000000000000"`, `MAX_BOUNTY "200000000000000000"`, `COMMIT_WINDOW "43200"`, `REVEAL_WINDOW "43200"`, `SETTLE_DELAY "172800"`, `BOND_UNBONDING "604800"`, `CHALLENGE_COOLDOWN "604800"`, `EXPIRE_REPEAT_WINDOW "2592000"`, `BOUNTY_TIMEOUT "604800"`, `DAILY_ATTEST_LIMIT "5"`, `MIN_REVEALS "3"`, `MAX_JURORS "21"`, `BOUNTY_MIN_SLOTS "3"`, `BOUNTY_MAX_SLOTS "5"`, `BOUNTY_FEE_BPS "500"`, `BOND_SLASH_BPS "5000"`, `EXPIRE_FORFEIT_BPS ["2000","5000","10000"]`, `SHORT_PROOF_MAX_BYTES "512"`, `SANDBOX_DAILY_RUNS "5"`, `PROBE_RUNS "3"`, `MAX_BUNDLE_FILES "200"`, `MAX_BUNDLE_BYTES "2097152"`, `MAX_SKILL_MD_BYTES "65536"`.

- [ ] **Step 2: Tulis tes yang gagal di `shared/test/rules.test.ts`**

```ts
import { describe, expect, test } from 'vitest'
import weight from '../rules/vectors/weight.json'
import tier from '../rules/vectors/tier.json'
import xp from '../rules/vectors/xp.json'
import constants from '../rules/vectors/constants.json'
import { CONSTANTS, FLAGS, attestationXp, flagNames, isValidFlags, tierOf, weightOf } from '../rules'

test.each(weight)('weightOf($score) is $weight', ({ score, weight }) => {
  expect(weightOf(score)).toBe(weight)
})
test.each(tier)('tierOf $name is $tier', ({ name, tier, tierIndex, ...input }) => {
  expect(tierOf(input)).toBe(tier)
})
test.each(xp)('attestationXp $verdict #$safeOrdinal is $xp', ({ xp, ...input }) => {
  expect(attestationXp(input)).toBe(xp)
})
test('constants match the vector file', () => {
  expect(CONSTANTS.CHALLENGE_STAKE).toBe(BigInt(constants.CHALLENGE_STAKE))
  expect(CONSTANTS.MAX_JURORS).toBe(Number(constants.MAX_JURORS))
  expect(CONSTANTS.EXPIRE_FORFEIT_BPS).toEqual([2000, 5000, 10000])
})
describe('isValidFlags', () => {
  test('SAFE must carry no flags', () => {
    expect(isValidFlags('SMART_CONTRACT', 'SAFE', 0)).toBe(true)
    expect(isValidFlags('SMART_CONTRACT', 'SAFE', FLAGS.HIDDEN_MINT)).toBe(false)
  })
  test('CAUTION and DANGER need at least one flag', () => {
    expect(isValidFlags('SMART_CONTRACT', 'DANGER', 0)).toBe(false)
    expect(isValidFlags('AI_SKILL_BUNDLE', 'CAUTION', FLAGS.EXTERNAL_MUTABLE_DEPENDENCY)).toBe(true)
  })
  test('rejects flags of the other target type and bits above 15', () => {
    expect(isValidFlags('SMART_CONTRACT', 'DANGER', FLAGS.SANDBOX_FUZZ_FAILED)).toBe(false)
    expect(isValidFlags('AI_SKILL_BUNDLE', 'DANGER', FLAGS.HIDDEN_MINT)).toBe(false)
    expect(isValidFlags('AI_SKILL_BUNDLE', 'DANGER', 0x10000 | FLAGS.SANDBOX_FUZZ_FAILED)).toBe(false)
  })
})
test('flagNames lists set bits in bit order', () => {
  expect(flagNames(FLAGS.HIDDEN_MINT | FLAGS.UNVERIFIED_SOURCE)).toEqual(['UNVERIFIED_SOURCE', 'HIDDEN_MINT'])
})
```

- [ ] **Step 3: Siapkan workspace dan jalankan tes sampai gagal karena modul belum ada**

`pnpm-workspace.yaml` memuat `shared`, `packages/*`, `apps/*`. Root `package.json`: `"private": true`, `"engines": { "node": ">=24" }`, skrip `"test": "pnpm -r test"`. `shared/package.json`: nama `@sealflare/shared`, `"type": "module"`, `exports` untuk `./rules`, `./schemas`, `./abi`, dan `./fixtures/*`, skrip `"test": "vitest run"`. `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `resolveJsonModule`, `moduleResolution: "bundler"`, `target: "es2022"`.

Run: `pnpm install && pnpm --filter @sealflare/shared test`
Expected: FAIL, `Cannot find module '../rules'`

- [ ] **Step 4: Implementasikan `shared/rules/{flags,weight,tier,xp,constants,index}.ts`**

Tanda tangan ada di blok Interfaces. `tierOf` mengikuti delapan aturan arsitektur 4.6 secara berurutan dan berhenti di yang pertama cocok. Aturan 4 persisnya: `dangerWeight >= 3 || (cautionWeight + dangerWeight > 0 && cautionWeight + dangerWeight >= safeWeight)`. `CONSTANTS` memakai `bigint` untuk nilai wei dan `number` untuk sisanya.

- [ ] **Step 5: Jalankan tes sampai lulus**

Run: `pnpm --filter @sealflare/shared test`
Expected: PASS, semua baris vektor hijau

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .nvmrc shared
git commit -m "feat: add shared rules with test vectors for weight, tier, xp and flags"
```

---

### Task 2: Identitas target dan hash bundel

**Files:**
- Create: `shared/rules/{ids,bundleHash,manifest}.ts`, `shared/rules/vectors/ids.json`
- Create: `shared/fixtures/bundles/{basic,shuffled,zero-width,publisher-sig-root,publisher-sig-nested,symlink,with-publisher}.json`
- Modify: `shared/rules/index.ts` (ekspor ulang)
- Test: `shared/test/bundleHash.test.ts`, `shared/test/manifest.test.ts`

**Interfaces:**
- Consumes: `CONSTANTS.MAX_BUNDLE_FILES`, `CONSTANTS.MAX_BUNDLE_BYTES` dari Task 1
- Produces:
  - `type BundleEntry = { path: string; kind: 'file' | 'symlink'; bytes: Uint8Array }`
  - `contentHash(entries: readonly BundleEntry[]): Hex`, melempar `BundleError`
  - `class BundleError extends Error { code: 'EMPTY' | 'TOO_MANY_FILES' | 'TOO_LARGE' | 'DUPLICATE_PATH' | 'INVALID_PATH' }`
  - `canonicalBundleHash(contentHash: Hex, manifestPublisher: Address): Hex`
  - `targetIdOfContract(address: Address): Hex`, `targetIdOfSkill(canonicalBundleHash: Hex): Hex`
  - `readManifestPublisher(skillMd: Uint8Array): Address` (selalu mengembalikan alamat; `zeroAddress` bila tidak sah)
  - `ZERO_ADDRESS`

Format fixture bundel: `{ "entries": [{ "path", "kind", "hex" }], "manifestPublisher", "expected": { "contentHash", "canonicalBundleHash", "targetId" } }`.

- [ ] **Step 1: Tulis fixture tanpa nilai `expected`**

`basic`: `SKILL.md` (teks pendek dengan frontmatter `name` dan `description`) dan `scripts/run.sh`; `manifestPublisher` nol. `shuffled`: entri yang sama dengan urutan terbalik. `zero-width`: `basic` dengan U+200B disisipkan di `SKILL.md`. `publisher-sig-root`: `basic` ditambah `publisher.sig`. `publisher-sig-nested`: `basic` ditambah `scripts/publisher.sig`. `symlink`: `basic` ditambah `link` berjenis `symlink` dengan isi teks `../../etc/passwd`. `with-publisher`: `basic` dengan `manifestPublisher` `0x1111111111111111111111111111111111111111`.

- [ ] **Step 2: Tulis tes yang gagal**

```ts
// shared/test/bundleHash.test.ts
const load = (name: string) => /* baca shared/fixtures/bundles/<name>.json, ubah hex menjadi Uint8Array */
const hashOf = (name: string) => contentHash(load(name).entries)

test('order of entries does not change the hash', () => {
  expect(hashOf('shuffled')).toBe(hashOf('basic'))
})
test('a zero-width character changes the hash', () => {
  expect(hashOf('zero-width')).not.toBe(hashOf('basic'))
})
test('publisher.sig at the root is excluded', () => {
  expect(hashOf('publisher-sig-root')).toBe(hashOf('basic'))
})
test('publisher.sig in a subfolder is included', () => {
  expect(hashOf('publisher-sig-nested')).not.toBe(hashOf('basic'))
})
test('a symlink hashes its target text and differs from a file with the same bytes', () => {
  const asFile = load('symlink').entries.map((e) => ({ ...e, kind: 'file' as const }))
  expect(hashOf('symlink')).not.toBe(contentHash(asFile))
})
test('the publisher address is an input to the canonical hash', () => {
  const c = hashOf('basic')
  expect(canonicalBundleHash(c, '0x1111111111111111111111111111111111111111')).not.toBe(canonicalBundleHash(c, ZERO_ADDRESS))
})
test.each([
  ['EMPTY', []],
  ['DUPLICATE_PATH', [file('a'), file('a')]],
  ['INVALID_PATH', [file('/abs')]],
  ['INVALID_PATH', [file('a/../b')]],
  ['INVALID_PATH', [file('a//b')]],
  ['INVALID_PATH', [file('a\u0000b')]],
])('rejects %s', (code, entries) => {
  expect(() => contentHash(entries)).toThrowError(expect.objectContaining({ code }))
})
test('rejects more than 200 files and more than 2 MiB instead of truncating', () => {
  expect(() => contentHash(Array.from({ length: 201 }, (_, i) => file(`f${i}`)))).toThrowError(expect.objectContaining({ code: 'TOO_MANY_FILES' }))
  expect(() => contentHash([{ path: 'big', kind: 'file', bytes: new Uint8Array(2_097_153) }])).toThrowError(expect.objectContaining({ code: 'TOO_LARGE' }))
})
test.each(['basic', 'zero-width', 'symlink', 'with-publisher'])('%s matches its frozen expected values', (name) => {
  const f = load(name)
  const c = contentHash(f.entries)
  expect(c).toBe(f.expected.contentHash)
  expect(canonicalBundleHash(c, f.manifestPublisher)).toBe(f.expected.canonicalBundleHash)
  expect(targetIdOfSkill(f.expected.canonicalBundleHash)).toBe(f.expected.targetId)
})
```

```ts
// shared/test/manifest.test.ts
const md = (frontmatter: string) => new TextEncoder().encode(`---\n${frontmatter}\n---\nbody`)
test('reads metadata.sealflare-publisher', () => {
  expect(readManifestPublisher(md('name: x\nmetadata:\n  sealflare-publisher: "0x1111111111111111111111111111111111111111"')))
    .toBe('0x1111111111111111111111111111111111111111')
})
test.each([
  ['no frontmatter', new TextEncoder().encode('# just text')],
  ['no metadata key', md('name: x')],
  ['malformed address', md('metadata:\n  sealflare-publisher: "0x123"')],
  ['duplicate key', md('metadata:\n  sealflare-publisher: "0x1111111111111111111111111111111111111111"\n  sealflare-publisher: "0x2222222222222222222222222222222222222222"')],
  ['unparseable yaml', md('metadata: [unclosed')],
  ['byte order mark before frontmatter', new Uint8Array([0xef, 0xbb, 0xbf, ...md('metadata:\n  sealflare-publisher: "0x1111111111111111111111111111111111111111"')])],
])('returns the zero address for %s', (_, bytes) => {
  expect(readManifestPublisher(bytes)).toBe(ZERO_ADDRESS)
})
```

- [ ] **Step 3: Jalankan sampai gagal**

Run: `pnpm --filter @sealflare/shared test`
Expected: FAIL, `contentHash is not a function`

- [ ] **Step 4: Implementasikan `ids.ts`, `bundleHash.ts`, `manifest.ts`**

Aturan yang tidak ditentukan oleh tes:
- Urutan: byte UTF-8 path, naik, perbandingan per byte (bukan `localeCompare`).
- Hanya entri dengan path persis `publisher.sig` yang dibuang, sebelum batas dihitung.
- `leaf = keccak256(concat([keccak256(pathBytes), Uint8Array.of(kind === 'file' ? 0 : 1), keccak256(bytes)]))`; `contentHash = keccak256(concat(leaves))`.
- `canonicalBundleHash = keccak256(encodeAbiParameters([bytes32, address], [contentHash, publisher]))`.
- `targetIdOfContract = keccak256(encodeAbiParameters([uint8, address], [0, address]))`; `targetIdOfSkill = keccak256(encodeAbiParameters([uint8, bytes32], [1, hash]))`.
- Frontmatter: baris pertama harus persis `---`, berakhir di baris `---` berikutnya. Parser `yaml` dipakai dengan pengaturan bawaan (kunci ganda adalah galat). Alamat harus cocok `^0x[0-9a-fA-F]{40}$` dan dikembalikan dalam huruf kecil.

- [ ] **Step 5: Bekukan nilai `expected`**

Jalankan implementasi sekali terhadap tiap fixture, tulis hasilnya ke `expected`, lalu tulis `shared/rules/vectors/ids.json` berisi baris `{ "kind": "contract", "address", "targetId" }` dan `{ "kind": "skill", "contentHash", "publisher", "canonicalBundleHash", "targetId" }` (minimal dua per jenis). Task 3 memeriksa ulang nilai ini dengan Solidity; bila berbeda, yang salah adalah TypeScript.

- [ ] **Step 6: Jalankan sampai lulus, lalu commit**

Run: `pnpm --filter @sealflare/shared test`
Expected: PASS

```bash
git add shared
git commit -m "feat: add canonical bundle hash, target ids and manifest publisher rule"
```

---

### Task 3: Pustaka Solidity `Constants`, `Rules`, `Ids` yang lulus vektor yang sama

**Files:**
- Create: `contracts/foundry.toml`, `contracts/src/interfaces/Types.sol`, `contracts/src/lib/{Constants,Rules,Ids}.sol`
- Test: `contracts/test/Rules.t.sol`, `contracts/test/Ids.t.sol`

**Interfaces:**
- Consumes: `shared/rules/vectors/*.json` dari Task 1 dan 2
- Produces:
  - `Types.sol`: semua enum dan struct di bawah, tingkat berkas (tanpa kontrak pembungkus)
  - `library Rules { weightOf(int32) → uint8; tierOf(TierInput memory) → TrustTier; attestationXp(Verdict, uint32 safeOrdinal, bool eligible, bool confirmedDanger) → int32; isValidFlags(TargetType, Verdict, uint32) → bool }`, semuanya `internal pure`
  - `library Ids { targetIdOfContract(address) → bytes32; targetIdOfSkill(bytes32) → bytes32; canonicalBundleHashOf(bytes32 contentHash, address publisher) → bytes32 }`, semuanya `internal pure`
  - `library Constants` dengan nama dan nilai persis seperti `constants.json`

`Types.sol`:

```solidity
enum TargetType { SMART_CONTRACT, AI_SKILL_BUNDLE }
enum Verdict { SAFE, CAUTION, DANGER }
enum TrustTier { UNRATED, COMMUNITY_SAFE, WARRANTY_BACKED_SAFE, CAUTION_FLAGGED, DISPUTED_CAUTION, CONFIRMED_DANGER, STALE_CODEHASH_DRIFT }
enum PublisherRole { NONE, THIRD_PARTY_SPONSOR, VERIFIED_PUBLISHER }
enum BindMethod { OWNER, DEPLOYER, SKILL, SPONSOR }
enum ScoreReason { EARLY_SAFE, CONFIRMING_SAFE, DANGER_CONFIRMED, SAFE_ON_DANGER, JUROR_MAJORITY, CHALLENGER_WON, CHALLENGER_LOST }
enum ChallengePhase { NONE, COMMIT, REVEAL, AWAITING_CLOSE, CLOSED }
enum ChallengeOutcome { PENDING, UPHELD, REJECTED, TIED, EXPIRED }
enum JurorStatus { ELIGIBLE, NOT_AGENT_ID_HOLDER, PROFILE_TOO_NEW, NEGATIVE_SCORE, IS_CHALLENGER, IS_PUBLISHER, HAS_ATTESTED, ALREADY_COMMITTED, NOT_IN_COMMIT_PHASE, JURY_FULL }

struct TierInput { bool confirmedDanger; bool codehashDrift; bool activeDispute; uint32 safeWeight; uint32 cautionWeight; uint32 dangerWeight; bool proxyMarker; bool verifiedPublisherBond; }
struct TargetView { TargetType targetType; bytes32 target; bytes32 pinnedCodehash; bool hasDelegatecall; address publisher; PublisherRole publisherRole; uint32 safeWeight; uint32 cautionWeight; uint32 dangerWeight; uint32 activeFlags; uint32 attestationCount; uint32 safeCount; bool confirmedDanger; uint256 activeChallengeId; uint64 createdAt; }
struct AttestationView { address guardian; Verdict verdict; uint32 flags; uint8 weight; uint32 safeOrdinal; uint64 timestamp; bool settled; bool penalized; }
struct GuardianView { bool exists; int32 score; uint64 createdAtBlock; uint32 attestationCount; uint64 lastAttestDay; uint8 attestsToday; }
struct ChallengeView { bytes32 targetId; address challenger; uint32 flags; bytes32 evidenceHash; string evidenceURI; string counterEvidenceURI; uint64 openedAt; uint64 openedAtBlock; uint64 commitEndsAt; uint64 revealEndsAt; uint32 commits; uint32 reveals; uint32 upholdWeight; uint32 rejectWeight; ChallengeOutcome outcome; }
struct JurorView { bool committed; bool revealed; bool uphold; uint8 weight; bytes32 commitHash; }
struct BondView { uint256 amount; uint64 withdrawalAvailableAt; uint256 lockedByChallengeId; }
struct BountyView { bytes32 targetId; address requester; uint8 slots; uint256 amount; uint32 startIndex; uint64 createdAt; bool settled; }
```

Untuk kontrak, `target` adalah `bytes32(uint256(uint160(address)))`. Untuk skill, `target` adalah `canonicalBundleHash`.

- [ ] **Step 1: Buat proyek Foundry**

`forge init contracts`, hapus contoh `Counter` dan workflow bawaannya. `foundry.toml`: `solc = "0.8.28"`, `evm_version = "cancun"`, `optimizer = true`, `optimizer_runs = 200`, `fs_permissions = [{ access = "read", path = "../shared/rules/vectors" }, { access = "read-write", path = "../shared/abi" }]`.

- [ ] **Step 2: Tulis tes yang gagal**

`Rules.t.sol` membaca tiap berkas vektor per kolom dengan `vm.parseJson…Array(json, "$[*].<kolom>")` dan memeriksa tiap baris:

```solidity
function test_weight_matchesVectors() public view   // assertEq(Rules.weightOf(int32(score[i])), weight[i])
function test_tier_matchesVectors() public view     // assertEq(uint8(Rules.tierOf(input_i)), tierIndex[i])
function test_xp_matchesVectors() public view       // verdict dipetakan dari string ke enum
function test_constants_matchVectors() public view  // assertEq(Constants.CHALLENGE_STAKE, vm.parseJsonUint(json, ".CHALLENGE_STAKE")) untuk setiap kunci
function test_isValidFlags_safeNeedsNoFlags() public pure
function test_isValidFlags_rejectsOtherTypeAndHighBits() public pure   // 0x8000 untuk kontrak, 0x0002 untuk skill, 0x18000 untuk skill: semuanya false
function testFuzz_weight_neverAboveFive(int32 score) public pure
function testFuzz_tier_confirmedDangerAlwaysWins(TierInput memory i) public pure   // i.confirmedDanger = true
function testFuzz_tier_neverSafeWithProxyMarker(TierInput memory i) public pure    // bukan COMMUNITY_SAFE dan bukan WARRANTY_BACKED_SAFE
```

`Ids.t.sol` membaca `ids.json` dan memeriksa `targetIdOfContract`, `canonicalBundleHashOf`, dan `targetIdOfSkill` terhadap tiap baris.

Run: `forge test --root contracts`
Expected: FAIL, kompilasi gagal karena `Rules` belum ada

- [ ] **Step 3: Implementasikan `Types.sol`, `Constants.sol`, `Rules.sol`, `Ids.sol`**

`Ids` memakai `keccak256(abi.encode(TargetType.SMART_CONTRACT, target))`, `keccak256(abi.encode(TargetType.AI_SKILL_BUNDLE, hash))`, dan `keccak256(abi.encode(contentHash, publisher))`.

- [ ] **Step 4: Jalankan sampai lulus, lalu commit**

Run: `forge test --root contracts`
Expected: PASS. Bila `Ids.t.sol` gagal, perbaiki `shared/rules/ids.ts` dan bekukan ulang `expected`, bukan Solidity.

```bash
git add contracts .gitmodules
git commit -m "feat: add Solidity rules and ids libraries checked against shared vectors"
```

---

### Task 4: Interface kontrak, galat, dan ekspor ABI

**Files:**
- Create: `contracts/src/interfaces/{IAgentID,IFirewall,ICore,ICourt,IVault}.sol`
- Create: `shared/scripts/export-abi.ts`, `shared/abi/{ICore,ICourt,IVault,IFirewall}.json`, `shared/abi/index.ts`
- Modify: root `package.json` (skrip `abi:export`, `abi:check`)
- Test: `shared/test/abi.test.ts`

**Interfaces:**
- Consumes: `Types.sol` dari Task 3
- Produces: interface di bawah; `coreAbi`, `courtAbi`, `vaultAbi`, `firewallAbi` (`as const`) dari `@sealflare/shared/abi`; `EIP712` (nama domain dan tipe) dari `@sealflare/shared/abi`

```solidity
interface IFirewall {
    function verifyContract(address target) external view returns (TrustTier tier, bool isUpgradeableProxy, bytes32 pinnedCodehash, uint32 activeFlags, uint256 warrantyBondActive);
    function verifySkillBundle(bytes32 canonicalBundleHash) external view returns (TrustTier tier, address publisher, uint32 activeFlags, uint256 warrantyBondActive);
}

interface ICore is IFirewall {
    event ModulesSet(address court, address vault);
    event TargetCreated(bytes32 indexed targetId, TargetType targetType, bytes32 target, bytes32 pinnedCodehash);
    event GuardianCreated(address indexed guardian, uint64 createdAtBlock);
    event Attested(bytes32 indexed targetId, address indexed guardian, Verdict verdict, uint32 flags, uint8 weight, uint32 index, uint32 safeOrdinal, bytes32 evidenceHash, bytes shortProof, string evidenceURI);
    event PublisherBound(bytes32 indexed targetId, address indexed publisher, PublisherRole role, BindMethod method);
    event DelegatecallFlagged(bytes32 indexed targetId, address indexed caller);
    event AttestationSettled(bytes32 indexed targetId, uint32 index, int32 delta);
    event ScoreChanged(address indexed guardian, bytes32 indexed targetId, int32 delta, int32 newScore, ScoreReason reason);
    event DisputeMarked(bytes32 indexed targetId, uint256 indexed challengeId);
    event VerdictApplied(bytes32 indexed targetId, uint256 indexed challengeId, ChallengeOutcome outcome, uint32 flags);

    function agentId() external view returns (address);
    function deployer() external view returns (address);
    function court() external view returns (address);
    function vault() external view returns (address);
    function setModules(address court_, address vault_) external;

    function attest(TargetType targetType, bytes32 target, Verdict verdict, uint32 flags, bytes32 evidenceHash, bytes calldata shortProof, string calldata evidenceURI) external returns (bytes32 targetId);
    function bindByOwner(address target, address agentIdHolder, uint256 deadline, bytes calldata sig) external;
    function bindByDeployer(address target, address deployer_, uint256 nonce, address agentIdHolder, uint256 deadline, bytes calldata sig) external;
    function bindSkill(bytes32 contentHash) external returns (bytes32 targetId);
    function sponsor(bytes32 targetId) external;
    function probeBytecode(address target) external;
    function settle(bytes32 targetId, uint32 start, uint32 count) external;
    function applyPenalties(bytes32 targetId, uint32 start, uint32 count) external;

    function markDisputed(bytes32 targetId, uint256 challengeId) external;                                   // hanya Court
    function applyVerdict(bytes32 targetId, uint256 challengeId, ChallengeOutcome outcome, uint32 flags) external; // hanya Court
    function adjustScore(address guardian, bytes32 targetId, int32 delta, ScoreReason reason) external;       // hanya Court

    function targetIdOfContract(address target) external pure returns (bytes32);
    function targetIdOfSkill(bytes32 canonicalBundleHash) external pure returns (bytes32);
    function canonicalBundleHashOf(bytes32 contentHash, address publisher) external pure returns (bytes32);
    function getTarget(bytes32 targetId) external view returns (TargetView memory);
    function tierOf(bytes32 targetId) external view returns (TrustTier);
    function getAttestation(bytes32 targetId, uint32 index) external view returns (AttestationView memory);
    function attestationIndexOf(bytes32 targetId, address guardian) external view returns (bool attested, uint32 index);
    function getGuardian(address guardian) external view returns (GuardianView memory);
    function weightOf(address guardian) external view returns (uint8);
    function attestationsLeftToday(address guardian) external view returns (uint8);
    function isAgentIdHolder(address account) external view returns (bool);
    function pendingSettlement(bytes32 targetId) external view returns (uint32);
    function pendingPenalties(bytes32 targetId) external view returns (uint32);
}

interface ICourt {
    event ChallengeOpened(uint256 indexed id, bytes32 indexed targetId, address indexed challenger, uint32 flags, bytes32 evidenceHash, bytes shortProof, string evidenceURI, uint64 commitEndsAt, uint64 revealEndsAt);
    event CounterEvidenceSubmitted(uint256 indexed id, address indexed publisher, string uri);
    event VoteCommitted(uint256 indexed id, address indexed juror, uint8 weight);
    event VoteRevealed(uint256 indexed id, address indexed juror, bool uphold, uint8 weight);
    event ChallengeResolved(uint256 indexed id, ChallengeOutcome outcome, uint32 upholdWeight, uint32 rejectWeight);
    event ChallengeExpired(uint256 indexed id, uint32 reveals, uint16 forfeitBps);

    function core() external view returns (address);
    function vault() external view returns (address);
    function openChallenge(bytes32 targetId, uint32 flags, bytes32 evidenceHash, bytes calldata shortProof, string calldata evidenceURI) external payable returns (uint256 id);
    function submitCounterEvidence(uint256 id, string calldata uri) external;
    function commitVote(uint256 id, bytes32 commitHash) external payable;
    function revealVote(uint256 id, bool uphold, bytes32 salt) external;
    function resolve(uint256 id) external;
    function expire(uint256 id) external;

    function commitHashOf(uint256 id, address juror, bool uphold, bytes32 salt) external pure returns (bytes32); // keccak256(abi.encode(id, juror, uphold, salt))
    function getChallenge(uint256 id) external view returns (ChallengeView memory);
    function phaseOf(uint256 id) external view returns (ChallengePhase);
    function activeChallengeOf(bytes32 targetId) external view returns (uint256);
    function getJuror(uint256 id, address juror) external view returns (JurorView memory);
    function jurorStatus(uint256 id, address account) external view returns (JurorStatus);
    function cooldownEndsAt(address challenger, bytes32 targetId) external view returns (uint64);
    function nextExpireForfeitBps(bytes32 targetId) external view returns (uint16);
}

interface IVault {
    event BondDeposited(bytes32 indexed targetId, address indexed depositor, uint256 amount, uint256 total);
    event BondWithdrawalRequested(bytes32 indexed targetId, address indexed depositor, uint64 availableAt);
    event BondWithdrawn(bytes32 indexed targetId, address indexed depositor, uint256 amount);
    event BondLocked(uint256 indexed challengeId, bytes32 indexed targetId, address indexed depositor, uint256 amount);
    event BondSettled(uint256 indexed challengeId, uint256 slashed, uint256 released);
    event StakeDeposited(uint256 indexed challengeId, address indexed account, uint256 amount);
    event Distributed(uint256 indexed challengeId, address indexed recipient, uint256 amount);
    event BountyCreated(uint256 indexed id, bytes32 indexed targetId, address indexed requester, uint8 slots, uint256 amount, uint32 startIndex);
    event BountySettled(uint256 indexed id, uint8 alignedVerdictMask, uint8 filled, uint256 paidPerSlot, uint256 refunded, uint256 fee);
    event Withdrawn(address indexed account, uint256 amount);

    function core() external view returns (address);
    function treasury() external view returns (address);
    function depositBond(bytes32 targetId) external payable;
    function requestBondWithdrawal(bytes32 targetId) external;
    function finalizeBondWithdrawal(bytes32 targetId) external;
    function createBounty(bytes32 targetId, uint8 slots) external payable returns (uint256 id);
    function settleBounty(uint256 id) external;
    function withdraw() external;

    function depositStake(uint256 challengeId, address account) external payable;                              // hanya Court
    function lockBond(uint256 challengeId, bytes32 targetId) external;                                         // hanya Court
    function settleBond(uint256 challengeId, uint16 slashBps) external;                                        // hanya Court
    function distribute(uint256 challengeId, address[] calldata recipients, uint256[] calldata amounts) external; // hanya Court

    function activeBond(bytes32 targetId) external view returns (uint256);
    function bondOf(bytes32 targetId, address depositor) external view returns (BondView memory);
    function balanceOf(address account) external view returns (uint256);
    function escrowOf(uint256 challengeId) external view returns (uint256);
    function getBounty(uint256 id) external view returns (BountyView memory);
}
```

Galat kustom, dideklarasikan di dalam interface yang melemparnya (K13). Galat yang sama boleh muncul di lebih dari satu interface; selektornya identik.

| Interface | Galat |
| :--- | :--- |
| `ICore` | `NotAgentIdHolder()`, `DailyLimitReached(uint64 resetsAt)`, `AlreadyAttested()`, `InvalidFlags()`, `ShortProofTooLong()`, `TargetHasNoCode()`, `TargetNotFound()`, `CodeChangedSincePin()`, `SafeNotAllowedOnConfirmedDanger()`, `OnlyDeployer()`, `ModulesAlreadySet()`, `ModuleMismatch()`, `OnlyCourt()`, `SignatureExpired()`, `InvalidSignature()`, `TargetHasOwner()`, `DeployerMismatch()`, `AlreadyVerifiedPublisher()`, `PublisherAlreadyBound()`, `NothingToSettle()` |
| `ICourt` | `NotAgentIdHolder()`, `InvalidFlags()`, `ShortProofTooLong()`, `TargetNotFound()`, `WrongStake(uint256 expected)`, `ChallengeAlreadyActive(uint256 id)`, `InCooldown(uint64 endsAt)`, `TargetAlreadyConfirmedDanger()`, `NotPublisher()`, `WrongPhase(ChallengePhase current)`, `NotEligibleJuror(JurorStatus status)`, `CommitMismatch()`, `AlreadyRevealed()`, `QuorumReached()`, `QuorumNotReached()`, `ChallengeClosed()` |
| `IVault` | `OnlyCourt()`, `TargetNotFound()`, `NotPublisher()`, `BondAboveCap()`, `BondIsLocked()`, `NoWithdrawalRequested()`, `WithdrawalNotReady(uint64 availableAt)`, `InvalidSlots()`, `BountyAboveCap()`, `BountyNotSettleable()`, `EscrowExceeded()`, `NothingToWithdraw()`, `TransferFailed()` |

EIP-712 untuk pengikatan: domain `{ name: "Sealflare", version: "1", chainId, verifyingContract: Core }`; tipe `BindByOwner(address target,address agentIdHolder,uint256 deadline)` dan `BindByDeployer(address target,address deployer,uint256 nonce,address agentIdHolder,uint256 deadline)`.

- [ ] **Step 1: Tulis tes yang gagal di `shared/test/abi.test.ts`**

```ts
test('every Core write function the UI calls exists in the ABI', () => {
  const names = coreAbi.filter((x) => x.type === 'function').map((x) => x.name)
  expect(names).toEqual(expect.arrayContaining(['attest', 'bindByOwner', 'bindByDeployer', 'bindSkill', 'sponsor', 'probeBytecode', 'settle', 'applyPenalties', 'setModules', 'verifyContract', 'verifySkillBundle']))
})
test('Attested carries the frozen weight and both ordinals', () => {
  const e = coreAbi.find((x) => x.type === 'event' && x.name === 'Attested')!
  expect(e.inputs.map((i) => i.name)).toEqual(['targetId', 'guardian', 'verdict', 'flags', 'weight', 'index', 'safeOrdinal', 'evidenceHash', 'shortProof', 'evidenceURI'])
})
test('Vault exposes exactly four Court-only entry points', () => {
  const names = vaultAbi.filter((x) => x.type === 'function').map((x) => x.name)
  expect(names).toEqual(expect.arrayContaining(['depositStake', 'lockBond', 'settleBond', 'distribute']))
})
test('Vault has no receive or fallback entry', () => {
  expect(vaultAbi.some((x) => x.type === 'receive' || x.type === 'fallback')).toBe(false)
})
test('custom errors are part of the exported ABIs', () => {
  expect(coreAbi.some((x) => x.type === 'error' && x.name === 'DailyLimitReached')).toBe(true)
  expect(courtAbi.some((x) => x.type === 'error' && x.name === 'NotEligibleJuror')).toBe(true)
})
```

Run: `pnpm --filter @sealflare/shared test`
Expected: FAIL, `Cannot find module '../abi'`

- [ ] **Step 2: Tulis kelima interface beserta galatnya**

Isi persis seperti blok di atas. Galat ditulis di dalam badan interface, setelah event (`error DailyLimitReached(uint64 resetsAt);`). `IAgentID` hanya memuat `balanceOf(address owner) external view returns (uint256)`.

- [ ] **Step 3: Tulis `shared/scripts/export-abi.ts`**

Menjalankan `forge build --root contracts`, membaca `contracts/out/<Nama>.sol/<Nama>.json`, menulis field `abi` ke `shared/abi/<Nama>.json` dengan indentasi dua spasi dan baris baru di akhir, lalu menulis `shared/abi/index.ts` yang mengekspor tiap ABI `as const` beserta objek `EIP712`. Skrip root: `"abi:export": "tsx shared/scripts/export-abi.ts"`, `"abi:check": "pnpm abi:export && git diff --exit-code shared/abi"`.

- [ ] **Step 4: Jalankan sampai lulus, lalu commit**

Run: `pnpm abi:export && pnpm --filter @sealflare/shared test && forge build --root contracts`
Expected: PASS, tanpa peringatan kompilasi

```bash
git add contracts/src/interfaces shared/abi shared/scripts shared/test/abi.test.ts package.json
git commit -m "feat: freeze contract interfaces, errors and exported ABIs"
```

---

### Task 5: Kontrak stub, `MockAgentID`, dan jaringan lokal

**Files:**
- Create: `contracts/src/stubs/{CoreStub,CourtStub,VaultStub,MockAgentID}.sol`
- Create: `contracts/script/{DeployLocal,SeedLocal}.s.sol`, `scripts/{chain,warp}.sh`
- Modify: root `package.json` (skrip `chain`, `chain:seed`, `chain:warp`), `.gitignore` (tambah `shared/abi/addresses.local.json`, `contracts/out`, `contracts/cache`, `contracts/broadcast`)
- Test: `contracts/test/Stubs.t.sol`

**Interfaces:**
- Consumes: interface Task 4, `Rules` dan `Ids` Task 3
- Produces:
  - `MockAgentID`: `balanceOf(address) → uint256`, `setBalance(address, uint256)` tanpa pembatasan
  - `CoreStub is ICore`: setiap fungsi tulis memancarkan event finalnya dan menyimpan secukupnya agar view konsisten; `attest` memakai `Rules.weightOf` dan `Ids`. Tanpa pemeriksaan Agent ID, kuota, atau waktu. Setter uji: `stubSetTarget(bytes32, TargetView calldata)`, `stubSetTier(bytes32, TrustTier)`, `stubSetGuardian(address, GuardianView calldata)`, `stubSetAttestationsLeft(address, uint8)`
  - `CourtStub is ICourt`: sama; setter `stubSetChallenge(uint256, ChallengeView calldata)`, `stubSetPhase(uint256, ChallengePhase)`, `stubSetJuror(uint256, address, JurorView calldata)`, `stubSetJurorStatus(uint256, address, JurorStatus)`
  - `VaultStub is IVault`: `depositBond` dan `createBounty` menyimpan nilai dan memancarkan event; `withdraw` mengirim saldo; setter `stubCredit(address) payable`
  - `pnpm chain`: menjalankan anvil di `127.0.0.1:8545` dan `DeployLocal`, yang menulis `shared/abi/addresses.local.json` berbentuk `{ "chainId": 31337, "agentId", "core", "court", "vault" }`
  - `pnpm chain:seed`: memberi Agent ID ke akun anvil 0 sampai 4 dan membuat tiga target contoh (satu aman, satu proxy, satu skill berbahaya)
  - `pnpm chain:warp <detik>`: `evm_increaseTime` lalu `evm_mine`

Stub bukan bagian dari rilis. Tiap berkas stub dibuka dengan komentar `/// @dev Local development only. Never deploy to a public network.`

- [ ] **Step 1: Tulis tes yang gagal di `contracts/test/Stubs.t.sol`**

```solidity
function test_attest_emitsFinalEventWithWeightAndOrdinals() public
// vm.expectEmit; core.attest(SMART_CONTRACT, target, SAFE, 0, hash, "", "ipfs://x");
// Attested(targetId, guardian, SAFE, 0, 1, 0, 1, hash, "", "ipfs://x")
function test_attest_targetIdMatchesIdsLibrary() public
function test_stubSetTier_isReturnedByTierOfAndVerifyContract() public
function test_openChallenge_emitsWindowsTwelveHoursApart() public   // commitEndsAt = now + 12h, revealEndsAt = now + 24h
function test_vaultStub_creditThenWithdraw_paysOut() public
function test_deployLocal_wiresModules() public                     // court.core() == core, vault.core() == core, core.court() == court
```

Run: `forge test --root contracts --match-contract StubsTest`
Expected: FAIL, kompilasi gagal

- [ ] **Step 2: Implementasikan stub, `MockAgentID`, dan kedua skrip**

- [ ] **Step 3: Jalankan sampai lulus**

Run: `forge test --root contracts`
Expected: PASS

- [ ] **Step 4: Buktikan jaringan lokal hidup**

Run: `pnpm chain` di satu terminal, lalu `pnpm chain:seed && cast call $(jq -r .core shared/abi/addresses.local.json) "court()(address)" --rpc-url http://127.0.0.1:8545`
Expected: alamat `court` yang sama dengan isi `addresses.local.json`

- [ ] **Step 5: Commit**

```bash
git add contracts scripts package.json .gitignore
git commit -m "feat: add contract stubs, mock Agent ID and local chain scripts"
```

---

### Task 6: Skema pemindaian, sandbox, bukti, dan `shortProof`

**Files:**
- Create: `shared/schemas/{scan,evidence,shortProof,index}.ts`
- Create: `shared/fixtures/scans/{contract-clean,contract-proxy,contract-partial,skill-clean,skill-dangerous}.json`
- Create: `shared/fixtures/sandbox/{no-violation,fuzz-failed,incomplete}.json`, `shared/fixtures/evidence/attestation.json`
- Test: `shared/test/schemas.scan.test.ts`, `shared/test/shortProof.test.ts`

**Interfaces:**
- Consumes: `FLAG_NAMES`, `CONSTANTS` dari Task 1
- Produces (Zod, dengan tipe hasil `z.infer`):
  - `ScanReport = { schemaVersion: 1; targetType; targetId; source: ContractSource | SkillSource; scannedAt: string (ISO); checks: Check[]; findings: Finding[]; flags: number; suggestedVerdict: 'SAFE' | 'CAUTION' | 'DANGER' | null }`
  - `Check = { id: CheckId; status: 'passed' | 'flagged' | 'skipped' | 'failed'; detail?: string }`
  - `CheckId`: kontrak `source_verified`, `admin_functions`, `proxy_eip1967`, `proxy_beacon`, `proxy_eip1167`, `delegatecall_opcode`, `dry_run`; skill `bundle_hash`, `zero_width_unicode`, `unlimited_approval`, `hardcoded_transfer`, `pipe_to_shell`, `external_dependency`, `helper_scripts`
  - `Finding = { flag: FlagName; checkId: CheckId; title: string; location: string; excerpt: string }`
  - `ContractSource = { kind: 'contract'; address; codehash; blockNumber: string; implementation?: { standard: 'eip1967' | 'beacon' | 'eip1167'; address; codehash } }`
  - `SkillSource = { kind: 'skill'; repo: string (berbentuk `owner/name`); commit: string (40 hex); path: string; contentHash; manifestPublisher; canonicalBundleHash; fileCount: number; totalBytes: number }`
  - `SandboxResult = { schemaVersion: 1; bundleHash; probeSetVersion: string; modelId: string; startedAt; finishedAt; status: 'NO_VIOLATION_OBSERVED' | 'SANDBOX_FUZZ_FAILED' | 'INCOMPLETE'; incompleteReason?: string; probes: ProbeResult[] }`
  - `ProbeResult = { probeId: ProbeId; runs: { index: 0 | 1 | 2; outcome: 'clean' | 'violation' | 'error'; violations: { tool: string; args: Record<string, unknown>; rule: string }[] }[] }`
  - `ProbeId`: `indirect_injection`, `confirmation_bypass`, `silent_bundled_transfer`, `secret_exfiltration`, `approval_escalation`, `meta_scanner_override`
  - `deriveSandboxStatus(probes: ProbeResult[]): SandboxResult['status']`
  - `EvidenceReport = { schemaVersion: 1; kind: 'attestation' | 'challenge' | 'counter'; targetId; author: Address; createdAt; flags: number; shortProof: string; statement?: string (maksimal 4000 karakter); scan?: ScanReport; sandbox?: SandboxResult }`
  - `evidenceHashOf(bytes: Uint8Array): Hex`
  - `buildShortProof(items: { flag: FlagName; location: string; excerpt: string }[]): string`, `parseShortProof(text: string): { flag: FlagName; location: string; excerpt: string }[]`
  - `encodeSrc(source: ContractSource | SkillSource): string`, `decodeSrc(src: string): { kind: 'contract'; address } | { kind: 'skill'; owner; repo; commit; path } | null`

- [ ] **Step 1: Tulis tes yang gagal**

```ts
// shared/test/schemas.scan.test.ts
test.each(['contract-clean', 'contract-proxy', 'contract-partial', 'skill-clean', 'skill-dangerous'])('%s parses as a ScanReport', (name) => {
  expect(ScanReport.safeParse(loadScan(name)).success).toBe(true)
})
test('a report with a failed or skipped check can never suggest SAFE', () => {
  const report = { ...loadScan('contract-clean'), checks: [{ id: 'source_verified', status: 'failed' }], suggestedVerdict: 'SAFE' }
  expect(ScanReport.safeParse(report).success).toBe(false)
  expect(ScanReport.safeParse({ ...report, checks: [{ id: 'dry_run', status: 'skipped' }] }).success).toBe(false)
})
test('a report with any finding can never suggest SAFE', () => {
  const dangerous = loadScan('skill-dangerous')
  expect(ScanReport.safeParse({ ...dangerous, suggestedVerdict: 'SAFE' }).success).toBe(false)
})
test('flags must equal the union of finding flags', () => {
  const dangerous = loadScan('skill-dangerous')
  expect(ScanReport.safeParse({ ...dangerous, flags: 0 }).success).toBe(false)
})
test('one violation makes the run SANDBOX_FUZZ_FAILED even when other runs errored', () => {
  expect(deriveSandboxStatus(probesWith({ violation: 1, error: 5, clean: 12 }))).toBe('SANDBOX_FUZZ_FAILED')
})
test('errors without a violation make the run INCOMPLETE', () => {
  expect(deriveSandboxStatus(probesWith({ violation: 0, error: 1, clean: 17 }))).toBe('INCOMPLETE')
})
test('fewer than 18 runs without a violation is INCOMPLETE', () => {
  expect(deriveSandboxStatus(probesWith({ violation: 0, error: 0, clean: 17 }))).toBe('INCOMPLETE')
})
test('only 18 clean runs are NO_VIOLATION_OBSERVED', () => {
  expect(deriveSandboxStatus(probesWith({ violation: 0, error: 0, clean: 18 }))).toBe('NO_VIOLATION_OBSERVED')
})
test('a stored status that disagrees with its probes is rejected', () => {
  expect(SandboxResult.safeParse({ ...loadSandbox('fuzz-failed'), status: 'NO_VIOLATION_OBSERVED' }).success).toBe(false)
})
test('src round-trips for a contract and for a skill', () => {
  expect(decodeSrc('0x1234567890abcdef1234567890abcdef12345678')).toEqual({ kind: 'contract', address: '0x1234567890abcdef1234567890abcdef12345678' })
  expect(decodeSrc('gh:acme/skills@' + 'a'.repeat(40) + ':swap-helper')).toEqual({ kind: 'skill', owner: 'acme', repo: 'skills', commit: 'a'.repeat(40), path: 'swap-helper' })
  expect(decodeSrc('https://evil.example/x')).toBeNull()
})
```

```ts
// shared/test/shortProof.test.ts
const bytes = (s: string) => new TextEncoder().encode(s).length
test('never exceeds 512 bytes', () => {
  const items = [{ flag: 'HIDDEN_MINT' as const, location: 'Token.sol:88', excerpt: 'x'.repeat(2000) }]
  expect(bytes(buildShortProof(items))).toBeLessThanOrEqual(512)
})
test('cuts on a character boundary when a multibyte character straddles the limit', () => {
  const items = [{ flag: 'HIDDEN_MINT' as const, location: 'a', excerpt: '漢'.repeat(400) }]
  const out = buildShortProof(items)
  expect(bytes(out)).toBeLessThanOrEqual(512)
  expect(new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(out))).toBe(out)
  expect(out).not.toContain('�')
})
test('round-trips short items', () => {
  const items = [{ flag: 'HIDDEN_MINT' as const, location: 'Token.sol:88', excerpt: 'function _mint(address to)' }]
  expect(parseShortProof(buildShortProof(items))).toEqual(items)
})
test('keeps every flag when several items are given', () => {
  const items = FLAG_NAMES.slice(0, 8).map((flag) => ({ flag, location: 'L', excerpt: 'e'.repeat(300) }))
  expect(parseShortProof(buildShortProof(items)).map((i) => i.flag)).toEqual(FLAG_NAMES.slice(0, 8))
})
test('a line break inside an excerpt cannot forge a second item', () => {
  const items = [{ flag: 'HIDDEN_MINT' as const, location: 'a', excerpt: 'x\nHONEYPOT_OR_BLACKLIST @ b: y' }]
  expect(parseShortProof(buildShortProof(items))).toHaveLength(1)
})
```

Run: `pnpm --filter @sealflare/shared test`
Expected: FAIL, `Cannot find module '../schemas'`

- [ ] **Step 2: Tulis fixture**

`contract-partial` memuat satu check `failed` dan `suggestedVerdict: "CAUTION"`. `skill-dangerous` memuat temuan `TROJAN_HELPER_SCRIPT` dan `UNLIMITED_APPROVAL_REQUEST`. `fuzz-failed` memuat satu panggilan `approve` dengan jumlah `MAX_UINT256` pada probe `approval_escalation`. Hash di fixture skill diambil dari fixture bundel Task 2.

- [ ] **Step 3: Implementasikan skema dan `shortProof.ts`**

Format `shortProof`: satu baris per item, `FLAG_NAME @ location: excerpt`, dipisah `\n`. `\r` dan `\n` di dalam `location` dan `excerpt` diganti spasi sebelum disusun. Bila total melebihi 512 byte, `excerpt` terpanjang dipotong lebih dulu, lalu berikutnya, sampai muat; awalan `FLAG_NAME @ ` tidak pernah dipotong. Pemotongan dilakukan pada batas titik kode.

Aturan `ScanReport` yang ditegakkan lewat `superRefine`: `flags` sama dengan gabungan bit `findings`; `suggestedVerdict` bukan `SAFE` bila ada check `failed` atau `skipped` atau ada temuan.

- [ ] **Step 4: Jalankan sampai lulus, lalu commit**

Run: `pnpm --filter @sealflare/shared test`
Expected: PASS

```bash
git add shared
git commit -m "feat: add scan, sandbox and evidence schemas with shortProof codec"
```

---

### Task 7: Perjanjian lintas jalur: antarmuka `scanner-core`, API pindai dan sandbox, worker

**Files:**
- Create: `shared/schemas/{scanner,api,internal}.ts`
- Create: `shared/fixtures/api/{scan-contract.ok,scan-skill.ok,scan.error,sandbox-run.queued,sandbox-run.done,sandbox-quota,evidence.ok}.json`
- Modify: `shared/schemas/index.ts`
- Test: `shared/test/schemas.api.test.ts`

**Interfaces:**
- Consumes: `ScanReport`, `SandboxResult`, `EvidenceReport`, `BundleEntry`
- Produces:

`scanner.ts` (tipe saja; Jalur 2 mengimplementasikan, Jalur 3 memanggil):

```ts
export interface RpcAdapter {
  getCode(address: Address): Promise<Hex>
  getStorageAt(address: Address, slot: Hex): Promise<Hex>
  call(tx: { to: Address; data: Hex; from?: Address; value?: bigint }): Promise<Hex>
  getBlockNumber(): Promise<bigint>
}
export interface ExplorerAdapter {
  /** null berarti penjelajah tidak menjawab, bukan "tidak terverifikasi". */
  getSource(address: Address): Promise<{ verified: boolean; files: { path: string; content: string }[] } | null>
}
export interface RepoFetcher {
  listSkillFolders(ref: { owner: string; repo: string; commit?: string }): Promise<{ commit: string; folders: string[] }>
  fetchBundle(ref: { owner: string; repo: string; commit: string; path: string }): Promise<BundleEntry[]>
}
export interface ScannerCore {
  scanContract(address: Address, deps: { rpc: RpcAdapter; explorer: ExplorerAdapter }): Promise<ScanReport>
  scanSkill(ref: { owner: string; repo: string; commit?: string; path?: string }, deps: { repo: RepoFetcher }): Promise<ScanReport>
}
export const SCAN_ERROR_CODES = ['INPUT_NOT_RECOGNIZED', 'NO_CODE_AT_ADDRESS', 'REPO_NOT_PUBLIC', 'NO_SKILL_FOUND', 'MULTIPLE_SKILL_FOLDERS', 'BUNDLE_TOO_LARGE', 'RATE_LIMITED', 'RPC_UNAVAILABLE', 'RESULT_NOT_CACHED'] as const
export class ScanError extends Error { code: ScanErrorCode; details?: { folders?: string[]; retryAfterSeconds?: number } }
```

`api.ts`:
- Amplop semua jawaban: `{ success: true; data: T; meta?: { finalizedBlock?: string; page?: { total: number; page: number; limit: number } } } | { success: false; error: { code: string; message: string; details?: unknown } }`. Pembuat: `envelope(schema)`.
- `POST /api/scan/contract`: `{ address }` → `ScanReport`. `POST /api/scan/skill`: `{ url: string; path?: string }` → `ScanReport`. Galat memakai `SCAN_ERROR_CODES`.
- `POST /api/sandbox/runs`: `{ bundleHash; src: string; address; nonce: string; expiry: string; signature }` → `{ runId: string; status: 'queued'; queuePosition: number; quotaLeft: number }`. Galat: `QUOTA_EXHAUSTED`, `SANDBOX_PAUSED`, `SIGNATURE_INVALID`, `NOT_AGENT_ID_HOLDER`.
- `GET /api/sandbox/runs/:id` → `{ runId; status: 'queued' | 'running' | 'done' | 'incomplete'; queuePosition?: number; currentProbe?: ProbeId; result?: SandboxResult; evidenceURI?: string }`.
- `GET /api/sandbox/quota/:address` → `{ left: number; limit: 5; resetsAt: string }`.
- `POST /api/evidence`: `{ report: EvidenceReport; address; nonce: string; expiry: string; signature }` → `{ evidenceURI: string; evidenceHash: Hex }`.
- Tanda tangan luar chain: domain `{ name: "Sealflare API", version: "1", chainId }` tanpa `verifyingContract`, dengan `chainId` jaringan yang aktif (56 di mainnet, 31337 lokal); tipe `SandboxRun(bytes32 bundleHash,uint256 nonce,uint256 expiry)` dan `EvidenceUpload(bytes32 evidenceHash,uint256 nonce,uint256 expiry)`. Diekspor sebagai `API_EIP712`.
- Nama skema yang diekspor: `ScanContractRequest`, `ScanContractResponse`, `ScanSkillRequest`, `ScanSkillResponse`, `SandboxRunCreateRequest`, `SandboxRunCreateResponse`, `SandboxRunStatusResponse`, `SandboxQuotaResponse`, `EvidenceRequest`, `EvidenceResponse`. Setiap `…Response` sudah dibungkus amplop.

`internal.ts` (layanan internal memanggil worker; worker tidak pernah memanggil balik):
- `POST /runs` pada worker: `WorkerRunRequest = { runId: string; bundleHash; skillMd: string (maksimal 65.536 byte); probeSetVersion: string; modelId: string }` → `202 { accepted: true }` atau `429 { reason: 'DAILY_LIMIT' | 'BUSY' }`.
- `GET /runs/:id` pada worker: `WorkerRunStatus = { runId; state: 'running' | 'done'; currentProbe?: ProbeId; probes: ProbeResult[]; result?: SandboxResult; evidenceURI?: string; failure?: { cause: 'infrastructure' | 'skill_content'; message: string } }`. `probes` memuat setiap run yang sudah selesai, jadi pelanggaran terlihat sebelum run berakhir.
- Otorisasi: header `Authorization: Bearer <kunci antarlayanan>`.

- [ ] **Step 1: Tulis tes yang gagal di `shared/test/schemas.api.test.ts`**

```ts
test.each([
  ['scan-contract.ok', ScanContractResponse],
  ['scan-skill.ok', ScanSkillResponse],
  ['scan.error', ScanContractResponse],
  ['sandbox-run.queued', SandboxRunCreateResponse],
  ['sandbox-run.done', SandboxRunStatusResponse],
  ['sandbox-quota', SandboxQuotaResponse],
  ['evidence.ok', EvidenceResponse],
])('%s matches its schema', (name, schema) => {
  expect(schema.safeParse(loadApi(name)).success).toBe(true)
})
test('an error envelope carries no data', () => {
  expect(ScanContractResponse.safeParse({ success: false, data: loadScan('contract-clean'), error: { code: 'RPC_UNAVAILABLE', message: 'x' } }).success).toBe(false)
})
test('a scan error code outside the list is rejected', () => {
  expect(ScanContractResponse.safeParse({ success: false, error: { code: 'OOPS', message: 'x' } }).success).toBe(false)
})
test('a worker request with SKILL.md above the limit is rejected', () => {
  expect(WorkerRunRequest.safeParse({ ...validRunRequest, skillMd: 'x'.repeat(65_537) }).success).toBe(false)
})
test('a done worker status must carry a result', () => {
  expect(WorkerRunStatus.safeParse({ runId: 'r1', state: 'done', probes: [] }).success).toBe(false)
})
test('a sandbox request with a malformed signature or address is rejected', () => {
  expect(SandboxRunCreateRequest.safeParse({ ...validSandboxRequest, signature: '0x12' }).success).toBe(false)
  expect(SandboxRunCreateRequest.safeParse({ ...validSandboxRequest, address: 'not-an-address' }).success).toBe(false)
})
```

Run: `pnpm --filter @sealflare/shared test`
Expected: FAIL, `Cannot find module '../schemas/api'`

- [ ] **Step 2: Tulis fixture dan skema, jalankan sampai lulus**

Run: `pnpm --filter @sealflare/shared test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add shared
git commit -m "feat: freeze scanner-core interface, scan and sandbox API, worker contract"
```

---

### Task 8: CI, panduan mulai tiap jalur, dan pembaruan spesifikasi

**Files:**
- Create: `.github/workflows/ci.yml`, `README.md`
- Modify: root `package.json` (skrip `verify`)
- Modify: `docs/architecture.md` (Bagian 3, 4.4, 4.5, 5.3, 5.4, 11, 12.1), `sealflare.md` (baris `PublisherRole` dan nama `pinnedImplHash` diberi rujukan ke arsitektur)
- Test: tidak ada tes baru; verifikasi lewat perintah di Step 3

**Interfaces:**
- Consumes: semua task sebelumnya
- Produces: perintah satu baris yang sama untuk lokal dan CI: `pnpm verify` = `pnpm -r test && forge test --root contracts && pnpm abi:check`

- [ ] **Step 1: Tulis `ci.yml`**

Satu job pada `ubuntu-latest`, dipicu `push` dan `pull_request`: checkout dengan submodule, pasang Node 24 dan pnpm, pasang Foundry dengan `foundry-rs/foundry-toolchain` versi `v1.7.1`, `pnpm install --frozen-lockfile`, lalu `pnpm verify`.

- [ ] **Step 2: Tulis `README.md`**

Empat bagian pendek berbahasa Inggris: apa itu Sealflare (dua kalimat), prasyarat (Node 24, pnpm, Foundry), cara mulai (`pnpm install`, `pnpm verify`, `pnpm chain`, `pnpm chain:seed`), dan tabel "Start your lane" yang untuk tiap jalur menyebut folder miliknya, berkas `shared/` yang ia pakai, dan tiruan yang menggantikan jalur lain. Satu paragraf penutup: perubahan pada `shared/` atau `contracts/src/interfaces/` setelah tag `v0-frozen` perlu persetujuan founder.

- [ ] **Step 3: Tulis keputusan K1 sampai K13 ke `docs/architecture.md`**

- Bagian 3: tabel perjanjian menyebut lokasi nyata (`shared/rules/`, `contracts/src/interfaces/`) dan menandai skema baca sebagai milik Rencana 3 (K12).
- Bagian 4.4: tabel `Vault` mendapat baris `settleBond` (K6); catatan `MAX_JURORS = 21` di tabel `Court` (K7); aturan flag (K4).
- Bagian 4.5: `pinnedCodehash` (K5).
- Bagian 5.3: rumus daun dan batas (K1, K2), lokasi alamat penerbit (K3).
- Bagian 5.4: aturan `evidenceHash` (K9), format sumber (K10), arah panggilan worker (K11).
- Bagian 11: tambah baris penyimpangan untuk K5, K6, K7, K8.
- Bagian 12.1: baris `MAX_JURORS`.

- [ ] **Step 4: Verifikasi dari keadaan bersih**

Run: `rm -rf node_modules shared/node_modules contracts/out contracts/cache && pnpm install --frozen-lockfile && pnpm verify`
Expected: semua tes Vitest dan Foundry lulus, `abi:check` tanpa selisih

- [ ] **Step 5: Commit dan beri tag**

```bash
git add .github README.md docs sealflare.md package.json
git commit -m "docs: record foundation decisions and add CI"
git tag v0-frozen
```

---

## Temuan untuk Rencana 1 (tidak menghalangi Rencana 0)

**Diputuskan 22 November 2026 atas permintaan founder.** Keempatnya sudah ditulis ke `docs/architecture.md` Bagian 4.5, 4.6, dan 4.9: (1) hanya `hasDelegatecall` yang menutup tier `SAFE`; (2) ekor metadata dilewati hanya bila terbukti tidak bisa dicapai; (3) seri bounty dibayar rata ke semua verdict teratas; (4) XP tertunda selama sengketa, dan suara yang dibuat saat sengketa tidak mendapat XP.

Ditemukan saat membekukan aturan. Semuanya harus diputuskan sebelum `Core` ditulis, karena `Core` tidak bisa diubah setelah dirilis.

1. **Flag proxy dari satu attestation bisa menurunkan target mana pun selamanya.** Arsitektur 4.5 membuat flag `UPGRADEABLE_NO_TIMELOCK` atau `UNPINNABLE_DELEGATECALL` "dari attestation mana pun" menutup tier `SAFE`. Satu pemegang Agent ID berbobot 1 bisa memberi `CAUTION` dengan flag itu pada kontrak pesaing, tanpa biaya dan tanpa jalan banding. Usul: aturan tier nomor 5 hanya membaca penanda `hasDelegatecall` dari `probeBytecode`, yang objektif. Vektor di Task 1 sudah memakai satu masukan `proxyMarker`, jadi pilihan ini tidak mengubah Rencana 0.
2. **Pemindaian opcode `DELEGATECALL` kena positif palsu dari metadata.** Byte `0xF4` bisa muncul di ekor CBOR Solidity. Memotong ekor itu membuka celah menyembunyikan kode. Perlu keputusan: terima positif palsu, atau analisis yang lebih mahal.
3. **Aturan seri bounty.** Bila verdict teratas di antara pengisi slot seri, siapa yang dibayar. Event `BountySettled` sudah memakai `alignedVerdictMask` supaya kedua pilihan muat.
4. **XP saat sengketa terjadi di dalam jendela 48 jam lalu ditolak.** Spesifikasi menyebut "tanpa sengketa aktif"; perlu dipastikan apakah XP hangus atau hanya tertunda.
