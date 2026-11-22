# Arsitektur Sealflare

**Status:** rancangan revisi 2 (setelah review independen), menunggu persetujuan  
**Tanggal:** 21 November 2026  
**Sumber:** [sealflare.md](../sealflare.md) (blueprint produk). Bila keduanya berbeda, dokumen ini yang berlaku.  
**Tenggat submisi:** 9 Desember 2026, 15:00 WIB

Dokumen ini menetapkan komponen Sealflare, tugas masing-masing, cara mereka saling bicara, dan tempat setiap data disimpan. Ia menjadi pegangan untuk tahap UX, design, develop, dan deploy. Ia tidak memuat kode implementasi.

---

## 1. Tujuan dan batasan

### 1.1 Yang ingin dicapai

- Membangun kelima modul di blueprint dengan kedalaman yang sama: kontrak, pemindai Layer 1, sandbox Layer 2, dApp, serta Companion Skill dan SDK.
- Tiga developer bekerja paralel tanpa saling menunggu.
- Kontrak hidup di BNB Smart Chain Mainnet dan terverifikasi di BscScan, dengan minimal 30 alamat Agent ID unik yang berinteraksi sebelum tenggat.

### 1.2 Batasan yang mengikat

- **Tim:** tiga developer full-stack. Founder memegang arsitektur, UX, design, deploy, dan Jalur 1. Dua developer lain mengerjakan Jalur 2 dan Jalur 3.
- **Safety Red Lines:** server tidak pernah menandatangani transaksi, tidak ada *unlimited approval*, tidak ada wewenang admin atas putusan atau dana.
- **Dana:** hanya BNB asli. Bounty USDT/USDC tidak dibangun.
- **Audit:** tidak ada audit pihak ketiga dalam jadwal ini. Hal itu dinyatakan di dokumentasi publik.

### 1.3 Ukuran berhasil

- Ketiga jalur bisa dibangun dan diuji tanpa komponen jalur lain, memakai tiruan.
- Satu skenario ujung ke ujung lulus di jaringan lokal: scan, attest, buka sengketa, putusan, tarik dana.
- Tidak ada jalur kode di mana kegagalan teknis menghasilkan verdict `SAFE`.

---

## 2. Gambaran sistem

```
                      ┌────────────────────────────────────────┐
                      │  Pengguna: dApp, Companion Skill, SDK  │
                      └───────┬───────────────────┬────────────┘
                 tanda tangan │                   │ HTTPS
                    transaksi │                   ▼
                              │        ┌────────────────────┐      ┌──────────────┐
                              │        │  API (Vercel)      │─────▶│ IPFS (Pinata)│
                              │        └─────────┬──────────┘      └──────────────┘
                              │                  │ HTTPS + tanda tangan
                              │                  ▼
                              │        ┌──────────────────────────────────────┐
                              │        │ VPS: layanan internal, sandbox       │──▶ LLM
                              │        │ worker, indexer, Postgres            │
                              │        └──────────────────▲───────────────────┘
                              ▼                           │ event
   ┌───────────────────────────────────────────────┐      │
   │  BNB Chain:  Court ──▶ Core ◀── Vault         │──────┘
   │              Court ───────────▶ Vault         │
   └───────────────────────────────────────────────┘
```

Sumber kebenaran adalah BNB Chain. Postgres dan IPFS menyimpan salinan, lampiran, dan data operasional sandbox.

---

## 3. Perjanjian yang dibekukan lebih dulu

Enam hal ini ditulis pada hari pertama, sebelum ada fitur. Semuanya disimpan di `shared/`. Perubahan setelah dibekukan harus disetujui founder.

| Perjanjian | Lokasi | Isi | Yang bergantung |
| :--- | :--- | :--- | :--- |
| ABI dan event | `contracts/src/interfaces/` (sumber), `shared/abi/` (ABI hasil ekspor) | Interface `ICore`, `ICourt`, `IVault`, `IFirewall` dengan parameter lengkap, daftar event (termasuk event setiap perubahan skor, dan bobot pemilih di event attestation), galat kustom di dalam tiap interface, ABI JSON | web, indexer, SDK, skill |
| Tipe pemindaian | `shared/schemas/scan.ts`, `shared/schemas/sandbox.ts`, `shared/rules/bundleHash.ts` | `ScanReport`, `SandboxResult`, daftar flag, aturan `canonicalBundleHash` (Bagian 5.3) | API, sandbox, skill, SDK, web |
| Antarmuka `scanner-core` | `shared/schemas/scanner.ts` | Tanda tangan fungsi publik dan adapter RPC, BscScan, pengambil repositori | API, skill, SDK |
| Skema API publik | `shared/schemas/api.ts` | Amplop jawaban, endpoint scan, sandbox, dan bukti. Skema baca (`targets`, `guardians`, `challenges`, `bounties`, `activity`) dibuat Jalur 3, karena kedua sisinya milik jalur itu | web, skill |
| Skema layanan internal | `shared/schemas/internal.ts` | Kontrak antara layanan internal dan sandbox worker. Endpoint antara Vercel dan layanan internal dibuat Jalur 3 | sandbox, layanan internal |
| Skema bukti dan aturan | `shared/schemas/evidence.ts`, `shared/schemas/shortProof.ts`, `shared/rules/` | JSON laporan IPFS, format `shortProof`, tabel tier dan XP beserta vektor uji di `shared/rules/vectors/` | scanner, sandbox, kontrak, web |

Yang diserahkan Jalur 1 pada hari pertama, supaya jalur lain tidak menunggu kontrak asli:

- Kontrak stub `Core`, `Court`, `Vault` dengan event final dan *setter* khusus uji.
- `MockAgentID` dengan `balanceOf` yang bisa diatur.
- Skrip deploy ke Anvil dan helper untuk memajukan waktu.

Tiruan lain: web memakai API tiruan yang mengembalikan isi `shared/fixtures/`; pemindai dan sandbox diuji dengan `shared/fixtures/` tanpa kontrak atau UI.

---

## 4. Kontrak on-chain

### 4.1 Tiga kontrak

| Kontrak | Tugas | Memegang dana |
| :--- | :--- | :---: |
| `Core` | Registri target, pengikatan penerbit, attestation, skor Guardian, `IFirewall` | tidak |
| `Court` | Sengketa: tantangan, bukti balasan, commit, reveal, putusan, kedaluwarsa | tidak |
| `Vault` | Semua BNB: stake penantang dan juri, Warranty Bond, bounty, treasury | ya |

Ketergantungan:

- `Court` menulis putusan ke `Core` dan memerintah `Vault` lewat escrow per sengketa.
- `Vault` membaca `Core` (peran penerbit, attestation) dan mengambil alamat `Court` dari `Core`.
- `Core` membaca satu angka dari `Vault`: besar bond aktif untuk `IFirewall`. Bila `vault` belum diisi, angka itu dianggap 0 dan tidak ada panggilan keluar.

Urutan deploy: `Core`, lalu `Vault(core)`, lalu `Court(core, vault)`, lalu `Core.setModules(court, vault)`.

### 4.2 `setModules` dan kepemilikan

- `Core` tidak mewarisi `Ownable`. Ia menyimpan `immutable deployer` dan satu flag sekali pakai.
- `setModules(court, vault)` hanya bisa dipanggil `deployer`, hanya sekali, dan memeriksa `ICourt(court).core() == this`, `IVault(vault).core() == this`, serta `ICourt(court).vault() == vault`.
- Fungsi yang sama mematikan wewenang `deployer` di akhir. Tidak ada transaksi pelepasan terpisah yang bisa terlupa atau terbalik urutannya.
- Kunci `deployer` disimpan di hardware wallet selama jendela antara rilis `Core` dan `setModules`.

### 4.3 Identitas target

- **Kontrak:** `targetId = keccak256(abi.encode(SMART_CONTRACT, contractAddr))`.
- **Skill:** `canonicalBundleHash = keccak256(abi.encode(contentHash, manifestPublisher))`, lalu `targetId = keccak256(abi.encode(AI_SKILL_BUNDLE, canonicalBundleHash))`. `manifestPublisher` adalah alamat di manifest skill, atau `address(0)` bila manifest tidak ada.

Catatan target dibuat saat pertama kali disentuh. Setiap fungsi yang membuat catatan untuk kontrak menolak alamat tanpa kode (`code.length == 0`), supaya pin tidak bisa diambil sebelum kontraknya ada.

### 4.4 Permukaan fungsi

**Core**

| Fungsi | Pemanggil | Keterangan |
| :--- | :--- | :--- |
| `attest(targetType, target, verdict, flags, evidenceHash, shortProof, evidenceURI)` | pemegang Agent ID | Memeriksa `balanceOf`, batas 5 per hari, satu suara per target. Bobot pemanggil dibekukan saat itu dan ditambahkan ke jumlah bobot target. |
| `bindByOwner(target, agentIdHolder, deadline, sig)` | siapa pun | Tanda tangan EIP-712 dari `owner()` target, diperiksa dengan `SignatureChecker` (EOA dan ERC-1271). Penerbit yang dicatat selalu `agentIdHolder`, yang harus memegang Agent ID. |
| `bindByDeployer(target, deployer, nonce, agentIdHolder, deadline, sig)` | siapa pun | Hanya bila target tidak punya `owner()` atau nilainya nol. Menghitung ulang alamat `CREATE`. |
| `bindSkill(contentHash)` | pemegang Agent ID | Menghitung `canonicalBundleHash` dengan `msg.sender` sebagai penerbit. Klaim atas bundel milik orang lain jatuh ke hash yang tidak pernah dihasilkan pemindai. |
| `sponsor(targetId)` | pemegang Agent ID | Mencatat `THIRD_PARTY_SPONSOR` bila target belum punya penerbit. |
| `probeBytecode(target)` | siapa pun | Memindai bytecode target mencari opcode `DELEGATECALL` dan menyalakan penanda `hasDelegatecall` secara permanen. Pemanggil yang membayar gasnya. |
| `settle(targetId, start, count)` | siapa pun | Membagikan XP per attestation setelah 48 jam, bertahap. |
| `applyPenalties(targetId, start, count)` | siapa pun | Menerapkan -15 ke attester `SAFE` setelah putusan bahaya, bertahap. |
| `verifyContract(target)`, `verifySkillBundle(hash)` | siapa pun (view) | `IFirewall`. Biaya tetap, tanpa perulangan. |
| `markDisputed`, `applyVerdict`, `adjustScore` | hanya `Court` | Satu-satunya jalur menulis putusan sengketa. |

Aturan flag: setiap flag harus berada di dalam kelompok jenis targetnya (bit 0 sampai 7 untuk kontrak, bit 8 sampai 15 untuk skill). Attestation `SAFE` wajib tanpa flag; `CAUTION` dan `DANGER` wajib membawa minimal satu flag.

Aturan pembacaan `owner()`: panggilan `staticcall` tingkat rendah dengan batas gas. Target dianggap tidak punya pemilik bila panggilan gagal atau data baliknya bukan 32 byte.

Domain EIP-712 memuat `chainId` dan alamat `Core`. Pesan yang ditandatangani juga memuat `bindNonce`, pencacah per target yang dipakai habis oleh setiap pengikatan. Tanpanya, tanda tangan lama untuk penerbit X bisa diputar ulang setelah pemilik menandatangani untuk penerbit Y. Tipe pesannya ada di `contracts/src/lib/BindTypes.sol`.

Peran penerbit: `NONE` ke `THIRD_PARTY_SPONSOR` ke `VERIFIED_PUBLISHER`. `VERIFIED_PUBLISHER` hanya bisa diganti oleh bukti baru dari `owner()` target saat itu.

**Court**

| Fungsi | Pemanggil | Keterangan |
| :--- | :--- | :--- |
| `openChallenge(targetId, flags, evidenceHash, shortProof, evidenceURI)` payable | pemegang Agent ID | Satu sengketa aktif per target. Stake masuk escrow `Vault`. |
| `submitCounterEvidence(id, uri)` | penerbit target | Selama fase commit. |
| `commitVote(id, hash)` payable | juri yang layak | Bobot juri dibekukan saat commit. Paling banyak 21 juri per sengketa (`MAX_JURORS`), supaya `resolve` selalu muat dalam satu blok. |
| `revealVote(id, uphold, salt)` | juri | Selama fase reveal. |
| `resolve(id)` | siapa pun | Setelah reveal berakhir dan jumlah reveal minimal 3. |
| `expire(id)` | siapa pun | Setelah reveal berakhir dan jumlah reveal kurang dari 3. |

Kelayakan juri: memegang Agent ID; profil Guardian dibuat sebelum blok sengketa dibuka (`Core` menyimpan `createdAtBlock`); skor tidak negatif saat commit; bukan penantang, bukan penerbit target, dan belum pernah attest target itu.

**Vault**

| Fungsi | Pemanggil | Keterangan |
| :--- | :--- | :--- |
| `depositBond(targetId)` payable | penerbit atau sponsor | Dicatat per `(targetId, penyetor)`. Bond yang dihitung untuk tier dan `IFirewall` hanya milik penerbit tercatat saat itu; bond sponsor lama tidak ikut dihitung setelah ada penerbit terverifikasi. |
| `requestBondWithdrawal`, `finalizeBondWithdrawal` | penyetor bond itu | Jeda 7 hari. Dana tetap bisa dipotong selama menunggu atau ada sengketa. |
| `createBounty(targetId, slots)` payable | siapa pun | 3 sampai 5 slot. |
| `settleBounty(id)` | siapa pun | Aturan di Bagian 4.9. |
| `withdraw()` | siapa pun | Menarik saldo sendiri. |
| `depositStake(challengeId, account)` payable | hanya `Court` | Satu-satunya jalur BNB masuk untuk sengketa. |
| `lockBond(challengeId, targetId)` | hanya `Court` | Mengikat bond target ke escrow sengketa itu. |
| `settleBond(challengeId, slashBps)` | hanya `Court` | Memindahkan `slashBps` dari bond yang terkunci ke escrow sengketa itu dan melepas sisanya ke penyetornya. Dipanggil sekali per sengketa yang mengunci bond: 5000 bila tantangan menang, 0 selain itu. |
| `distribute(challengeId, recipients, amounts)` | hanya `Court` | Jumlah total tidak boleh melebihi isi escrow sengketa itu. |

`Vault` tidak punya `receive()` dan tidak pernah memakai `address(this).balance` dalam logikanya. Bug di `Court` hanya bisa merusak satu escrow sengketa.

### 4.5 `IFirewall`: yang bisa dan tidak bisa dideteksi on-chain

Kontrak tidak bisa membaca storage kontrak lain, dan `EXTCODEHASH` sebuah proxy tidak berubah saat implementasinya diganti. Karena itu:

- `verifyContract` mendeteksi perubahan bytecode target sendiri (`STALE_CODEHASH_DRIFT`).
- Nilai ketiga yang dikembalikan `verifyContract` bernama `pinnedCodehash`: `EXTCODEHASH` target saat pertama kali dicatat. Blueprint menamainya `pinnedImplHash`, padahal `Core` tidak bisa membaca slot implementasi.
- `verifyContract` **tidak** mendeteksi penggantian implementasi proxy. Pengecekan itu hanya ada di SDK dan pemindai, yang membaca slot EIP-1967 dan Beacon lewat RPC.
- Sebagai pengaman, target dengan penanda `hasDelegatecall` atau flag `UPGRADEABLE_NO_TIMELOCK` atau `UNPINNABLE_DELEGATECALL` dari attestation mana pun tidak pernah mendapat tier `SAFE` dari `IFirewall`. Tier tertingginya `CAUTION_FLAGGED`, dan `isUpgradeableProxy` bernilai benar.
- Penanda `hasDelegatecall` hanya bisa menyala, tidak bisa padam. Siapa pun bisa menyalakannya lewat `probeBytecode`, jadi attester pertama yang berbohong tidak bisa menyembunyikan proxy. Positif palsu jatuh ke sisi aman.

Kontrak pemanggil yang perlu mempercayai proxy harus memakai SDK, bukan `IFirewall` saja.

### 4.6 Konsensus, tier, dan XP

Jumlah bobot disimpan per target: `safeWeight`, `cautionWeight`, `dangerWeight`. Bobot `W(S)` seorang Guardian dihitung dari skornya dan dibekukan pada saat ia attest. Perubahan skor setelah itu tidak mengubah suara lama.

Tier ditentukan dengan urutan prioritas berikut, berhenti di aturan pertama yang cocok:

| # | Syarat | Tier |
| :---: | :--- | :--- |
| 1 | Ada putusan bahaya | `CONFIRMED_DANGER` |
| 2 | Bytecode target berbeda dari pin | `STALE_CODEHASH_DRIFT` |
| 3 | Ada sengketa aktif | `DISPUTED_CAUTION` |
| 4 | `dangerWeight >= 3`, atau `cautionWeight + dangerWeight >= safeWeight` dan lebih dari 0 | `CAUTION_FLAGGED` |
| 5 | Penanda proxy menyala (Bagian 4.5) | `CAUTION_FLAGGED` |
| 6 | `safeWeight >= 3` dan penerbit terverifikasi punya bond aktif | `WARRANTY_BACKED_SAFE` |
| 7 | `safeWeight >= 3` | `COMMUNITY_SAFE` |
| 8 | Selain itu | `UNRATED` |

XP:

| Peristiwa | XP | Diterapkan oleh |
| :--- | :---: | :--- |
| Attestation `SAFE` urutan 1 sampai 3, bertahan 48 jam sejak attestation itu tanpa sengketa aktif atau putusan bahaya | +2 | `settle` |
| Attestation `SAFE` urutan 4 sampai 10, syarat sama | +1 | `settle` |
| Attestation `SAFE` urutan 11 dan seterusnya | 0 | |
| Attestation `DANGER` pada target yang kemudian diputus bahaya | +5 | `settle` |
| Attestation `CAUTION` | 0 | |
| Juri di sisi mayoritas | +3 | `resolve` |
| Penantang yang menang | +5 | `resolve` |
| Penantang yang kalah | -5 | `resolve` |
| Attestation `SAFE` pada target yang diputus bahaya | -15 | `applyPenalties` |

`settle` tidak pernah memotong skor. Suara `SAFE` pada target yang diputus bahaya tidak mendapat apa pun dari `settle`; potongan -15 hanya diterapkan `applyPenalties`, dengan penandanya sendiri, sehingga tidak bisa terpotong dua kali. Suara `DANGER` baru bisa diselesaikan setelah ada putusan bahaya.

Setiap attestation punya penanda "sudah diselesaikan", supaya XP tidak dibayar dua kali. Tabel tier dan XP disimpan di `shared/rules/` dengan vektor uji yang sama untuk Foundry dan Vitest. Halaman rincian membaca tier dari view `Core`, bukan menghitungnya ulang.

### 4.7 Mesin status sengketa

`T0` adalah waktu `openChallenge`.

| Fase | Waktu | Yang boleh |
| :--- | :--- | :--- |
| Commit | `T0` sampai `T0 + 12 jam` | `commitVote`, `submitCounterEvidence` |
| Reveal | `T0 + 12 jam` sampai `T0 + 24 jam` | `revealVote` |
| Selesai | setelah `T0 + 24 jam` | `resolve` bila reveal minimal 3, selain itu `expire`. Keduanya saling eksklusif. |

- Kuorum dihitung dari jumlah reveal, bukan commit.
- Stake juri yang commit tetapi tidak reveal hangus. Ini menutup taktik commit di dua sisi lalu hanya membuka yang menang.
- Target berstatus `DISPUTED_CAUTION` hanya selama sengketa aktif.
- *Cooldown* 7 hari untuk pasangan Agent ID dan target dipicu oleh `expire`.
- Porsi stake penantang yang hangus saat `expire` naik untuk sengketa kedaluwarsa berulang pada target yang sama dalam 30 hari: 20%, lalu 50%, lalu 100%, siapa pun penantangnya. Ini membatasi penguncian target secara bergiliran.

### 4.8 Pembagian dana sengketa

*Pool* adalah stake juri minoritas, stake juri yang tidak reveal, dan potongan bond.

| Hasil | Penantang | Juri mayoritas | Juri minoritas | Bond penerbit | Treasury |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Tantangan menang | stake kembali + 50% pool | stake kembali + 50% pool, dibagi rata | stake hangus ke pool | 50% dipotong ke pool | sisa pembulatan |
| Tantangan kalah | stake hangus ke pool | stake kembali + 100% pool, dibagi rata | stake hangus ke pool | utuh | sisa pembulatan |
| Bobot seri | stake kembali | stake kembali | stake kembali | utuh | stake yang tidak reveal |
| Kedaluwarsa | 80%, 50%, atau 0% kembali (Bagian 4.7) | yang reveal: stake kembali | | utuh | sisanya |

Treasury adalah alamat `immutable` di `Vault`. Saldonya ditarik lewat `withdraw()` seperti saldo lain, dan alamatnya dicantumkan di dokumentasi *owner permissions*.

### 4.9 Bounty

- Slot diisi oleh N attestation pertama pada target itu setelah `createBounty`, dari alamat selain peminta. `Vault` membaca urutannya dari `Core`.
- Konsensus bounty adalah verdict mayoritas di antara pengisi slot itu sendiri, jadi tidak bisa digeser oleh attestation susulan.
- Pembayaran bisa diselesaikan 48 jam setelah slot terakhir terisi: dibagi rata ke pengisi slot yang selaras, dipotong 5% untuk treasury.
- Setelah 7 hari sejak dibuat, bounty yang slotnya belum penuh diselesaikan dengan slot yang ada, dan sisa dana kembali ke peminta.

### 4.10 Keputusan desain

- **Pembayaran model tarik.** `Vault` hanya mencatat saldo yang bisa ditarik.
- **Penyelesaian malas dan bertahap, tanpa bot.** Tidak ada penjadwal. Pekerjaan yang jumlahnya tumbuh (`settle`, `applyPenalties`) memakai `start` dan `count`, supaya tidak pernah melampaui batas gas blok.
- **Bobot dibekukan saat dipakai.** Saat attest untuk suara, saat commit untuk juri. Hasil tidak bergantung pada kapan `resolve` dipanggil.
- **Nilai nominal sebagai konstanta** (Bagian 12.1).

### 4.11 Yang sengaja tidak ada

| Tidak ada | Alasan | Harga |
| :--- | :--- | :--- |
| Proxy atau upgrade | Sealflare menandai pola itu; melanggar Zero Admin Override | Bug tidak bisa ditambal |
| Fungsi pemilik selain `setModules` | Tidak ada pihak yang perlu dipercaya | Protokol tidak bisa dijeda saat diserang |
| Token | Tidak ada `approve`, tidak ada klaim imbal hasil | Bounty hanya dalam BNB |

### 4.12 Batas yang diketahui

- **Bundel tanpa manifest tidak bisa diklaim penerbit.** `manifestPublisher` bernilai `address(0)`.
- **Kontrak hasil factory atau `CREATE2` tanpa `owner()`** tidak bisa membuktikan kepemilikan dan hanya bisa punya sponsor.
- **Modul tidak bisa diganti.** Kalau `Court` atau `Vault` bermasalah, penggantinya tidak bisa disambung ke `Core` lama.
- **Kuorum juri sulit di minggu awal.** Sengketa kedaluwarsa akan sering terjadi sampai jumlah Guardian cukup.

---

## 5. Komponen off-chain

### 5.1 Komponen

| Komponen | Tempat | Tugas |
| :--- | :--- | :--- |
| `scanner-core` | pustaka | Hash bundel, pre-parser statis, inspeksi kontrak lewat RPC (codehash, slot EIP-1967, Beacon, EIP-1167, opcode `DELEGATECALL`), dry-run `eth_call` |
| API publik | Vercel | Scan, data baca, permintaan sandbox, unggah bukti |
| Layanan internal | VPS | Satu-satunya pintu ke Postgres: endpoint baca untuk data indexer, endpoint tulis untuk antrean, kuota, dan cache |
| Sandbox worker | VPS | Probe red-team ke LLM dengan wallet tiruan, 3 kali per probe |
| Indexer | VPS | Menyalin event `Core`, `Court`, `Vault` ke Postgres |
| Postgres | VPS | Tabel indexer, antrean, kuota, cache sandbox dan scan |

### 5.2 Keputusan desain

- **`scanner-core` tanpa keadaan dan tanpa lingkungan.** Akses RPC, BscScan, dan pengambil repositori disuntikkan pemanggil. Pustaka yang sama dipakai API, Companion Skill, dan SDK.
- **Skrip milik skill tidak pernah dijalankan.** Sandbox memberi isi `SKILL.md` ke LLM bersama alat tiruan dan mencatat alat yang coba dipanggil. Flag `TROJAN_HELPER_SCRIPT` hanya bisa ditemukan pre-parser.
- **Alat tiruan tidak melakukan I/O jaringan.** Kontainer worker hanya boleh keluar ke API LLM dan Pinata, sehingga injeksi tidak bisa mengarahkannya ke Postgres atau layanan internal.
- **Layanan internal yang memanggil worker.** Worker membuka endpoint `POST /runs` dan `GET /runs/:id`, dan tidak pernah membuka koneksi balik. Status yang dibaca layanan internal memuat setiap run yang sudah selesai, jadi pelanggaran bisa disimpan sebelum run berakhir.
- **Pelanggaran langsung disimpan.** Begitu wallet tiruan menangkap satu panggilan terlarang, hasil `SANDBOX_FUZZ_FAILED` disimpan permanen, apa pun yang terjadi pada sisa run. Skill tidak bisa menghapus jejak dengan menggagalkan run setelah melanggar.
- **Cache asimetris.** Kunci `(bundleHash, probeSetVersion, modelId)`. Hasil gagal permanen. Hasil tanpa pelanggaran kedaluwarsa saat model atau versi probe berganti.
- **Indexer hanya membaca blok final.** Ia mengindeks sampai tag `finalized`, menyimpan `blockHash`, dan memakai kunci unik `(txHash, logIndex)`. Status target dan sengketa dibaca lewat view kontrak, bukan dihitung ulang dari waktu.

### 5.3 Aturan `canonicalBundleHash`

- `contentHash` dihitung atas **byte mentah** setiap file, tanpa normalisasi. Karakter tak terlihat yang disisipkan mengubah hash.
- Semua file di folder skill ikut dihitung, diurutkan menurut path, kecuali tepat satu file: `publisher.sig` di akar folder.
- `publisher.sig` harus berupa file biasa berukuran paling banyak 1.024 byte. Karena berada di luar hash, isinya tidak boleh menjadi tempat menyimpan apa pun selain tanda tangan.
- Rumusnya: `contentHash = keccak256(leaf_0 ‖ … ‖ leaf_n)` atas entri yang diurutkan menurut byte UTF-8 path, dengan `leaf = keccak256(keccak256(path) ‖ kindByte ‖ keccak256(bytes))`. `kindByte` bernilai 0 untuk file dan 1 untuk symlink. Lebar tiap bagian tetap, jadi path dan isi tidak bisa saling bergeser.
- Path yang absolut, memuat segmen `.` atau `..`, segmen kosong, garis miring terbalik, atau byte NUL ditolak. Dua entri dengan path sama juga ditolak.
- `manifestPublisher` dibaca dari frontmatter YAML `SKILL.md` di akar folder: `metadata.sealflare-publisher`. Nilai yang tidak ada, tidak sah, atau ganda berarti `address(0)`.
- Implementasi acuannya ada di `shared/rules/bundleHash.ts`, `shared/rules/manifest.ts`, dan `shared/rules/ids.ts`. `scanner-core` memakainya, tidak menulis ulang.
- Symlink di-*hash* sebagai teks tujuannya dan tidak pernah diikuti atau dibaca.
- Batasnya 200 file dan 2.097.152 byte total. Bundel yang melewatinya ditolak, bukan dipotong. `SKILL.md` yang dikirim ke sandbox dibatasi 65.536 byte.
- Setiap aturan punya satu fixture di `shared/fixtures/`.

### 5.4 Endpoint API publik

| Endpoint | Perlindungan | Tugas |
| :--- | :--- | :--- |
| `POST /api/scan/contract` | batas laju per IP | Layer 1 untuk sebuah alamat |
| `POST /api/scan/skill` | batas laju per IP, batas ukuran repositori | Mengambil repositori, menghitung hash, menjalankan pre-parser |
| `POST /api/sandbox/runs` | tanda tangan EIP-712 pemegang Agent ID berisi `bundleHash`, nonce, dan kedaluwarsa; 5 per hari | Mengantrekan run |
| `GET /api/sandbox/runs/:id` | | Status dan hasil run |
| `POST /api/evidence` | tanda tangan Agent ID, hanya JSON yang lolos skema bukti, batas ukuran | Mengunggah laporan ke IPFS |
| `GET /api/targets`, `/api/targets/:id` | | Daftar dan rincian target, termasuk rincian sinyal per kelompok bobot |
| `GET /api/guardians`, `/api/guardians/:address` | | Papan peringkat, serta riwayat dan penalti tertunda per alamat |
| `GET /api/challenges`, `/api/challenges/:id` | | Daftar sengketa, serta rincian: bukti, balasan, juri, pembagian dana |
| `GET /api/bounties`, `/api/bounties/:id` | | Daftar dan rincian bounty |
| `GET /api/activity/:address` | | Hal yang menunggu tindakan dan saldo yang bisa ditarik untuk My activity |
| `GET /api/sandbox/quota/:address` | | Sisa kuota sandbox hari ini |

Semua endpoint daftar menerima filter `?address=`. Rincian layar yang memakainya ada di [ux.md](ux.md).

Setiap jawaban baca menyertakan nomor blok final terakhir yang dibaca indexer.

Tiga aturan tambahan:

- `evidenceHash` adalah `keccak256` atas byte persis yang disimpan di `evidenceURI`. Karena itu `POST /api/evidence` menerima laporan sebagai teks JSON (`reportJson`), bukan objek: klien meng-hash teks itu, menandatangani hash-nya, dan server menyimpan teks yang sama tanpa menyusun ulang.
- Repositori skill hanya GitHub. Sumber target ditulis `0x…` untuk kontrak dan `gh:<owner>/<repo>@<commit 40 hex>:<path>` untuk skill; ini isi `?src=` di alamat halaman target.
- Semua jawaban memakai satu amplop: `{ success: true, data, meta? }` atau `{ success: false, error: { code, message, details? } }`, tidak pernah keduanya.

### 5.5 Perlindungan biaya sandbox

- Kuota dipotong saat run masuk antrean. Kuota hanya dikembalikan untuk kegagalan infrastruktur kita, bukan kegagalan yang dipicu isi skill.
- `SKILL.md` punya batas ukuran.
- Layanan internal memverifikasi ulang tanda tangan Agent ID, jadi kunci antarlayanan yang bocor tidak cukup untuk mengantrekan run.
- Worker punya pemutus biaya harian global.

### 5.6 Rahasia

| Rahasia | Vercel | VPS |
| :--- | :---: | :---: |
| Kunci RPC, kunci BscScan, token pengambil repositori | ya | ya (RPC) |
| Kunci Pinata | ya | ya |
| Kunci LLM | tidak | ya |
| Kunci antarlayanan Vercel ke VPS | ya | ya |
| Kunci `deployer` kontrak | tidak | tidak, hanya hardware wallet |

Tidak ada kunci berbayar yang memakai awalan `NEXT_PUBLIC_`. Tidak ada rahasia di repositori.

---

## 6. Penempatan data

| Tempat | Isi | Kalau hilang |
| :--- | :--- | :--- |
| BNB Chain | Putusan, attestation, skor, dana, hash bukti, `shortProof` | tidak bisa hilang |
| IPFS | Laporan scan lengkap, transkrip sandbox | hash on-chain tetap membuktikan isi; `shortProof` tetap terbaca |
| Postgres, tabel indexer | Salinan event | dibangun ulang dari chain |
| Postgres, data operasional | Cache sandbox, antrean, kuota | hanya bisa dipulihkan dari cadangan `pg_dump` harian di luar VPS |

Kalau seluruh server Sealflare mati: `IFirewall` tetap bisa dipanggil kontrak lain, dan SDK serta Companion Skill tetap bisa membaca chain dan menjalankan Layer 1 sendiri. Yang berhenti adalah sandbox, halaman daftar, dan leaderboard.

---

## 7. Alur data

### 7.1 Scan skill sampai attestation

1. Pengguna memasukkan alamat repositori di dApp atau menjalankan `scan-skill`.
2. `scanner-core` mengambil folder skill, menghitung `canonicalBundleHash`, dan menjalankan pre-parser.
3. API memeriksa cache sandbox. Bila kosong, pengguna boleh meminta run baru dengan menandatangani pesan.
4. Worker menjalankan probe, menyimpan transkrip ke IPFS, dan mencatat hasil.
5. dApp menyusun parameter `attest()` dan menampilkan ringkasannya.
6. Pengguna menandatangani transaksi. `Core` mencatat attestation dan memancarkan event.
7. Indexer menangkap event setelah bloknya final, dan halaman target berubah.

### 7.2 Penerbit mengikat karyanya

1. Penerbit membuktikan kepemilikan lewat `bindByOwner`, `bindByDeployer`, atau `bindSkill`. Pihak lain boleh mencatat diri sebagai sponsor.
2. `Core` mencatat perannya.
3. Penerbit atau sponsor boleh menyetor bond ke `Vault`. Bond selalu milik penyetornya.

### 7.3 Sengketa sampai putusan

1. Penantang memanggil `openChallenge` dengan stake. `Court` menitipkannya ke escrow `Vault` dan menandai target `DISPUTED_CAUTION`.
2. Penerbit boleh mengirim bukti balasan selama fase commit.
3. Juri commit selama 12 jam, lalu reveal selama 12 jam.
4. Siapa pun memanggil `resolve` atau `expire`. `Court` menulis putusan ke `Core` dan memerintah `Vault` membagi escrow.
5. Setiap pihak menarik bagiannya dengan `withdraw`. Penalti -15 diterapkan bertahap lewat `applyPenalties`.

### 7.4 Aplikasi lain memakai Sealflare

1. Kontrak lain memanggil `verifyContract(target)` dan mendapat tier menurut Bagian 4.6.
2. Target yang berupa proxy tidak pernah mendapat tier `SAFE` dari panggilan ini.
3. Agent framework memakai SDK, yang menambahkan pengecekan slot implementasi secara langsung.

---

## 8. Penanganan kegagalan

| Kegagalan | Yang terjadi | Yang dilihat pengguna |
| :--- | :--- | :--- |
| RPC lambat atau mati | Coba penyedia cadangan | Scan tertunda; bila semua gagal, pesan jelas tanpa verdict |
| BscScan tidak menjawab | Layer 1 jalan tanpa status sumber | "Status sumber tidak diketahui", verdict tertinggi `CAUTION` |
| LLM gagal karena infrastruktur | Run ditandai tidak lengkap, kuota dikembalikan | "Sandbox belum selesai" |
| LLM gagal karena isi skill | Pelanggaran yang sudah tertangkap tetap tersimpan, kuota tidak dikembalikan | Hasil sebagian beserta alasannya |
| IPFS gagal mengunggah | Transaksi tidak disiapkan | Diminta mengulang |
| Indexer tertinggal | Jawaban API menyertakan nomor blok terakhir | "Data tertinggal N blok" |
| Transaksi ditolak kontrak | Kode error diterjemahkan | Pesan spesifik, misalnya batas harian tercapai |

Dua aturan berlaku di semua alur:

- **Ragu berarti tidak aman.** Kegagalan pemindaian menurunkan hasil ke `CAUTION` atau tanpa verdict.
- **Server tidak pernah menandatangani.** Setiap perubahan on-chain berasal dari wallet pengguna.

---

## 9. Struktur repositori dan jalur kerja

```
sealflare/
├── contracts/            Jalur 1: Core, Court, Vault, stub, MockAgentID, tes Foundry
├── packages/
│   ├── scanner-core/     Jalur 2
│   ├── sandbox-worker/   Jalur 2
│   ├── sdk/              Jalur 3: @sealflare/guard
│   └── skill/            Jalur 3: SKILL.md dan skrip read-only
├── apps/
│   ├── web/              Jalur 3: Next.js, UI dan API publik
│   ├── internal/         Jalur 3: layanan internal di VPS
│   └── indexer/          Jalur 3
└── shared/
    ├── abi/
    ├── schemas/
    ├── rules/
    └── fixtures/
```

| Jalur | Isi | Pemegang |
| :--- | :--- | :--- |
| 1. On-chain | `contracts/`, deploy, verifikasi | founder |
| 2. Pemindaian | `scanner-core`, `sandbox-worker` | developer kedua |
| 3. Aplikasi | `apps/`, `sdk`, `skill` | developer ketiga |

Ada dua titik temu:

- **28 sampai 30 November:** `Core`, halaman scan dan attest, serta `scanner-core` disambung untuk rilis mainnet pertama.
- **Akhir:** sengketa, bond, bounty, dan sandbox disambung setelah `setModules`.

---

## 10. Pengujian

| Lapisan | Alat | Yang diuji |
| :--- | :--- | :--- |
| Kontrak, unit | Foundry | Setiap fungsi, setiap alasan penolakan, setiap nilai nominal |
| Kontrak, invarian | Foundry fuzz | Saldo `Vault` lebih besar atau sama dengan jumlah kewajiban; isi tiap escrow tidak pernah negatif; hanya `Court` yang bisa menulis putusan |
| Kontrak, fork | Foundry di fork BSC | `balanceOf` terhadap kontrak Agent ID asli; pembacaan `owner()` terhadap kontrak nyata, termasuk yang hanya punya `fallback` |
| Aturan bersama | Foundry dan Vitest | Vektor uji tier dan XP memberi hasil sama di kedua sisi |
| `scanner-core` | Vitest | Hash deterministik; tiap flag dan tiap aturan hash punya fixture |
| Sandbox | Vitest, LLM tiruan | Pelanggaran tersimpan walau run gagal; hasil lolos tidak permanen |
| API, layanan internal, indexer | Vitest | Jawaban cocok dengan skema; indexer memberi data sama saat dibangun ulang |
| Ujung ke ujung | Playwright, Anvil | Scan, attest, sengketa, putusan, tarik dana |

Wajib lulus sebelum `Core` dirilis ke mainnet:

- `Court` dan `Vault` versi lengkap lulus tes ujung ke ujung terhadap `Core` yang sama, walaupun keduanya belum di-*deploy*. `Core` tidak bisa diubah, jadi semua yang dibutuhkan modul darinya harus sudah terbukti cukup.
- Tes invarian `Vault`.
- Tes fork terhadap kontrak Agent ID asli.
- Fixture berbahaya untuk setiap flag.

Tidak ada target persentase cakupan untuk UI.

---

## 11. Penyimpangan dari blueprint

| Blueprint | Arsitektur ini | Alasan |
| :--- | :--- | :--- |
| `AgentFirewallCore` tunggal | Tiga kontrak | Kerja paralel, isolasi bug dana |
| `setCourt(address)` lalu lepas kepemilikan | `setModules(court, vault)` yang memvalidasi dan mematikan wewenang dalam satu transaksi | Menutup salah urutan dan salah alamat |
| `IFirewall` mendeteksi *stale proxy* | Hanya mendeteksi perubahan bytecode; proxy tidak pernah `SAFE` on-chain | EVM tidak bisa membaca slot kontrak lain |
| Bobot dihitung dari skor saat dibaca | Bobot dibekukan saat attest dan saat commit | Mencegah manipulasi lewat waktu pemanggilan |
| Juri: skor tidak negatif sebelum sengketa | Profil dibuat sebelum sengketa, skor tidak negatif saat commit | Kontrak tidak menyimpan riwayat skor |
| Kuorum dalam 48 jam | Selesai dalam 24 jam (12 commit, 12 reveal) | Satu mesin status tanpa putaran kedua |
| Stake kembali 100% saat deadlock | Porsi hangus 20%, 50%, 100% untuk kedaluwarsa berulang | Menutup penguncian target bergiliran |
| `publisher.sig` di dalam bundel | Alamat penerbit menjadi masukan hash; `publisher.sig` di luar hash | Menutup klaim siapa cepat |
| Konsensus bounty dari konsensus akhir target | Mayoritas di antara pengisi slot | Tidak bisa digeser attestation susulan |
| Bounty BNB atau USDT/USDC | BNB saja | Keputusan founder |
| Sandbox "menjalankan paket `SKILL.md`" | LLM membaca skill dengan alat tiruan; skrip tidak dieksekusi | Isolasi kontainer tidak realistis dalam jadwal |
| *Genesis Guardian Sprint* satu bounty untuk 30 sampai 50 Guardian | Beberapa bounty 3 sampai 5 slot pada target berbeda | Batas slot per bounty |
| Bagian 10: cakupan bertingkat | Kelima modul dirancang sama dalam | Keputusan founder |
| `IFirewall` mengembalikan `pinnedImplHash` | Mengembalikan `pinnedCodehash` | `Core` tidak bisa membaca slot implementasi; nama lama menyesatkan pemanggil |
| `Vault` punya tiga fungsi khusus `Court` | Empat: ditambah `settleBond` | `distribute` saja tidak bisa memotong bond lalu mengembalikan sisanya |
| Jumlah juri tidak dibatasi | Paling banyak 21 juri per sengketa | `resolve` membagi dana ke semua juri dalam satu transaksi |
| `PublisherRole`: `NONE`, `VERIFIED_PUBLISHER`, `THIRD_PARTY_SPONSOR` | `NONE`, `THIRD_PARTY_SPONSOR`, `VERIFIED_PUBLISHER` | Urutan naik, sama dengan arah perpindahan peran |

---

## 12. Keputusan pelaksanaan

Diputuskan 21 November 2026. Semuanya bisa diubah founder sebelum komponen terkait dirilis.

### 12.1 Nilai nominal

| Konstanta | Nilai | Alasan |
| :--- | :--- | :--- |
| `CHALLENGE_STAKE` | 0,01 BNB, tetap | Menahan tantangan iseng, tetap terjangkau pelapor jujur |
| `JURY_STAKE` | 0,005 BNB, tetap | Separuh stake penantang, supaya tiga juri mudah terkumpul |
| `MAX_WARRANTY_BOND` | 0,5 BNB per penyetor per target | Batas kerugian bila `Vault` bermasalah |
| `MAX_BOUNTY` | 0,2 BNB per permintaan | Cukup untuk beberapa bounty di *Genesis Guardian Sprint* |
| `MAX_JURORS` | 21 per sengketa | Menjaga biaya gas `resolve` tetap terbatas |

Harga BNB saat keputusan ini dibuat tidak bisa dipastikan (sumber yang ditemukan berkisar 570 sampai 710 dolar AS dan tidak bertanggal). Nilai dolar harus dicek ulang sebelum `Vault` di-*deploy*.

### 12.2 Tempat menjalankan

| Komponen | Penyedia | Alasan |
| :--- | :--- | :--- |
| Next.js (UI dan API publik) | Vercel | Deploy otomatis dari git |
| Layanan internal, sandbox worker, indexer | VPS milik tim, kontainer lewat Docker Compose | Sudah tersedia, proses selalu hidup |
| Postgres | VPS yang sama, kontainer dengan volume tetap | Tidak terbuka ke internet |
| IPFS | Pinata | Sudah disebut di blueprint |

Postgres hanya bisa dicapai dari kontainer lain di VPS. Vercel berbicara dengan layanan internal lewat HTTPS.

### 12.3 Model LLM untuk sandbox

`claude-haiku-5-5` sebagai bawaan, dengan ID model dibaca dari konfigurasi.

- Sandbox menjalankan hingga 8 probe, masing-masing 3 kali, jadi biaya per run penting.
- Model yang lebih kecil lebih mudah terpancing *prompt injection*, sehingga skill berbahaya lebih mungkin tertangkap.
- Hasil selalu dicatat bersama ID model, dan cache terikat padanya.

Harga per token belum dicek dan harus dipastikan sebelum batas 5 run per hari dianggap aman.

### 12.4 Urutan rilis

`Core` dirilis lebih dulu, paling lambat 1 Desember 2026, dengan syarat di Bagian 10 terpenuhi. `Vault` dan `Court` menyusul, lalu `setModules` dipanggil.

- Pengumpulan 30 alamat Agent ID baru bisa mulai setelah `attest()` hidup di mainnet.
- `Core` tidak memegang dana.
- Harganya dua. Pertama, `Court` dan `Vault` harus sudah selesai ditulis dan lulus tes pada 1 Desember walaupun belum dirilis. Kedua, antara rilis `Core` dan `setModules`, `deployer` masih memegang satu wewenang. Jendela itu disebut di dokumentasi *owner permissions*.

### 12.5 Asumsi yang belum diverifikasi

Harus dicek sebelum `Core` dirilis:

- Alamat kontrak Agent ID dan sifat *non-transferable*-nya.
- Apakah kontrak Agent ID itu proxy atau punya fungsi mint dan burn milik admin. `Core` bergantung permanen pada perilaku `balanceOf`-nya. Caranya: jalankan Layer 1 Sealflare terhadap kontrak itu.
- Jaminan satu pengguna satu Agent ID.
- Definisi "alamat Agent ID unik" untuk syarat minimal 30.
- Bobot rubrik dan isi Safety Red Lines.
