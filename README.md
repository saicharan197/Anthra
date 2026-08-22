# Dayflow — Human Resource Management System (HRMS)

> **Every workday, perfectly aligned.**  
> A lightweight, offline-first Human Resource Management System built with Python, Supabase (PostgreSQL), and Vanilla JavaScript PWA.

---

## Overview

**Dayflow** streamlines core workforce operations, bridging the gap between HR administration and daily employee workflows. Built with an **offline-first PWA architecture**, Dayflow allows field and on-premise staff to log attendance via QR scans and submit time-off requests even with zero network connectivity—seamlessly synchronizing once reconnected.

---

## Key Features

* **Role-Based Access Control (RBAC):** Distinct permissions and views for `Admin / HR Officer` vs. `Employee`.
* **Offline-First QR Attendance:** In-browser camera QR decoding via `html5-qrcode` with local IndexedDB action queues and automatic background synchronization.
* **Attendance Tracking & Status Derivation:** Automated derivation of daily/weekly logs (`Present`, `Absent`, `Half-day`, `Leave`).
* **Leave & Time-Off Management:** Multi-tier leave requests (`Paid`, `Sick`, `Unpaid`) with conflict validation, balance tracking, and Admin approval workflows with comments.
* **Dynamic Pro-Rata Payroll Engine:** Real-time net salary calculations automatically factoring in unapproved absences and unpaid leaves.
* **Employee Profile Management:** Role-gated profile controls (Employees edit contact/photo; Admins manage job titles, roles, and compensation).

---

## Tech Stack

* **Backend:** Python (FastAPI / Uvicorn)
* **Database & Auth:** Supabase (PostgreSQL) with Row Level Security (RLS)
* **Frontend:** Vanilla HTML5, CSS3, Modern JavaScript (ES6+)
* **Offline Storage & Sync:** Service Worker PWA, IndexedDB / `localStorage`
* **QR Engine:** `html5-qrcode`

---

## System Architecture

┌─────────────────────────────────────────────────────────────┐
│                    Client Layer (PWA)                       │
│  - Vanilla JS / Responsive UI                               │
│  - html5-qrcode Scanner                                     │
│  - IndexedDB Sync Queue (Offline Engine)                    │
└──────────────────────────────┬──────────────────────────────┘
│ HTTP / JSON (or Auto-Sync)
▼
┌─────────────────────────────────────────────────────────────┐
│                 Backend API (Python / FastAPI)              │
│  - Auth & RBAC Middleware                                   │
│  - Idempotent Sync Handler (/api/sync)                    │
│  - Dynamic Pro-Rata Payroll Engine                          │
└──────────────────────────────┬──────────────────────────────┘
│ PostgreSQL Wire Protocol
▼
┌─────────────────────────────────────────────────────────────┐
│                 Database (Supabase PostgreSQL)              │
│  - Tables: profiles, attendance, leave_requests, payroll    │
└─────────────────────────────────────────────────────────────┘


---

## Project Structure

```text
dayflow-hrms/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entrypoint
│   │   ├── config.py            # Environment variables & Supabase client
│   │   ├── models/              # Pydantic schemas & data models
│   │   ├── routers/             # Auth, Profile, Attendance, Leave, Payroll routes
│   │   └── services/            # Dynamic payroll & attendance calculation logic
│   └── requirements.txt         # Python dependencies
├── frontend/
│   ├── index.html               # Main entry page
│   ├── css/
│   │   └── style.css            # Responsive layout & design system
│   ├── js/
│   │   ├── app.js               # Core routing & DOM logic
│   │   ├── auth.js              # Authentication state handler
│   │   ├── attendance.js        # QR scanner & attendance tracking
│   │   ├── leave.js             # Leave application & admin approval
│   │   ├── payroll.js           # Dynamic payslip renderer
│   │   └── offline-sync.js      # IndexedDB queue & online sync listener
│   ├── sw.js                    # Service Worker for offline asset caching
│   └── manifest.json            # PWA manifest
├── seed/
│   └── seed_data.py             # Database seeder script
├── schema.sql                   # Supabase PostgreSQL tables & constraints
└── README.md
