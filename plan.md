# AI Conversational Intelligence Layer for Growing UMKM

## 1. Executive Summary

This document outlines the full product, technical, and business strategy for an **AI-powered Conversational Business Intelligence platform** purpose-built for growing Indonesian UMKM (5–30 employees).

The product is **not** an ERP, accounting system, or operational tool.
It is an **intelligence layer** that sits on top of existing business data.

Business owners upload or connect their existing data (Excel, CSV, Google Sheets, POS exports), and the AI transforms it into clear, decision-ready dashboards through **natural language interaction in Bahasa Indonesia**.

**Core Value Proposition:**
> Owners talk to their data. The system translates intent into structured insights — in seconds, in their language, with zero configuration.

**Key Differentiators:**
1. Bahasa Indonesia-first conversational AI — not a translated English product
2. Zero-configuration analytics — no dimensions, measures, or chart pickers
3. Opinionated, status-driven UX — verdicts first, details on demand
4. Built for messy real-world UMKM data — not clean enterprise datasets
5. Affordable SaaS pricing aligned with UMKM economics

---

## 2. Problem Statement

### 2.1 The Growing UMKM Data Crisis

As UMKM scale beyond 5 employees, operational complexity compounds:

| Pain Point | Impact |
|---|---|
| Sales across multiple channels (Shopee, Tokopedia, offline, WhatsApp) | No unified view of revenue |
| Data stored in disconnected Excel files | Manual consolidation takes hours |
| Reports created manually every week/month | Delayed, error-prone decision-making |
| Profit visibility unclear (revenue ≠ profit) | Over-expansion or under-investment |
| Decisions based on intuition, not evidence | Missed trends, undetected anomalies |
| Multi-branch operations | No branch-level performance comparison |

### 2.2 Why Traditional BI Fails for UMKM

Traditional BI tools (Power BI, Tableau, Metabase, Google Looker) are:

* **Too complex** — require understanding of data modeling concepts
* **Require technical setup** — database connections, schema design, DAX formulas
* **Designed for analysts** — not for business owners with no technical background
* **English-first** — poor Bahasa Indonesia support, especially for NLP features
* **Expensive** — Power BI Pro at $10/user/month is prohibitive for UMKM margins
* **Overkill** — 90% of features go unused

### 2.3 The Insight Gap

Growing UMKM don't need more dashboards.
They need **clarity without configuration** — answers to questions they can express in their own language.

---

## 3. Market Analysis

### 3.1 Target Market Size

| Metric | Value |
|---|---|
| Total UMKM in Indonesia | ~65 million |
| Growing UMKM (5–30 employees) | ~3.5 million (Addressable) |
| Digital-ready (uses smartphone + spreadsheets) | ~1.2 million (Serviceable) |
| Year 1 target | 1,000 paying users |
| Year 3 target | 25,000 paying users |

### 3.2 Target User Personas

**Primary: Owner-Operator ("Pak Budi")**
* Owns 2–3 branches of a food/retail business
* Manages via WhatsApp groups and Excel
* Makes decisions based on "feeling" and end-of-month bank balance
* Smartphone-first, limited laptop usage
* Wants: "Is my business healthy today? What should I worry about?"

**Secondary: Operations Manager ("Mbak Rina")**
* Hired to manage daily operations across branches
* Creates weekly/monthly reports manually in Excel
* Spends 4–6 hours per week on report compilation
* Wants: "Generate my weekly report automatically"

**Tertiary: Family Business Successor ("Dimas")**
* Young (25–35), tech-savvy, taking over family business
* Frustrated with lack of data visibility
* Wants: "Show me what's actually working and what's not"

### 3.3 Competitive Landscape

| Competitor | Type | Weakness for UMKM |
|---|---|---|
| Power BI | Enterprise BI | Too complex, expensive, English-first |
| Tableau | Enterprise BI | No Bahasa NLP, requires analyst |
| Metabase | Open-source BI | Requires self-hosting, SQL knowledge |
| Jurnal.id | Accounting | Limited analytics, not conversational |
| BukuWarung | Bookkeeping | Basic reporting only |
| Moka POS | POS | Channel-locked, no cross-source analytics |
| ChatGPT + Excel | Manual AI | No persistence, no schema, hallucinations |

**Our positioning:** The only Bahasa-first, zero-config, conversational BI platform for UMKM.

---

## 4. Product Positioning

### 4.1 What This Product IS

* A **Conversational Intelligence Layer** over existing business data
* A **natural language interface** to structured analytics
* An **automated insight generator** that proactively surfaces anomalies
* A **decision support system** for business owners

### 4.2 What This Product is NOT

* ❌ An ERP system
* ❌ An accounting platform
* ❌ A POS replacement
* ❌ An inventory management tool
* ❌ A general-purpose chatbot

### 4.3 Integration Philosophy

The system **connects to** existing tools — it does not replace them.

```
┌─────────────────────────────────────────────┐
│              UMKM Data Sources              │
│  Excel │ CSV │ Google Sheets │ POS Exports  │
│  Tokopedia │ Shopee │ Accounting Exports     │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│      AI Conversational Intelligence Layer   │
│  ┌─────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ Ingest  │→│ Normalize│→│ AI Analytics │ │
│  └─────────┘ └──────────┘ └──────────────┘ │
│  ┌──────────────────────────────────────┐   │
│  │   Natural Language Interface (ID)    │   │
│  └──────────────────────────────────────┘   │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
        ┌─────────────────────┐
        │  Dashboards, Alerts │
        │  Verdicts, Reports  │
        └─────────────────────┘
```

---

## 5. Core Concept & User Flow

### 5.1 The "Talk to Your Data" Paradigm

```
User uploads business data (or connects spreadsheet)
         │
         ▼
User types: "Tampilkan untung mingguan dan produk paling laku."
         │
         ▼
    ┌────────────────────┐
    │  1. Parse Intent   │  NLU extracts: metric=profit, period=weekly,
    │                    │  ranking=top_products
    ├────────────────────┤
    │  2. Map Metrics    │  profit → SUM(revenue) - SUM(cogs)
    │                    │  top_products → GROUP BY product ORDER BY qty DESC
    ├────────────────────┤
    │  3. Build Query    │  Template-based SQL generation (no free-form)
    ├────────────────────┤
    │  4. Execute Query  │  Sandboxed PostgreSQL with row-level security
    ├────────────────────┤
    │  5. Select Visual  │  AI picks: MetricCard + TrendChart + TopList
    ├────────────────────┤
    │  6. Compose Layout │  Responsive grid using design rules
    └────────────────────┘
         │
         ▼
    Dashboard renders in < 3 seconds
```

The user **never** selects dimensions, measures, filters, or chart types manually.

### 5.2 Conversational Examples

| User Says (Bahasa) | System Does |
|---|---|
| "Tampilkan omzet minggu ini" | Revenue metric card + daily trend chart |
| "Bandingkan dengan bulan lalu" | Adds comparison overlay + delta indicator |
| "Mana cabang paling lemah?" | Branch performance ranking + bottom performer highlight |
| "Kenapa omzet turun hari Rabu?" | Anomaly analysis + contributing factors |
| "Buat laporan mingguan" | Auto-generates PDF/WhatsApp-ready summary |
| "Ini data cabang Surabaya" | Tags uploaded dataset with branch metadata |
| "Gabungkan dengan file kemarin" | Intelligent merge with conflict detection |

---

## 6. Data Integration Architecture

### 6.1 Supported Data Inputs

**MVP (Phase 1):**
| Source | Format | Method |
|---|---|---|
| Excel | .xlsx, .xls | File upload |
| CSV | .csv | File upload |
| Google Sheets | Link | OAuth / manual link |
| POS exports | CSV/Excel | File upload |
| Accounting exports | CSV/Excel | File upload |

**Phase 2:**
| Source | Format | Method |
|---|---|---|
| Tokopedia Seller Center | API | OAuth integration |
| Shopee Seller Center | API | OAuth integration |
| GrabFood Merchant | API | OAuth integration |
| GoFood Merchant | API | OAuth integration |
| BukuWarung | Export | File upload |

**Phase 3:**
| Source | Format | Method |
|---|---|---|
| Bank Statements (BCA, Mandiri) | PDF/CSV | File upload + OCR |
| WhatsApp Order Messages | Text | NLP extraction |
| Receipt/Invoice Images | Image | OCR + template matching |

### 6.2 Data Ingestion Pipeline

```
┌──────────┐    ┌───────────┐    ┌──────────────┐    ┌───────────┐
│  Upload  │───▶│Pre-Clean  │───▶│ AI Column    │───▶│Normalize  │
│          │    │           │    │ Mapping      │    │& Store    │
└──────────┘    └───────────┘    └──────────────┘    └───────────┘
     │               │                │                    │
     │          • Remove empty   • Inspect headers    • Map to internal
     │            rows           • Analyze sample       schema
     │          • Detect header    rows               • Validate data
     │            row            • AI suggests          types
     │          • Normalize        mapping            • Store in
     │            dates          • User confirms        PostgreSQL
     │          • Remove           or corrects
     │            summary rows
     │
     ▼
  Validation Report:
  "Saya mendeteksi 1,247 transaksi dari 3 bulan terakhir.
   Ada 45 produk unik dan 3 cabang."
```

### 6.3 Internal Data Schema

**Core Tables:**

```sql
-- Transactions (the heart of the system)
CREATE TABLE transactions (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    transaction_date TIMESTAMPTZ NOT NULL,
    product_id      UUID REFERENCES products(id),
    branch_id       UUID REFERENCES branches(id),
    customer_id     UUID REFERENCES customers(id),
    quantity        DECIMAL(12,2),
    unit_price      DECIMAL(15,2),
    total_revenue   DECIMAL(15,2),
    cogs            DECIMAL(15,2),
    discount        DECIMAL(15,2) DEFAULT 0,
    channel         VARCHAR(50),       -- tokopedia, shopee, offline, etc.
    payment_method  VARCHAR(50),
    source_file_id  UUID REFERENCES source_files(id),
    raw_data        JSONB,             -- preserve original row
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Products
CREATE TABLE products (
    id          UUID PRIMARY KEY,
    tenant_id   UUID NOT NULL,
    name        VARCHAR(255),
    category    VARCHAR(100),
    sku         VARCHAR(100),
    unit        VARCHAR(50),
    base_price  DECIMAL(15,2),
    base_cogs   DECIMAL(15,2)
);

-- Branches
CREATE TABLE branches (
    id          UUID PRIMARY KEY,
    tenant_id   UUID NOT NULL,
    name        VARCHAR(255),
    city        VARCHAR(100),
    type        VARCHAR(50)   -- offline, online, warehouse
);

-- Expenses
CREATE TABLE expenses (
    id           UUID PRIMARY KEY,
    tenant_id    UUID NOT NULL,
    expense_date TIMESTAMPTZ,
    category     VARCHAR(100),  -- gaji, sewa, listrik, bahan_baku, marketing
    amount       DECIMAL(15,2),
    branch_id    UUID REFERENCES branches(id),
    description  TEXT,
    recurring    BOOLEAN DEFAULT FALSE
);

-- Customers (optional, Phase 2)
CREATE TABLE customers (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    name            VARCHAR(255),
    phone           VARCHAR(20),
    total_orders    INTEGER DEFAULT 0,
    total_spent     DECIMAL(15,2) DEFAULT 0,
    first_order     TIMESTAMPTZ,
    last_order      TIMESTAMPTZ
);

-- Source file tracking
CREATE TABLE source_files (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    filename        VARCHAR(500),
    file_type       VARCHAR(20),
    upload_date     TIMESTAMPTZ DEFAULT NOW(),
    row_count       INTEGER,
    date_range_start TIMESTAMPTZ,
    date_range_end  TIMESTAMPTZ,
    column_mapping  JSONB,
    status          VARCHAR(20)  -- processing, mapped, confirmed, error
);
```

### 6.4 Data Quality Engine

The system handles messy UMKM data gracefully:

| Issue | Auto-Fix |
|---|---|
| Mixed date formats (01/03/2025 vs 2025-03-01) | AI detects locale and normalizes |
| Merged cells in Excel | Unmerge and fill down |
| Currency symbols in numbers (Rp 50.000) | Strip and parse |
| Indonesian number format (50.000,00 vs 50,000.00) | Detect locale-specific formatting |
| Duplicate transactions | Fuzzy matching + user confirmation |
| Missing product names | Group by price/quantity pattern |
| Summary/total rows mixed with data | AI detects and separates |

### 6.5 Conversational Data Management

Users manage data through natural language:

```
User: "Ini data cabang Bandung bulan Februari"
→ System tags: branch=Bandung, period=2025-02

User: "Gabungkan dengan file minggu lalu"
→ System merges with conflict detection, reports: "3 transaksi duplikat ditemukan, diabaikan."

User: "Hapus data yang salah dari file kemarin"
→ System shows affected rows, user confirms deletion

User: "Update harga pokok Nasi Goreng jadi 15.000"
→ System updates COGS, recalculates margins
```

### 6.6 Data Safety & Governance

* **No free-form SQL from LLM** — only parameterized template queries
* **Row-level security** — each tenant can only access their own data
* **Audit trail** — every query logged with user, timestamp, and result count
* **Encrypted at rest** — AES-256 for stored data
* **Encrypted in transit** — TLS 1.3 for all connections
* **Data retention policy** — configurable per tenant (default: 2 years)
* **GDPR-ready** — data export and deletion APIs available
* **No training on user data** — LLM does not learn from business data

---

## 7. Core Features (Detailed)

### 7.1 AI Dashboard Generator

**How it works:**

1. User describes desired insight in Bahasa Indonesia
2. NLU engine extracts: metrics, dimensions, time period, comparisons, filters
3. Query engine executes against normalized data
4. Visualization selector picks optimal chart types
5. Layout composer arranges components using design rules
6. Dashboard renders with animation

**Component Library:**

| Component | Use Case | Data Requirements |
|---|---|---|
| MetricCard | Single KPI display | 1 aggregated number |
| TrendChart | Time-series visualization | Date + metric |
| ComparisonCard | Period-over-period delta | 2 time periods |
| TopList | Ranked items | Dimension + metric |
| DistributionChart | Category breakdown | Category + metric |
| AlertIndicator | Anomaly flag | Threshold + current value |
| HeatmapCalendar | Daily performance pattern | Date + metric |
| BranchComparison | Multi-location view | Branch + metrics |
| FunnelChart | Conversion stages | Stage + count |
| GoalTracker | Target vs actual | Target + actual values |

**Layout Rules (AI-enforced):**

* Maximum 8 components per dashboard
* MetricCards always at top in 2–4 column grid
* TrendCharts span full width
* TopLists and ComparisonCards in 2-column layout
* AlertIndicators pinned to top-right
* Mobile: single column stack with MetricCards as horizontal scroll

### 7.2 Manual Dashboard Builder

While AI-generated dashboards are the primary experience, users who want full control can **build dashboards manually** using a visual component picker.

**Builder Modes:**

| Mode | For Whom | How It Works |
|---|---|---|
| **AI Mode** (default) | Most users | Describe what you want → AI builds it |
| **Manual Mode** | Power users | Pick components from library → arrange on canvas |
| **Hybrid Mode** | Intermediate | AI generates → user manually tweaks |

**Manual Builder Interface:**

```
┌─────────────────────────────────────────────────────┐
│  📊 Dashboard Builder            [AI Mode] [Manual] │
├──────────┬──────────────────────────────────────────┤
│          │                                          │
│ Component│   ┌──────────┐  ┌──────────┐             │
│ Library  │   │ Omzet    │  │ Untung   │             │
│          │   │ Rp 45.2M │  │ Rp 8.1M  │             │
│ [+] Metric│  └──────────┘  └──────────┘             │
│ [+] Trend │                                         │
│ [+] Top   │   ┌────────────────────────┐            │
│ [+] Compare│  │ 📈 Trend Chart         │            │
│ [+] Alert │   │ [select metric ▼]      │            │
│ [+] Heatmap│  │ [select period ▼]      │            │
│ [+] Goal  │   └────────────────────────┘            │
│           │                                         │
│ Templates │   ┌────────────────────────┐            │
│ ─────────│   │  + Add Component       │            │
│ Mingguan  │   └────────────────────────┘            │
│ Bulanan   │                                         │
│ Per Cabang│   [Preview] [Simpan] [Share]            │
└──────────┴──────────────────────────────────────────┘
```

**Component Configuration (per component):**

Each manually placed component has a simple configuration panel:

| Setting | Options | Example |
|---|---|---|
| Metric | Dropdown of available metrics | Omzet, Untung, Qty, Margin |
| Time Period | Preset periods | Hari ini, 7 hari, 30 hari, Custom |
| Filter | Branch, channel, product | Cabang Bandung, Tokopedia |
| Comparison | Toggle comparison overlay | vs. periode sebelumnya |
| Size | Small / Medium / Full-width | — |

**Dashboard Templates:**

Pre-built templates users can start from and customize:

| Template | Components Included | Best For |
|---|---|---|
| Ringkasan Mingguan | 3 MetricCards + TrendChart + TopList | Weekly owner check-in |
| Performa Cabang | BranchComparison + MetricCards per branch | Multi-location businesses |
| Analisis Produk | TopList + DistributionChart + TrendChart | Product-focused businesses |
| Pantau Target | GoalTracker + TrendChart + MetricCards | Goal-oriented owners |
| Laporan Keuangan | MetricCards (Revenue, COGS, Profit) + TrendChart + ComparisonCard | Financial overview |

**Template Flow:**
```
User selects template → System pre-fills with their data → User tweaks if needed → Save
```

**Key Design Decisions:**

* **No complex drag-and-drop grid** — components snap into a simple vertical stack or 2-column grid (not a free-form canvas)
* **AI always available as fallback** — user can switch to AI mode at any time by typing a request
* **Guardrails on manual mode** — system warns if dashboard has too many/conflicting components
* **Save & share** — saved dashboards can be pinned to home screen or shared as image/PDF

### 7.3 Conversational Dashboard Editing

Users modify **any** dashboard (AI-generated or manually built) through natural language:

```
"Tambahkan perbandingan bulan lalu"     → Adds ComparisonCard
"Fokus ke untung saja"                  → Filters to profit-related components
"Tampilkan per cabang"                  → Splits metrics by branch
"Hilangkan chart yang itu"              → Removes last-added component
"Ganti ke tampilan harian"              → Changes time granularity
"Simpan dashboard ini sebagai 'Mingguan'" → Saves named dashboard
"Mulai dari template bulanan"           → Loads monthly template as starting point
```

This means all three modes (AI, Manual, Hybrid) converge — a user can start in manual mode, then ask AI to adjust, or vice versa.

### 7.3 Daily AI Business Verdict

Every morning (configurable time), the system generates a single-sentence business verdict:

**Examples:**

> ✅ "Bisnis kamu stabil hari ini. Untung naik 6% dibanding kemarin. Tidak ada anomali."

> ⚠️ "Perhatian: Omzet cabang Depok turun 23% dari rata-rata. Cek stok atau operasional."

> 🔴 "Peringatan: Margin keuntungan bulan ini 8%, di bawah rata-rata 15%. HPP naik signifikan."

**Verdict Components:**
1. **Health Status** — Sehat / Waspada / Kritis (with color indicator)
2. **Key Metric Summary** — Revenue, profit, top changes
3. **Anomaly Alerts** — Automated detection of unusual patterns
4. **Recommendation** — One actionable suggestion

**Delivery Channels:**
* In-app notification
* WhatsApp message (via WhatsApp Business API)
* Email digest (weekly summary)

### 7.4 Anomaly Detection Engine

**Statistical Methods:**
* Z-score based detection (>2σ from rolling mean)
* Seasonal decomposition (STL) for weekly/monthly patterns
* Year-over-year comparison for seasonal businesses    
* Inter-branch comparison for multi-location businesses

**Detected Anomaly Types:**

| Anomaly | Detection Method | Alert |
|---|---|---|
| Revenue drop | Z-score on daily revenue | "Omzet hari ini 40% di bawah rata-rata" |
| Margin compression | COGS/Revenue ratio shift | "Margin turun dari 25% ke 18%" |
| Sudden spike | Z-score on daily volume | "Pesanan 3x lipat hari ini — promo?" |
| Branch underperformance | Cross-branch comparison | "Cabang Depok 30% di bawah cabang lain" |
| Product decline | Week-over-week trend | "Penjualan Nasi Goreng turun 5 minggu berturut" |
| Customer churn signal | Order frequency analysis | "15 pelanggan reguler belum order 30 hari" |

### 7.5 Question-Driven Analytics (Q&A)

Users ask open-ended business questions:

```
User: "Kenapa omzet turun minggu lalu?"
```

**AI Response Structure:**
1. **Direct Answer** — "Omzet turun 18% minggu lalu (Rp 12.5M → Rp 10.2M)"
2. **Contributing Factors** — Ranked by impact
   - "Cabang Bandung tutup 2 hari (kontribusi: -Rp 1.4M)"
   - "Produk Ayam Geprek stok habis Kamis–Sabtu (-Rp 600K)"
   - "Hujan lebat Jumat–Minggu, traffic offline turun (-Rp 500K)"
3. **Visual Support** — Daily revenue chart with annotated events
4. **Recommendation** — "Pastikan stok Ayam Geprek tersedia menjelang weekend"

### 7.6 AI Report Generation

Reports are generated **both automatically and on-demand** through conversation.

#### 7.6.1 On-Demand Report Generation (Conversational)

Users can request any report by simply asking:

```
User: "Buatkan laporan minggu ini"
→ AI generates weekly summary report

User: "Buat laporan untung rugi bulan Februari"
→ AI generates P&L report for February

User: "Kirim ringkasan ke WhatsApp"
→ AI generates WhatsApp-optimized card and sends it

User: "Bandingkan performa Q1 vs Q4 tahun lalu"
→ AI generates quarterly comparison report

User: "Buat laporan untuk meeting investor"
→ AI generates professional PDF with key growth metrics
```

**Report Customization via Conversation:**

| User Says | System Does |
|---|---|
| "Tambahkan grafik margin" | Adds margin chart to current report |
| "Hilangkan bagian per cabang" | Removes branch breakdown section |
| "Buat lebih singkat" | Condenses report to executive summary |
| "Fokus ke produk baru" | Filters report to recently added products |
| "Buat dalam Bahasa Inggris" | Regenerates report content in English |

#### 7.6.2 Scheduled Auto-Reports

Users configure recurring reports (or AI suggests them during onboarding):

**Weekly Report (Every Monday 7 AM):**
* Revenue summary with week-over-week comparison
* Top 5 products by revenue and quantity
* Branch performance ranking
* Anomaly summary
* AI recommendations
* 1-sentence verdict

**Monthly Report (1st of each month):**
* Full P&L approximation (revenue - known expenses)
* Product performance matrix
* Customer metrics (if data available)
* Trend analysis and 30-day forecast
* Growth indicators
* Month-over-month comparison

**Custom Scheduled Reports:**
Users can create their own recurring reports:
```
User: "Setiap Jumat sore, kirim ringkasan omzet mingguan ke WhatsApp"
→ System creates: Weekly revenue summary, delivered every Friday 5 PM via WhatsApp

User: "Setiap tanggal 25, ingatkan saya soal pengeluaran bulanan"
→ System creates: Monthly expense report, delivered on 25th via push notification
```

#### 7.6.3 Report Delivery & Formats

| Format | Use Case | Details |
|---|---|---|
| **In-app** | Quick review | Interactive, tap to drill down |
| **PDF** | Formal sharing, printing, investor meetings | Branded, professional layout |
| **WhatsApp Card** | Quick daily/weekly digest | Single image with key metrics (optimized for mobile) |
| **WhatsApp Text** | Ultra-light summary | Plain text verdict + 3 key numbers |
| **Excel** | Deep analysis, accountant handoff | Raw data + pre-built pivot tables |
| **Email** | Scheduled digests | HTML email with embedded charts |

#### 7.6.4 Smart Report Suggestions

The AI proactively suggests reports users might need:

```
🤖 "Kamu belum pernah cek performa per produk bulan ini.
    Mau saya buatkan laporannya?"
    [Ya, buatkan] [Nanti saja]

🤖 "Bulan depan tutup buku. Mau saya siapkan laporan
    bulanan otomatis setiap tanggal 1?"
    [Atur jadwal] [Tidak perlu]
```

### 7.7 Goal Setting & Tracking

Users set business targets through conversation:

```
User: "Target omzet bulan ini 200 juta"
→ System creates goal tracker
→ Daily progress updates: "Sudah 65% dari target. Perlu Rp 4.6M/hari sisa 15 hari."

User: "Target untung 20%"
→ Margin monitoring activated
→ Alert if margin drops below threshold
```

### 7.8 User Engagement Loop (Keeping Users in the Loop Without Overwhelming)

The biggest risk for a BI product is **notification fatigue** — users turn off alerts and stop opening the app. This section defines a deliberate strategy to keep UMKM owners informed at the right frequency, through the right channel, with the right amount of detail.

#### 7.8.1 The Attention Budget Model

Each user has a daily **attention budget** — the system tracks how many notifications have been sent and self-throttles:

| Priority | Max/Day | Max/Week | Delivery |
|---|---|---|---|
| 🔴 Critical (anomaly, large loss) | Unlimited | — | Immediate push + WhatsApp |
| 🟡 Important (weekly report, goal miss) | 2 | 7 | Scheduled time-slot |
| 🟢 Informational (insight, suggestion) | 1 | 3 | Batched in daily digest |
| ⚪ Background (tips, feature updates) | 0 | 1 | In-app only |

**Rules:**
* If 2 important notifications already sent today → next one queued for tomorrow
* Informational items always batched, never sent individually
* System learns preferred check-in times (e.g., if user always opens app at 8 AM → deliver digest at 7:55 AM)

#### 7.8.2 Notification Tiers & Channels

| Tier | What | When | Channel | Opt-Out |
|---|---|---|---|---|
| **Morning Verdict** | 1-sentence business health check | Daily (configurable time) | WhatsApp or Push | Can switch to weekly |
| **Anomaly Alert** | Significant deviation detected | Real-time (throttled) | Push notification | Can set sensitivity |
| **Weekly Digest** | Full week summary with key numbers | Every Monday | WhatsApp + Email | Can change day |
| **Goal Check-in** | Progress toward active targets | When relevant (not daily) | In-app | Per-goal toggle |
| **Monthly Report** | Auto-generated monthly summary | 1st of month | Email + In-app | Toggle on/off |
| **Smart Suggestion** | AI spots opportunity or risk pattern | 1–2x per week max | In-app card | Dismiss = fewer |
| **Data Reminder** | "You haven't uploaded new data in 7 days" | After inactivity | Email | 1 reminder only |
| **Re-engagement** | "Here's what changed since you last checked" | After 14+ days inactive | WhatsApp | 1 message only |

#### 7.8.3 Progressive Information Density

Instead of dumping all information at once, the system uses **progressive disclosure in notifications**:

**Layer 1 — The Hook (always delivered):**
> ✅ "Bisnis kamu sehat minggu ini. Omzet naik 8%."

**Layer 2 — The Summary (tap to expand):**
> Omzet: Rp 52.3M (▲8%) · Untung: Rp 9.1M (▲5%) · Produk terlaris: Nasi Goreng

**Layer 3 — The Detail (opens app):**
> Full dashboard with daily breakdown, branch comparison, anomaly details

```
┌─────────────────────────────────────────┐
│ WhatsApp Message (Layer 1)             │
│                                         │
│ 📊 Ringkasan Bisnis - Senin, 3 Mar     │
│                                         │
│ ✅ Bisnis sehat minggu ini.             │
│ Omzet: Rp 52.3M (▲8%)                  │
│ Untung: Rp 9.1M (▲5%)                  │
│                                         │
│ 🏆 Terlaris: Nasi Goreng               │
│ ⚠️ 1 anomali: Cabang Depok turun 15%   │
│                                         │
│ [Lihat Detail di App]                   │
│ [Balas "STOP" untuk berhenti]           │
└─────────────────────────────────────────┘
```

#### 7.8.4 Conversational Notification Management

Users control notifications through natural language — no settings page hunting:

```
User: "Jangan kirim notifikasi setiap hari, cukup mingguan"
→ System: Switches morning verdict to weekly digest

User: "Kirim laporan setiap Jumat, bukan Senin"
→ System: Updates weekly digest schedule

User: "Kasih tahu saya kalau omzet turun lebih dari 20% saja"
→ System: Sets anomaly threshold to 20% deviation

User: "Matikan notifikasi soal goal untuk sekarang"
→ System: Disables goal check-ins (can re-enable anytime)

User: "Kirim ringkasan ke WhatsApp saja, jangan email"
→ System: Updates channel preferences
```

#### 7.8.5 Smart Engagement Patterns

**For Daily Active Users:**
* Minimal push notifications (they're already checking)
* In-app insights surfaced as cards on home screen
* New insights highlighted with subtle badge/dot

**For Weekly Active Users (most UMKM owners):**
* One strong weekly digest (WhatsApp) with key numbers
* Anomaly alerts only for significant deviations (>20%)
* End-of-month report auto-delivered

**For Inactive Users (14+ days):**
* Single re-engagement message: "Sudah 2 minggu sejak kamu cek bisnis. Omzet minggu ini Rp 48M. Mau lihat detailnya?"
* If no response → one more after 30 days
* If still no response → stop all notifications (respect the user)
* Never spam — maximum 2 re-engagement attempts total

#### 7.8.6 Feedback Loop on Notifications

Every notification includes a lightweight feedback mechanism:

```
📊 Weekly Digest
[content...]

Apakah ringkasan ini berguna?
[👍 Berguna]  [👎 Tidak]  [⚙️ Ubah frekuensi]
```

**System learns from feedback:**
* Consistent 👍 → maintain current cadence
* 👎 → reduce frequency or change format
* Ignored notifications → automatically reduce after 3 consecutive ignores
* Opened and spent >30s reading → increase slightly (user values this)

This creates a **self-tuning notification system** that adapts to each owner's actual behavior, not just their stated preferences.

---

## 8. AI/ML Architecture

### 8.1 AI System Overview

```
┌─────────────────────────────────────────────────────┐
│                   AI Layer                          │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │   NLU Engine │  │  Query Engine│  │  Insight  │ │
│  │              │  │              │  │  Engine   │ │
│  │ • Intent     │  │ • Template   │  │           │ │
│  │   detection  │  │   selection  │  │ • Anomaly │ │
│  │ • Entity     │  │ • Parameter  │  │ • Trend   │ │
│  │   extraction │  │   binding    │  │ • Forecast│ │
│  │ • Context    │  │ • Safety     │  │ • Verdict │ │
│  │   management │  │   validation │  │           │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │  Column      │  │ Visualization│  │  Response │ │
│  │  Mapper      │  │ Selector     │  │  Generator│ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
└─────────────────────────────────────────────────────┘
```

### 8.2 NLU Engine (Natural Language Understanding)

**Purpose:** Parse Bahasa Indonesia business queries into structured intents.

**Architecture:**
* **Primary Model:** Gemini 2.0 Flash (or equivalent) via API — for intent classification and entity extraction
* **Fallback Model:** Fine-tuned smaller model for common patterns (offline-capable)
* **Context Window:** Maintains conversation history for follow-up questions

**Intent Taxonomy:**

| Intent Category | Examples |
|---|---|
| `show_metric` | "Tampilkan omzet", "Berapa untung" |
| `compare` | "Bandingkan dengan bulan lalu" |
| `rank` | "Produk paling laku", "Cabang terbaik" |
| `explain` | "Kenapa turun", "Apa penyebabnya" |
| `filter` | "Hanya cabang Bandung", "Bulan Maret saja" |
| `modify_dashboard` | "Tambahkan", "Hilangkan", "Ganti" |
| `set_goal` | "Target omzet 200 juta" |
| `generate_report` | "Buat laporan mingguan" |
| `data_management` | "Upload file", "Gabungkan data" |

**Entity Types:**

| Entity | Examples |
|---|---|
| `metric` | omzet, untung, margin, HPP, qty |
| `time_period` | minggu ini, bulan lalu, 3 bulan terakhir, hari ini |
| `branch` | cabang Bandung, toko Depok |
| `product` | Nasi Goreng, Ayam Geprek |
| `channel` | Tokopedia, Shopee, offline |
| `comparison_type` | vs bulan lalu, vs cabang lain |

### 8.3 Query Engine (Template-Based)

**No free-form SQL generation.** The system uses parameterized query templates.

**Template Examples:**

```python
QUERY_TEMPLATES = {
    "total_revenue": """
        SELECT SUM(total_revenue) as value
        FROM transactions
        WHERE tenant_id = :tenant_id
          AND transaction_date BETWEEN :start_date AND :end_date
          {branch_filter}
          {channel_filter}
    """,
    "revenue_trend": """
        SELECT DATE_TRUNC(:granularity, transaction_date) as period,
               SUM(total_revenue) as value
        FROM transactions
        WHERE tenant_id = :tenant_id
          AND transaction_date BETWEEN :start_date AND :end_date
          {branch_filter}
        GROUP BY period
        ORDER BY period
    """,
    "top_products": """
        SELECT p.name, SUM(t.quantity) as total_qty,
               SUM(t.total_revenue) as total_revenue
        FROM transactions t
        JOIN products p ON t.product_id = p.id
        WHERE t.tenant_id = :tenant_id
          AND t.transaction_date BETWEEN :start_date AND :end_date
        GROUP BY p.name
        ORDER BY total_revenue DESC
        LIMIT :limit
    """,
    # ... 50+ templates covering all analytics scenarios
}
```

**Safety Layers:**
1. Template selection — LLM picks template ID, not SQL
2. Parameter validation — types checked before binding
3. Row-level security — tenant_id always enforced
4. Query timeout — 10 second maximum
5. Result size limit — max 10,000 rows returned

### 8.4 Insight Engine

**Statistical Analysis (runs nightly):**
* Rolling averages (7-day, 30-day)
* Standard deviation bands for anomaly detection
* Seasonal decomposition (weekly patterns)
* Linear regression for simple trend forecasting
* Cohort analysis for customer behavior (Phase 2)

**Verdict Generation:**
* Aggregates all detected signals
* Ranks by severity and business impact
* Generates natural language summary in Bahasa Indonesia
* Selects appropriate emotional tone (reassuring vs. alerting)

### 8.5 AI Column Mapper

**Purpose:** Automatically map uploaded file columns to internal schema.

**Process:**
1. Read column headers + first 10 sample rows
2. AI analyzes naming patterns, data types, and value distributions
3. Generates mapping suggestions with confidence scores
4. User confirms or corrects
5. Mapping saved for future uploads from same source

**Example:**

```json
{
  "input_column": "tgl_trx",
  "suggested_mapping": "transaction_date",
  "confidence": 0.95,
  "reasoning": "Column contains date values, name matches 'tanggal transaksi'"
}
```

### 8.6 LLM Cost Management

| Operation | Model | Est. Cost/Query |
|---|---|---|
| Intent parsing | Gemini Flash | ~$0.001 |
| Column mapping | Gemini Flash | ~$0.003 |
| Verdict generation | Gemini Flash | ~$0.002 |
| Anomaly explanation | Gemini Flash | ~$0.003 |
| Report generation | Gemini Flash | ~$0.005 |

**Monthly cost per active user (estimate):** $0.50–$2.00
**Cost optimization:** Cache common queries, batch nightly analysis, use smaller models for classification.

---

## 9. System Architecture (Technical)

### 9.1 High-Level Architecture

```
                    ┌─────────────────┐
                    │   CDN (Vercel)  │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Next.js App    │
                    │  (Frontend +    │
                    │   API Routes)   │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼──────┐ ┌────▼─────┐ ┌──────▼──────┐
     │  Auth Service │ │  AI      │ │  File       │
     │  (Supabase    │ │  Service │ │  Processing │
     │   Auth)       │ │  (Python)│ │  Worker     │
     └───────────────┘ └────┬─────┘ └──────┬──────┘
                            │              │
                    ┌───────▼──────────────▼───┐
                    │    PostgreSQL (Supabase)  │
                    │    + Row Level Security   │
                    └──────────────────────────┘
                            │
                    ┌───────▼──────────────────┐
                    │    Object Storage        │
                    │    (Supabase Storage)     │
                    │    - Uploaded files       │
                    │    - Generated reports    │
                    └──────────────────────────┘
```

### 9.2 Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Frontend** | Next.js 14 (App Router) | SSR, API routes, Vercel deployment |
| **UI Framework** | React + Tailwind CSS | Rapid UI development |
| **Charting** | Recharts or Tremor | React-native charts, good defaults |
| **State Management** | Zustand | Lightweight, minimal boilerplate |
| **Backend API** | Next.js API Routes + FastAPI (Python) | JS for CRUD, Python for AI/ML |
| **Database** | PostgreSQL (Supabase) | Managed, row-level security, real-time |
| **Auth** | Supabase Auth | Social login, phone OTP (critical for UMKM) |
| **File Storage** | Supabase Storage | Integrated with auth, signed URLs |
| **AI/LLM** | Google Gemini API | Bahasa Indonesia support, cost-effective |
| **File Parsing** | Python (openpyxl, pandas) | Robust Excel/CSV handling |
| **Job Queue** | Supabase Edge Functions / Bull + Redis | Background file processing |
| **Notifications** | WhatsApp Business API + FCM | Primary UMKM communication channel |
| **Deployment** | Vercel (frontend) + Railway/Fly.io (Python) | Auto-scaling, zero-config |
| **Monitoring** | Sentry + PostHog | Error tracking + product analytics |

### 9.3 API Design

**RESTful API Endpoints:**

```
# Authentication
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/otp/send          # Phone OTP for UMKM owners
POST   /api/auth/otp/verify

# Business Profile
POST   /api/business/setup
GET    /api/business/profile
PUT    /api/business/profile

# Data Management
POST   /api/data/upload             # File upload
GET    /api/data/sources             # List uploaded files
GET    /api/data/sources/:id/mapping # Get column mapping
PUT    /api/data/sources/:id/mapping # Confirm/edit mapping
POST   /api/data/sources/:id/process # Start processing
DELETE /api/data/sources/:id         # Remove data source

# Conversational AI
POST   /api/chat                     # Send message, get response
GET    /api/chat/history             # Conversation history
POST   /api/chat/feedback            # User feedback on response

# Dashboards
GET    /api/dashboards               # List saved dashboards
GET    /api/dashboards/:id           # Get dashboard config
POST   /api/dashboards               # Save dashboard
PUT    /api/dashboards/:id           # Update dashboard
DELETE /api/dashboards/:id           # Delete dashboard

# Insights & Verdicts
GET    /api/insights/verdict          # Today's business verdict
GET    /api/insights/anomalies        # Active anomalies
GET    /api/insights/trends           # Trend analysis

# Reports
POST   /api/reports/generate          # Generate report
GET    /api/reports                    # List generated reports
GET    /api/reports/:id/download      # Download report

# Goals
POST   /api/goals                     # Set business goal
GET    /api/goals                     # List active goals
GET    /api/goals/:id/progress        # Goal progress
```

### 9.4 Real-Time Architecture

```
Client ←──WebSocket──→ Supabase Realtime
                           │
                    Listens on:
                    • dashboard_updates (tenant_id)
                    • anomaly_alerts (tenant_id)
                    • file_processing_status (file_id)
```

**Use Cases:**
* Live dashboard updates when new data is processed
* Real-time file processing progress bar
* Instant anomaly alerts
* Collaborative viewing (future: multi-user same dashboard)

---

## 10. UX Design Specification

### 10.1 Design Principles

1. **Status over charts** — Tell me if I'm OK before showing me graphs
2. **Clarity over complexity** — One clear number beats ten unclear charts
3. **Minimal configuration** — AI decides layout, not the user
4. **Opinionated defaults** — Strong defaults, gentle overrides
5. **Bahasa-first** — Every label, tooltip, and AI response in natural Bahasa
6. **Mobile-first** — Most UMKM owners access via smartphone
7. **Emotional design** — Colors and language convey business health intuitively

### 10.2 Color System

| Status | Color | Usage |
|---|---|---|
| Sehat (Healthy) | `#10B981` (Emerald) | Positive metrics, growth |
| Waspada (Warning) | `#F59E0B` (Amber) | Declining metrics, attention needed |
| Kritis (Critical) | `#EF4444` (Red) | Significant drops, urgent issues |
| Netral (Neutral) | `#6B7280` (Gray) | Informational, no sentiment |
| Aksen (Accent) | `#6366F1` (Indigo) | Brand, interactive elements |

### 10.3 Screen Layouts

**A. Main Dashboard (Home)**

```
┌─────────────────────────────────────────────┐
│  🏪 Warung Pak Budi            [👤] [⚙️]   │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  ✅ Usaha kamu sehat minggu ini.    │    │
│  │     Untung naik 6% dari minggu lalu │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ Omzet    │ │ Untung   │ │ Transaksi│    │
│  │ Rp 45.2M │ │ Rp 8.1M  │ │ 1,247    │    │
│  │ ▲ +12%   │ │ ▲ +6%    │ │ ▲ +8%    │    │
│  └──────────┘ └──────────┘ └──────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  📈 Omzet Harian (7 hari terakhir) │    │
│  │  [====chart area================]   │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  🏆 Produk Terlaris Minggu Ini     │    │
│  │  1. Nasi Goreng      Rp 8.2M       │    │
│  │  2. Ayam Geprek      Rp 6.1M       │    │
│  │  3. Es Teh Manis     Rp 3.4M       │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ 💬 Tanyakan sesuatu tentang bisnis  │    │
│  │ kamu...                        [➤]  │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  [🏠 Home] [📊 Dashboard] [📁 Data] [⚙️]  │
└─────────────────────────────────────────────┘
```

**B. Chat Interface**

```
┌─────────────────────────────────────────────┐
│  ← Asisten Bisnis                           │
├─────────────────────────────────────────────┤
│                                             │
│  👤 Kenapa omzet turun minggu lalu?         │
│                                             │
│  🤖 Omzet turun 18% minggu lalu            │
│     (Rp 12.5M → Rp 10.2M)                  │
│                                             │
│     Penyebab utama:                         │
│     1. Cabang Bandung tutup 2 hari (-Rp1.4M)│
│     2. Stok Ayam Geprek habis (-Rp600K)     │
│     3. Hujan lebat akhir pekan (-Rp500K)    │
│                                             │
│     ┌──────────────────────────────┐        │
│     │ 📈 [Daily Revenue Chart]     │        │
│     └──────────────────────────────┘        │
│                                             │
│     💡 Saran: Pastikan stok Ayam Geprek     │
│        tersedia menjelang weekend.           │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ Ketik pertanyaan...            [➤]  │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Saran: [Untung bulan ini] [Produk terlaris]│
└─────────────────────────────────────────────┘
```

**C. Data Upload Flow**

```
Step 1: Upload          Step 2: AI Mapping       Step 3: Confirm
┌──────────────┐       ┌──────────────┐         ┌──────────────┐
│  📁 Upload   │       │ AI mendeteksi│         │ ✅ Data siap │
│  file bisnis │──────▶│ kolom data:  │────────▶│              │
│  kamu        │       │              │         │ 1,247 transaksi│
│              │       │ tgl_trx → ✅ │         │ 45 produk    │
│  [Drop file] │       │ produk  → ✅ │         │ 3 bulan      │
│              │       │ total   → ✅ │         │              │
│              │       │ qty     → ⚠️  │         │ [Mulai!]     │
└──────────────┘       └──────────────┘         └──────────────┘
```

### 10.4 Onboarding Flow (Detailed)

```
Step 1: Welcome
  "Selamat datang! Saya akan membantu kamu memahami bisnis kamu lebih baik."

Step 2: Business Profile
  - Nama usaha
  - Jenis usaha (dropdown: Makanan, Retail, Jasa, Lainnya)
  - Jumlah cabang
  - Range omzet bulanan (opsional)

Step 3: Data Upload
  - Drag-and-drop or file picker
  - AI scans and reports: "Saya mendeteksi data penjualan 3 bulan terakhir
    dengan 1,247 transaksi dan 45 produk unik."

Step 4: Column Mapping Confirmation
  - AI suggests mappings
  - User taps ✅ or edits

Step 5: First Insight
  - System generates initial dashboard
  - "Ini ringkasan bisnis kamu. Mau lihat apa lagi?"

Step 6: Guided Prompts
  - "Coba tanyakan: 'Produk mana paling menguntungkan?'"
  - User tries first query
  - System responds with dashboard

Total onboarding time target: < 5 minutes
```

### 10.5 Responsive Design

| Breakpoint | Layout | Behavior |
|---|---|---|
| Mobile (< 640px) | Single column | Verdict → Metrics (horizontal scroll) → Chat |
| Tablet (640–1024px) | 2-column grid | Verdict spans full, metrics in 2-col |
| Desktop (> 1024px) | 3-column with sidebar | Sidebar nav + main dashboard + chat panel |

---

## 11. Security Architecture

### 11.1 Authentication

* **Phone OTP** (primary) — Most UMKM owners don't use email regularly
* **Google OAuth** (secondary) — For tech-savvy users
* **Email + Password** (tertiary) — Standard fallback
* **Session management** — JWT with 7-day refresh tokens
* **Device trust** — Remember trusted devices for 30 days

### 11.2 Authorization

* **Row-Level Security (RLS)** — PostgreSQL policies enforce tenant isolation
* **Role-Based Access Control:**

| Role | Permissions |
|---|---|
| Owner | Full access, manage users, delete data |
| Manager | View all data, create reports, no deletion |
| Viewer | View dashboards only, no data management |

### 11.3 Data Protection

* **Encryption at rest:** AES-256 (Supabase default)
* **Encryption in transit:** TLS 1.3
* **File upload scanning:** Malware check before processing
* **PII handling:** Phone numbers and names encrypted separately
* **Backup:** Daily automated backups with 30-day retention
* **Data residency:** Indonesian data center (GCP asia-southeast2)

### 11.4 AI Security

* **No user data in LLM training** — API-only usage, no fine-tuning on user data
* **Prompt injection prevention** — Input sanitization + output validation
* **Query sandboxing** — Template-only queries, no free-form SQL
* **Rate limiting** — Max 100 queries/hour per user
* **Audit logging** — Every AI interaction logged for review

---

## 12. Performance Requirements

| Metric | Target | Measurement |
|---|---|---|
| Dashboard load time | < 2 seconds | P95 latency |
| Chat response time | < 3 seconds | P95 latency |
| File upload processing | < 30 seconds (10K rows) | P95 |
| Column mapping suggestion | < 5 seconds | P95 |
| Verdict generation | < 10 seconds | Nightly batch |
| API availability | 99.5% uptime | Monthly |
| Concurrent users | 500+ simultaneous | Load test |

---

## 13. Monetization Strategy

### 13.1 Pricing Tiers

| Tier | Price (IDR/month) | Features |
|---|---|---|
| **Gratis** | Rp 0 | 1 data source, 50 queries/month, basic dashboard |
| **Starter** | Rp 99,000 (~$6) | 3 data sources, 500 queries/month, daily verdict, PDF reports |
| **Bisnis** | Rp 249,000 (~$15) | Unlimited sources, unlimited queries, WhatsApp alerts, multi-branch, goal tracking |
| **Enterprise** | Custom | API access, custom integrations, dedicated support, SLA |

### 13.2 Revenue Projections

| Period | Users | MRR (IDR) | MRR (USD) |
|---|---|---|---|
| Month 6 | 100 | Rp 15M | ~$940 |
| Year 1 | 1,000 | Rp 150M | ~$9,400 |
| Year 2 | 5,000 | Rp 750M | ~$47,000 |
| Year 3 | 25,000 | Rp 3.75B | ~$235,000 |

### 13.3 Unit Economics

| Metric | Value |
|---|---|
| LLM cost per user/month | Rp 8,000–32,000 ($0.50–$2.00) |
| Infrastructure per user/month | Rp 5,000 ($0.30) |
| Total COGS per user/month | Rp 13,000–37,000 |
| Average revenue per user/month | Rp 175,000 |
| **Gross margin** | **78–93%** |

---

## 14. Development Roadmap

### Phase 1: MVP (Week 1–8)

**Goal:** Demo-ready product for hackathon/investor pitch

| Week | Deliverable |
|---|---|
| 1–2 | Project setup, database schema, auth (Supabase), file upload UI |
| 3–4 | Data ingestion pipeline, AI column mapper, data normalization |
| 5–6 | Chat interface, intent parsing, template query engine, basic dashboard rendering |
| 7 | Daily verdict, anomaly detection (basic), onboarding flow |
| 8 | Polish, testing, demo preparation |

**MVP Feature Set:**
- [x] CSV / Excel file upload and ingestion
- [x] AI-powered column mapping
- [x] Normalized internal schema (transactions, products, branches)
- [x] Conversational query interface in Bahasa Indonesia
- [x] MetricCard, TrendChart, TopList components
- [x] Daily AI business verdict
- [x] Conversational dashboard modification
- [x] Basic anomaly detection
- [x] Mobile-responsive design

### Phase 2: Growth (Week 9–16)

**Goal:** Production-ready SaaS with paying users

* Google Sheets integration
* WhatsApp notifications (Business API)
* Automated weekly/monthly reports (PDF)
* Goal setting and tracking
* Multi-branch comparison dashboard
* Expense tracking integration
* ComparisonCard, HeatmapCalendar, BranchComparison components
* User feedback loop for AI improvement
* Payment integration (Midtrans/Xendit)

### Phase 3: Scale (Week 17–24)

**Goal:** Platform expansion and marketplace integrations

* Tokopedia / Shopee seller API integration
* GrabFood / GoFood merchant integration
* Customer analytics (RFM analysis)
* Inventory insights
* Cash flow forecasting
* Team access (multi-user per business)
* White-label option for resellers

### Phase 4: Intelligence (Week 25+)

**Goal:** Advanced AI capabilities

* Predictive analytics (demand forecasting)
* Automated pricing recommendations
* Supplier cost optimization suggestions
* Cross-business benchmarking (anonymized)
* Voice input for queries (speech-to-text)
* Industry-specific templates (F&B, retail, services)

---

## 15. Testing Strategy

### 15.1 Automated Testing

| Type | Tools | Coverage Target |
|---|---|---|
| Unit Tests | Jest (frontend), Pytest (Python) | 80% |
| Integration Tests | Playwright | Critical user flows |
| API Tests | Supertest / httpx | All endpoints |
| Load Tests | k6 | Concurrent user simulation |

### 15.2 AI Quality Testing

* **Intent accuracy benchmark** — 200+ Bahasa Indonesia queries with expected intents
* **Column mapping accuracy** — 50+ real UMKM Excel files as test set
* **Verdict quality review** — Weekly human review of generated verdicts
* **Query safety audit** — Automated check that no raw SQL leaks through

### 15.3 User Testing

* **Usability testing** — 10 real UMKM owners during Phase 1
* **A/B testing** — Onboarding flow variants during Phase 2
* **Beta program** — 50 businesses during Phase 2 launch

---

## 16. Team Structure

### Minimum Viable Team (Phase 1)

| Role | Count | Responsibility |
|---|---|---|
| Full-Stack Developer | 1–2 | Next.js frontend + API routes |
| AI/ML Engineer | 1 | NLU, query engine, insight engine |
| Designer | 1 (part-time) | UI/UX design, component library |
| Total | 3–4 | |

### Growth Team (Phase 2+)

| Role | Count | Responsibility |
|---|---|---|
| Frontend Developer | 1 | React, charting, mobile optimization |
| Backend Developer | 1 | FastAPI, data pipeline, integrations |
| AI/ML Engineer | 1 | Model optimization, new capabilities |
| Product Manager | 1 | Strategy, user research, roadmap |
| Growth/Marketing | 1 | UMKM community, content, partnerships |
| Total | 5 | |

---

## 17. Risk Analysis

| Risk | Severity | Mitigation |
|---|---|---|
| LLM hallucination in financial data | 🔴 Critical | Template-only queries, no free-form SQL, output validation |
| UMKM data too messy to normalize | 🟡 High | Robust data quality engine, manual override, progressive improvement |
| Low adoption — UMKM resistance to new tools | 🟡 High | WhatsApp-first delivery, partner with POS/accounting vendors |
| LLM API cost spirals | 🟡 Medium | Caching, smaller models for common queries, batch processing |
| Competitor enters (e.g., Moka adds AI) | 🟡 Medium | Speed to market, deeper Bahasa NLU, community building |
| Data privacy concerns | 🟡 Medium | Indonesian data residency, clear privacy policy, data encryption |
| Single LLM vendor dependency | 🟢 Low | Abstract LLM layer, support multiple providers |

---

## 18. Success Metrics

### Product Metrics

| Metric | Target (Month 6) | Target (Year 1) |
|---|---|---|
| Registered businesses | 500 | 2,000 |
| Monthly active users | 200 | 1,000 |
| Daily active users | 50 | 300 |
| Queries per user per week | 10 | 15 |
| File uploads per user per month | 4 | 8 |
| NPS (Net Promoter Score) | 40+ | 50+ |

### AI Quality Metrics

| Metric | Target |
|---|---|
| Intent classification accuracy | > 90% |
| Column mapping accuracy | > 85% (auto), 100% (after user correction) |
| Query execution success rate | > 98% |
| Verdict relevance (human-rated) | > 4.0 / 5.0 |
| Anomaly detection precision | > 80% |

### Business Metrics

| Metric | Target (Year 1) |
|---|---|
| Monthly Recurring Revenue | Rp 150M ($9,400) |
| Customer Acquisition Cost | < Rp 200,000 ($12) |
| Lifetime Value | > Rp 2,000,000 ($125) |
| LTV:CAC Ratio | > 10:1 |
| Monthly churn rate | < 5% |
| Gross margin | > 75% |

---

## 19. Hackathon Demo Flow

### Demo Script (5 minutes)

**[0:00–0:30] Hook**
"Pak Budi punya 3 cabang restoran. Omzetnya 50 juta per bulan. Tapi dia tidak tahu cabang mana yang untung, produk mana yang rugi, dan kenapa omzet turun minggu lalu. Dia punya datanya — di Excel. Tapi datanya tidak bisa bicara. Sampai sekarang."

**[0:30–1:30] Upload & Auto-Map**
1. Upload Excel sales file (real data format)
2. AI detects and maps columns automatically
3. System confirms: "1,247 transaksi, 3 bulan, 45 produk, 3 cabang"

**[1:30–3:00] Conversational Analytics**
4. Type: "Tampilkan untung 3 bulan terakhir dan produk paling laku"
5. Dashboard generates live with MetricCards + TrendChart + TopList
6. Type: "Tambahkan perbandingan dengan bulan lalu"
7. Dashboard adds ComparisonCards showing deltas
8. Type: "Mana cabang paling lemah?"
9. BranchComparison card appears

**[3:00–4:00] Anomaly Detection**
10. Type: "Kenapa minggu lalu turun?"
11. AI explains: contributing factors with visual support
12. Shows daily verdict: "⚠️ Cabang Depok perlu perhatian"

**[4:00–5:00] Vision & Close**
13. Show WhatsApp notification mockup (daily verdict)
14. Show roadmap: marketplace integration, voice queries, predictive analytics
15. Close: **"UMKM tidak perlu belajar BI. Mereka hanya perlu berbicara dengan datanya."**

---

## 20. Conclusion

Indonesia's 65 million UMKM represent the backbone of the economy. As they grow, the gap between data they have and insights they need widens dangerously.

This platform bridges that gap — not by adding another complex tool, but by creating an **intelligence layer that speaks their language**.

**The vision is simple:**
Every growing UMKM in Indonesia should be able to ask "Gimana bisnis gue hari ini?" and get a clear, accurate, actionable answer — in seconds.

We're not building another BI tool.
We're building **the first business advisor that never sleeps, never forgets, and always speaks Bahasa Indonesia.**
