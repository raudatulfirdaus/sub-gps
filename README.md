# sub-gps
Rancangan Sistem Rekapitulasi & Rekonsiliasi GPS (Edisi Per Divisi & Masa Kontrak)

Dokumen ini menjelaskan alur data dan logika program untuk mencocokkan laporan aktif vendor, status servis, dan masa berlaku kontrak.

1. Struktur Data yang Dibutuhkan

A. Master Data Device (Diperbarui)

Daftar inventaris lengkap dengan atribusi lokasi/divisi dan masa kontrak.

Device ID (Key): IMEI atau Serial Number.

Nama Unit/Plat No: Identitas kendaraan.

Cabang (Branch) & Kode Divisi: Lokasi dan Cost Center.

Tipe Subscription: (GPS Only / GPS + Fuel / Personal Tracker).

Masa Berlaku (Subscription Period):

Sub_Start_Date: Tanggal awal kontrak.

Sub_End_Date: Tanggal akhir kontrak.

Status Aset: (Active / Rusak / Hilang).

B. Log Servis (Service History)

(Tidak berubah)

Device ID: IMEI/Serial.

Tanggal Mulai & Selesai Servis.

C. Laporan Vendor (Invoice Data)

(Tidak berubah)

Device ID & Status Vendor.

2. Aturan Bisnis (Business Logic)

Level 1: Logika Masa Kontrak (Baru)

Sebelum melihat status servis, cek dulu tanggalnya terhadap Bulan Rekap:

Jika Bulan Rekap > End Date -> Status EXPIRED (Tidak perlu bayar).

Jika Bulan Rekap < Start Date -> Status PENDING (Belum aktif, tidak perlu bayar).

Jika Masuk Rentang Tanggal -> Lanjut ke Level 2.

Level 2: Logika Servis (Existing)

Jika alat mati total 1 bulan penuh -> Status SRV-FULL (Gratis).

Jika alat aktif sebagian hari -> Status BILLABLE.

Logika Agregasi

Kelompokkan berdasarkan Divisi -> Hitung Subtotal.

3. Diagram Alur (Flowchart Logic)

flowchart TD
    Start([Mulai]) --> LoadData[Load Master, Logs, Invoice]
    LoadData --> Grouping[Kelompokkan per DIVISI]
    
    Grouping --> LoopDiv{Loop Divisi}
    LoopDiv --> LoopDev{Loop Device}
    
    LoopDev --> CheckContract{Cek Masa Kontrak}
    
    CheckContract -- Expired/Belum Mulai --> StsExp[Status: EXPIRED/OFF]
    CheckContract -- Kontrak Aktif --> CheckSrv{Cek Log Servis}
    
    CheckSrv -- Rusak Full Sebulan --> StsSrv[Status: SERVICE (Free)]
    CheckSrv -- Unit Sehat --> StsBill[Status: BILLABLE]
    
    StsExp --> NextDev
    StsSrv --> NextDev
    StsBill --> AddCost[Hitung Biaya & Tambah Subtotal]
    
    AddCost --> NextDev
    NextDev --> LoopDev
    
    LoopDev -- Selesai Divisi --> Print[Cetak Laporan]
    Print --> LoopDiv
    LoopDiv -- Selesai Semua --> End([Selesai])
