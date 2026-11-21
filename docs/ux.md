# UX Sealflare

**Status:** rancangan, menunggu persetujuan  
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

---

## 4. Keadaan pengguna

Setiap layar aplikasi harus benar di keempat keadaan ini.

| # | Keadaan | Yang bisa dilakukan | Yang ditawarkan |
| :---: | :--- | :--- | :--- |
| 1 | Tanpa wallet | Scan, membaca semua halaman | "Connect wallet" hanya di tempat tindakan |
| 2 | Wallet tersambung, jaringan salah | Sama seperti 1 | Satu tombol pindah ke BNB Smart Chain |
| 3 | Wallet tersambung, tanpa Agent ID | Sama seperti 1, plus membuat bounty | Penjelasan kenapa Agent ID diperlukan dan tautan ke cara resmi mendapatkannya |
| 4 | Pemegang Agent ID | Semua tindakan | Sisa kuota attestation hari ini |

Keadaan 3 adalah titik paling rawan kehilangan orang. Hasil scan mereka tersimpan di alamat halaman, sehingga mereka bisa kembali ke target yang sama setelah punya Agent ID.

---

## 5. Aturan lintas layar

- **Membaca terbuka, menulis butuh wallet.** Wallet baru diminta saat orang hendak menulis ke chain.
- **Ringkasan sebelum tanda tangan.** Sebelum wallet terbuka, aplikasi menampilkan dalam bahasa biasa apa yang akan ditulis ke chain, berapa BNB yang dikirim, dan apa yang bisa hilang.
- **Sinyal tidak pernah diringkas jadi satu angka.** Di mana pun status target muncul, rincian bobotnya ikut tampil atau satu klik dari sana.
- **Data tertinggal dikatakan.** Halaman menyebut nomor blok terakhir yang dibaca indexer bila ia belum mengejar chain.
- **Tidak ada notifikasi dari luar aplikasi.** Sealflare tidak menyimpan kontak pengguna. Tenggat ditampilkan di My activity dan di halaman terkait.
- **Penyelesaian dipicu pengguna.** Tindakan seperti Resolve, Expire, dan Settle ditampilkan sebagai tombol kepada siapa pun yang membuka halamannya, dengan keterangan bahwa memicunya butuh gas.

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
| 7 | Wallet | Menandatangani | |
| 8 | Target | Selesai | Suaranya muncul di rincian sinyal, dengan tautan transaksi |

Dari tautan sampai tanda tangan ada empat tindakan: tempel, tekan Attest, pilih, konfirmasi.

### 6.2 Keputusan

- **Hasil scan adalah halaman target.** Setelah Layer 1 selesai, alamat halaman berubah menjadi `/app/t/[id]`.
- **Verdict diusulkan, tetapi harus dipilih sendiri.** Attestation adalah kesaksian pribadi yang bisa kena penalti.
- **Risiko disebut sebelum tanda tangan.** Ringkasan menulis bahwa suara `SAFE` yang terbukti berbahaya memotong 15 poin, dan slot ke berapa yang sedang diisi (+2, +1, atau 0 XP).

### 6.3 Sandbox

- Bila hasil untuk bundel itu ada di cache, ia tampil bersama Layer 1.
- Bila belum ada, halaman menampilkan tombol "Run sandbox". Tombol itu butuh tanda tangan pesan tanpa transaksi dan menampilkan sisa kuota hari itu.
- Selama sandbox berjalan, pengguna boleh attest berdasarkan Layer 1 saja atau menunggu.

### 6.4 Percabangan saat menekan "Attest"

| Keadaan | Yang terjadi |
| :--- | :--- |
| Tanpa wallet | Panel meminta sambungan wallet, lalu lanjut ke tahap 1 tanpa mengulang |
| Jaringan salah | Satu tombol pindah jaringan, lalu lanjut |
| Tanpa Agent ID | Panel menjelaskan kenapa Agent ID diperlukan dan menautkan cara mendapatkannya |
| Sudah attest target ini | Tombol menjadi "You attested: Safe" dengan tautan transaksi |
| Kuota harian habis | Tombol mati dengan keterangan kapan kuota kembali |
| Target sedang disengketakan | Attest tetap bisa, dengan catatan XP tidak dibagikan selama sengketa aktif |

### 6.5 Kasus khusus

- **Belum pernah dinilai.** Ajakannya "Be the first Guardian", dengan keterangan tiga slot pertama bernilai +2 XP.
- **Scan gagal sebagian.** Halaman menampilkan pemeriksaan mana yang tidak jalan. Verdict usulan tidak pernah lebih tinggi dari Caution.
- **Proxy.** Halaman menyebut bahwa target ini tidak bisa mendapat status aman dari `IFirewall`, dan kenapa.

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
- **Rincian sinyal.** Dua baris: pemegang Agent ID baru dan Guardian berpengalaman, masing-masing dengan arah suara dan flag yang dilaporkan.
- **Tindakan.** Satu tombol utama (Attest) dan dua tindakan sekunder. Kolom ini mengikuti keadaan pengguna.

### 7.3 Tab

| Tab | Isi | Teks saat kosong |
| :--- | :--- | :--- |
| Findings | Hasil Layer 1 per pemeriksaan dengan baris bukti; hasil sandbox per probe dengan panggilan alat yang tertangkap | "This version has not been scanned yet." |
| Attestations | Siapa, verdict, flag, bobot saat itu, tautan bukti dan transaksi | "No attestations yet. Be the first Guardian." |
| Publisher | Peran, cara kepemilikan dibuktikan, besar bond, status penarikan | "No publisher has claimed this target." |
| Dispute | Sengketa aktif dengan fase dan sisa waktu; riwayat sengketa | "No disputes." |
| Bounty | Bounty terbuka, slot terisi, kapan bisa dicairkan | "No bounty." |
| History | Garis waktu kejadian on-chain | hanya kejadian pembuatan catatan |

Tab Findings terbuka lebih dulu.

### 7.4 Pita peringatan

Bila salah satu berlaku, pita muncul di atas status dan tidak bisa ditutup:

| Pita | Arti |
| :--- | :--- |
| Confirmed danger | Juri sudah memutus target ini berbahaya |
| Modified since audit | Kode atau isi bundel berubah sejak disegel; suara lama tidak berlaku untuk versi ini |
| Under dispute | Ada sengketa aktif, dengan sisa waktu dan tautan |
| Unbonding | Penerbit sedang menarik bond, dengan tanggal selesai |

### 7.5 Perbedaan untuk skill

- Identitasnya nama repositori dan potongan `bundleHash`, dengan catatan versi yang dinilai.
- Tab Findings menaruh hasil sandbox di atas.
- Bila repositori sudah berubah, halaman menawarkan "Scan the current version", yang membuat halaman target baru untuk hash baru.

### 7.6 Layar sempit

Kolom tindakan turun ke bawah status, tombol Attest menempel di tepi bawah, dan tab menjadi baris yang digulir ke samping. Tidak ada informasi yang dibuang.

---

## 8. Sengketa dan juri

### 8.1 Membuka sengketa

Panel tiga tahap dari tombol "Open a challenge" di halaman target.

| Tahap | Yang diisi | Yang ditampilkan |
| :---: | :--- | :--- |
| 1 | Flag pelanggaran yang dituduhkan | Flag dari hasil scan sudah tercentang |
| 2 | Bukti: kutipan singkat (masuk chain) dan lampiran (masuk IPFS) | Batas panjang kutipan dan pratinjau |
| 3 | Ringkasan sebelum tanda tangan | Stake 0,01 BNB dan empat kemungkinan akhir beserta uang yang kembali di tiap kasus |

Tahap 3 menyebut bahwa sengketa kedaluwarsa bila reveal juri kurang dari tiga, dan berapa porsi stake yang hangus untuk target itu.

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

### 8.3 Menjadi juri

| Langkah | Yang terjadi |
| :--- | :--- |
| Menekan "Join the jury" | Aplikasi memeriksa kelayakan dan menyebut alasan bila ditolak: pernah attest target ini, penantangnya sendiri, penerbitnya, profil dibuat setelah sengketa dibuka, atau skor negatif |
| Memilih suara | Uphold atau Reject |
| Ringkasan | Stake 0,005 BNB, jadwal reveal, peringatan bahwa tidak reveal berarti stake hangus |
| Tanda tangan commit | Aplikasi membuat salt |
| Kembali untuk reveal | Satu tombol "Reveal my vote" dalam jendela 12 jam |

### 8.4 Salt

Salt yang hilang berarti juri tidak bisa reveal dan stake-nya hangus.

- **Salt diturunkan dari tanda tangan wallet.** Aplikasi meminta wallet menandatangani pesan tetap untuk sengketa itu dan memakai hasilnya sebagai salt. Juri bisa membuatnya ulang di perangkat mana pun dengan wallet yang sama.
- **Cadangan di peramban.** Salt disimpan di penyimpanan lokal supaya reveal bisa satu klik.
- **Pengingat di aplikasi.** My activity menaruh reveal yang jatuh tempo di urutan teratas, dan halaman sengketa menampilkan hitung mundur.
- **Halaman konfirmasi commit** mengatakan bahwa tidak ada pengingat dari luar aplikasi dan menampilkan waktu reveal yang bisa disalin.

### 8.5 Setelah selesai

- Putusan, bobot tiap sisi, dan daftar juri dengan suara yang sudah dibuka.
- Rincian uang: siapa menerima berapa, sesuai tabel di arsitektur.
- Bagi peserta: tombol "Withdraw" bila ada saldo.

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

Setelah terikat:

- Langkah opsional menyetor Warranty Bond. Sebelum tanda tangan disebut: batas 0,5 BNB, penarikan butuh 7 hari, dan separuh bond dipotong bila sengketa membuktikan pelanggaran.
- Potongan kode lencana keamanan untuk README, yang menautkan ke halaman target.

---

## 10. Bounty

| Tindakan | Dari mana | Langkah |
| :--- | :--- | :--- |
| Membuat | Tombol di halaman target | Pilih 3 sampai 5 slot dan dana maksimal 0,2 BNB. Ringkasan menyebut bahwa bayaran mengikuti mayoritas pengisi slot, apa pun verdict-nya, dan bahwa peminta tidak boleh attest target itu. |
| Mengisi | Halaman Bounties | Menekan satu baris membuka halaman target. Alur attest berjalan seperti biasa; slot terisi otomatis. |
| Mencairkan | Halaman target atau My activity | Tombol "Settle" muncul 48 jam setelah slot terakhir terisi. Bayaran masuk ke saldo yang bisa ditarik. |

---

## 11. My activity

Diurutkan menurut seberapa mendesak.

| Bagian | Isi |
| :--- | :--- |
| Needs action | Reveal yang jatuh tempo, sengketa atas target milik sendiri, sengketa yang bisa diselesaikan, XP yang bisa diklaim |
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
