# Arsitektur Sealflare

**Status:** rancangan, menunggu persetujuan  
**Tanggal:** 21 November 2026  
**Sumber:** [sealflare.md](../sealflare.md) (blueprint produk)  
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
                 tanda tangan │                   │ HTTP
                    transaksi │                   ▼
                              │        ┌────────────────────┐      ┌──────────────┐
                              │        │  API (Next.js)     │─────▶│ IPFS (Pinata)│
                              │        └───┬────────────┬───┘      └──────────────┘
                              │            │            │
                              │   scanner-core     antrean
                              │            │            ▼
                              │            │   ┌────────────────┐
                              │            │   │ Sandbox worker │──▶ LLM
                              │            │   └────────────────┘
                              ▼            ▼
   ┌───────────────────────────────────────────────┐        ┌──────────┐
   │  BNB Chain:  Court ──▶ Core ◀── Vault         │──event─▶│ Indexer  │──▶ Postgres
   │              Court ───────────▶ Vault         │        └──────────┘
   └───────────────────────────────────────────────┘
```

Sumber kebenaran adalah BNB Chain. Postgres dan IPFS hanya menyimpan salinan dan lampiran.

---

## 3. Empat perjanjian yang dibekukan lebih dulu

Empat hal ini ditulis pada hari pertama, sebelum ada fitur. Semuanya disimpan di `shared/`. Perubahan setelah dibekukan harus disetujui founder, karena mengganggu ketiga jalur sekaligus.

| Perjanjian | Lokasi | Isi | Yang bergantung |
| :--- | :--- | :--- | :--- |
| ABI dan event | `shared/abi/` | Interface Solidity `ICore`, `ICourt`, `IVault`, `IFirewall` tanpa isi, beserta ABI JSON | web, indexer, SDK, skill |
| Tipe pemindaian | `shared/schemas/scan.ts` | `ScanReport`, daftar flag, aturan `canonicalBundleHash` | API, sandbox, skill, SDK, web |
| Skema API | `shared/schemas/api.ts` | Endpoint, bentuk permintaan dan jawaban | web, skill |
| Skema bukti | `shared/schemas/evidence.ts` | JSON laporan di IPFS dan format `shortProof` | scanner, sandbox, kontrak, web |

Tiruan yang dipakai selama membangun:

- **Web** berjalan terhadap kontrak yang di-*deploy* ke Anvil dan API tiruan yang mengembalikan isi `shared/fixtures/`.
- **Pemindai dan sandbox** diuji dengan `shared/fixtures/` tanpa kontrak atau UI.
- **Kontrak** diuji dengan Foundry tanpa komponen off-chain.

---

## 4. Kontrak on-chain

### 4.1 Tiga kontrak

| Kontrak | Tugas | Memegang dana |
| :--- | :--- | :---: |
| `Core` | Registri target, pengikatan penerbit, attestation, skor Guardian, `IFirewall` | tidak |
| `Court` | Sengketa: tantangan, bukti balasan, commit, reveal, putusan, kedaluwarsa | tidak |
| `Vault` | Semua BNB: stake penantang dan juri, Warranty Bond, bounty, potongan treasury | ya |

Ketergantungan satu arah:

- `Court` menulis putusan ke `Core` dan memerintah `Vault` mengunci, memotong, atau melepas saldo.
- `Vault` hanya membaca `Core` (peran penerbit, hasil konsensus).
- `Core` mengenal dua alamat luar, `Court` dan `Vault`, yang diisi lewat `setModules(court, vault)`. Fungsi itu hanya bisa dipanggil sekali, lalu kepemilikan dilepas dengan `renounceOwnership`.

### 4.2 Identitas target

`targetId = keccak256(abi.encode(targetType, contractAddr atau canonicalBundleHash))`

Satu kunci dipakai untuk kontrak dan skill, sehingga attestation, sengketa, dan bounty memakai struktur yang sama. Catatan target dibuat otomatis saat pertama kali disentuh (attestation atau pengikatan penerbit).

### 4.3 Permukaan fungsi

**Core**

| Fungsi | Pemanggil | Keterangan |
| :--- | :--- | :--- |
| `attest(...)` | pemegang Agent ID | Memeriksa `balanceOf`, batas 5 per hari, satu suara per target. Membuat profil Guardian saat pertama kali. |
| `bindByOwner(target, delegationSig)` | siapa pun | Lolos jika `owner()` target sama dengan pemanggil atau penanda tangan delegasi. |
| `bindByDeployer(target, deployer, nonce, delegationSig)` | siapa pun | Hanya bila `owner()` tidak ada atau nol. Menghitung ulang alamat `CREATE`. |
| `bindSkill(bundleHash)` | pemegang Agent ID | Mencatat klaim penerbit atas sebuah bundel. |
| `settle(targetId)` | siapa pun | Membagikan XP setelah *cooling window* 48 jam lewat. |
| `verifyContract(target)`, `verifySkillBundle(hash)` | siapa pun (view) | `IFirewall`. Membandingkan `EXTCODEHASH` saat itu dengan yang disegel. |
| `markDisputed`, `applyVerdict`, `adjustScore` | hanya `Court` | Satu-satunya jalur menulis putusan dan mengubah skor di luar `attest` dan `settle`. |
| `setModules(court, vault)` | pemilik, sekali | Menyambung modul, lalu kepemilikan dilepas. |

**Court**

| Fungsi | Pemanggil | Keterangan |
| :--- | :--- | :--- |
| `openChallenge(...)` payable | pemegang Agent ID | Stake diteruskan ke `Vault`. Ditolak selama *cooldown* 7 hari untuk pasangan Agent ID dan target yang sama. |
| `submitCounterEvidence(id, uri)` | penerbit target | Sebelum fase commit berakhir. |
| `commitVote(id, hash)` payable | juri yang layak | Hash memuat alamat juri. Kelayakan: profil Guardian ada dan skor tidak negatif sebelum blok tantangan dibuka, dan belum pernah attest atau menerbitkan target itu. |
| `revealVote(id, uphold, salt)` | juri | Selama 12 jam setelah fase commit. |
| `resolve(id)` | siapa pun | Menghitung bobot, menulis putusan ke `Core`, memerintah `Vault`. |
| `expire(id)` | siapa pun | Tanpa kuorum 3 juri dalam 48 jam: 80% stake penantang kembali, 20% ke treasury. |

**Vault**

| Fungsi | Pemanggil | Keterangan |
| :--- | :--- | :--- |
| `depositBond(targetId)` payable | penerbit | Memeriksa peran penerbit di `Core`. |
| `requestBondWithdrawal`, `finalizeBondWithdrawal` | penerbit | Jeda 7 hari, dana tetap bisa dipotong selama menunggu atau ada sengketa. |
| `createBounty(targetId, slots)` payable | siapa pun | Peminta tidak boleh attest target itu. |
| `settleBounty(id)`, `cancelUnfilledBounty(id)` | siapa pun | Bayar setelah 48 jam menurut konsensus, potong 5%. Batal setelah 7 hari bila slot kosong. |
| `withdraw()` | siapa pun | Menarik saldo sendiri. |
| `lock`, `slash`, `release` | hanya `Court` | Memindahkan saldo antarbuku, tanpa mengirim BNB keluar. |

### 4.4 Keputusan desain

- **Pembayaran model tarik.** `Vault` tidak pernah mengirim BNB secara otomatis. Ia mencatat saldo yang bisa ditarik. Ini menutup reentrancy dan mencegah satu penerima yang menolak transfer menggagalkan pembayaran lain.
- **Penyelesaian malas, tanpa bot.** Tidak ada penjadwal. Setiap transisi berbasis waktu dipicu oleh siapa pun yang memanggil `settle`, `resolve`, atau `expire`. Fungsi baca menghitung status dari waktu saat ini.
- **Bobot tidak disimpan.** `W(S)` dihitung dari skor setiap kali dibaca, supaya tidak ada dua angka yang bisa tidak sinkron.
- **Batas nominal sebagai konstanta.** `challengeStake`, `juryStake`, `warrantyBond`, dan bounty punya nilai atau batas atas yang ditulis di kontrak (angka di Bagian 12.1).

### 4.5 Yang sengaja tidak ada

| Tidak ada | Alasan | Harga |
| :--- | :--- | :--- |
| Proxy atau upgrade | Sealflare menandai pola itu dengan `UPGRADEABLE_NO_TIMELOCK`; melanggar Zero Admin Override | Bug tidak bisa ditambal |
| Fungsi pemilik selain `setModules` | Tidak ada pihak yang perlu dipercaya | Protokol tidak bisa dijeda saat diserang |
| Token | Tidak ada `approve`, tidak ada klaim imbal hasil | Bounty hanya dalam BNB |

### 4.6 Batas yang diketahui

- **Klaim penerbit skill bersifat siapa cepat.** `Core` tidak bisa melihat isi repositori, jadi `bindSkill` hanya mencatat klaim. Pengaman ada di luar chain: alamat penerbit ditulis di manifest yang ikut di-*hash*, dan pemindai menandai ketidakcocokan antara manifest dan klaim on-chain. Berkas `publisher.sig` tidak ikut di-*hash*, karena isinya adalah tanda tangan atas hash itu sendiri.
- **Kontrak hasil factory atau `CREATE2` tanpa `owner()`** tidak bisa membuktikan kepemilikan dan selalu tercatat `THIRD_PARTY_SPONSOR`.
- **Modul tidak bisa diganti.** Kalau `Court` atau `Vault` bermasalah, penggantinya tidak bisa disambung ke `Core` lama.

---

## 5. Komponen off-chain

### 5.1 Lima komponen

| Komponen | Bentuk | Tugas |
| :--- | :--- | :--- |
| `scanner-core` | Pustaka TypeScript murni | Hash bundel, pre-parser statis, inspeksi kontrak lewat RPC (codehash, slot EIP-1967, Beacon, EIP-1167, opcode `DELEGATECALL`), dry-run `eth_call` |
| API | Route handler Next.js | Scan, data hasil indexer, antrean sandbox, unggah bukti |
| Sandbox worker | Proses Node yang selalu hidup | Probe red-team ke LLM dengan wallet tiruan, 3 kali per probe |
| Indexer | Proses Node yang selalu hidup | Menyalin event `Core`, `Court`, `Vault` ke Postgres |
| Postgres | Satu instans | Tabel indexer, antrean dan cache sandbox, cache scan |

### 5.2 Keputusan desain

- **`scanner-core` tanpa keadaan dan tanpa lingkungan.** Akses RPC dan BscScan disuntikkan pemanggil. Pustaka yang sama dipakai API, Companion Skill, dan SDK, sehingga hasil scan identik di ketiganya.
- **Skrip milik skill tidak pernah dijalankan.** Sandbox memberi isi `SKILL.md` ke LLM bersama alat tiruan dan mencatat alat yang coba dipanggil. Skrip pembantu hanya dianalisis statis. Akibatnya flag `TROJAN_HELPER_SCRIPT` hanya bisa ditemukan oleh pre-parser.
- **Postgres bisa dibangun ulang.** Indexer membaca ulang semua event sejak blok deploy. Hanya cache sandbox yang harus dijalankan lagi.
- **Cache sandbox asimetris.** Kunci cache `(bundleHash, probeSetVersion, modelId)`. Hasil gagal disimpan permanen. Hasil tanpa pelanggaran kedaluwarsa saat model atau versi probe berganti.

### 5.3 Endpoint API

| Endpoint | Tugas |
| :--- | :--- |
| `POST /api/scan/contract` | Menjalankan Layer 1 untuk sebuah alamat |
| `POST /api/scan/skill` | Mengambil repositori, menghitung hash, menjalankan pre-parser |
| `POST /api/sandbox/runs` | Mengantrekan run baru. Butuh tanda tangan pesan dari pemegang Agent ID, batas 5 per hari. |
| `GET /api/sandbox/runs/:id` | Status dan hasil run |
| `POST /api/evidence` | Mengunggah laporan ke IPFS, mengembalikan URI dan hash |
| `GET /api/targets`, `GET /api/targets/:id` | Daftar dan rincian target dari indexer |
| `GET /api/guardians`, `GET /api/challenges`, `GET /api/bounties` | Data baca untuk halaman daftar |

Setiap jawaban baca menyertakan nomor blok terakhir yang dibaca indexer.

### 5.4 Tempat menjalankan

- Next.js di Vercel.
- Sandbox worker, indexer, dan Postgres di VPS milik tim, karena batas waktu fungsi serverless terlalu pendek untuk sandbox.
- Pinata untuk IPFS.

Penyedia yang dipilih ada di Bagian 12.2 dan bisa diganti. Yang mengikat hanya kebutuhan proses yang selalu hidup untuk worker dan indexer.

---

## 6. Penempatan data

| Tempat | Isi | Kalau hilang |
| :--- | :--- | :--- |
| BNB Chain | Putusan, attestation, skor, dana, hash bukti, `shortProof` | tidak bisa hilang |
| IPFS | Laporan scan lengkap, transkrip sandbox | hash on-chain tetap membuktikan isi; `shortProof` tetap terbaca |
| Postgres | Salinan event, antrean, cache | dibangun ulang dari chain |

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
7. Indexer menangkap event, dan halaman target berubah.

### 7.2 Penerbit mengikat karyanya

1. Penerbit membuktikan kepemilikan lewat `bindByOwner`, `bindByDeployer`, atau `bindSkill`.
2. `Core` mencatat peran `VERIFIED_PUBLISHER` atau `THIRD_PARTY_SPONSOR`.
3. Penerbit boleh menyetor Warranty Bond ke `Vault`.

### 7.3 Sengketa sampai putusan

1. Penantang memanggil `openChallenge` dengan stake. `Court` menitipkannya ke `Vault` dan menandai target `DISPUTED_CAUTION`.
2. Penerbit boleh mengirim bukti balasan.
3. Juri commit selama 12 jam, lalu reveal selama 12 jam.
4. Siapa pun memanggil `resolve`. `Court` menghitung bobot, menulis putusan ke `Core`, dan memerintah `Vault` memindahkan saldo.
5. Setiap pihak menarik bagiannya dengan `withdraw`.

### 7.4 Aplikasi lain memakai Sealflare

1. Kontrak lain memanggil `verifyContract(target)`.
2. Bila `EXTCODEHASH` berbeda dari yang disegel, jawabannya `STALE_CODEHASH_DRIFT`, apa pun kata konsensus.
3. SDK menggabungkan jawaban itu dengan pengecekan slot proxy secara langsung.

---

## 8. Penanganan kegagalan

| Kegagalan | Yang terjadi | Yang dilihat pengguna |
| :--- | :--- | :--- |
| RPC lambat atau mati | Coba penyedia cadangan | Scan tertunda; bila semua gagal, pesan jelas tanpa verdict |
| BscScan tidak menjawab | Layer 1 jalan tanpa status sumber | "Status sumber tidak diketahui", verdict tertinggi `CAUTION` |
| LLM gagal di tengah probe | Run ditandai tidak lengkap, tidak di-cache | "Sandbox belum selesai", kuota tidak terpotong |
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
├── contracts/            Jalur 1: Core, Court, Vault, interface, tes Foundry
├── packages/
│   ├── scanner-core/     Jalur 2
│   ├── sandbox-worker/   Jalur 2
│   ├── sdk/              Jalur 3: @sealflare/guard
│   └── skill/            Jalur 3: SKILL.md dan skrip read-only
├── apps/
│   ├── web/              Jalur 3: Next.js, UI dan API
│   └── indexer/          Jalur 3
└── shared/
    ├── abi/
    ├── schemas/
    └── fixtures/
```

| Jalur | Isi | Pemegang |
| :--- | :--- | :--- |
| 1. On-chain | `contracts/`, deploy, verifikasi | founder |
| 2. Pemindaian | `scanner-core`, `sandbox-worker` | developer kedua |
| 3. Aplikasi | `apps/web`, `apps/indexer`, `sdk`, `skill` | developer ketiga |

Titik temu ketiga jalur hanya satu: penyambungan di akhir, saat tiruan diganti dengan komponen asli.

---

## 10. Pengujian

| Lapisan | Alat | Yang diuji |
| :--- | :--- | :--- |
| Kontrak, unit | Foundry | Setiap fungsi, setiap alasan penolakan, setiap batas nominal |
| Kontrak, invarian | Foundry fuzz | Saldo `Vault` sama dengan jumlah kewajiban; skor tidak berubah tanpa putusan; hanya `Court` yang bisa menulis putusan |
| Kontrak, fork | Foundry di fork BSC | `balanceOf` terhadap kontrak Agent ID asli; jalur `owner()` dan `(deployer, nonce)` terhadap kontrak nyata |
| `scanner-core` | Vitest | Hash deterministik; tiap flag punya contoh positif dan negatif |
| Sandbox | Vitest, LLM tiruan | Wallet tiruan menangkap setiap panggilan terlarang; hasil lolos tidak di-cache permanen |
| API dan indexer | Vitest | Jawaban cocok dengan skema; indexer menghasilkan data sama saat dibangun ulang |
| Ujung ke ujung | Playwright, Anvil | Scan, attest, sengketa, putusan, tarik dana |

Wajib lulus sebelum mainnet:

- Tes invarian saldo `Vault`.
- Tes fork terhadap kontrak Agent ID asli.
- Fixture berbahaya untuk setiap flag.

Tidak ada target persentase cakupan untuk UI.

---

## 11. Penyimpangan dari blueprint

| Blueprint | Arsitektur ini | Alasan |
| :--- | :--- | :--- |
| `AgentFirewallCore` tunggal | Tiga kontrak: `Core`, `Court`, `Vault` | Kerja paralel, isolasi bug dana, batas ukuran kontrak |
| `setCourt(address)` | `setModules(court, vault)` | `Core` perlu membaca besar bond dari `Vault` |
| Bounty BNB atau USDT/USDC | BNB saja | Keputusan founder, 21 November 2026 |
| Sandbox "menjalankan paket `SKILL.md`" | LLM membaca skill dengan alat tiruan; skrip tidak dieksekusi | Isolasi kontainer tidak realistis dalam jadwal |
| Bagian 10: cakupan bertingkat dan titik potong | Kelima modul dirancang dengan kedalaman sama | Keputusan founder, 21 November 2026 |

Blueprint perlu diselaraskan setelah dokumen ini disetujui.

---

## 12. Keputusan pelaksanaan

Diputuskan 21 November 2026. Semuanya bisa diubah founder sebelum tenggat di kolom terakhir.

### 12.1 Batas nominal

Semua angka ditulis sebagai konstanta di kontrak. Stake dibuat tetap, bukan rentang, supaya tidak ada juri atau penantang yang bisa menekan pihak lain dengan modal lebih besar.

| Konstanta | Nilai | Alasan |
| :--- | :--- | :--- |
| `CHALLENGE_STAKE` | 0,01 BNB, tetap | Cukup mahal untuk menahan tantangan iseng, cukup murah bagi pelapor jujur |
| `JURY_STAKE` | 0,005 BNB, tetap | Separuh stake penantang, supaya tiga juri mudah terkumpul |
| `MAX_WARRANTY_BOND` | 0,5 BNB per target | Batas kerugian bila `Vault` bermasalah |
| `MAX_BOUNTY` | 0,2 BNB per permintaan, 3 sampai 5 slot | Cukup untuk anggaran *Genesis Guardian Sprint* di blueprint |

Harga BNB saat keputusan ini dibuat tidak bisa dipastikan (sumber yang ditemukan berkisar 570 sampai 710 dolar AS dan tidak bertanggal). Nilai dolar harus dicek ulang sebelum `Vault` di-*deploy*, karena setelah itu angkanya tidak bisa diubah.

### 12.2 Tempat menjalankan

| Komponen | Penyedia | Alasan |
| :--- | :--- | :--- |
| Next.js (UI dan API) | Vercel | Deploy otomatis dari git |
| Sandbox worker dan indexer | VPS milik tim, dua kontainer lewat Docker Compose | Sudah tersedia, proses selalu hidup, tanpa biaya tambahan |
| Postgres | VPS yang sama, kontainer ketiga dengan volume tetap | Tidak terbuka ke internet; hanya worker, indexer, dan API yang mengaksesnya |
| IPFS | Pinata | Sudah disebut di blueprint |

Tiga hal yang timbul karena memakai VPS sendiri:

- **API di Vercel perlu jalan ke Postgres.** Basis data tidak dibuka ke internet. API membaca data lewat layanan HTTP kecil di VPS (bagian dari indexer) yang dilindungi kunci rahasia dan HTTPS.
- **Cadangan basis data.** Tabel indexer bisa dibangun ulang dari chain, tetapi cache sandbox tidak. `pg_dump` harian disimpan di luar VPS.
- **Kunci rahasia di VPS.** Kunci LLM, Pinata, dan RPC disimpan sebagai variabel lingkungan di VPS, tidak pernah di repositori.

### 12.3 Model LLM untuk sandbox

`claude-haiku-5-5` sebagai bawaan, dengan ID model dibaca dari konfigurasi.

- Sandbox menjalankan hingga 8 probe, masing-masing 3 kali, jadi biaya per run penting.
- Model yang lebih kecil lebih mudah terpancing *prompt injection*. Untuk sebuah firewall itu menguntungkan: skill berbahaya lebih mungkin tertangkap.
- Hasil selalu dicatat bersama ID model, dan cache terikat padanya, jadi mengganti model tidak mencampur hasil.

Harga per token belum dicek dan harus dipastikan sebelum batas 5 run per hari dianggap aman.

### 12.4 Urutan rilis

`Core` dirilis lebih dulu, paling lambat 1 Desember 2026. `Court` dan `Vault` menyusul, lalu `setModules` dipanggil dan kepemilikan dilepas.

- Pengumpulan 30 alamat Agent ID baru bisa mulai setelah `attest()` hidup di mainnet. Rilis 1 Desember menyisakan 8 hari.
- `Core` tidak memegang dana, jadi risikonya paling kecil untuk dirilis awal.
- Harganya: antara rilis `Core` dan `setModules`, kontrak masih punya pemilik. Jendela itu harus disebut di dokumentasi *owner permissions*.

### 12.5 Asumsi yang belum diverifikasi

Empat asumsi dari blueprint masih belum diverifikasi dan harus dicek sebelum deploy: alamat dan sifat soulbound kontrak Agent ID, jaminan satu pengguna satu Agent ID, definisi "alamat Agent ID unik" untuk syarat 30, serta bobot rubrik dan isi Safety Red Lines.
