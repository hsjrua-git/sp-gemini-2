# Student Panel — Full-Stack Live Audit & Preview Execution Plan

A comprehensive, four-pass audit and live runtime verification of the bilingual (Persian RTL / English LTR) Student Panel platform—hosting the real application on port 3000 with rich, realistic test data across every domain module so both you and the automated browser inspector can see the live system in action without silently fixing or hiding any codebase defects.

## User Review & Critical Decisions

> [!IMPORTANT]
> All Phase 1 preferences have been incorporated into this plan. No application bug fixes or feature modifications will be applied to the audited codebase; only the hosting wiring required to run and preview the live app on port 3000 and the final audit report update will be performed.

- **Confirmed Decision 1 — Live Hosting on Port 3000 for Shared Preview**: Extract the uploaded Student Panel project into the workspace and run the full Express + built React application on port 3000 backed by an on-disk PGlite database, allowing you to view and interact with the seeded application directly in the AI Studio preview pane while keeping all audited source logic intact.
- **Confirmed Decision 2 — Two-Stage Unshimmed & Shimmed Runtime Audit**:
  - **Stage A (Strictly Unshimmed)**: Boot the server against the unmodified database pool adapter to reproduce, verify, and log the exact runtime crashes (such as uncast PostgreSQL `date` OID `1082` serialization failures on Sessions, Accounting Periods, Journal, Purchases, and Teachers).
  - **Stage B (Runtime-Only Shim via Node `--import`)**: Attach an external runtime loader shim (without altering the audited source code) so pages blocked by the date-serialization crash can be loaded, populated with diverse test values, and visually/functionally audited end-to-end.
- **Confirmed Decision 3 — Report Delivery**: Deliver the complete, severity-ordered Problems list (`Critical` / `Major` / `Minor` / `Cosmetic`), value-ordered Suggestions list, and Unverifiable items list both in the chat response and in the updated audit documentation.

---

## 1. Overview & Core Concept

- **What It Does**: Executes a deep, four-pass static and dynamic audit of the Student Panel ecosystem—spanning the Express 5 REST backend, 30 PostgreSQL schema migrations and database triggers, the PGlite offline/on-device service mirror, the React 19 + TanStack Query + Three.js frontend, the local Persian/English voice agent & counter kiosk, and the deployment scripts.
- **Target Audience / Persona**: Engineering and product stakeholders reviewing production readiness, data integrity, security boundaries, RTL/LTR visual fidelity, and edge-case resilience before applying remediation commits.
- **Key Value**: Goes beyond static code reading and prior audit notes by seeding diverse, realistic domain data into a live running instance on port 3000, exercising every role, workflow, database trigger, and UI viewport in headless Chromium, and documenting every confirmed finding with exact locations and reproduction steps.

---

## 2. User Experience & Visual Design (Live Preview & Visual Audit Scope)

### Key User Flows to Seed, Preview & Inspect Live
1. **Authentication, Forced Password Change & RBAC**:
   - Sign in as Administrator (`admin`) and role-scoped test accounts (Evaluator, Blind-Entry Scorer, Cafe Cashier, Accountant, Kiosk, Read-Only Viewer) to verify session handling, CSRF double-submit + Origin checks, temporary password enforcement, and permission-gated navigation panels.
2. **Cohort Dashboard & 3D WebGL Constellation**:
   - Inspect the executive overview hero (`CompletionHub`), KPI stat cards, trend/distribution/comparison charts, and the 3D cohort constellation (plus its WebGL-unavailable fallback state) across different assignment periods and quality/quantity dimensions.
3. **Students, Custom Fields, Groups & Teachers**:
   - Test student roster filtering, 10-digit national ID search, custom field types (text, number, select, boolean, date, restricted fields), soft-delete & restore flows, group membership history (`joined_on` / `left_on`), CSV/XLSX student imports, and teacher profiles.
4. **Scheduling, Sessions, Evaluations, Tasks & Alerts**:
   - Exercise recurring vs. one-off assignments, session generation, session status transitions (`scheduled`, `held`, `moved`, `canceled`), 4-session period bucketing, the session-tied Evaluation Grid (individual vs. group targets, quality/quantity integers, comments, 7-day/1-day score locks, lock override with audit reason), task templates, student tasks, and session alert resolution.
5. **Cafe POS, Stock, Purchases, Balances & Voice Kiosk**:
   - Test cafe catalog management, supplier purchases with stock-movement ledger updates, waste/adjustment recording, student balance top-ups/deductions, POS cash/credit/balance sales, receipt generation, and the voice agent / counter kiosk transcripts and status checklist.
6. **Double-Entry Accounting & Export Center**:
   - Inspect the chart of accounts hierarchy, Cafe-to-Accounting event mappings, automated and manual journal entries, balanced debit/credit triggers, fiscal period lifecycle (`open` / `closed` / overlap prevention), opening entry generation, trial balance / general ledger / P&L reports, and the multi-sheet Export Center.

### Visual Identity, Typography & Layout Audit Criteria
- **Aesthetic Direction & Theme Tokens**: Verify light and dark theme surface tokens (`--bg`, `--surface`, `--border`, `--text`, `--accent`), ensuring proper contrast ratios (WCAG AA 4.5:1) and clean single-elevation card hierarchy across all 26+ views.
- **Typography & Bilingual Hierarchy**: Verify `Vazirmatn` (Persian RTL) and `Manrope` (English LTR) rendering, eastern Arabic numeral formatting (`۰-۹`) vs. Latin numerals, and `tabular-nums` alignment across financial ledgers, score grids, and timestamps.
- **Component Styling, RTL Logical Geometry & Responsiveness**: Inspect desktop (`1440×900`) and mobile (`390×844`) viewports in both `dir="rtl"` and `dir="ltr"` for physical CSS property leaks (`left`/`right` instead of `inset-inline`), horizontal table overflow (`.table-wrap`), sticky column headers in `EvaluationGrid`, modal/drawer focus traps, and topbar title truncation.
- **Interactive Feedback & Motion**: Check page transition animations, `prefers-reduced-motion` handling, custom cursor behavior, inline mutation error scoping, and `ErrorBoundary` recovery states.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Running the Real Express Server on Port 3000 Backed by PGlite**
  - *Chosen Approach*: Use the project's existing PGlite adapter (`createPglitePool`) persisted to a local data directory so the Express server runs on port 3000 and serves the built React frontend plus all `/api/*` routes.
  - *Why*: The container does not run an external PostgreSQL daemon, and PGlite executes genuine PostgreSQL SQL, PL/pgSQL triggers, constraints, and `connect-pg-simple` session queries in-process, letting both you (via the AI Studio preview) and `playwright-cli` interact with the real full-stack application.
  - *Alternatives Considered*: Running only unit tests or static mocks (rejected because it cannot verify real SQL triggers, HTTP middleware, or live browser rendering).

- **Decision 2: Two-Stage Runtime Verification (Unshimmed Crash Reproduction -> Shimmed Deep Inspection)**
  - *Chosen Approach*: First boot the server with raw PGlite/pg date behavior to reproduce and confirm the OID `1082` `Date` serialization crashes on API endpoints and React pages; then enable a runtime-only `--import` hook that returns `YYYY-MM-DD` strings for OID `1082` so we can seed rich test data and inspect all downstream UI states on those pages.
  - *Why*: Strictly honors the "do not change code; confirm findings by running" requirement while preventing one known serialization bug from blocking the live audit of 7+ downstream pages (Sessions, Schedule, Teachers, Cafe Purchases, Cafe Reports, Accounting Periods, Journal, and Reports).
  - *Alternatives Considered*: Leaving the OID `1082` crash active for the entire session (rejected because it would leave the Accounting, Sessions, and Cafe Purchases UIs stuck on `ErrorBoundary` and prevent testing them with real values).

- **Decision 3: Multi-Profile Test Data Seeding Strategy**
  - *Chosen Approach*: Seed not only the baseline sample cohort, but also targeted test values covering edge cases across every module: boundary scores (`min`, `max`, `0`, `null`), locked vs. unlocked sessions, soft-deleted students with non-zero cafe balances, low-stock and out-of-stock cafe items, supplier purchases, waste/adjustments, manual and auto-posted accounting journal entries, open and closed fiscal periods, custom student fields (including restricted fields), and voice agent transcript turns.
  - *Why*: Ensures every table, chart, report, filter, and permission boundary is exercised with realistic data rather than empty states.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Audit Execution Pipeline

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     4-Pass Audit & Live Preview Pipeline                     │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Pass 1: Big Picture (Architecture, Config, Security, Schema & Deps)    │  │
│  │  • 30 SQL migrations, triggers, FK cascades, indexes & invariants      │  │
│  │  • AuthN/AuthZ, CSRF, rate-limits, CSP/Helmet, session & kiosk safety  │  │
│  │  • Express vs. on-device PGlite core service parity & deploy scripts   │  │
│  └───────────────────────────────────┬────────────────────────────────────┘  │
│                                      ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Pass 2: Backend Deep Dive (Routes, Libs, Validation, Core & Agent)     │  │
│  │  • Transaction boundaries, race conditions & trigger error handling    │  │
│  │  • Input validation edge cases, query pagination, N+1s & math accuracy │  │
│  │  • Voice agent dialogue/intent parser, STT/TTS & kiosk HTTP/SSE server │  │
│  └───────────────────────────────────┬────────────────────────────────────┘  │
│                                      ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Pass 3: Frontend Deep Dive (Pages, Components, State, i18n, CSS, A11y) │  │
│  │  • React state/memo bugs, query cache invalidation & error handling    │  │
│  │  • RTL/LTR layout math, responsive tables, focus management & ARIA     │  │
│  │  • Persian/English translation parity & Jalali/Gregorian date logic    │  │
│  └───────────────────────────────────┬────────────────────────────────────┘  │
│                                      ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Pass 4: Live Runtime, Test Seeding & Visual Browser Verification       │  │
│  │  • Run server/client/agent test suites & build production client       │  │
│  │  • Stage A (Unshimmed): Reproduce & confirm OID 1082 date crashes      │  │
│  │  • Stage B (Shimmed on Port 3000): Seed rich multi-module test data,   │  │
│  │    inspect all pages via playwright-cli (FA/EN, Desktop/Mobile),       │  │
│  │    capture console/network logs, and keep port 3000 live for preview   │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Diverse Test Values to Seed for Live Inspection
- **Users & Roles**:
  - `admin` (full Administrator access, password changed from temporary so interactive preview works immediately, plus a secondary user with `must_change_password = true` to test the forced password-change gate).
  - Role-specific accounts: `teacher_eval` (`scores.enter` + `scores.view`), `blind_entry` (`scores.enter` without `scores.view`), `cashier` (Cafe POS + balances), `accountant` (`accounting.view` + `accounting.enter` + `accounting.manage`), and `viewer` (`students.view` + `dashboard.view`).
- **Academic & Cohort Data**:
  - **Students**: 30+ active students across multiple groups with Persian & English names, 10-digit national IDs, birth dates, custom field values (including restricted fields), plus 2 soft-deleted students (one with a negative cafe balance / debt and one with a positive prepayment balance to test the soft-deleted balance leak in reports and opening entries).
  - **Teachers, Intervals & Assignments**: Multiple teachers, weekly/biweekly/one-off intervals, group and individual assignments.
  - **Sessions, Evaluations, Tasks & Alerts**: Held, scheduled, moved, and canceled sessions spanning 3+ periods (12+ non-canceled sessions); evaluation cells covering boundary values (`0`, `min`, `max`, unanswered selected cells, whole-group vs. individual overrides, locked past sessions, and unlocked current sessions); overdue and completed student tasks; open and resolved session alerts.
- **Cafe & Financial Ledger Data**:
  - **Catalog & Stock**: Hot drinks, cold drinks, snacks, and non-tracked items; items above threshold, at low-stock threshold, and at zero stock.
  - **Suppliers, Purchases & Inventory Movements**: Multiple suppliers, posted purchase invoices (cash and credit), waste entries, and manual stock adjustments.
  - **POS Sales & Student Balances**: Cash sales, card sales, student balance sales, credit/debt sales, student top-ups, and debt repayments.
  - **Accounting**: Active chart of accounts, Cafe-to-Accounting mappings, open fiscal period (`1405`) plus a closed prior fiscal period (`1404`) to test closed-period trigger behavior, posted and draft journal entries, and opening balance snapshots.
- **Voice Agent & Kiosk Data**:
  - Sample voice session transcripts (`user`, `assistant`, `tool` turns in Persian and English, with and without retained audio flags) so `AgentPage` and `AgentTranscriptsPage` render populated states.

### Interactive Verification & Reporting Matrix
- Every existing finding in `docs/audit-notes.md` will be re-verified and cross-checked against the live runtime.
- Every additional finding discovered across Passes 1–4 will be documented with:
  - Exact location (`file:line`) or reproduction steps
  - Verification method (`Confirmed by running` vs. `Confirmed by reading code`)
  - Clear explanation of impact and root cause
- Final output will present:
  1. **Problems** ordered by severity (`Critical` → `Major` → `Minor` → `Cosmetic`)
  2. **Suggestions** ordered by value (`Quick Wins` → `Architectural / High-Leverage Improvements`)
  3. **What Could Not Be Checked & Why** (e.g., hardware microphone/speaker loop, live Ollama/piper-tts binaries if not installed in the container, physical LAN printer/TLS proxy).
