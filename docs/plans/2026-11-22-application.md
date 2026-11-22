# Rencana Implementasi 3: Aplikasi Sealflare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun aplikasi web di `/app`, API publik, layanan internal, indexer, SDK, dan Companion Skill, sehingga orang bisa memindai target, memberi attestation, bersengketa, dan menarik dana lewat wallet mereka sendiri.

**Architecture:** Satu aplikasi Next.js di Vercel memuat UI dan API publik. API tidak pernah menyentuh Postgres; ia berbicara dengan layanan internal di VPS lewat HTTPS berkunci. Layanan internal adalah satu-satunya pintu ke Postgres dan satu-satunya pemanggil sandbox worker. Indexer menyalin event dari blok final ke Postgres. Semua tulisan on-chain berasal dari wallet pengguna; server tidak pernah menandatangani.

**Tech Stack:** Node 24, pnpm 12, TypeScript (strict), Next.js (App Router), React, wagmi + viem, TanStack Query, Zod 4, Vitest, Testing Library, Playwright; Hono untuk layanan internal; Postgres dengan `postgres` (klien) dan PGlite untuk tes.

**Spec:** [docs/ux.md](../ux.md) (seluruhnya; mengikat untuk layar, keadaan, alur, dan teks), [docs/architecture.md](../architecture.md) Bagian 4.4 sampai 4.9, 5, 6, 7, 8, 10. Visual: [docs/design](../design). Perjanjian yang mengikat: [shared/abi](../../shared/abi), [shared/schemas](../../shared/schemas), [shared/rules](../../shared/rules).

**Pemegang:** developer ketiga. **Mulai:** 24 November 2026.

## Tonggak

| Tonggak | Tenggat | Isi | Task |
| :--- | :--- | :--- | :--- |
| **M1** | 27 November | Irisan utuh: scan, halaman target, attest, bukti ke IPFS, indexer `Core`, berjalan di atas kontrak asli | 1 sampai 11 |
| Titik temu | 28 sampai 30 November | Sambung ke `Core` asli (`pnpm chain:real`) dan ke `scanner-core` asli; perbaiki temuan | |
| Rilis | 1 Desember | `Core` di mainnet; aplikasi M1 di Vercel dengan `modulesLive` mati | |
| **M2** | 5 Desember | Sandbox, sengketa, juri, Publish dan bond, bounty, My activity, daftar, SDK, skill | 12 sampai 22 |
| Submisi | 9 Desember, 15:00 WIB | | |

### Yang dipotong lebih dulu bila waktu habis

Urutan dari yang pertama dipotong. Ini beban besar untuk satu orang dalam dua minggu, jadi daftar ini diputuskan sekarang, bukan saat panik.

| Urutan | Task | Yang hilang dari produk |
| :---: | :--- | :--- |
| 1 | 21 (Companion Skill) | Agen tidak bisa memindai dari dalam wallet; SDK dan web tetap ada |
| 2 | 19 (profil Guardian; daftar tetap) | Riwayat per Guardian tidak bisa dilihat; papan peringkat tetap |
| 3 | 17 (UI bounty) | Bounty hanya bisa dibuat lewat BscScan; *Genesis Guardian Sprint* jadi manual |
| 4 | 20 (SDK) dikecilkan menjadi satu fungsi `verifyContract` | Integrasi framework agen hanya contoh |
| 5 | 13 (sandbox di UI) | Layer 2 hanya bisa didemokan lewat worker langsung |

Yang tidak boleh dipotong: Task 1 sampai 11, 14, 15, 16, 18. Tanpa itu tidak ada alur sengketa dan tidak ada jalan menarik dana.

## Global Constraints

- `shared/` dan `contracts/src/interfaces/` beku pada tag `v0-frozen`. Satu-satunya tambahan yang diizinkan rencana ini adalah berkas baru `shared/schemas/readModel.ts` beserta fixture-nya (Task 1). Kebutuhan lain dicatat di "Perubahan yang perlu disetujui founder".
- **Server tidak pernah menandatangani transaksi.** Tidak ada kunci privat di server. Tidak ada `approve` tak terbatas di mana pun.
- Tidak ada rahasia di repositori. Tidak ada kunci berbayar di variabel `NEXT_PUBLIC_`. Variabel lingkungan divalidasi dengan Zod saat proses mulai.
- Setiap jawaban API memakai `envelope` dari `shared/schemas/api.ts`. Setiap jawaban yang dibangun dari data indexer membawa `meta.finalizedBlock`. Setiap masukan divalidasi dengan skema Zod bersama sebelum diproses.
- Kepemilikan Agent ID, status "sudah attest", dan kuota harian dibaca langsung dari view `Core`, bukan dari indexer (ux.md Bagian 4). Tier selalu dari `Core.tierOf`, tidak dihitung ulang.
- Membaca terbuka; wallet baru diminta saat menulis. Tidak ada notifikasi dari luar aplikasi. Sinyal tidak pernah diringkas jadi satu angka.
- Setiap panel tindakan punya empat keadaan transaksi (ux.md Bagian 5). Setiap layar berdata punya keadaan kosong, memuat, dan gagal (ux.md Bagian 13).
- Semua teks antarmuka berbahasa Inggris, dikutip persis dari ux.md bila ada, tanpa em dash. Disimpan di `apps/web/lib/copy.ts`, tidak ditulis di dalam komponen.
- Visual mengikuti `docs/design`: token dari `docs/design/system/tokens.json`, abu-abu netral, lime sebagai `primary`, `--radius: 0`, tema gelap dan terang, Instrument Sans dan Geist Mono. Tidak ada gradien dekoratif, emoji, logo mitra, atau testimoni.
- Desktop dulu; layar 375 piksel tidak boleh meluber ke samping (ux.md Bagian 5 dan 7.6). Fokus keyboard terlihat; kontras teks minimal 4,5.
- Landing `/` dan Docs `/docs` dibangun founder. Rencana ini menyiapkan kerangka situs dan token, dan tidak menyentuh kedua rute itu.
- Berkas di bawah 400 baris, fungsi di bawah 50 baris, data tidak dimutasi di tempat, galat ditangani eksplisit.
- Tiap paket punya skrip `test` dan `typecheck`. `pnpm verify` di akar harus lulus setelah setiap task. Commit memakai format `<type>: <description>` tanpa trailer `Co-Authored-By`.

## Keputusan yang dibuat rencana ini

| # | Keputusan | Alasan |
| :---: | :--- | :--- |
| A1 | Layanan internal memakai Hono; API publik memakai *route handler* Next.js | Hono kecil dan dipakai juga oleh worker; satu deploy untuk web dan API |
| A2 | Migrasi berupa berkas SQL bernomor di `apps/internal/migrations`, dijalankan runner kecil sendiri. Tes memakai PGlite | Tanpa ORM; tes Postgres berjalan tanpa Docker |
| A3 | Batas laju endpoint publik dihitung di layanan internal (tabel per kunci dan jendela), dengan kunci berupa hash IP + garam harian | Fungsi Vercel tidak berbagi memori; tidak menambah layanan baru; IP mentah tidak disimpan |
| A4 | Hasil scan di-cache di Postgres lewat layanan internal, kunci `targetId` | Halaman target bisa dibuka ulang; ux.md 6.6 menyebut "This result is no longer cached." |
| A5 | Nonce permintaan bertanda tangan disimpan sekali pakai di Postgres sampai `expiry`; `expiry` maksimal 10 menit ke depan | Menutup pemutaran ulang tanda tangan sandbox dan bukti |
| A6 | Reveal code berbentuk `sf1.<challengeId>.<u|r>.<salt hex 64>` | Bisa disalin sebagai satu teks; memuat salt dan arah (ux.md 8.4) |
| A7 | Pemindai dipilih lewat variabel `SCANNER=mock|real` di satu berkas `apps/web/server/scanner.ts`; mock mengembalikan fixture | Jalur 2 belum selesai saat M1 dimulai |
| A8 | Indexer membaca event per rentang 2.000 blok sampai tag `finalized`, dalam satu transaksi Postgres per rentang bersama kursornya | Pembangunan ulang memberi data identik (arsitektur Bagian 10) |
| A9 | Kelompok sinyal: "New IDs" = bobot 1 saat attest; "Guardians" = bobot 2 ke atas | ux.md 7.2 |

## Review Focus

1. Indexer dimatikan di tengah rentang lalu dijalankan lagi: tidak ada baris ganda dan tidak ada event terlewat (Task 5).
2. Tanda tangan sandbox atau bukti yang dipakai dua kali, atau kedaluwarsa, atau ditandatangani alamat tanpa Agent ID: ditolak di layanan internal, bukan hanya di Vercel (Task 7 dan 13).
3. Pengguna menolak di wallet pada persetujuan kedua (transaksi) setelah bukti terunggah: panel kembali ke ringkasan tanpa pesan galat, dan tidak ada yang terkirim on-chain (Task 10).
4. Reveal code yang ditempel untuk sengketa lain, dengan arah terbalik, atau cacat: transaksi tidak dikirim dan juri diberi tahu (Task 15).
5. Jawaban layanan internal yang tertinggal jauh dari chain: halaman menyebut jumlah blok tertinggal dan tetap menampilkan tier dari `Core` (Task 9).

## Struktur berkas

```
shared/schemas/readModel.ts            satu-satunya tambahan ke shared
apps/web/
  app/
    layout.tsx  globals.css            token, font, tema
    (site)/                            MILIK FOUNDER: page.tsx (Landing), docs/
    app/
      layout.tsx                       navigasi aplikasi + tombol wallet
      page.tsx                         Scan
      t/[id]/page.tsx                  Target
      explore/  disputes/  disputes/[id]/  bounties/  guardians/  g/[address]/  me/  publish/
    api/
      scan/contract/route.ts  scan/skill/route.ts  evidence/route.ts
      sandbox/runs/route.ts  sandbox/runs/[id]/route.ts  sandbox/quota/[address]/route.ts
      targets/…  guardians/…  challenges/…  bounties/…  activity/[address]/route.ts
  components/
    ui/                                Button, Chip, Frame, Banner, Tabs, Table, Panel, SealMark, Skeleton
    wallet/  target/  attest/  dispute/  jury/  publish/  bounty/  activity/
  lib/
    copy.ts  env.ts  chain/{addresses,config,errors,userState}.ts  api/client.ts  format.ts  revealCode.ts
  server/
    scanner.ts  internal.ts  pinata.ts  respond.ts
  e2e/
apps/internal/
  migrations/*.sql
  src/{env,db,auth,app,main}.ts  src/routes/{targets,guardians,challenges,bounties,activity,scans,rate,nonce,sandbox}.ts
  src/sandbox/{queue,quota,cache,workerClient,poller}.ts
apps/indexer/
  src/{env,main,loop,decode,cursor}.ts  src/handlers/{core,court,vault}.ts
packages/sdk/                          @sealflare/guard
packages/skill/                        SKILL.md + skrip read-only
```

---

## Tonggak 1

### Task 1 (M1): Skema baca di `shared/schemas/readModel.ts`

**Files:**
- Create: `shared/schemas/readModel.ts`, `shared/fixtures/api/{targets.list,target.detail,guardians.list,guardian.detail,challenges.list,challenge.detail,bounties.list,bounty.detail,activity}.json`
- Modify: `shared/schemas/index.ts`
- Test: `shared/test/schemas.readModel.test.ts`

**Interfaces:**
- Produces (semua `…Response` sudah dibungkus `envelope`):
  - `SignalGroup = { votes: { safe: number; caution: number; danger: number }; weight: { safe: number; caution: number; danger: number }; flags: number }`
  - `TargetSummary = { targetId; targetType; label: string; src: string; tier: TrustTier; safe: number; caution: number; danger: number; publisherRole: 'NONE' | 'THIRD_PARTY_SPONSOR' | 'VERIFIED_PUBLISHER'; bond: string; lastVoteAt: string | null }`
  - `TargetDetail = TargetSummary & { publisher: Address | null; pinnedCodehash; hasDelegatecall: boolean; activeFlags: number; signal: { newIds: SignalGroup; guardians: SignalGroup }; activeChallengeId: string | null; attestationCount: number; scan: ScanReport | null; sandbox: SandboxResult | null }`
  - `AttestationRow = { index: number; guardian: Address; verdict: Verdict; flags: number; weight: number; safeOrdinal: number; shortProof: string; evidenceURI: string; txHash; at: string; settled: boolean; castDuringDispute: boolean }`
  - `GuardianSummary = { address; score: number; weight: number; attestations: number; penaltyPending: boolean }`, `GuardianDetail = GuardianSummary & { createdAtBlock: string; history: ActivityItem[] }`
  - `ChallengeSummary = { id: string; targetId; label: string; challenger: Address; phase: 'COMMIT' | 'REVEAL' | 'AWAITING_CLOSE' | 'CLOSED'; outcome: 'PENDING' | 'UPHELD' | 'REJECTED' | 'TIED' | 'EXPIRED'; commitEndsAt: string; revealEndsAt: string; commits: number; reveals: number }`
  - `ChallengeDetail = ChallengeSummary & { flags: number; shortProof: string; evidenceURI: string; counterEvidenceURI: string | null; publisher: Address | null; jurors: { address; weight: number; revealed: boolean; uphold: boolean | null }[]; upholdWeight: number; rejectWeight: number; payouts: { recipient: Address; amount: string }[] }`
  - `BountySummary = { id: string; targetId; label: string; requester: Address; slots: number; filled: number; amount: string; createdAt: string; settleableAt: string | null; settled: boolean }`, `BountyDetail = BountySummary & { fillers: { guardian: Address; verdict: Verdict }[] }`
  - `ActivityItem = { kind: 'attestation' | 'juror' | 'challenge' | 'bounty' | 'bond'; targetId; label: string; result: string; xp: number | null; at: string }`
  - `Activity = { needsAction: NeedsAction[]; balance: string; score: number; weight: number; toNextWeight: number | null; history: ActivityItem[] }`
  - `NeedsAction = { kind: 'REVEAL_DUE' | 'REPLY_DUE' | 'CAN_CLOSE' | 'XP_CLAIMABLE' | 'BOND_READY' | 'BOUNTY_SETTLEABLE'; targetId; challengeId?: string; bountyId?: string; dueAt?: string; detail: string }`
  - `ListQuery = { page?: number; limit?: number (maksimal 100); address?: Address; type?: TargetType; tier?: TrustTier }`
  - `TargetsListResponse`, `TargetDetailResponse`, `AttestationsListResponse`, `GuardiansListResponse`, `GuardianDetailResponse`, `ChallengesListResponse`, `ChallengeDetailResponse`, `BountiesListResponse`, `BountyDetailResponse`, `ActivityResponse`

Jumlah wei selalu string desimal. Waktu selalu ISO. Selama fase commit, `jurors[].uphold` wajib `null`.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
test.each([
  ['targets.list', TargetsListResponse], ['target.detail', TargetDetailResponse], ['guardians.list', GuardiansListResponse],
  ['guardian.detail', GuardianDetailResponse], ['challenges.list', ChallengesListResponse], ['challenge.detail', ChallengeDetailResponse],
  ['bounties.list', BountiesListResponse], ['bounty.detail', BountyDetailResponse], ['activity', ActivityResponse],
])('%s matches its schema', (name, schema) => expect(schema.safeParse(loadApi(name)).error?.issues).toBeUndefined())
test('a read answer without meta.finalizedBlock is rejected', () => {})
test('a challenge in the commit phase cannot expose any juror vote direction', () => {
  /* phase 'COMMIT' dengan jurors[0].uphold === true → gagal */
})
test('an amount that is not a decimal integer string is rejected', () => { /* bond: 0.5, bond: "0.5" */ })
test('a list query caps limit at 100 and rejects a malformed address filter', () => {})
test('the signal breakdown never collapses into one number', () => {
  /* TargetDetail tanpa signal.newIds atau signal.guardians → gagal */
})
```

Run: `pnpm --filter @sealflare/shared test`
Expected: FAIL, modul belum ada

- [ ] **Step 2: Tulis fixture dan skema, jalankan sampai lulus, lalu commit**

```bash
git add shared
git commit -m "feat: add read-model schemas for targets, guardians, challenges, bounties and activity"
```

Minta founder memeriksa commit ini hari itu juga: setelah disetujui, berkas ini ikut beku.

---

### Task 2 (M1): Kerangka `apps/web`, token, dan komponen dasar

**Files:**
- Create: `apps/web/{package.json,tsconfig.json,next.config.ts,vitest.config.ts,playwright.config.ts}`, `app/layout.tsx`, `app/globals.css`, `app/app/layout.tsx`, `lib/{copy,env,format}.ts`, `components/ui/*`
- Test: `apps/web/test/ui.test.tsx`, `test/format.test.ts`, `test/env.test.ts`

**Interfaces:**
- Produces:
  - `components/ui`: `Button({ variant: 'primary' | 'secondary' | 'ghost', ...button })`, `Chip`, `Frame({ crop?: boolean })`, `Banner({ tone: 'danger' | 'warning' | 'info' })`, `Tabs`, `Table`, `Panel({ title, onClose, children })`, `SealMark({ tier, size })`, `Skeleton`, `EmptyState({ title, action })`, `ErrorState({ what, onChainSafe, onRetry })`
  - `lib/format.ts`: `shortAddress(a)`, `formatBnb(wei: string | bigint)`, `timeLeft(until: Date, now: Date)`, `tierLabel(tier)`, `tierReason(detail)`
  - `lib/env.ts`: `publicEnv` (`NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `NEXT_PUBLIC_MODULES_LIVE`) dan `serverEnv` (`INTERNAL_URL`, `INTERNAL_KEY`, `RPC_URLS`, `BSCSCAN_KEY`, `GITHUB_TOKEN`, `PINATA_JWT`, `SCANNER`)
  - `lib/copy.ts`: objek `copy` berisi setiap teks dari ux.md, dikelompokkan per layar

- [ ] **Step 1: Konfirmasi versi dan cara pasang dari dokumentasi resmi**

Baca dokumentasi resmi Next.js (App Router, *route handlers*, cara memuat font), wagmi, dan WalletConnect untuk versi mayor yang berlaku saat ini. Catat versi yang dipakai dan URL dokumentasinya di `apps/web/README.md`. Bila cara pasang berbeda dari yang diasumsikan task di bawah, ikuti dokumentasi dan catat di ledger.

- [ ] **Step 2: Tulis tes yang gagal**

```tsx
test('tokens define both themes and a zero radius', () => { /* baca globals.css: --radius: 0; blok tema gelap dan terang; --primary */ })
test('Button renders a real button with a visible focus style and is not clickable when disabled', () => {})
test('SealMark draws a full ring only for the two SAFE tiers', () => {})
test('Banner cannot be dismissed', () => { /* tidak ada tombol tutup */ })
test('ErrorState says whether on-chain data is safe and offers a retry', () => {})
test('shortAddress keeps 6 and 4 characters', () => expect(shortAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678'))
test('formatBnb never uses floating point', () => expect(formatBnb('10000000000000001')).toBe('0.010000000000000001'))
test('timeLeft formats hours and minutes and never goes negative', () => {})
test('no copy string contains an em dash', () => { /* telusuri semua nilai di copy */ })
test('env parsing fails with the variable name when a server key is missing', () => {})
test('no server key is exposed under a NEXT_PUBLIC_ name', () => { /* periksa nama-nama di serverEnv */ })
```

Run: `pnpm --filter @sealflare/web test`
Expected: FAIL

- [ ] **Step 3: Implementasikan**

Token di `globals.css` disalin dari blok `.sf` dan `.sf.is-light` di `docs/design/screens/Main.dc.html`; kelas komponen dari `docs/design/system/components/bundle.css`. Navigasi aplikasi mengikuti kepala `Main.dc.html`: Scan, Explore, Disputes, Bounties, Guardians, tombol wallet di kanan. Folder `app/(site)/` dibuat kosong dengan satu `README.md` yang menyebut bahwa Landing dan Docs milik founder dan memakai `app/layout.tsx` serta token yang sama.

- [ ] **Step 4: Jalankan sampai lulus, lalu commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat: scaffold the web app with design tokens and base components"
```

---

### Task 3 (M1): Lapisan chain: alamat, wallet, keadaan pengguna, dan terjemahan galat

**Files:**
- Create: `lib/chain/{addresses,config,errors,userState}.ts`, `components/wallet/{WalletButton,WalletMenu,ConnectPrompt,NoAgentId,WrongNetwork}.tsx`
- Test: `test/chain.errors.test.ts`, `test/userState.test.tsx`, `test/wallet.test.tsx`

**Interfaces:**
- Produces:
  - `addresses(chainId: 56 | 31337): { agentId; core; court; vault }` (31337 dari `shared/abi/addresses.local.json`, 56 dari `addresses.bsc.json`; `court` dan `vault` boleh `null`)
  - `translateContractError(error: unknown): { message: string; retry: boolean } | null` (`null` berarti pengguna menolak di wallet)
  - `type UserState = { kind: 'no-wallet' } | { kind: 'wrong-network' } | { kind: 'no-agent-id'; address } | { kind: 'holder'; address; attestationsLeft: number }`
  - `useUserState(): UserState & { recheck(): void }` (membaca `Core.isAgentIdHolder` dan `attestationsLeftToday`)
  - `modulesLive: boolean`

Setiap galat kustom di `coreAbi`, `courtAbi`, dan `vaultAbi` punya satu kalimat di `copy.errors`. Contoh yang ditetapkan ux.md: `DailyLimitReached` → "You have used all 5 attestations for today."

- [ ] **Step 1: Tulis tes yang gagal**

```ts
test('every custom error in the three ABIs has a sentence', () => {
  const names = [...coreAbi, ...courtAbi, ...vaultAbi].filter((x) => x.type === 'error').map((x) => x.name)
  for (const name of new Set(names)) expect(copy.errors[name], name).toBeTruthy()
})
test('DailyLimitReached is translated with the reset time', () => {})
test('a rejection in the wallet returns null, so the panel shows no error', () => { /* UserRejectedRequestError */ })
test('an unknown revert gives a generic sentence and allows a retry', () => {})
test('NotEligibleJuror names the specific reason', () => { /* HAS_ATTESTED → "You attested this target, so you cannot judge it." */ })
test.each([['no wallet', 'no-wallet'], ['chain 1', 'wrong-network'], ['no Agent ID', 'no-agent-id'], ['holder', 'holder']])(
  '%s resolves to %s', () => {})
test('NoAgentId offers both paths and a "Check again" that re-reads balanceOf without reloading', () => {
  /* tombol "I have one on another wallet", tautan "Get an Agent ID" target _blank, tombol "Check again" memanggil recheck */
})
test('the wallet button shows the count of things needing action without opening the menu', () => {})
test('modules not live disables dispute, bounty and bond actions with the fixed sentence', () => {
  /* "Opens when the dispute and vault contracts go live." */
})
```

Run: `pnpm --filter @sealflare/web test`
Expected: FAIL

- [ ] **Step 2: Implementasikan, jalankan sampai lulus, lalu commit**

Tautan "Get an Agent ID" dibaca dari `NEXT_PUBLIC_AGENT_ID_URL`; founder yang mengisinya (ux.md Bagian 14).

```bash
git add apps/web
git commit -m "feat: add wallet connection, the four user states and contract error messages"
```

---

### Task 4 (M1): Skema Postgres, migrasi, dan kerangka layanan internal

**Files:**
- Create: `apps/internal/{package.json,tsconfig.json,vitest.config.ts}`, `migrations/001_indexer.sql`, `migrations/002_operational.sql`, `src/{env,db,auth,app,main}.ts`, `src/routes/{rate,nonce,scans}.ts`
- Test: `apps/internal/test/{migrations,auth,rate,nonce,scans}.test.ts`

**Interfaces:**
- Produces:
  - Tabel indexer: `cursor(id, last_block, last_block_hash)`, `events(tx_hash, log_index, block_number, block_hash, contract, name, args jsonb, PRIMARY KEY (tx_hash, log_index))`, `targets`, `attestations`, `guardians`, `challenges`, `jurors`, `bonds`, `bounties`, `balances`, `score_changes`
  - Tabel operasional: `scan_cache(target_id PRIMARY KEY, src, report jsonb, scanned_at)`, `rate(key, window_start, count, PRIMARY KEY (key, window_start))`, `nonces(address, nonce, expires_at, PRIMARY KEY (address, nonce))`, `sandbox_runs`, `sandbox_cache`, `sandbox_quota`
  - `migrate(sql): Promise<string[]>` (nama migrasi yang baru dijalankan; aman dijalankan ulang)
  - `createApp(deps: { sql; env; now?: () => Date }): Hono` dengan *middleware* kunci antarlayanan
  - `POST /rate/take { key, limit, windowSeconds }` → `{ allowed: boolean; retryAfterSeconds: number }`
  - `POST /nonce/use { address, nonce, expiry }` → `{ fresh: boolean }`
  - `PUT /scans/:targetId`, `GET /scans/:targetId`

- [ ] **Step 1: Tulis tes yang gagal (PGlite)**

```ts
test('migrations run from empty and are a no-op the second time', async () => {})
test('events are unique on (tx_hash, log_index)', async () => {})
test('a request without the inter-service key is 401 and reads nothing', async () => {})
test('the key is compared in constant time and never echoed', async () => {})
test('rate/take allows up to the limit in a window and then reports when to retry', async () => {})
test('a new window starts fresh', async () => {})
test('nonce/use is true once and false on replay', async () => {})
test('nonce/use refuses an expiry in the past or more than 10 minutes ahead', async () => {})
test('expired nonces and old rate rows are deleted by cleanup', async () => {})
test('a stored scan is returned unchanged and passes ScanReport', async () => {})
test('storing a body that fails ScanReport is 400 and stores nothing', async () => {})
test('GET of an unknown target id is 404 with code RESULT_NOT_CACHED', async () => {})
```

Run: `pnpm --filter @sealflare/internal test`
Expected: FAIL

- [ ] **Step 2: Implementasikan, jalankan sampai lulus, lalu commit**

Semua kueri memakai parameter terikat; tidak ada penggabungan string ke SQL.

```bash
git add apps/internal pnpm-lock.yaml
git commit -m "feat: add Postgres schema, migrations and the internal service skeleton"
```

---

### Task 5 (M1): Indexer untuk event `Core`

**Files:**
- Create: `apps/indexer/{package.json,tsconfig.json,vitest.config.ts}`, `src/{env,main,loop,decode,cursor}.ts`, `src/handlers/core.ts`
- Test: `apps/indexer/test/{loop,core.handlers,rebuild}.test.ts`

**Interfaces:**
- Consumes: `coreAbi`; tabel Task 4 (indexer mengimpor `migrate` dan klien `sql` dari `@sealflare/internal/db`)
- Produces:
  - `indexOnce(deps: { client: PublicClient; sql; addresses; batch?: number }): Promise<{ from: bigint; to: bigint; events: number }>` (A8)
  - `applyCoreEvent(tx, event)` untuk `TargetCreated`, `GuardianCreated`, `Attested`, `PublisherBound`, `DelegatecallFlagged`, `AttestationSettled`, `ScoreChanged`, `DisputeMarked`, `VerdictApplied`, `ModulesSet`

- [ ] **Step 1: Tulis tes yang gagal**

Tes memakai Anvil dengan stub (`pnpm chain` di `globalSetup`) dan PGlite. Anvil mendukung tag `finalized`; tes mengatur jarak final dengan menambang blok.

```ts
test('indexes only up to the finalized block', async () => {})
test('an attestation becomes a row with its frozen weight, both ordinals and its short proof', async () => {})
test('target counters equal the sum of their attestation rows', async () => {})
test('running the same range twice inserts nothing new', async () => {})
test('a crash between the event insert and the cursor update cannot happen: both are in one transaction', async () => {
  /* suntikkan galat setelah insert; cursor dan events sama-sama tidak berubah */
})
test('the cursor stores the block hash, and a hash mismatch at the cursor stops the indexer with a clear error', async () => {})
test('rebuilding from block 0 yields byte-identical tables', async () => {
  /* indeks, dump terurut, kosongkan, indeks lagi, bandingkan */
})
test('an event from an unknown address is ignored', async () => {})
test('an RPC failure leaves the cursor where it was', async () => {})
test('ScoreChanged rows add up to the guardian score Core reports', async () => {})
```

Run: `pnpm --filter @sealflare/indexer test`
Expected: FAIL

- [ ] **Step 2: Implementasikan, jalankan sampai lulus, lalu commit**

```bash
git add apps/indexer pnpm-lock.yaml
git commit -m "feat: add the indexer for Core events, reading finalized blocks only"
```

---

### Task 6 (M1): Layanan internal: rute baca target dan attestation

**Files:**
- Create: `apps/internal/src/routes/targets.ts`, `src/readModel/{targets,signal}.ts`
- Test: `apps/internal/test/targets.test.ts`

**Interfaces:**
- Consumes: skema Task 1; tabel Task 4 dan 5
- Produces: `GET /targets?page&limit&type&tier&address`, `GET /targets/:id`, `GET /targets/:id/attestations?page&limit`; `signalOf(rows): { newIds: SignalGroup; guardians: SignalGroup }` (A9); setiap jawaban membawa `meta.finalizedBlock` dari tabel `cursor`

`tier` di jawaban diisi pemanggil (API publik) dari `Core.tierOf`; layanan internal mengembalikan `tier: null` di barisnya dan API publik yang melengkapinya. Dengan begitu tier tidak pernah dihitung dari data indexer.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
test('the list is newest vote first and paged', async () => {})
test('filters by type and by an address that attested', async () => {})
test('the signal splits weight-1 votes from weight-2-and-above votes, with counts, weights and flags per group', async () => {
  /* 42 suara bobot 1 SAFE dan 3 suara bobot 5 DANGER berflag HIDDEN_MINT →
     newIds.votes.safe 42, newIds.weight.safe 42; guardians.votes.danger 3, guardians.weight.danger 15, guardians.flags HIDDEN_MINT */
})
test('every answer carries the last finalized block', async () => {})
test('a detail joins the cached scan when there is one and is null otherwise', async () => {})
test('an unknown target is 404, not an empty object', async () => {})
test('limit above 100 is rejected', async () => {})
```

Run: `pnpm --filter @sealflare/internal test`
Expected: FAIL

- [ ] **Step 2: Implementasikan, jalankan sampai lulus, lalu commit**

```bash
git add apps/internal
git commit -m "feat: add target and attestation read routes with the signal breakdown"
```

---

### Task 7 (M1): API publik: scan, bukti, dan target

**Files:**
- Create: `apps/web/server/{scanner,internal,pinata,respond}.ts`, `app/api/scan/contract/route.ts`, `app/api/scan/skill/route.ts`, `app/api/evidence/route.ts`, `app/api/targets/route.ts`, `app/api/targets/[id]/route.ts`, `app/api/targets/[id]/attestations/route.ts`
- Test: `apps/web/test/api.scan.test.ts`, `test/api.evidence.test.ts`, `test/api.targets.test.ts`

**Interfaces:**
- Consumes: `ScannerCore`, `parseScanInput` (Rencana 2), `ScanContractRequest`, `ScanSkillRequest`, `EvidenceRequest`, `API_EIP712`, `evidenceHashOf`; layanan internal
- Produces:
  - `getScanner(): ScannerCore` (A7: `SCANNER=mock` mengembalikan pemindai tiruan dari `shared/fixtures/scans`; `real` mengembalikan `createScanner()` dengan adapter nyata)
  - `ok(data, meta?)`, `fail(code, message, status, details?)` yang selalu menghasilkan amplop
  - `internal.get(path)`, `internal.post(path, body)` dengan kunci antarlayanan dan batas waktu

Batas laju (A3): scan 20 per 10 menit per kunci IP; bukti 30 per jam per alamat.

Alur `POST /api/evidence`: validasi `EvidenceRequest`; hitung `evidenceHashOf(utf8(reportJson))`; pulihkan penanda tangan dari `EvidenceUpload(evidenceHash, nonce, expiry)` dan cocokkan dengan `address`; `report.author` harus sama dengan `address`; `Core.isAgentIdHolder(address)`; `nonce/use`; unggah byte `reportJson` persis ke Pinata; jawab `{ evidenceURI, evidenceHash }`.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
// scan
test('a valid address returns a ScanReport in an envelope and caches it', async () => {})
test.each(SCAN_ERROR_CODES)('ScanError %s becomes an error envelope with the right HTTP status', async () => {})
test('MULTIPLE_SKILL_FOLDERS returns the folder list in details', async () => {})
test('the 21st scan in ten minutes from one network is RATE_LIMITED with retryAfterSeconds', async () => {})
test('a body that is not JSON, or fails the schema, is BAD_REQUEST', async () => {})
test('an unexpected throw is INTERNAL with no stack trace or secret in the body', async () => {})
test('SCANNER=mock and SCANNER=real differ only in server/scanner.ts', () => { /* grep: tidak ada berkas lain yang membaca SCANNER */ })
// evidence
test('a correctly signed report is pinned byte for byte and its hash is returned', async () => {
  /* byte yang dikirim ke Pinata === utf8(reportJson); evidenceHash === keccak256 dari byte itu */
})
test.each([['a signature by another address', 'SIGNATURE_INVALID'], ['an expired expiry', 'SIGNATURE_EXPIRED'],
  ['a signer without an Agent ID', 'NOT_AGENT_ID_HOLDER'], ['a replayed nonce', 'SIGNATURE_INVALID'],
  ['an author different from the signer', 'SIGNATURE_INVALID'], ['a report above the size limit', 'BAD_REQUEST']])(
  '%s is refused with %s and nothing is pinned', async () => {})
test('a Pinata failure is UPLOAD_FAILED and the nonce is not consumed', async () => {})
// targets
test('the list fills tier from Core.tierOf, not from the indexer', async () => {})
test('the answer carries meta.finalizedBlock', async () => {})
test('the internal service being down is an error envelope, never an empty list', async () => {})
```

Run: `pnpm --filter @sealflare/web test`
Expected: FAIL

- [ ] **Step 2: Implementasikan, jalankan sampai lulus, lalu commit**

```bash
git add apps/web
git commit -m "feat: add public scan, evidence and target API routes"
```

---

### Task 8 (M1): Layar Scan

**Files:**
- Create: `app/app/page.tsx`, `components/target/{ScanField,ScanProgress,ScanError}.tsx`, `lib/api/client.ts`
- Test: `apps/web/test/scan.test.tsx`

**Interfaces:**
- Consumes: `encodeSrc`; API Task 7
- Produces: `api.scanContract(address)`, `api.scanSkill(url, path?)` (mengembalikan data atau melempar `ApiError` berisi `code`, `message`, `details`); layar yang setelah scan berhasil berpindah ke `/app/t/[targetId]?src=…`

Visual: `docs/design/screens/Scan.dc.html`. Teks galat persis dari tabel ux.md 6.6.

- [ ] **Step 1: Tulis tes yang gagal**

```tsx
test('pasting an address and pressing Enter starts a contract scan', async () => {})
test('pasting a repository link starts a skill scan', async () => {})
test('checks tick off one by one while scanning', async () => {})
test('a finished scan navigates to /app/t/[id] with the src query', async () => {})
test.each([
  ['INPUT_NOT_RECOGNIZED', 'That is not a contract address or a repository link.'],
  ['NO_CODE_AT_ADDRESS', 'No contract is deployed at this address on BNB Chain.'],
  ['REPO_NOT_PUBLIC', 'This repository is not public.'],
  ['NO_SKILL_FOUND', 'No skill was found in this repository.'],
  ['BUNDLE_TOO_LARGE', 'This skill is too large to scan.'],
  ['RPC_UNAVAILABLE', 'BNB Chain could not be reached. No verdict was produced.'],
])('%s shows "%s"', async () => {})
test('RATE_LIMITED shows the minutes to wait', async () => { /* "Too many scans from your network. Try again in 3 minutes." */ })
test('MULTIPLE_SKILL_FOLDERS lists the folders and scans the one chosen', async () => {})
test('?q= from the landing page starts the scan immediately', async () => {})
test('the field is labelled and usable with the keyboard alone', async () => {})
```

Run: `pnpm --filter @sealflare/web test`
Expected: FAIL

- [ ] **Step 2: Implementasikan, jalankan sampai lulus, lalu commit**

```bash
git add apps/web
git commit -m "feat: add the Scan screen with progress and every scan error"
```

---

### Task 9 (M1): Halaman target

**Files:**
- Create: `app/app/t/[id]/page.tsx`, `components/target/{Identity,StatusCard,SignalBreakdown,ActionColumn,Banners,FindingsTab,AttestationsTab,HistoryTab,StaleNotice}.tsx`
- Test: `apps/web/test/target.test.tsx`

**Interfaces:**
- Consumes: `TargetDetail`, `AttestationRow`; `Core.tierOf`, `Core.getTarget`, `Core.attestationIndexOf` lewat wagmi; `decodeSrc`
- Produces: halaman yang bisa dibangun dari `id` saja (data indexer), dari `?src=` saja (scan ulang), atau keduanya

Visual: `docs/design/screens/Main.dc.html`. Tab Publisher, Dispute, dan Bounty diisi di M2; di M1 tab itu tampil dengan teks kosong dari ux.md 7.3.

- [ ] **Step 1: Tulis tes yang gagal**

```tsx
test('shows the tier in words with one sentence of reason', async () => {})
test('the signal breakdown shows both groups with votes, weight and flags', async () => {
  /* "42 new IDs" Safe; "3 guardians (W 15)" Danger, Hidden mint */
})
test('the tier comes from Core even when the indexer row disagrees', async () => {})
test('Findings opens first and lists each check with its evidence line', async () => {})
test.each([['Findings', 'This version has not been scanned yet.'], ['Attestations', 'No attestations yet. Be the first Guardian.'],
  ['Publisher', 'No publisher has claimed this target.'], ['Dispute', 'No disputes.'], ['Bounty', 'No bounty.']])(
  'the empty %s tab says "%s"', async () => {})
test.each(['Confirmed danger', 'Modified since audit', 'Under dispute', 'Unbonding'])('the %s banner shows when it applies and cannot be closed', async () => {})
test('a proxy says it cannot get a safe status from IFirewall, and offers "Flag as proxy on-chain" when the marker is not set', async () => {})
test('an unrated target invites "Be the first Guardian" and mentions +2 XP for the first three slots', async () => {})
test('a partial scan lists the checks that did not run', async () => {})
test('an unknown id with a src offers "Scan again"; without a src it says "This result is no longer cached."', async () => {})
test('a lagging indexer shows how many blocks behind', async () => { /* "Data is 12 blocks behind." */ })
test('a skill shows the repository, a short bundle hash and the version rated', async () => {})
test('loading shows a skeleton of the same shape; a failed load says on-chain data is safe and offers a retry', async () => {})
test('at 375 px nothing overflows sideways and Attest sticks to the bottom edge', async () => { /* Playwright component atau e2e */ })
```

Run: `pnpm --filter @sealflare/web test`
Expected: FAIL

- [ ] **Step 2: Implementasikan, jalankan sampai lulus, lalu commit**

```bash
git add apps/web
git commit -m "feat: add the target page with status, signal breakdown, tabs and banners"
```

---

### Task 10 (M1): Panel Attest

**Files:**
- Create: `components/attest/{AttestPanel,VerdictStep,ReviewStep,AttestButton,useAttest}.ts(x)`
- Test: `apps/web/test/attest.test.tsx`

**Interfaces:**
- Consumes: `buildShortProof`, `EvidenceReport`, `evidenceHashOf`, `API_EIP712`, `isValidFlags`; `Core.attest`; `useUserState`
- Produces: `useAttest(target): { state: 'idle' | 'signing-evidence' | 'uploading' | 'signing-tx' | 'pending' | 'failed' | 'done'; error?; txHash?; submit(input) }`

Visual: `docs/design/screens/Panels.dc.html` (tiga keadaan). Alur persis ux.md 6.1 langkah 4 sampai 9, percabangan 6.4.

Urutan `submit`: susun `EvidenceReport` → `reportJson = JSON.stringify(report)` → `evidenceHash` → tanda tangan `EvidenceUpload` (persetujuan pertama, tanpa gas) → `POST /api/evidence` → `Core.attest(…)` (persetujuan kedua) → tampilkan hasil dengan "Waiting for finality".

- [ ] **Step 1: Tulis tes yang gagal**

```tsx
test('the scanner suggestion is shown but no verdict is preselected', async () => {})
test('the review step shows what is written on-chain, the reward and risk for the chosen verdict, and both fixed sentences', async () => {
  /* "This vote is permanent. It cannot be changed or withdrawn." dan "XP becomes claimable after 48 hours." */
})
test.each([['Safe', '+2 XP', '-15'], ['Caution', '0 XP', 'none'], ['Danger', '+5 XP', 'none']])('%s shows reward %s and risk %s', async () => {})
test('the panel says up front there are two approvals and only the second uses gas', async () => {})
test('choosing Safe clears the flags; Caution and Danger need at least one', async () => {})
test('a flag the scanner did not find asks for a short proof quote', async () => {})
test('the bytes signed, uploaded and hashed are the same reportJson', async () => {})
test('a failed upload says "Evidence upload failed. Nothing was sent on-chain." and no transaction is requested', async () => {})
test('rejecting the first approval returns to the review step with no error', async () => {})
test('rejecting the second approval returns to the review step with no error and sends nothing', async () => {})
test('a pending transaction locks the button and links to the transaction', async () => {})
test('a revert shows the translated contract error and a retry', async () => {})
test('success shows the vote in the signal breakdown labelled "Waiting for finality"', async () => {})
test.each([
  ['no wallet', 'asks to connect, then continues at step 1'],
  ['wrong network', 'offers one switch button, then continues'],
  ['no Agent ID', 'shows the two paths and Check again'],
  ['already attested', 'button reads "You attested: Safe" with a transaction link'],
  ['quota used up', 'button is disabled and says when the quota returns'],
  ['target under dispute', 'allows attesting and shows both notes'],
  ['confirmed danger', 'Safe is disabled, Caution and Danger remain'],
  ['contract code changed', 'attesting is closed with the explanation'],
  ['skill changed', 'button reads "Scan the current version"'],
])('%s: %s', async () => {})
```

Run: `pnpm --filter @sealflare/web test`
Expected: FAIL

- [ ] **Step 2: Implementasikan, jalankan sampai lulus, lalu commit**

```bash
git add apps/web
git commit -m "feat: add the Attest panel with two approvals and every branch"
```

---

### Task 11 (M1): Ujung ke ujung tonggak 1

**Files:**
- Create: `apps/web/e2e/{fixtures.ts,scan-attest.spec.ts}`, `apps/web/e2e/README.md`
- Modify: root `package.json` (skrip `e2e`), `.github/workflows/ci.yml` (job `e2e` terpisah)

**Interfaces:**
- Produces: `pnpm e2e` yang menyalakan Anvil dengan stub, PGlite atau Postgres lokal, layanan internal, indexer, dan web dengan `SCANNER=mock`, lalu menjalankan Playwright dengan wallet uji yang memakai akun Anvil lewat *connector* tiruan wagmi (bukan ekstensi)

- [ ] **Step 1: Tulis tes yang gagal**

```ts
test('a visitor scans a contract and reads the result without a wallet', async ({ page }) => {})
test('a new Guardian scans, attests and sees the vote after the block is final', async ({ page }) => {
  /* tempel alamat → halaman target → Attest → pilih Safe → dua persetujuan → "Waiting for finality" →
     tambang blok sampai final → indexer membaca → baris muncul di tab Attestations tanpa label */
})
test('an account without an Agent ID is offered both paths and can continue after getting one', async ({ page }) => {
  /* setBalance di MockAgentID lalu "Check again" */
})
test('the sixth attestation in a day shows the daily limit sentence', async ({ page }) => {})
```

Run: `pnpm e2e`
Expected: FAIL sampai orkestrasi lengkap; lalu PASS

- [ ] **Step 2: Jalankan sampai lulus, lalu commit**

```bash
git add apps/web package.json .github
git commit -m "test: add end-to-end scan and attest flow for milestone one"
```

Ini akhir M1. Pada titik temu: ganti `pnpm chain` dengan `pnpm chain:real` (Rencana 1 Task 11) dan `SCANNER=mock` dengan `SCANNER=real` (Rencana 2 Task 6), lalu jalankan `pnpm e2e` lagi. Setiap perbedaan perilaku antara stub dan kontrak asli dicatat dan dibawa ke founder.

---

## Tonggak 2

### Task 12 (M2): Indexer `Court` dan `Vault`, dan rute baca sisanya

**Files:**
- Create: `apps/indexer/src/handlers/{court,vault}.ts`, `apps/internal/src/routes/{guardians,challenges,bounties,activity}.ts`, `src/readModel/{activity,needsAction}.ts`, rute `app/api/{guardians,challenges,bounties,activity}` di web
- Test: `apps/indexer/test/{court,vault}.handlers.test.ts`, `apps/internal/test/{challenges,bounties,guardians,activity}.test.ts`

**Interfaces:**
- Produces: penanganan semua event `ICourt` dan `IVault`; rute `GET /guardians`, `/guardians/:address`, `/challenges`, `/challenges/:id`, `/bounties`, `/bounties/:id`, `/activity/:address`; `needsActionFor(address, now): NeedsAction[]`

- [ ] **Step 1: Tulis tes yang gagal**

```ts
test('balances equal the sum of BalanceCredited minus Withdrawn per account', async () => {})
test('a challenge row follows ChallengeOpened, VoteCommitted, VoteRevealed, ChallengeResolved', async () => {})
test('juror vote direction is null in the answer until the challenge leaves the commit phase', async () => {})
test('payouts come from Distributed rows of that challenge only', async () => {})
test('bounty filled slots skip the requester and stop at the slot count', async () => {})
test('rebuilding with all three contracts yields identical tables', async () => {})
test.each([
  ['a committed vote in the reveal phase', 'REVEAL_DUE'], ['a challenge on my target in the commit phase', 'REPLY_DUE'],
  ['a challenge past the reveal phase', 'CAN_CLOSE'], ['a SAFE vote older than 48 hours, unsettled', 'XP_CLAIMABLE'],
  ['a bond withdrawal past 7 days', 'BOND_READY'], ['my bounty past its settle time', 'BOUNTY_SETTLEABLE'],
])('%s appears as %s', async () => {})
test('needs action is ordered by due time and empty when nothing is due', async () => {})
test('a guardian with an unapplied -15 is marked penaltyPending', async () => {})
```

Run: `pnpm --filter @sealflare/indexer test && pnpm --filter @sealflare/internal test`
Expected: FAIL

- [ ] **Step 2: Implementasikan, jalankan sampai lulus, lalu commit**

```bash
git add apps
git commit -m "feat: index Court and Vault events and add the remaining read routes"
```

---

### Task 13 (M2): Sandbox: antrean, kuota, cache, dan tampilan

**Files:**
- Create: `apps/internal/src/sandbox/{queue,quota,cache,workerClient,poller}.ts`, `src/routes/sandbox.ts`, rute `app/api/sandbox/*` di web, `components/target/SandboxSection.tsx`
- Test: `apps/internal/test/sandbox.*.test.ts`, `apps/web/test/sandbox.test.tsx`

**Interfaces:**
- Consumes: `WorkerRunRequest`, `WorkerRunResponse`, `WorkerRunStatus`, `SandboxRunCreateRequest`, `API_EIP712`, `CONSTANTS.SANDBOX_DAILY_RUNS`
- Produces: `enqueue(request)`, `takeQuota(address, now)`, `refundQuota(runId)`, `cacheGet(bundleHash, probeSetVersion, modelId)`, `cachePut(result)`, `pollOnce()`

Aturan (arsitektur 5.2 dan 5.5): kuota dipotong saat masuk antrean; dikembalikan hanya bila `failure.cause === 'infrastructure'`; hasil `SANDBOX_FUZZ_FAILED` di cache selamanya; hasil `NO_VIOLATION_OBSERVED` hanya cocok untuk `probeSetVersion` dan `modelId` yang sama; layanan internal memverifikasi ulang tanda tangan dan Agent ID sendiri; setiap pelanggaran di jawaban `GET /runs/:id` worker disimpan saat itu juga.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
test('a cached failed result is returned without using quota or calling the worker', async () => {})
test('a cached clean result is ignored when the model or the probe set version differs', async () => {})
test('quota is taken when the run is queued, and the sixth run in a UTC day is QUOTA_EXHAUSTED', async () => {})
test('quota comes back for an infrastructure failure and not for a skill_content failure', async () => {})
test('the internal service re-verifies the signature and the Agent ID even with a valid inter-service key', async () => {})
test('a replayed nonce is refused', async () => {})
test('a violation seen in a poll is stored before the run ends, and survives the worker disappearing', async () => {})
test('worker 429 DAILY_LIMIT becomes SANDBOX_PAUSED and the quota is returned', async () => {})
test('the queue runs one job at a time and reports queue position', async () => {})
test('SKILL.md for the worker is fetched from the pinned commit in src, never taken from the client', async () => {})
// web
test.each([['queued', 'position in the queue'], ['running', 'the probe in progress'],
  ['done, clean', '"No violation observed" with model and date, and the note that this is not proof of safety'],
  ['done, violation', 'the caught tool calls per probe'], ['incomplete', 'partial results and the reason'],
  ['paused', '"Sandbox is paused for today. Layer 1 results are unaffected."']])('%s shows %s', async () => {})
test('the Run sandbox button states the cost: "Uses 1 of your 5 daily runs. A run that fails because of the skill\'s own content still counts."', async () => {})
```

Run: `pnpm --filter @sealflare/internal test && pnpm --filter @sealflare/web test`
Expected: FAIL

- [ ] **Step 2: Implementasikan, jalankan sampai lulus, lalu commit**

```bash
git add apps
git commit -m "feat: add sandbox queue, quota, asymmetric cache and the sandbox section"
```

---

### Task 14 (M2): Membuka sengketa, daftar Disputes, dan halaman sengketa

**Files:**
- Create: `components/dispute/{ChallengePanel,PhaseStrip,EvidenceBox,ReplyBox,ReplyPanel,Outcomes,PayoutTable}.tsx`, `app/app/disputes/page.tsx`, `app/app/disputes/[id]/page.tsx`, `components/target/DisputeTab.tsx`
- Test: `apps/web/test/dispute.test.tsx`

**Interfaces:**
- Consumes: `ChallengeSummary`, `ChallengeDetail`; `Court.openChallenge`, `submitCounterEvidence`, `phaseOf`, `cooldownEndsAt`, `nextExpireForfeitBps`, `activeChallengeOf`; alur bukti dari Task 10

Visual: `docs/design/screens/Dispute.dc.html`; daftar memakai pola tabel `Explore.dc.html`. Alur ux.md 8.1, 8.2, 8.5, 8.6.

- [ ] **Step 1: Tulis tes yang gagal**

```tsx
test('the panel has three steps: flags, evidence, review', async () => {})
test('the review step names the 0.01 BNB stake and all four endings with the money returned in each', async () => {})
test('the review step states the forfeit share for this target from nextExpireForfeitBps', async () => { /* 20%, 50%, atau 100% */ })
test('the stake sent equals CHALLENGE_STAKE exactly', async () => {})
test.each([['an open challenge exists', 'link "View the open challenge"'], ['in cooldown', 'disabled with the end date'],
  ['confirmed danger', 'button not shown'], ['modules not live', 'disabled with the fixed sentence']])('%s: %s', async () => {})
test('during the commit phase the page shows the juror count and never a vote direction', async () => {})
test('the phase strip counts down and the phase comes from Court.phaseOf', async () => {})
test('the verified publisher sees "Submit reply" during commit; a sponsor does not', async () => {})
test('a target with no publisher says "No publisher is bound to this target, so no reply is possible." with no countdown', async () => {})
test('a closed challenge shows the verdict, the weight on each side, revealed votes and who received what', async () => {})
test('after a danger verdict anyone sees "Apply penalties (N pending)"', async () => {})
test('Resolve and Expire are offered to anyone, each saying it costs gas, and only the applicable one shows', async () => {})
test('the list shows phase and time left, and an empty list explains itself', async () => {})
```

Run: `pnpm --filter @sealflare/web test`
Expected: FAIL

- [ ] **Step 2: Implementasikan, jalankan sampai lulus, lalu commit**

```bash
git add apps/web
git commit -m "feat: add challenge panel, disputes list and the dispute page"
```

---

### Task 15 (M2): Juri: commit dengan reveal code, dan reveal

**Files:**
- Create: `lib/revealCode.ts`, `components/jury/{JoinPanel,RevealCodeStep,RevealPanel,useJury}.ts(x)`
- Test: `apps/web/test/revealCode.test.ts`, `test/jury.test.tsx`

**Interfaces:**
- Consumes: `Court.jurorStatus`, `commitVote`, `revealVote`, `getJuror`, `commitHashOf`; `CONSTANTS.JURY_STAKE`
- Produces:
  - `newRevealCode(challengeId: bigint, uphold: boolean): string` (A6; salt dari `crypto.getRandomValues`, 32 byte)
  - `parseRevealCode(code: string): { challengeId: bigint; uphold: boolean; salt: Hex } | null`
  - `commitHashFor(code, juror: Address): Hex` (sama dengan `Court.commitHashOf`)
  - `saveRevealCode(code)`, `loadRevealCode(challengeId, juror)` (penyimpanan lokal)

- [ ] **Step 1: Tulis tes yang gagal**

```ts
test('a new code round-trips through parseRevealCode', () => {})
test('two codes for the same vote differ: the salt is random, never derived from a signature', () => {
  /* tidak ada panggilan signMessage di jalur ini; 100 kode semuanya berbeda */
})
test('commitHashFor equals keccak256(abi.encode(id, juror, uphold, salt))', () => {})
test.each(['', 'sf1.1.u', 'sf1.x.u.' + 'a'.repeat(64), 'sf1.1.z.' + 'a'.repeat(64), 'sf2.1.u.' + 'a'.repeat(64), 'sf1.1.u.' + 'g'.repeat(64)])(
  'parseRevealCode(%s) is null', (code) => expect(parseRevealCode(code)).toBeNull())
```

```tsx
test('each ineligible status shows its own reason', async () => { /* tujuh status */ })
test('the summary names the 0.005 BNB stake, the reveal schedule and both ways to lose the stake', async () => {})
test('the commit button stays disabled until the reveal code is copied or downloaded', async () => {})
test('the commit confirmation says there is no reminder outside the app and shows a copyable reveal time', async () => {})
test('the code is kept in local storage so a reveal from the same device is one click', async () => {})
test('a pasted code is checked against the on-chain commit hash before anything is sent', async () => {})
test.each([['for another challenge'], ['with the direction flipped'], ['malformed'], ['belonging to another juror']])(
  'a code %s sends no transaction and tells the juror', async () => {})
test('revealing outside the reveal window is not offered', async () => {})
test('after revealing, the vote shows with "Waiting for finality"', async () => {})
```

Run: `pnpm --filter @sealflare/web test`
Expected: FAIL

- [ ] **Step 2: Implementasikan, jalankan sampai lulus, lalu commit**

```bash
git add apps/web
git commit -m "feat: add jury commit with a saved random reveal code, and reveal"
```

---

### Task 16 (M2): Publish dan bond

**Files:**
- Create: `app/app/publish/page.tsx`, `app/app/publish/sign/[request]/page.tsx`, `components/publish/{KindStep,ContractStep,OwnerProofStep,SkillStep,BondStep,BadgeSnippet}.tsx`, `components/target/PublisherTab.tsx`
- Test: `apps/web/test/publish.test.tsx`, `test/publisherTab.test.tsx`

**Interfaces:**
- Consumes: `EIP712` (dengan `bindNonce`), `Core.bindByOwner`, `bindByDeployer`, `bindSkill`, `sponsor`, `bindNonce`; `Vault.depositBond`, `requestBondWithdrawal`, `finalizeBondWithdrawal`, `bondOf`; `readManifestPublisher` lewat laporan scan

Visual: `docs/design/screens/Publish.dc.html`. Alur ux.md Bagian 9. Tautan "Share this request" memuat data pesan di *fragment* URL (target, pemegang, nonce, tenggat), jadi server tidak menyimpan apa pun; halaman `sign` hanya meminta tanda tangan dan menampilkan hasilnya untuk disalin.

- [ ] **Step 1: Tulis tes yang gagal**

```tsx
test('Publish needs an Agent ID, not just a wallet', async () => {})
test('an owner who is the connected wallet signs once and binds in one transaction', async () => {})
test('an owner on another wallet gets a share link valid for 24 hours and a "Paste signature" field', async () => {})
test('the signed message carries the current bindNonce of the target', async () => {})
test('a pasted signature is verified locally before the transaction is offered', async () => {})
test('a contract with no owner asks for the deployer and finds the matching nonce', async () => {})
test('a skill binds only when the manifest publisher equals the connected wallet; otherwise it explains why', async () => {})
test('a target that cannot be proven offers the sponsor role', async () => {})
test('a target that already has a publisher says "This target already has a publisher."', async () => {})
test('the bond step states the 0.5 BNB cap, the 7 day wait, that it can still be cut, and the half cut on a proven violation', async () => {})
test('the bond step can be skipped', async () => {})
test('the badge snippet links to /app/t/[id], never to the landing page', async () => {})
test('the Publisher tab shows role, how ownership was proven, bond per depositor and withdrawal status', async () => {})
test('the depositor sees Deposit bond, Request withdrawal, and Finalize withdrawal only after 7 days', async () => {})
test('a locked bond explains it cannot be withdrawn during the dispute', async () => {})
```

Run: `pnpm --filter @sealflare/web test`
Expected: FAIL

- [ ] **Step 2: Implementasikan, jalankan sampai lulus, lalu commit**

```bash
git add apps/web
git commit -m "feat: add Publish flow and warranty bond actions"
```

---

### Task 17 (M2): Bounty

**Files:**
- Create: `components/bounty/{BountyPanel,BountyTab,SettleButton}.tsx`, `app/app/bounties/page.tsx`
- Test: `apps/web/test/bounty.test.tsx`

**Interfaces:**
- Consumes: `BountySummary`, `BountyDetail`; `Vault.createBounty`, `settleBounty`; `CONSTANTS.MAX_BOUNTY`, `BOUNTY_MIN_SLOTS`, `BOUNTY_MAX_SLOTS`

- [ ] **Step 1: Tulis tes yang gagal**

```tsx
test('slots are limited to 3 to 5 and the amount to 0.2 BNB', async () => {})
test('the summary states all five facts from ux.md section 10', async () => {
  /* mayoritas pengisi slot; 5% treasury; tidak bisa dibatalkan; slot kosong dikembalikan setelah 7 hari; suara peminta tidak mengisi slot */
})
test('creating a bounty needs a wallet but not an Agent ID', async () => {})
test('a row in the list opens the target page', async () => {})
test('Settle appears 48 hours after the last slot, or 7 days after creation', async () => {})
test('the tab shows filled slots and when it can be settled', async () => {})
test('modules not live shows the empty state with the fixed sentence', async () => {})
```

Run: `pnpm --filter @sealflare/web test`
Expected: FAIL

- [ ] **Step 2: Implementasikan, jalankan sampai lulus, lalu commit**

```bash
git add apps/web
git commit -m "feat: add bounty creation, list and settlement"
```

---

### Task 18 (M2): My activity, penarikan, dan tombol penyelesaian

**Files:**
- Create: `app/app/me/page.tsx`, `components/activity/{NeedsAction,Balance,Standing,History,WithdrawButton,SettleXpButton,ApplyPenaltiesButton}.tsx`
- Test: `apps/web/test/activity.test.tsx`

**Interfaces:**
- Consumes: `Activity`, `NeedsAction`; `Vault.balanceOf`, `withdraw`; `Core.settle`, `applyPenalties`, `pendingSettlement`, `pendingPenalties`, `getGuardian`, `weightOf`

Visual: `docs/design/screens/Activity.dc.html`. Saldo dibaca dari `Vault.balanceOf` langsung, bukan dari indexer.

- [ ] **Step 1: Tulis tes yang gagal**

```tsx
test('needs action comes first, ordered by urgency, and disappears when empty', async () => {})
test('a due reveal names the stake at risk and links to the reveal', async () => {})
test('the balance comes from Vault.balanceOf and Withdraw sends the whole balance', async () => {})
test('Withdraw is not offered with a zero balance', async () => {})
test('standing shows score, vote weight, distance to the next weight and attestations left today', async () => {})
test('Claim calls settle for the page of attestations that contains mine and says it costs gas', async () => {})
test('Apply penalties pages through in chunks and shows how many remain', async () => {})
test('an account with no history sees one invitation: scan a first target', async () => {})
test('the wallet button badge equals the number of needs-action items', async () => {})
test('this page asks for a wallet and shows nothing personal without one', async () => {})
```

Run: `pnpm --filter @sealflare/web test`
Expected: FAIL

- [ ] **Step 2: Implementasikan, jalankan sampai lulus, lalu commit**

```bash
git add apps/web
git commit -m "feat: add My activity, withdrawals and settlement actions"
```

---

### Task 19 (M2): Explore, Guardians, dan profil Guardian

**Files:**
- Create: `app/app/explore/page.tsx`, `app/app/guardians/page.tsx`, `app/app/g/[address]/page.tsx`, `components/target/TargetTable.tsx`
- Test: `apps/web/test/lists.test.tsx`

Visual: `docs/design/screens/Explore.dc.html`. Di layar sempit, baris tabel menjadi kartu (ux.md Bagian 5).

- [ ] **Step 1: Tulis tes yang gagal**

```tsx
test('Explore lists targets newest first with a seal mark, the three vote counts and the publisher', async () => {})
test('filters by kind and by verdict, and the filter is in the URL', async () => {})
test('the three vote counts are always shown; there is no single score column', async () => {})
test('Guardians ranks by score and marks "Penalty pending"', async () => {})
test('a profile shows score, weight and history', async () => {})
test('every list has empty, loading and failed states', async () => {})
test('at 375 px each row is a card and nothing overflows', async () => {})
```

Run: `pnpm --filter @sealflare/web test`
Expected: FAIL

- [ ] **Step 2: Implementasikan, jalankan sampai lulus, lalu commit**

```bash
git add apps/web
git commit -m "feat: add Explore, Guardians and the Guardian profile"
```

---

### Task 20 (M2): SDK `@sealflare/guard`

**Files:**
- Create: `packages/sdk/{package.json,tsconfig.json,vitest.config.ts,README.md}`, `src/{index,contract,skill}.ts`
- Test: `packages/sdk/test/{contract,skill}.test.ts`

**Interfaces:**
- Consumes: `firewallAbi`, `TRUST_TIERS`, `bundleIdentity`; `inspectProxy` dari `@sealflare/scanner-core`
- Produces:
  - `createGuard(options: { client: PublicClient; core: Address }): Guard`
  - `guard.checkContract(address): Promise<{ tier: TrustTier; safe: boolean; isUpgradeableProxy: boolean; implementationChanged: boolean | null; flags: FlagName[]; warrantyBond: bigint; reasons: string[] }>`
  - `guard.checkSkill(entries: BundleEntry[]): Promise<{ tier; safe: boolean; canonicalBundleHash; publisher: Address | null; flags: FlagName[]; warrantyBond: bigint; reasons: string[] }>`

`safe` hanya benar untuk `COMMUNITY_SAFE` dan `WARRANTY_BACKED_SAFE`. Setiap kegagalan RPC melempar; tidak ada jalur yang mengembalikan `safe: true` saat ragu.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
test.each(TRUST_TIERS)('tier %s: safe is true only for the two SAFE tiers', async () => {})
test('a proxy is never safe, whatever its tier', async () => {})
test('a proxy whose implementation slot now holds different code than at the last scan reports implementationChanged', async () => {})
test('an unknown target is UNRATED and not safe', async () => {})
test('an RPC failure throws; it never resolves to safe', async () => {})
test('checkSkill computes the canonical hash locally from the entries, so a changed file changes the answer', async () => {})
test('reasons are plain English sentences with no em dash', async () => {})
test('the README example is three lines and type-checks', () => { /* kompilasi potongan dari README */ })
```

Run: `pnpm --filter @sealflare/guard test`
Expected: FAIL

- [ ] **Step 2: Implementasikan, jalankan sampai lulus, lalu commit**

```bash
git add packages/sdk pnpm-lock.yaml
git commit -m "feat: add the @sealflare/guard SDK"
```

---

### Task 21 (M2): Companion Skill

**Files:**
- Create: `packages/skill/{SKILL.md,package.json,tsconfig.json,vitest.config.ts}`, `scripts/{scan-contract,scan-skill,prepare-attestation}.ts`, `src/{output,args}.ts`
- Test: `packages/skill/test/{scripts,selfScan}.test.ts`

**Interfaces:**
- Consumes: `@sealflare/guard`, `@sealflare/scanner-core`, `buildShortProof`, `encodeSrc`
- Produces: tiga skrip baca-saja. `prepare-attestation` mencetak parameter `attest()` dan ringkasan, lalu berhenti; ia tidak menandatangani dan tidak mengirim apa pun.

`SKILL.md` memuat frontmatter dengan `metadata.sealflare-publisher` berisi alamat penerbit (diisi founder saat rilis), dan menyuruh agen selalu menampilkan ringkasan serta menunggu konfirmasi pengguna.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
test('scan-contract prints the tier, both signal groups and the flags, and links to /app/t/[id]', async () => {})
test('scan-skill prints the canonical bundle hash, the findings and the on-chain status', async () => {})
test('prepare-attestation prints the attest() parameters and a summary, and never calls a signer', async () => {
  /* tidak ada impor wallet client di paket ini; grep "privateKey|signTransaction|sendTransaction" kosong */
})
test('no script writes a file or reads an environment secret other than RPC_URL', async () => {})
test('a bad argument prints usage and exits non-zero', async () => {})
test('the skill passes its own Layer 1 scan with a SAFE suggestion', async () => {
  /* muat packages/skill sebagai BundleEntry[] dan jalankan pemeriksaan skill dari scanner-core */
})
```

Run: `pnpm --filter @sealflare/skill test`
Expected: FAIL

- [ ] **Step 2: Implementasikan, jalankan sampai lulus, lalu commit**

```bash
git add packages/skill pnpm-lock.yaml
git commit -m "feat: add the read-only Companion Skill"
```

---

### Task 22 (M2): Ujung ke ujung tonggak 2 dan pemeriksaan akhir

**Files:**
- Create: `apps/web/e2e/{dispute.spec.ts,publish-bond.spec.ts,narrow.spec.ts}`
- Modify: `README.md`

- [ ] **Step 1: Tulis tes yang gagal**

Dijalankan terhadap kontrak asli (`pnpm chain:real`), dengan `pnpm chain:warp` untuk melompati fase.

```ts
test('scan, attest, challenge, jury, verdict, withdraw', async ({ page }) => {
  /* tiga Guardian attest Safe → penantang membuka sengketa → tiga juri commit dan menyimpan reveal code →
     warp 12 jam → tiga reveal → warp 12 jam → Resolve → pita Confirmed danger → Apply penalties →
     penantang Withdraw dan saldo wallet naik */
})
test('a challenge with two reveals expires and the challenger gets 80% back', async ({ page }) => {})
test('a publisher binds, deposits a bond, requests withdrawal and finalizes after 7 days', async ({ page }) => {})
test('every app screen at 375 px has no horizontal overflow', async ({ page }) => { /* sepuluh rute */ })
test('every app screen passes an automated accessibility scan in both themes', async ({ page }) => {})
test('with modulesLive off, dispute, bounty and bond actions are disabled everywhere', async ({ page }) => {})
```

Run: `pnpm e2e`
Expected: FAIL sampai semua task M2 selesai; lalu PASS

- [ ] **Step 2: Jalankan `pnpm verify` dan `pnpm e2e`, lalu commit**

```bash
git add apps/web README.md
git commit -m "test: add end-to-end dispute, publish and narrow-screen checks"
```

---

## Perubahan yang perlu disetujui founder

- **`shared/schemas/readModel.ts` (Task 1).** Tambahan yang sudah diizinkan; perlu diperiksa dan dibekukan pada hari pertama.
- **Tautan resmi mendapatkan Agent ID** (`NEXT_PUBLIC_AGENT_ID_URL`). Tanpa itu, panel "Get an Agent ID" menunjuk ke tempat kosong.
- **Variabel lingkungan dan akun** yang dipegang founder: Project ID WalletConnect, kunci RPC, kunci BscScan, token GitHub, JWT Pinata, URL dan kunci layanan internal.

Bila pelaksanaan menemukan perjanjian beku lain tidak cukup, catat di sini: apa yang kurang, kenapa tidak bisa diselesaikan di dalam jalur ini, dan siapa yang terdampak.

## Yang tidak dikerjakan rencana ini

- Landing `/` dan Docs `/docs` (founder).
- Docker Compose, deploy ke Vercel dan VPS, cadangan `pg_dump` (founder).
- Kontrak (Rencana 1), pemindai dan worker sandbox (Rencana 2).
