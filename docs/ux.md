# UX Sealflare

**Status:** rancangan revisi 2 (setelah review independen), menunggu persetujuan  
**Tanggal:** 22 November 2026  
**Sumber:** [architecture.md](architecture.md) dan [sealflare.md](../sealflare.md)  
**Tahap berikutnya:** design (tampilan visual)

Dokumen ini menetapkan siapa pengguna Sealflare, layar apa saja yang ada, dan urutan langkah di tiap alur. Ia tidak menetapkan warna, tipografi, atau komponen visual. Semua teks antarmuka berbahasa Inggris; contoh teks di dokumen ini ditulis sebagaimana akan tampil.

---

## 1. Keputusan dasar

| Keputusan | Pilihan | Alasan |
| :--- | :--- | :--- |
| Perangkat | Desktop dulu. Ponsel bisa dibuka tanpa rusak. | Pengguna utama adalah developer dan auditor di laptop dengan ekstensi wallet |
| Bahasa antarmuka | Inggris saja | Juri, tim lain, dan kreator konten berasal dari banyak negara; istilah kontrak sudah berbahasa Inggris |
| Susunan situs | Landing terpisah di `/`, aplikasi di `/app` | Ruang leluasa untuk menjelaskan produk |
| Pusat aplikasi | Target. Setiap kontrak atau skill punya satu halaman tempat hampir semua tindakan terjadi. | `targetId` adalah kunci semua data; tautan yang dibagikan punya tujuan jelas |
| Tindakan bertahap | Panel di samping halaman target | Pemula dituntun tanpa kehilangan konteks |

Alur yang paling penting adalah scan lalu attest oleh Guardian baru, karena itu yang menghasilkan alamat Agent ID untuk syarat submisi.

---

## 2. Pengguna

| Pengguna | Yang ingin dicapai | Layar utama |
| :--- | :--- | :--- |
| Pengunjung | Tahu apakah sebuah kontrak atau skill aman | Scan, Target |
| Guardian | Memberi attestation dan menaikkan skor | Target, My activity |
| Penerbit | Mengikat karyanya dan menunjukkan itikad dengan bond | Publish, Target |
| Penantang | Membatalkan status aman yang keliru | Target, Dispute |
| Juri | Memutus sengketa dan mendapat bagian | Dispute, My activity |
| Peminta bounty | Mendapat tinjauan cepat untuk targetnya | Target, Bounties |
| Developer | Memasang SDK atau Companion Skill | Docs |

Satu orang bisa memegang beberapa peran sekaligus. Karena itu aplikasi tidak dibagi menurut peran.

---

## 3. Peta layar

### 3.1 Dua wilayah

| Wilayah | Navigasi | Tombol wallet |
| :--- | :--- | :---: |
| Situs: `/` dan `/docs` | Docs, GitHub, "Launch app" | tidak ada |
| Aplikasi: `/app/...` | Scan, Explore, Disputes, Bounties, Guardians | ada, di kanan |

Tombol wallet yang sudah tersambung membuka menu berisi My activity (dengan penanda jumlah hal yang menunggu tindakan), Publish, dan Disconnect. Itu satu-satunya jalan ke kedua halaman tersebut, jadi penandanya harus terlihat tanpa membuka menu.

### 3.2 Dua belas layar

| Layar | Alamat | Isi | Butuh wallet |
| :--- | :--- | :--- | :---: |
| Landing | `/` | Penjelasan produk, kotak scan, "Launch app" | tidak |
| Docs | `/docs` | Cara kerja, SDK, Companion Skill, *owner permissions* | tidak |
| Scan | `/app` | Kotak tempel alamat kontrak atau tautan repositori skill | tidak |
| Target | `/app/t/[id]` | Status, rincian sinyal, bukti, attestation, penerbit, sengketa, bounty | tidak untuk melihat |
| Explore | `/app/explore` | Daftar target, bisa disaring menurut jenis dan status | tidak |
| Disputes | `/app/disputes` | Sengketa aktif dengan fase dan sisa waktu | tidak |
| Dispute | `/app/disputes/[id]` | Bukti kedua pihak, fase, kursi juri, hasil | tidak untuk melihat |
| Bounties | `/app/bounties` | Bounty terbuka dengan slot tersisa | tidak |
| Guardians | `/app/guardians` | Papan peringkat menurut skor | tidak |
| Guardian | `/app/g/[address]` | Skor, bobot, riwayat | tidak |
| My activity | `/app/me` | Skor sendiri, yang menunggu tindakan, saldo yang bisa ditarik | ya |
| Publish | `/app/publish` | Panduan mengikat kontrak atau skill dan menyetor bond | ya |

### 3.3 Aturan tautan

- Tautan yang dibagikan selalu langsung ke aplikasi: tautan target di X, lencana keamanan di README, dan keluaran Companion Skill mengarah ke `/app/t/[id]`, tidak pernah ke landing.
- Kotak scan di landing mengirim pengguna ke `/app` dengan scan sudah berjalan.
- `id` di alamat target adalah hash satu arah, jadi alamat itu juga membawa sumbernya sebagai query: `?src=` berisi alamat kontrak, atau repositori beserta commit. Dengan begitu halaman bisa dibangun ulang walau cache scan hilang dan target belum pernah ditulis ke chain.

---

## 4. Keadaan pengguna

Setiap layar aplikasi harus benar di keempat keadaan ini.

| # | Keadaan | Yang bisa dilakukan | Yang ditawarkan |
| :---: | :--- | :--- | :--- |
| 1 | Tanpa wallet | Scan, membaca semua halaman | "Connect wallet" hanya di tempat tindakan |
| 2 | Wallet tersambung, jaringan salah | Sama seperti 1 | Satu tombol pindah ke BNB Smart Chain |
| 3 | Wallet tersambung, tanpa Agent ID | Sama seperti 1, plus membuat bounty | Penjelasan kenapa Agent ID diperlukan dan tautan ke cara resmi mendapatkannya |
| 4 | Pemegang Agent ID | Semua tindakan | Sisa kuota attestation hari ini |

Status "sudah attest", kuota harian, dan kepemilikan Agent ID dibaca langsung dari view `Core`, bukan dari indexer, supaya tidak tertinggal.

### 4.1 Tanpa Agent ID

Keadaan 3 adalah titik paling rawan kehilangan orang, dan metrik 30 alamat bergantung padanya. Panel tidak berhenti di "you need an Agent ID". Ia menawarkan dua jalan:

| Pilihan | Yang terjadi |
| :--- | :--- |
| "I have one on another wallet" | Ganti wallet di ekstensi, atau sambungkan wallet ponsel lewat QR (WalletConnect) |
| "Get an Agent ID" | Tautan ke cara resmi mendapatkannya, dibuka di tab baru |

Di bawahnya ada tombol "Check again" yang membaca ulang `balanceOf` tanpa memuat ulang halaman. Halaman target tetap terbuka di belakang panel, jadi orang kembali ke tempat yang sama.

### 4.2 Modul belum hidup

`Core` dirilis lebih dulu; `Court` dan `Vault` menyusul. Selama jendela itu satu flag konfigurasi `modulesLive` bernilai mati, dan:

- Tindakan sengketa, bounty, dan bond tampil nonaktif dengan keterangan "Opens when the dispute and vault contracts go live."
- Halaman Disputes dan Bounties menampilkan keadaan kosong dengan keterangan yang sama.
- Scan, attest, dan Publish (tanpa bond) berjalan normal.

---

## 5. Aturan lintas layar

- **Membaca terbuka, menulis butuh wallet.** Wallet baru diminta saat orang hendak menulis ke chain.
- **Ringkasan sebelum tanda tangan.** Sebelum wallet terbuka, aplikasi menampilkan dalam bahasa biasa apa yang akan ditulis ke chain, berapa BNB yang dikirim, dan apa yang bisa hilang.
- **Sinyal tidak pernah diringkas jadi satu angka.** Di mana pun status target muncul, rincian bobotnya ikut tampil atau satu klik dari sana.
- **Data tertinggal dikatakan.** Halaman menyebut nomor blok terakhir yang dibaca indexer bila ia belum mengejar chain.
- **Tidak ada notifikasi dari luar aplikasi.** Sealflare tidak menyimpan kontak pengguna. Tenggat ditampilkan di My activity dan di halaman terkait.
- **Penyelesaian dipicu pengguna.** Resolve, Expire, Settle, Apply penalties, dan Claim XP ditampilkan sebagai tombol kepada siapa pun yang membuka halamannya, dengan keterangan bahwa memicunya butuh gas.
- **Empat keadaan transaksi di setiap panel tindakan.** Ditolak di wallet (kembali ke ringkasan, tanpa pesan galat), menunggu konfirmasi (tombol terkunci, tautan transaksi), gagal (alasan dari kontrak, tombol coba lagi), dan berhasil. Setelah berhasil, hasil ditampilkan langsung dengan label "Waiting for finality" sampai indexer membacanya.
- **Layar sempit.** Kolom menumpuk, panel bertahap menjadi lembar layar penuh, tabel daftar menjadi kartu, dan tombol tindakan utama menempel di tepi bawah. Tidak ada informasi yang dibuang.

---

## 6. Alur inti: scan sampai attestation

### 6.1 Langkah

| # | Layar | Yang dilakukan pengguna | Yang ditampilkan |
| :---: | :--- | :--- | :--- |
| 1 | Scan | Menempel alamat kontrak atau tautan repositori, lalu Enter | Jenis masukan dikenali sendiri |
| 2 | Scan | Menunggu | Daftar pemeriksaan Layer 1 yang tercentang satu per satu |
| 3 | Target | Membaca hasil | Status, flag beserta baris buktinya, rincian sinyal komunitas |
| 4 | Target | Menekan "Attest" | Panel bertahap terbuka di samping |
| 5 | Panel, tahap 1 | Memilih Safe, Caution, atau Danger | Verdict dan flag usulan pemindai; pengguna boleh mengubah |
| 6 | Panel, tahap 2 | Memeriksa ringkasan | Yang akan ditulis ke chain, perkiraan gas, akibat bila salah |
| 7 | Wallet | Menandatangani unggahan bukti (tanpa gas) | Laporan scan diunggah ke IPFS. Bila gagal: "Evidence upload failed. Nothing was sent on-chain." dan tombol coba lagi |
| 8 | Wallet | Menandatangani transaksi | |
| 9 | Target | Selesai | Suaranya muncul di rincian sinyal dengan label "Waiting for finality" dan tautan transaksi |

Dari tautan sampai selesai ada empat tindakan di aplikasi (tempel, tekan Attest, pilih, konfirmasi) dan dua persetujuan di wallet. Panel menyebut sejak awal bahwa akan ada dua persetujuan dan hanya yang kedua memakai gas.

`shortProof` diambil dari baris bukti flag yang dipilih. Bila pengguna menambah flag yang tidak ditemukan pemindai, panel meminta kutipan bukti singkat untuk flag itu.

### 6.2 Keputusan

- **Hasil scan adalah halaman target.** Setelah Layer 1 selesai, alamat halaman berubah menjadi `/app/t/[id]`.
- **Verdict diusulkan, tetapi harus dipilih sendiri.** Attestation adalah kesaksian pribadi yang bisa kena penalti.
- **Risiko dan imbalan disebut menurut verdict yang dipilih.** Ringkasan menampilkan:

| Verdict | Imbalan | Risiko |
| :--- | :--- | :--- |
| Safe | +2 XP (slot 1 sampai 3), +1 XP (slot 4 sampai 10), atau 0 | -15 bila target kelak diputus berbahaya |
| Caution | 0 XP | tidak ada |
| Danger | +5 XP bila target kelak diputus berbahaya | tidak ada |

- **Dua hal lain selalu tertulis di ringkasan:** "This vote is permanent. It cannot be changed or withdrawn." dan "XP becomes claimable after 48 hours."

### 6.3 Sandbox

- Bila hasil untuk bundel itu ada di cache, ia tampil bersama Layer 1.
- Bila belum ada, halaman menampilkan tombol "Run sandbox". Tombol itu butuh tanda tangan pesan tanpa transaksi dan menampilkan sisa kuota hari itu.
- Selama sandbox berjalan, pengguna boleh attest berdasarkan Layer 1 saja atau menunggu.
- "Run sandbox" butuh Agent ID. Tanpa wallet, jaringan salah, atau tanpa Agent ID, tombol itu bercabang seperti Attest (Bagian 6.4 dan 4.1).
- Di samping tombol tertulis: "Uses 1 of your 5 daily runs. A run that fails because of the skill's own content still counts."

| Keadaan run | Yang ditampilkan |
| :--- | :--- |
| Antre | Posisi dalam antrean |
| Berjalan | Probe mana yang sedang dijalankan |
| Selesai, tanpa pelanggaran | "No violation observed" beserta model dan tanggal, dengan catatan bahwa ini bukan bukti aman |
| Selesai, ada pelanggaran | Panggilan alat yang tertangkap, per probe |
| Tidak lengkap | Hasil sebagian dan alasan berhenti |
| Batas harian layanan tercapai | "Sandbox is paused for today. Layer 1 results are unaffected." |

### 6.4 Percabangan saat menekan "Attest"

| Keadaan | Yang terjadi |
| :--- | :--- |
| Tanpa wallet | Panel meminta sambungan wallet, lalu lanjut ke tahap 1 tanpa mengulang |
| Jaringan salah | Satu tombol pindah jaringan, lalu lanjut |
| Tanpa Agent ID | Panel menjelaskan kenapa Agent ID diperlukan dan menautkan cara mendapatkannya |
| Sudah attest target ini | Tombol menjadi "You attested: Safe" dengan tautan transaksi |
| Kuota harian habis | Tombol mati dengan keterangan kapan kuota kembali |
| Target sedang disengketakan | Attest tetap bisa, dengan dua catatan: suara ini tidak mendapat XP, dan pengguna tidak bisa lagi menjadi juri sengketa itu |
| Target sudah diputus berbahaya | Pilihan Safe dimatikan. Caution dan Danger tetap bisa. |
| Kode berubah sejak disegel | Kontrak: attest ditutup, dengan penjelasan bahwa suara terikat pada kode lama. Skill: tombol menjadi "Scan the current version". |

### 6.5 Kasus khusus

- **Belum pernah dinilai.** Ajakannya "Be the first Guardian", dengan keterangan tiga slot pertama bernilai +2 XP.
- **Scan gagal sebagian.** Halaman menampilkan pemeriksaan mana yang tidak jalan. Verdict usulan tidak pernah lebih tinggi dari Caution.
- **Proxy.** Halaman menyebut bahwa target ini tidak bisa mendapat status aman dari `IFirewall`, dan kenapa. Bila pemindai menemukan `DELEGATECALL` tetapi penanda on-chain belum menyala, tab Findings menampilkan tombol "Flag as proxy on-chain" (memanggil `probeBytecode`).

### 6.6 Galat scan

| Galat | Pesan | Tindakan |
| :--- | :--- | :--- |
| Masukan tidak dikenali | "That is not a contract address or a repository link." | Contoh format yang diterima |
| Alamat tanpa kode | "No contract is deployed at this address on BNB Chain." | Periksa jaringan dan alamat |
| Repositori privat atau tidak ada | "This repository is not public." | Tempel tautan lain |
| Tidak ada `SKILL.md` | "No skill was found in this repository." | Tunjukkan folder skill |
| Beberapa folder skill | Daftar folder yang ditemukan | Pilih satu |
| Bundel melewati batas ukuran | "This skill is too large to scan." beserta batasnya | |
| Terlalu banyak permintaan | "Too many scans from your network. Try again in N minutes." | |
| Semua RPC gagal | "BNB Chain could not be reached. No verdict was produced." | Coba lagi |
| Target tidak ditemukan saat tautan dibuka | "This result is no longer cached." | Tombol "Scan again", memakai `?src=` |

---

## 7. Halaman target

### 7.1 Tata letak desktop

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Scan   Explore   Disputes   Bounties   Guardians          [Connect wallet]│
├──────────────────────────────────────────────────────────────────────────┤
│ 0x1234…abcd  ·  Smart contract  ·  BNB Chain            [Copy] [BscScan]  │
│                                                                          │
│ ┌─ STATUS ─────────────────────────────────┐  ┌─ ACTIONS ──────────────┐ │
│ │ CAUTION FLAGGED                          │  │ [ Attest ]             │ │
│ │ Upgradeable proxy, no timelock           │  │ Open a challenge       │ │
│ │                                          │  │ Fund an audit bounty   │ │
│ │ Community signal                         │  │                        │ │
│ │ 42 new IDs        Safe                   │  │ 3 of 5 attestations    │ │
│ │ 3 guardians (W 15) Danger · Hidden mint  │  │ left today             │ │
│ └──────────────────────────────────────────┘  └────────────────────────┘ │
│                                                                          │
│ Findings   Attestations (45)   Publisher   Dispute   Bounty   History    │
│ ──────────────────────────────────────────────────────────────────────── │
│ (isi tab terpilih)                                                       │
└──────────────────────────────────────────────────────────────────────────┘
```

Angka di sketsa ini contoh tata letak, bukan data.

### 7.2 Bagian atas, selalu terlihat

- **Identitas.** Alamat atau nama repositori, jenis target, tautan ke BscScan atau repositori.
- **Status.** Tier dalam kata-kata, dengan satu kalimat alasan utamanya.
- **Rincian sinyal.** Dua baris: pemegang Agent ID baru (bobot 1 saat attest) dan Guardian berpengalaman (bobot 2 ke atas). Tiap baris menampilkan jumlah suara per verdict, total bobotnya, dan flag yang dilaporkan. Pemisahan ini dihitung indexer dari bobot yang tercatat di event attestation; tier tetap dibaca dari `Core`.
- **Tindakan.** Satu tombol utama (Attest) dan dua tindakan sekunder. Kolom ini mengikuti keadaan pengguna.

### 7.3 Tab

| Tab | Isi | Teks saat kosong |
| :--- | :--- | :--- |
| Findings | Hasil Layer 1 per pemeriksaan dengan baris bukti; hasil sandbox per probe dengan panggilan alat yang tertangkap | "This version has not been scanned yet." |
| Attestations | Siapa, verdict, flag, bobot saat itu, tautan bukti dan transaksi | "No attestations yet. Be the first Guardian." |
| Publisher | Peran, cara kepemilikan dibuktikan, bond per penyetor, status penarikan. Bagi penyetor: tombol "Deposit bond", "Request withdrawal", dan "Finalize withdrawal" | "No publisher has claimed this target." |
| Dispute | Sengketa aktif dengan fase dan sisa waktu; riwayat sengketa | "No disputes." |
| Bounty | Bounty terbuka, slot terisi, kapan bisa dicairkan | "No bounty." |
| History | Garis waktu kejadian on-chain | hanya kejadian pembuatan catatan |

Tab Findings terbuka lebih dulu.

### 7.4 Pita peringatan

Bila salah satu berlaku, pita muncul di atas status dan tidak bisa ditutup:

| Pita | Arti |
| :--- | :--- |
| Confirmed danger | Juri sudah memutus target ini berbahaya. Bila masih ada penalti yang belum diterapkan, pita memuat tombol "Apply penalties (N pending)". |
| Modified since audit | Kode atau isi bundel berubah sejak disegel; suara lama tidak berlaku untuk versi ini |
| Under dispute | Ada sengketa aktif, dengan sisa waktu dan tautan |
| Unbonding | Penerbit sedang menarik bond, dengan tanggal selesai |

### 7.5 Perbedaan untuk skill

- Identitasnya nama repositori dan potongan `bundleHash`, dengan catatan versi yang dinilai.
- Tab Findings menaruh hasil sandbox di atas.
- Bila repositori sudah berubah, halaman menawarkan "Scan the current version", yang membuat halaman target baru untuk hash baru.

### 7.6 Layar sempit

Mengikuti aturan umum di Bagian 5: kolom tindakan turun ke bawah status, tombol Attest menempel di tepi bawah, dan tab menjadi baris yang digulir ke samping.

---

## 8. Sengketa dan juri

### 8.1 Membuka sengketa

Panel tiga tahap dari tombol "Open a challenge" di halaman target.

| Tahap | Yang diisi | Yang ditampilkan |
| :---: | :--- | :--- |
| 1 | Flag pelanggaran yang dituduhkan | Flag dari hasil scan sudah tercentang |
| 2 | Bukti: kutipan singkat (masuk chain) dan keterangan tertulis (masuk IPFS sebagai JSON sesuai skema bukti) | Batas panjang kutipan dan pratinjau |
| 3 | Ringkasan sebelum tanda tangan | Stake 0,01 BNB dan empat kemungkinan akhir beserta uang yang kembali di tiap kasus |

Seperti attest, ada dua persetujuan wallet: unggahan bukti tanpa gas, lalu transaksi.

Tahap 3 menyebut empat hal: sengketa kedaluwarsa bila reveal juri kurang dari tiga; berapa porsi stake yang hangus untuk target itu (20%, 50%, atau 100%); kalah berarti stake hangus dan -5 XP; dan setelah kedaluwarsa ada jeda 7 hari sebelum bisa menantang target yang sama lagi.

Percabangan saat menekan "Open a challenge":

| Keadaan | Yang terjadi |
| :--- | :--- |
| Tanpa wallet, jaringan salah, tanpa Agent ID | Sama seperti Attest (Bagian 6.4 dan 4.1) |
| Sudah ada sengketa aktif | Tombol menjadi tautan "View the open challenge" |
| Dalam jeda 7 hari | Tombol mati dengan tanggal jeda berakhir |
| Target sudah diputus berbahaya | Tombol tidak ditampilkan |
| Modul belum hidup | Lihat Bagian 4.2 |

### 8.2 Halaman sengketa

```
┌──────────────────────────────────────────────────────────────────────┐
│ Challenge #12  ·  0x1234…abcd                                        │
│                                                                      │
│  ●─────────────●─────────────○                                       │
│  Commit         Reveal        Resolve                                │
│  ends in 4h 12m                                                      │
│                                                                      │
│ ┌─ CHALLENGER ──────────────┐  ┌─ PUBLISHER REPLY ─────────────────┐ │
│ │ Claims: Hidden mint       │  │ No reply yet                      │ │
│ │ "function _mint(...)…"    │  │ Reply window closes in 4h 12m     │ │
│ │ Full evidence (IPFS)      │  │                                   │ │
│ └───────────────────────────┘  └───────────────────────────────────┘ │
│                                                                      │
│ Jury: 2 committed  ·  needs 3 reveals          [ Join the jury ]     │
└──────────────────────────────────────────────────────────────────────┘
```

Selama fase commit, halaman hanya menampilkan jumlah juri, tidak pernah arah suaranya.

Kotak balasan penerbit:

- Bagi penerbit tercatat, selama fase commit, kotak itu memuat tombol "Submit reply". Tombol membuka panel: tulis keterangan, unggah ke IPFS (tanpa gas), lalu tanda tangan transaksi.
- Sponsor tidak bisa membalas; hanya penerbit terverifikasi.
- Bila target tidak punya penerbit, kotak menampilkan "No publisher is bound to this target, so no reply is possible." tanpa hitung mundur.

### 8.3 Menjadi juri

| Langkah | Yang terjadi |
| :--- | :--- |
| Menekan "Join the jury" | Aplikasi memeriksa kelayakan dan menyebut alasan bila ditolak: pernah attest target ini, penantangnya sendiri, penerbitnya, profil dibuat setelah sengketa dibuka, atau skor negatif |
| Memilih suara | Uphold atau Reject |
| Ringkasan | Stake 0,005 BNB, jadwal reveal, dan dua cara stake hangus: tidak reveal, atau reveal tetapi berada di sisi minoritas |
| Simpan reveal code | Aplikasi membuat kode acak dan mewajibkan juri menyalin atau mengunduhnya sebelum lanjut |
| Tanda tangan commit | Transaksi dengan stake |
| Kembali untuk reveal | Satu tombol "Reveal my vote" dalam jendela 12 jam |

### 8.4 Reveal code

Tanpa reveal code, juri tidak bisa reveal dan stake-nya hangus. Reveal yang hilang juga bisa membuat sengketa kedaluwarsa dan merugikan penantang.

- **Kode acak, bukan turunan tanda tangan.** Salt adalah 32 byte acak yang dibuat di peramban. Tanda tangan wallet tidak dipakai sebagai sumbernya, karena wallet berbasis MPC, wallet kontrak, dan sebagian hardware wallet memberi tanda tangan berbeda tiap kali, dan pesan tetap bisa diminta situs lain untuk membongkar arah suara.
- **Wajib disimpan sebelum commit.** Reveal code memuat salt dan arah suara. Tombol tanda tangan baru aktif setelah juri menyalin atau mengunduhnya.
- **Cadangan di peramban.** Kode juga disimpan di penyimpanan lokal supaya reveal dari perangkat yang sama cukup satu klik.
- **Reveal dari perangkat lain.** Layar reveal punya kolom "Paste your reveal code".
- **Dicek sebelum dikirim.** Aplikasi mencocokkan kode dengan hash commit on-chain lebih dulu. Bila tidak cocok, transaksi tidak dikirim dan juri diberi tahu.
- **Pengingat di aplikasi.** My activity menaruh reveal yang jatuh tempo di urutan teratas, dan halaman sengketa menampilkan hitung mundur. Halaman konfirmasi commit mengatakan bahwa tidak ada pengingat dari luar aplikasi dan menampilkan waktu reveal yang bisa disalin.

### 8.5 Setelah selesai

- Putusan, bobot tiap sisi, dan daftar juri dengan suara yang sudah dibuka.
- Rincian uang: siapa menerima berapa, sesuai tabel di arsitektur.
- Bagi peserta: tombol "Withdraw" bila ada saldo.
- Setelah putusan bahaya: tombol "Apply penalties (N pending)" bagi siapa pun. Tidak ada pihak yang diuntungkan langsung dengan menekannya, jadi tombol ini juga muncul di pita Confirmed danger, dan halaman Guardian menandai skor yang masih menunggu penalti dengan "Penalty pending".

### 8.6 Penerbit yang ditantang

- Pita "Under dispute" tampil di halaman target dan di My activity miliknya.
- Jendela bukti balasan 12 jam. Halaman Publish dan dokumentasi menyebutnya, supaya penerbit yang menyetor bond tahu mereka perlu memantau.

Batas yang diketahui: tanpa notifikasi dari luar aplikasi, jendela 12 jam tidak cukup bagi penerbit yang tidak sedang memantau.

---

## 9. Publish

`/app/publish` dimulai dengan satu pertanyaan tentang apa yang diikat, lalu bercabang.

| Yang diikat | Langkah | Hasil |
| :--- | :--- | :--- |
| Kontrak dengan `owner()` | Tempel alamat. Bila pemiliknya wallet yang tersambung, satu tanda tangan. Bila wallet lain atau multisig, aplikasi membuat pesan untuk ditandatangani pemilik itu. | Verified publisher |
| Kontrak tanpa pemilik | Tempel alamat dan alamat deployer. Aplikasi mencari nonce yang cocok, lalu meminta tanda tangan deployer. | Verified publisher |
| Skill | Tempel tautan repositori. Aplikasi mencocokkan alamat penerbit di manifest dengan wallet. | Verified publisher |
| Tidak bisa dibuktikan | Aplikasi menjelaskan kenapa dan menawarkan peran sponsor | Third-party sponsor |

Rincian yang berlaku di semua cabang:

- **Publish butuh Agent ID**, bukan hanya wallet. Tanpa Agent ID, halaman menampilkan pilihan di Bagian 4.1.
- **Mengikat adalah dua langkah:** tanda tangan pesan dari pemilik (tanpa gas), lalu satu transaksi dari pemegang Agent ID.
- **Pemilik di wallet lain atau multisig.** Aplikasi menampilkan layar "Share this request": tautan yang dibuka pemilik untuk menandatangani, dengan masa berlaku 24 jam. Untuk Safe, tanda tangan dilakukan di antarmuka Safe dan diperiksa on-chain. Pemilik EOA juga bisa menempelkan tanda tangannya lewat "Paste signature".
- **Target sudah punya penerbit.** Tawaran sponsor diganti dengan "This target already has a publisher."

Setelah terikat:

- Langkah opsional menyetor Warranty Bond. Sebelum tanda tangan disebut: batas 0,5 BNB, penarikan butuh 7 hari, bond tetap bisa dipotong selama 7 hari itu, dan separuh bond dipotong bila sengketa membuktikan pelanggaran. Langkah ini bisa dilewati dan dilakukan belakangan dari tab Publisher di halaman target.
- Penarikan bond dilakukan dari tab Publisher: "Request withdrawal", lalu "Finalize withdrawal" setelah 7 hari. Pengguna harus kembali untuk langkah kedua, dan My activity mengingatkannya.
- Potongan kode lencana keamanan untuk README, yang menautkan ke halaman target.

---

## 10. Bounty

| Tindakan | Dari mana | Langkah |
| :--- | :--- | :--- |
| Membuat | Tombol di halaman target | Pilih 3 sampai 5 slot dan dana maksimal 0,2 BNB. Ringkasan menyebut: bayaran mengikuti mayoritas pengisi slot, apa pun verdict-nya; 5% dipotong untuk treasury; bounty tidak bisa dibatalkan; slot yang kosong setelah 7 hari dikembalikan; dan attestation peminta sendiri tidak mengisi slot. |
| Mengisi | Halaman Bounties | Menekan satu baris membuka halaman target. Alur attest berjalan seperti biasa; slot terisi otomatis. |
| Mencairkan | Halaman target atau My activity | Tombol "Settle" muncul 48 jam setelah slot penuh, atau 7 hari sejak bounty dibuat bila slot tidak penuh. Bayaran dan pengembalian masuk ke saldo yang bisa ditarik. |

---

## 11. My activity

Diurutkan menurut seberapa mendesak.

| Bagian | Isi |
| :--- | :--- |
| Needs action | Reveal yang jatuh tempo, sengketa atas target milik sendiri (dengan sisa waktu balasan), sengketa yang bisa diselesaikan, XP yang bisa diklaim, bond yang siap difinalisasi, bounty milik sendiri yang bisa dicairkan |
| Balance | Saldo yang bisa ditarik dan satu tombol Withdraw |
| Standing | Skor, bobot suara, jarak ke bobot berikutnya, kuota attestation hari ini |
| History | Attestation, kursi juri, sengketa, dan bounty beserta hasilnya |

Bagian Needs action hilang bila kosong. Bila pengguna belum punya riwayat, halaman menampilkan satu ajakan: scan target pertama.

---

## 12. Landing

Landing hanya memuat hal yang benar-benar ada. Tidak ada angka pengguna, logo mitra, atau testimoni sebelum ada data sungguhan.

| Urutan | Bagian | Isi |
| :---: | :--- | :--- |
| 1 | Pembuka | Satu kalimat tentang yang dilakukan Sealflare, kotak scan, tombol Launch app |
| 2 | Contoh nyata | Satu skill berbahaya buatan sendiri, berlabel demo, beserta panggilan terlarang yang ditangkap sandbox |
| 3 | Cara kerja | Dua lapis pemindaian dan peran Agent ID, masing-masing satu paragraf |
| 4 | Untuk siapa | Tiga jalur masuk: jadi Guardian, ikat karyamu, pasang SDK |
| 5 | Keterbukaan | Tautan ke kontrak di BscScan, kode sumber, dokumen *owner permissions*, dan pernyataan bahwa belum ada audit pihak ketiga |

Setelah ada data di chain, bagian 2 boleh menampilkan jumlah target yang dinilai dan jumlah Guardian, dibaca langsung dari indexer.

---

## 13. Keadaan kosong, memuat, dan gagal

Setiap layar yang menampilkan data punya ketiganya.

| Keadaan | Yang ditampilkan |
| :--- | :--- |
| Kosong | Kalimat yang menjelaskan kenapa kosong dan satu tindakan yang bisa diambil |
| Memuat | Kerangka dengan bentuk yang sama seperti isi akhirnya |
| Gagal | Apa yang gagal, apakah data on-chain tetap aman, dan tombol coba lagi |

Pesan penolakan dari kontrak diterjemahkan menjadi kalimat spesifik, misalnya "You have used all 5 attestations for today."

---

## 14. Yang masih terbuka

| Hal | Memengaruhi | Pemilik |
| :--- | :--- | :--- |
| Cara resmi mendapatkan Agent ID dan tautannya | Keadaan 3, landing, Publish | founder, dari materi hackathon |
| Wallet yang dipakai pemegang Agent ID (ekstensi, aplikasi ponsel, atau keduanya) | Cara sambung wallet, prioritas layar sempit | founder |
| Teks final setiap layar | Seluruh aplikasi | tahap design |

Soal wallet sudah dijawab founder pada 22 November 2026: Agent ID bisa dipakai dari ekstensi desktop maupun aplikasi ponsel. Karena itu "desktop dulu" tetap berlaku, sambungan lewat QR tersedia sebagai jalur kedua, dan baris wallet di tabel di atas dianggap selesai. Jawaban ini berasal dari founder dan belum diuji dengan Agent ID sungguhan.
