# YHGC — Prototype plan & flows (v1 only)

**Sources:** `YHGC_App_Brief_Final (2).docx` (April 2026 developer brief + screen mockups), `yhgc-website-v4 (3).html` (marketing site; **ignore v2** and any copy that conflicts with the brief, e.g. website “secure messaging” — brief specifies **no in-app messaging**, push only).

**Goal:** Admin (React) + client app (Flutter) **prototypes** with **dummy local state** (JSON / in-memory / local files), **no Firebase yet**. Include **multi-file & multi-image upload** per **client** and per **property/project** in admin UI (stored locally as blobs/base64 or `file://` references for demo).  
**Later:** This document doubles as a **Firebase integration checklist** (Firestore paths, Storage layout, Auth, FCM).

---

## 1. Product summary (v1)

- **Private, invitation-only** portfolio app for YHGC clients: one place for portfolio value, income/expenditure, construction progress, finance, insurance, documents, invoices.
- **Clients:** read-only; created by admin; login **code** (e.g. `YHG-YEAR-NNNN`) + password (set on first login); forgot password → email on file.
- **Accountants:** **no app account** — **magic link** (JWT-style in production) to **invoices only**, expiring (e.g. 90 days), revocable.
- **Admin (web):** full CRUD on clients, companies, properties, all tab data, uploads, construction stages, notifications log, accountant links.
- **Push (real implementation):** FCM; triggers listed in brief (prototype can **simulate** with a local “notifications” list).

**Explicitly out of scope (v2 roadmap — do not build):** Open Banking, client document upload area, in-app subscription billing, portfolio PDF export, valuation history graph, multi-currency, P&L auto PDF, etc. Data model should **allow** extension later without redesign.

---

## 2. User flows (high level)

### 2.1 Client (Flutter)

1. **Splash** → logo, quote, “Register interest” (opens `yhgc.co.uk`), **Log in** (no self-signup).
2. **Login** → code + password → session (prototype: mock “success” after fixed demo credentials or any code).
3. **First login (brief):** code validates → **set password** → home (prototype: one extra screen).
4. **Home / dashboard** → portfolio banner (totals), **company cards** (name, # properties, last updated), bell for notifications.
5. **Bottom nav:** Home | Documents (all properties) | Invoices (aggregate) | Notifications | Account.
6. **Company** → profile (from **Companies House** in prod; prototype: mock JSON from admin-entered company number).
7. **Property list** (YHGC-managed only) → card: hero image, address, type, **status badge**, key stats.
8. **Property detail** → hero + **6 tabs:** Details | Construction | Finance | Income | Invoices | Insurance.
9. **Construction:** progress ring + timeline + **weekly stages**; each stage **multiple photos**; % = `100 ÷ totalWeeks` per weekly upload (prototype: advance on “admin uploaded stage” in dummy data).
10. **Invoices tab** → list + PDF view + **Invite accountant** (prototype: generate fake link + copy).
11. **Account** → profile, logout, legal (prototype minimal).

### 2.2 Admin (React)

1. **Login** (prototype: simple mock gate or no auth; document real **Firebase Auth** later — separate admin role).
2. **Clients** → list → create/edit → **generate login code**, suspend/revoke, register email for reset.
3. **Client detail** → companies, **attachments** (multiple files/images at client level).
4. **Companies** → add CH number (prototype: paste JSON or “fetch mock”); link to client.
5. **Properties** → under company; hero image; type; **status**; **attachments** at property level.
6. **Property editor — 6 tabs** (all fields from brief):  
   - Details (address, dates, values, insurance renewal, tenancy, agent, income/costs, net card)  
   - Construction (start/end, **total weeks**, stages with **multi-photo**)  
   - Finance (lender fields + **document folder**)  
   - Income (rows + chart data — static JSON in prototype)  
   - Invoices (rows + PDFs)  
   - Insurance (fields + **document folder** + renewal dates for alert simulation)
7. **Notifications** (prototype): table of “would send” events; manual “send test” optional.
8. **Accountant links** → list active/expired, revoke (prototype: local tokens).

### 2.3 Accountant (browser — can be minimal HTML route in React admin or separate thin view)

1. Open link → **invoices list only** for one company/property scope (as per token payload).

---

## 3. Information architecture (entities)

| Entity | Parent | Notes |
|--------|--------|--------|
| Client | — | login code, email, status, profile |
| ClientAttachment | Client | multi file/image |
| Company | Client | CH number, cached CH profile (mock) |
| Property | Company | hero, status enum, tab payloads |
| PropertyAttachment | Property | tagged: finance / insurance / invoice / general |
| ConstructionProject | Property | start, end, totalWeeks |
| ConstructionStage | Project | week index, date, **photos[]** |
| Invoice | Property | metadata + file ref |
| IncomeRow | Property | month, amounts |
| Notification | Client | type, title, body, read |
| AccountantLink | Company or Property | token, expiry, scope |

**Status badges:** In Construction | Fully Tenanted | Partially Tenanted | Vacant (admin-set).

### 3.1 Field-level data models (for app + admin)

Use these as the shared contract between React admin and Flutter app (local JSON first, Firestore later).

```ts
type ID = string;
type ISODate = string; // e.g. 2026-04-24
type DateTime = string; // ISO timestamp

type UserRole = "admin" | "client";
type ClientStatus = "active" | "suspended" | "revoked";
type PropertyStatus = "in_construction" | "fully_tenanted" | "partially_tenanted" | "vacant";
type InvoiceStatus = "paid" | "unpaid" | "queried";
type AttachmentTag = "general" | "finance" | "insurance" | "invoice" | "construction";

interface Client {
  id: ID;
  fullName: string;
  email: string;
  phone?: string;
  loginCode: string; // YHG-YEAR-NNNN
  status: ClientStatus;
  createdAt: DateTime;
  updatedAt: DateTime;
}

interface Company {
  id: ID;
  clientId: ID;
  companyNumber: string;
  name: string;
  registeredAddress?: string;
  directors?: string[];
  incorporationDate?: ISODate;
  nextAccountsDueDate?: ISODate;
  lastUpdatedAt: DateTime;
}

interface Property {
  id: ID;
  clientId: ID;
  companyId: ID;
  title: string;
  address: string;
  propertyType: string;
  status: PropertyStatus;
  heroImageAssetId?: ID;
  purchaseDate?: ISODate;
  purchasePrice?: number;
  currentValue?: number;
  refinanceDate?: ISODate;
  insuranceRenewalDate?: ISODate;
  tenancyStatus?: string;
  managingAgent?: string;
  totalIncomeToDate?: number;
  totalCostToDate?: number;
  netPosition?: number;
  createdAt: DateTime;
  updatedAt: DateTime;
}

interface ConstructionProject {
  id: ID;
  propertyId: ID;
  startDate: ISODate;
  expectedCompletionDate: ISODate;
  totalWeeks: number;
  currentWeek: number;
  progressPercent: number; // derive: completedStages / totalWeeks * 100
  lastUpdatedAt?: DateTime;
}

interface ConstructionStage {
  id: ID;
  projectId: ID;
  weekNumber: number;
  uploadDate: ISODate;
  percentageAtStage: number;
  photoAssetIds: ID[]; // multiple images per week
}

interface FinanceRecord {
  id: ID;
  propertyId: ID;
  financeType?: "bridge" | "mortgage" | "cash";
  lenderName?: string;
  lenderContactName?: string;
  lenderContactPhone?: string;
  loanAmount?: number;
  monthlyPayment?: number;
  interestRatePct?: number;
  ltvPct?: number;
  termEndDate?: ISODate;
  documentAssetIds: ID[];
}

interface IncomeRow {
  id: ID;
  propertyId: ID;
  period: string; // YYYY-MM
  incomeAmount: number;
  costAmount: number;
  netAmount: number;
}

interface Invoice {
  id: ID;
  propertyId: ID;
  supplierName: string;
  invoiceRef: string;
  invoiceDate: ISODate;
  amount: number;
  status: InvoiceStatus;
  pdfAssetId: ID;
}

interface InsuranceRecord {
  id: ID;
  propertyId: ID;
  insurerName?: string;
  policyNumber?: string;
  coverStartDate?: ISODate;
  coverEndDate?: ISODate;
  renewal60DayAlertOn?: ISODate;
  renewal14DayAlertOn?: ISODate;
  documentAssetIds: ID[];
}

interface Asset {
  id: ID;
  ownerType: "client" | "property" | "construction_stage" | "invoice";
  ownerId: ID;
  tag: AttachmentTag;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  urlOrPath: string; // local blob/base64 now, Firebase Storage URL later
  createdAt: DateTime;
}

interface Notification {
  id: ID;
  clientId: ID;
  type:
    | "construction_update"
    | "new_document"
    | "new_invoice"
    | "insurance_60"
    | "insurance_14"
    | "construction_complete"
    | "new_property_added";
  title: string;
  body: string;
  isRead: boolean;
  createdAt: DateTime;
}

interface AccountantLink {
  id: ID;
  scopeType: "company" | "property";
  scopeId: ID;
  token: string;
  expiresAt: DateTime;
  isRevoked: boolean;
  createdAt: DateTime;
}
```

---

## 4. Multi-upload requirement (prototype + Firebase prep)

- **Admin UI:** drag-drop or file picker, **multiple files**, show list with remove; **images** show thumbnails.  
- **Prototype storage:** e.g. `IndexedDB` / `localStorage` (small limits) / **download JSON export** — pick one per sprint; simplest is **in-memory + export/import JSON** with base64 for small demos.  
- **Firebase (later):**  
  - **Storage paths:** `clients/{clientId}/...`, `properties/{propertyId}/finance/...`, `.../construction/week_{n}/...`, `.../invoices/...`  
  - **Firestore:** metadata documents with `storagePath`, `mimeType`, `size`, `createdAt`, `tag`.  
  - **Rules:** client read only own subtree; admin full; accountant read only invoice paths for token scope.

---

## 5. Design alignment

- **Brand:** crimson `#8B1A1A`, gold `#C9A96E`, dark/black from site; app surfaces **lighter** (brief: white/off-white) for readability.  
- **Typography:** serif headings (Georgia / Cormorant), sans body (Inter / Montserrat).  
- **Website sections** (for tone only): Philosophy, Services, Process, Ecosystem, Exclusivity, Assets, Portfolio App, Register — no need to replicate site inside admin/app.

---

## 6. Prototype build order (suggested)

1. **Shared dummy JSON schema** (single source exported from admin, importable in app — optional).  
2. **React admin:** layout + Clients → Companies → Properties → 6-tab editor + uploads.  
3. **Flutter app:** splash → login → dashboard → company → property → tabs (read-only).  
4. **Accountant view:** one read-only invoices route fed by same dummy data / query param token.  
5. **Doc pass:** map each screen to future **Firestore collections** and **FCM** trigger types.

---

## 7. Firebase integration checklist (when you leave prototype)

- [ ] Firebase project, iOS/Android app ids for Flutter; web app for React admin.  
- [ ] **Auth:** client email/password or custom token after code verification; admin users (custom claims `admin: true`).  
- [ ] **Firestore** collections mirroring §3; security rules per clientId.  
- [ ] **Storage** rules aligned to §4 paths.  
- [ ] **Companies House** API from client app only (or callable from backend) — confirm rate limits.  
- [ ] **FCM** topics or per-user tokens; server/Cloud Functions for insurance date cron + upload triggers.  
- [ ] **Accountant links:** signed URL or short-lived custom token + Cloud Function to mint JWT.  
- [ ] **No v2** features in first release; keep fields nullable for future bank link etc.

---

## 8. Mock data seeds (for demos)

- 1–2 clients, 1–2 companies each, 2–3 properties with mixed statuses.  
- One property **in construction** with 3–4 stages and multiple photos.  
- Finance/insurance folders with 2+ PDF placeholders.  
- 3+ invoices with paid/unpaid.  
- One active accountant link.

---

## 9. Detailed flow map (final implementation blueprint)

### 9.1 Admin flows (React + Tailwind)

#### A) Admin authentication and session
1. Open admin URL.
2. Read `USE_MOCKED_BACKEND` from settings config.
3. If `true`: use local mock auth (fixed admin user).
4. If `false`: use Firebase Auth sign-in for admin account.
5. Resolve role guard (`admin` claim or mock role).
6. Enter dashboard.

#### B) Client creation flow
1. Admin opens `Clients` list.
2. Click `Create Client`.
3. Fill: name, email, phone (optional), status default `active`.
4. System generates login code (`YHG-YYYY-XXXX`).
5. Save client.
6. System writes client entity and notification log entry.
7. Optional: add client-level attachments (multiple files/images).

#### C) Company setup flow
1. Open client detail.
2. Click `Add Company`.
3. Enter company number + optional manual metadata.
4. Mock mode: auto-fill from local CH response map.
5. Firebase mode: same structure, still write to Firestore.
6. Save company under selected client.

#### D) Property setup flow
1. Open company detail.
2. Click `Add Property`.
3. Fill base fields: address, type, status, hero image.
4. Save property.
5. Auto-create empty records for 6 tabs.
6. Property appears in company property list and dashboard counters.

#### E) Property 6-tab editor flow
1. Open property editor.
2. Tab `Details`: edit values, dates, tenancy, agent, net summary.
3. Tab `Construction`: set project start/end/total weeks.
4. Add stage upload (week number + date + many photos).
5. System auto-computes progress = `completedStages / totalWeeks * 100`.
6. Tab `Finance`: lender fields + multiple docs upload.
7. Tab `Income`: add monthly income/cost rows; derive net.
8. Tab `Invoices`: add invoice meta + PDF upload + status.
9. Tab `Insurance`: policy data + cover dates + docs.
10. Save each tab independently and with full-page save.

#### F) Notifications and alerts flow
1. System creates notification events on:
   - construction stage upload
   - finance/insurance document upload
   - invoice upload
   - new property assignment
2. Renewal alert simulator:
   - if cover end in 60 days => create `insurance_60`
   - if cover end in 14 days => create `insurance_14`
3. Admin can view all sent events and manually create one.

#### G) Accountant link flow
1. Open invoice tab or accountant links module.
2. Click `Generate link` with scope (company/property).
3. Set expiry (default 90 days).
4. Generate token + URL.
5. Copy/share link.
6. Revoke link anytime.
7. Link view shows invoices only.

#### H) Upload management flow (critical)
1. Drag/drop multiple files.
2. Validate size/type.
3. Create local preview for images.
4. Tag attachment (`finance`, `insurance`, `invoice`, `construction`, `general`).
5. Save attachment metadata + storage path reference.
6. Remove/replace file supported.

### 9.2 Mobile app flows (Flutter + GetX)

#### A) Splash and entry
1. Show branded splash screen.
2. Buttons: `Register Interest` (open web URL), `Log In`.
3. No self-signup route.

#### B) Login and first-time setup
1. Enter login code + password.
2. First login path:
   - verify code
   - set new password
   - continue to dashboard
3. Forgot password path:
   - request reset to registered email.

#### C) Main dashboard flow
1. Load client summary (portfolio totals).
2. Show company cards with last updated info.
3. Show unread notification indicator.
4. Bottom nav active across all app pages.

#### D) Company and property browsing
1. Tap company card.
2. Show company profile (CH metadata from stored fields).
3. List YHGC-managed properties only.
4. Tap property card => property details.

#### E) Property tabs flow
1. Details tab: read-only key metrics.
2. Construction tab:
   - ring progress
   - timeline
   - weekly stages list with multiple photos
   - gallery viewer per stage.
3. Finance tab: lender info + document list.
4. Income tab: monthly rows + visual summary.
5. Invoices tab: list/filter/status + PDF preview.
6. Insurance tab: policy + renewal highlights + docs.

#### F) Global Documents and Invoices
1. Documents tab aggregates docs across accessible properties.
2. Invoices tab aggregates all invoices with filters.
3. Tap to open inline viewer.

#### G) Notifications and account
1. Notifications list ordered latest first.
2. Mark read on open.
3. Account page: profile summary + logout.

### 9.3 Accountant web flow
1. Open tokenized URL.
2. Validate token + expiry + revoked flag.
3. Load invoices for scope only.
4. Allow view/download PDF.
5. Block all other modules.

---

## 10. Dual-backend architecture (mock + firebase, no index-based querying dependency)

### 10.1 Settings-driven backend switch
- Admin: `USE_MOCKED_BACKEND` in config.
- Flutter: `MOCKED` compile/runtime constant.
- Single repository interfaces; two implementations:
  - `Mock*Repository`
  - `Firebase*Repository`

### 10.2 Query strategy without index-dependent patterns
- Prefer direct document fetch by id and deterministic parent-child paths.
- Use path-scoped reads (`clients/{id}/companies`, `companies/{id}/properties`).
- Avoid compound `where + orderBy` dependencies.
- Keep list sorting/filtering in application layer when needed.
- Use cached denormalized summary docs for dashboard counters.

### 10.3 Storage strategy
- Mock mode: browser storage / local file refs / base64 previews.
- Firebase mode: Storage for binaries, Firestore for metadata only.
- Keep attachments normalized in `assets` records.

### 10.4 Offline and consistency approach
- Mock: local-first with autosave.
- Firebase: optimistic UI + rollback on failure.
- Standard result envelope for all repos: `{ok, data, error}`.

---

## 11. Build plan (execution order)

### Phase 1: Monorepo and contracts
- Create `admin-web/`, `mobile-app/`, `shared-spec/`.
- Add model schemas, enums, sample seed data.
- Add backend switch settings in both apps.

### Phase 2: Admin MVP complete
- Dashboard + client/company/property CRUD.
- 6-tab property editor.
- Multi-upload module.
- Notifications log and accountant links.

### Phase 3: Mobile MVP complete
- Splash, auth, dashboard, company, property tabs.
- Docs/invoices/notifications/account flows.
- Gallery and PDF preview.

### Phase 4: Firebase implementation layer
- Auth + Firestore + Storage + FCM integration.
- Keep same UI and same repository interfaces.
- Validate parity with mock behavior.

### Phase 5: Hardening and UAT
- Full flow QA against this document.
- Seed data scripts for demos.
- Build instructions for admin web and Flutter app.

---

## 12. Definition of done (100% flow match)

- All flows in section 9 implemented and navigable.
- Both backends operational via boolean switch.
- No v2 feature leakage.
- Multi-image and multi-file uploads working across required modules.
- Property construction auto-progress logic working exactly as defined.
- Accountant scoped invoice access working with revoke and expiry.
- UI follows provided brand and app screen intent.

---

*Detailed plan finalized. Next step: implementation starts with project scaffolding and shared contracts.*
