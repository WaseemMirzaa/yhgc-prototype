# YHGC — French Localization Audit (untranslated text inventory)

**Date:** 2026-06-11
**Goal:** Convert the YHGC prototype to French — both the **English UI text** and the **English mock/demo data** — across the React admin (`admin-web`) and the Flutter client app (`mobile-app`).

This document is a **page-by-page inventory of every user-facing English string** that needs translating. It is the review artifact: confirm the scope/decisions in §0, then conversion proceeds against this list.

---

## 0. Summary & decisions needed

### Totals (distinct user-facing strings)

| Area | Count | Where |
|---|---:|---|
| Admin UI | ~555 | `admin-web/src/App.tsx` (most), `components/*`, `store/useAppStore.ts` (toasts) |
| Mobile UI | ~250 | `mobile-app/lib/src/app.dart` (~85%), controllers, login gate, fcm service, widgets, label helpers |
| Mock / seed data | ~95–100 | `admin-web/src/data/seed.ts`, `mobile-app/lib/src/data/repository.dart`, `types/mobileAppConfig.ts`, `config/settings.ts` |
| **Total** | **~900** | |

### Key technical findings (affect *how* we translate, not just *what*)

1. **No i18n framework exists.** Every string is an inline literal. The `intl` (Flutter) and `Intl.NumberFormat` (admin) usages are only for number/date formatting, not localization.
2. **Enum → label sites must be translated at the conversion point**, not at each widget, or labels will drift:
   - Mobile: `repository.dart` `_normalizeStatus` / `_invoiceStatusLabel` / `_normalizeDocType`, and `loan_type_label.dart`.
   - Admin: `formatPropertyStatus` (`App.tsx:243`), `LOAN_TYPE_OPTIONS` (`App.tsx:254`), `INVOICE_STATUS_OPTIONS` (`App.tsx:223`).
   - ⚠️ **Consistency risk:** the mobile invoice seed (`_mockInvoicesSeed`) hardcodes labels `"Paid"/"Unpaid"/"Queried"` as data, *and* they are also derived from keys — both paths must use the same French label.
3. **Interpolated / plural strings** need French patterns (gender/plural aware): `"{n} file(s)"`, `"{n} attachments"`, `"Week {n}"`, `"{n} active alerts"`, `"Logged {date} · {n} file(s)"`, `"Programme {n}"`, etc.
4. **Raw enum values shown to users** (need human labels, currently shown verbatim): admin `PropertyEditForm` status `<option>`s (`App.tsx:828-831`: `in_construction`…), client status options (`active/suspended/revoked`, `App.tsx:419-421`).
5. **Currency/locale is hardcoded** `£` / `en-GB`: admin `Intl.NumberFormat("en-GB")` (`App.tsx:232`), `toLocaleString("en-GB")` (`LegalPublicPage.tsx:82`); mobile `_money`/`_moneyLabel` (`repository.dart:567`) + ~6 baked `£…` labels.
6. **`friendlySaveError`** (`useAppStore.ts:178`) may contain additional hardcoded English — flagged for a follow-up pass.

### Decisions that shape the conversion (please confirm — see the questions I'll ask alongside this doc)

- **D1 — Approach:** inline French replacement (fully-French prototype, simplest) **vs.** an i18n layer with an EN/FR toggle.
- **D2 — Locale & currency:** language only (keep `£`, UK addresses/phones/dates) **vs.** full `fr-FR` (`€`, French number/date formats, `+33`, French addresses).
- **D3 — Fictional demo data** (people like "Aarav Shah", companies like "BuildCo Structures Ltd", UK addresses): keep as English **vs.** franco-ize (French names/companies/cities) for an immersive demo.
- **D4 — Real brand names** (HSBC, AXA, Knight Frank, Savills, Zurich, Aviva, RSA, Nationwide, Barclays): keep as-is **vs.** swap for French-market equivalents (BNP Paribas, Crédit Agricole, Foncia, BNP Paribas Real Estate…).

### Things that should **not** be translated (kept verbatim)
Login codes (`YHG-2026-1001`), policy/invoice reference codes, emails, URLs, Firebase keys, Firestore collection/field names, enum *keys* (snake_case), MIME types, ISO dates, the admin password credential.

---

# PART A — ADMIN UI (`admin-web/src`)

> Recurring single-word row buttons (View / Edit / Delete / Cancel / Close / Save) collapse to a handful of unique tokens; listed once per screen with representative lines.

## A1. Login screen
- `App.tsx:1347` — "Admin portal"
- `App.tsx:1348` — "Private Operations Portal"
- `App.tsx:1349` — "Professional control center for portfolio operations, client onboarding, and secure data workflows."
- `App.tsx:1353` — "Secure invitation-only access"
- `App.tsx:1354` — "Unified portfolio controls"
- `App.tsx:1355` — "Professional data and upload workflows"
- `App.tsx:1365` — "Admin portal" · `:1366` — "Welcome" · `:1367` — "Single administrator sign-in."
- `App.tsx:1374` — "Login" (splash) · `:1382` — "Administrator login"
- `App.tsx:1385` — "Email" · `:1394` — "Password" · `:1403` — "Login" (submit)
- `App.tsx:1326` — "Invalid credentials."
- (img alt "YOUR HOME GROUP Consultancy" `:1364/:1381` — brand, see D)

## A2. Top nav / shell / breadcrumbs / global
- `App.tsx:1434` — "Saving changes…" · `:1453` — "Dismiss"
- `App.tsx:1461` — "Admin" · `:1462` — "Operations"
- sidebar nav from `sections` via `replaceAll("_"," ")` (`App.tsx:28-36`): "dashboard","clients","companies","properties","notifications","accountant links","settings"
- `App.tsx:1497` — "Logout"
- `App.tsx:1503` — "Operations Console" · `:1504` — "Your Home Group Consultancy" · `:1505` — "Secure portfolio administration with controlled access."
- `App.tsx:1511` — "Detail navigation" (aria) · `:1518` — "← Back" · `:1523` — "Property not found" · `:1525` — "Details"
- Generic modal: "Close" (`:431, 583, 978, 1015, 1539`)
- Loading screen (`:2866-2870`): "YHGC Admin" / "Loading your dashboard" / "Preparing clients, properties, invoices and alerts..."
- Bootstrap error (`:2885-2897`): "YHGC Admin" / "We could not load your workspace" / "Check your internet connection and Firebase settings in settings.ts, then try again." / "Retry"

## A3. Dashboard / stats
- `App.tsx:2100` — "Portfolio Control Center" · `:2101` — "Full flow admin for clients, companies, properties, uploads, notifications, and accountant links."
- StatCards (`:2105-2109`): "Clients" / "Companies" / "Properties" / "Invoices" / "Notifications"
- `:2113` — "Onboard Client" · `:2114` — "Create client, generate code, and start setup."
- `:2123` — "Update Property" · `:2124` — "Open a property to edit its profile and portfolio records."
- `:2133` — "Manage Alerts" · `:2134` — "Review notifications and accountant links."

## A4. Clients (list, detail, create/edit)
**List** — `:2149` "Clients"; `:2155` "Add client"; `:2163` "Login code: {…}"; `:2164` "Status: {…}"; row actions `:2175-2221` "View/Edit/Delete/Block/Unblock"; `:2189` "Permanently delete client "…" and all companies, properties, invoices, files, and notifications for this client? This cannot be undone."; `:2204` "Block mobile access for {fullName}?"
**Detail** — `:1949` "Client detail"; `:1965` "Block this client? They will be unable to sign in on the mobile app."; `:1971` "Block mobile access"; `:1982` "Restore mobile access"; `:1990` delete-confirm; `:2007` "Status: {…}"; `:2008` "Login code: {…}"; `:2011` "Companies"; `:2018` "No. {companyNumber}"; `:2037` "Delete company "{name}" and all its properties and data?"; `:2051` "All properties for this client"; `:2083` "Delete property "{title}" and all related data?"
**Edit/Add modal** (`ClientEditForm`) — `:2599` "Edit Client: {fullName}"; `:371` "Edit client"; `:379` "Full name"; `:390` "Email"; `:402` "Login code"; `:413` "Status"; `:419-421` "active/suspended/revoked"; `:431` "Close"; `:434` "Save client"; validation `:354` "Enter the client's full name (at least 2 characters).", `:358` "Enter a valid email address.", `:362` "Enter a login code."; Add modal `:2644` "Add client", `:2648` "Client name", `:2649` "Client email", `:2651` "Create client"

## A5. Companies (list, detail, add/edit)
**List** — `:2234` "Companies"; `:2240` "Add company"; `:2247` "No. {companyNumber}"; `:2248` "Client ID: {…}"; `:2273` "Permanently delete company "…" and all its properties, invoices, files, and related data? This cannot be undone."
**Detail** — `:1861` "Company detail"; `:1889` "Delete company"; `:1894` "Client ID: {…}"; `:1895` "Updated: {…}"; `:1898` "Properties"; `:1930` "Delete property "{title}" and all related data?"
**Edit form** (`CompanyEditForm`) — `:2613` "Edit Company: {name}"; `:503` "Edit company"; `:511` "Client"; `:521` "Select client"; `:531` "Company name"; `:542` "Companies House number"; `:553` "Registered address"; `:562` "Directors (one per line)"; `:571` "Next accounts due"; `:589` "Save company"; validation `:475/479/483`
**Add modal** — `:2663` "Add company"; `:2697` "Client"; `:2721` "Company name"; `:2729` "Companies House number"; `:2741` "Add company"; validation `:2674/2678/2682`

## A6. Properties (list, detail, add/edit, details/valuation)
**List** — `:2295` "Properties"; `:2296` "Choose View to work on construction, loans, invoices, and other records in one place. Use Edit profile on that screen (or Edit from the list) to change title, address, and links."; `:2306` "Add property"; `:2335` "Quick edit profile"; `:2343` delete-confirm; shortcuts `:2355` "Operational shortcuts", `:2356` "Same flows as on a property page: pick a property, then log a construction week (with optional files) or add an invoice.", `:2366` "Log a new week", `:2378` "Add invoice"; `:2402` "Add a property before recording invoices."; `:2406` "Property"; `:2411` "Property for this invoice"
**Detail header/overview** — `:1533` "This property is no longer in the snapshot (it may have been removed)."; `:1558` "General documents"; `:1565` "Edit profile"; `:1573` delete-confirm; `:1585` "Overview"; `:1586` long help text; cards `:1593-1620` "Title/Address/Property ID/Type/Status/Linked client/Linked company"; `:1636` "Edit property details" / "Add property details"; `:1650` "General property documents"; `:1671` "Upload general property documents"; `:1676` "Uploaded files (general)"; `:1697` "Records & documents"; `:1698` "Work in one category at a time. Edits save to Firebase as you go."
- `formatPropertyStatus` (`:244-249`): "In construction" / "Fully tenanted" / "Partially tenanted" / "Vacant"
**Record-counts** (`:4184-4199`): "Construction programmes" / "Weekly stages logged" / "Loan records" / "Income rows" / "Invoices" / "Insurance policies" / "Attached files" (+hint "General, construction, loan, invoice PDFs, etc.") / "Records on this property" / "Counts across all categories (open a tab below to view or edit)."
**Valuation summary** (`:4231-4311`): "Valuation & operating summary" / help text / "General documents" / "Edit details"/"Add property details" / "Hero image" / "Purchase price" / "Purchase date" / "Current value" / "Monthly net" / "Refinance date" / "Insurance renewal" / "Tenancy status" / "Managing agent" / "Income to date" / "Costs to date" / "Net position" / `:4266` "Not set"
**Quick-edit form** (`PropertyEditForm`) — `:2628` "Property profile — {title}"; `:738` "Edit property"; labels `:746-958` "Client/Select client/Company/Select company/Title/Address/Property type/Status/Current value/Monthly net (£)/Portfolio & operating summary/Purchase price (£)/Purchase date/Refinance date/Insurance renewal (summary)/Tenancy status/Managing agent/Income to date (£)/Costs to date (£)/Net position (£)"; `:828-831` raw status options (`in_construction`…); `:981` "Save property"; validation `:664-680`
**Add form** (`PropertyFormFields`) — `:2748` "Add property"; `:3292` "Company"; `:3305` "Select company"; `:3354` "Property title"; `:3363` "Address"; `:3372` "Property type"; `:3381` "Status"; `:3387-3390` "In Construction/Fully Tenanted/Partially Tenanted/Vacant"; validation `:3265/3269`; creates notification `:2770` "New property added" / `:2771` "{title} has been added"
**Details modal form** (`PropertyDetailsFieldsForm`) — `:4494` "Details & valuation"; `:4495` "Click Save changes to apply. The read-only summary above updates after you save."; labels `:4514-4642` (Purchase price (£)/Purchase date/Current value (£)/Monthly net (£)/Refinance date/Insurance renewal (summary)/Tenancy status/Managing agent/Income to date (£)/Costs to date (£)/Net position (£)); `:4657` "Save changes"; `:4486` "Nothing to save — add or change a value first, or use Close."; amount validation (`:142-143`) "{label} must be a valid number." / "{label} cannot be negative."

## A7. Property editor tabs
**Tab nav** (`PROPERTY_TAB_NAV`, `:87-97`): "Construction" — "Build programme, weekly stages, and construction photos linked to this property." · "Loan" — "Mortgage, bridging, or other borrowing — amount and monthly payment." · "Income" — "Rental income and operating costs by period." · "Invoices" — "Supplier invoices, references, amounts, and linked PDFs." · "Insurance" — "Policies, insurers, and cover dates for this property."

### Construction (`:6901+`)
- `:6988` "No construction programme for this property yet." · `:6994` "Add construction programme" · `:7005` "Build programmes on this property" · `:7006` "{n} programme(s) linked to this property. Use each row for View, Log a New Week, Edit, or Delete — or expand for a quick preview." · `:7017` "Add another programme"
- `:7044` "Programme {n}" · `:7048` "{n} weeks in programme · {n} week(s) logged" · `:7054` "· start {date}" · `:7060` "· target {date}" · `:7067` "Record: {n} / {total}"
- row actions `:7075-7099` "View programme / Log a New Week / Edit / Delete" · `:7106` "Logged weeks" · `:7121` "Week {n}" · `:7124` "{n} file(s)" · `:7133-7158` "View log / Edit week / Week files / Delete" · `:7152` "Delete this stage and any files attached to it?"
- preview `:7171-7188` "Start / Expected completion / Programme id / Log a new week…" · legacy `:7204` "Property-level construction files (not tied to a week)" / `:7205` help / `:7210` "Legacy construction files"
- Add-programme modal `:7220/7224`; Log-week modal `:7244` "Log a New Week · programme {n}", fields `:7311-7388` ("Week #"/"e.g. 3"/"Upload date"/"Programme id {…}"/"Attachments (optional)"/help/"Choose files"/"Images, PDFs, and other documents."), `:7428` "Remove", `:7442` "Cancel", `:7445` "Saving…"/"Log a New Week"; validation `:7257/7261`
- Week-files modal `:7459` "Week {n} · {date}"; View-week `:7485+`; Edit-week `:7534` "Edit logged week · programme {n}"; View-programme `:7560+` ("Programme {n} · review", Start/Expected completion/Total weeks/Programme id/Logged weeks/"No weeks logged yet."/…); Edit-programme `:7695`; Delete-programme `:7715` "Delete build programme?" + `:7716` body
- Programme fields form (`:8579+`): "Start"/"Expected completion"/"Total weeks"/"Save programme dates"/"Add programme"/"Delete programme"; validation `:8614-8629`
- Stage edit form (`:6823+`): "Week #"/"Upload date"/"Stage id {…}"/"Save week"; validation `:6844/6849`
- Week files card `:5377` "Photos & documents · Week {n} ({date})" / `:5383` "Files for this week"; read-only log `:5407-5435` "Programme/Programme {n}/Week number/Upload date/Stage id/Photo URLs on record/Files for this week"
- Shortcut form (`:5581+`): `:5636` "Add a property before logging construction weeks."; "Property"/"Build programme"/"No programme for this property"/"Programme {n}"/"· starts {date}"/"Week #"/"Upload date"/etc.; validation `:5648-5662`

### Finance / Loan (`:6545+`)
- `:6604` "Loans" · `:6605` "Mortgages, bridging, development finance, or cash purchase — use Add loan for the full form, View for all fields, or Edit on a row." · `:6615` "Add loan" · `:6619` "No loans recorded yet. Use Add loan above."
- table headers `:6627-6632` "Type/Lender/Amount/Monthly/Term end/Actions"; row `:6658-6672` "View/Edit/Delete"
- `:6684` "Property-wide loan documents" / `:6685` help / `:6691` "Upload loan documents (general)" / `:6697` "General loan files"
- View `:6710` "Loan details"/`:6714` "Attached files"/`:6735` "Edit loan"; Add `:6743`; Edit `:6757`; Delete `:6778` "Delete loan?" + `:6780` body
- `LOAN_TYPE_OPTIONS` (`:254-259`): "Mortgage"/"Bridging loan"/"Development finance"/"Cash purchase"; fallback `:267` "Loan"; `:6345` "{label} (legacy)"
- New/Edit forms (`:5873+`/`:6227+`): "Loan type"/"Lender"/"Contact name"/"Contact phone"/"Loan amount (£)"/"Monthly payment (£)"/"Interest %"/"LTV %"/"Term end"/"Upload loan documents"/"Queued files attach after you save the loan (display name is set in the upload dialog)."/"Add loan"/"Save loan"/"Files for this loan"; validation (`:5537-5561`) "Enter the lender or label (at least 2 characters)."/"Enter a loan amount greater than zero."/"Enter a monthly payment greater than zero."/"Choose the term end date."/"Enter a valid interest rate between 0 and 100%."/"Enter a valid LTV between 0 and 100%."
- Read-only (`:6500+`): "Loan type/Lender/Contact name/Contact phone/Loan amount/Monthly payment/Interest/LTV/Term end/Notes/Record id"; `:6534` "Cash purchase — loan amount, monthly payment, interest, LTV, and term end are not stored for this type."

### Income (`:8173+`)
- `:8183` "Add income row" · `:8187` "No income rows yet. Use Add income row above."
- headers `:8193-8196` "Period/Income (£)/Costs (£)/Actions"; row `:8212-8226` "View/Edit/Delete"
- View `:8241` "Income row details"; Add `:8267`; Edit `:8280`; Delete `:8299` "Delete income row?" + `:8300` body
- Forms (`:5061+`/`:8700+`): "Period"/"Income (£)"/"Costs (£)"/"Save income row"/"Add income row"; validation (`:5087-5099`) "Choose the month for this row." / "Choose the month for this income row." / "Enter a valid income amount." / "Enter a valid costs amount." / "Income and costs must each be a non-zero amount (not £0)."
- Read-only (`:5440+`): "Period/Income/Costs/Net/Row id"

### Invoices (`:8331+`)
- `:8340` "Invoices for this property" · `:8341` "Supplier invoices, references, amounts, and linked files — use View for the full record and attachments." · `:8350` "Add invoice" · `:8354` "No invoices recorded yet. Use Add invoice above, then open Edit to attach files."
- headers `:8362-8368` "Supplier/Reference/Date/Amount (£)/Status/Files/Actions"; row `:8422-8436` "View/Edit/Delete"
- View `:8451` "Invoice details"; Add `:8484`; Edit `:8498`; Delete `:8519` "Delete invoice?" + `:8520` body
- `INVOICE_STATUS_OPTIONS` (`:223-227`): "Queried"/"Unpaid"/"Paid"
- New form (`:3397+`): "Supplier"/"Supplier name"/"Default invoice status"/"Stored on the new invoice; you can change it anytime under Edit."/"Reference (optional)"/"INV-0001"/"Date"/"Amount (£)"/"0.00"/"Upload invoice PDFs, images, or scans"/"Files are stored on this invoice after you press Add invoice (display name is set in the upload dialog)."/"Add invoice"; validation `:3450-3459`
- Edit form (`:5161+`): "Supplier"/"Invoice status"/"Reference (optional)"/"Date"/"Amount (£)"/"Save invoice"/"Files for this invoice"; validation `:5205-5214`
- Read-only (`:5459+`): "Supplier/Reference/Invoice date/Amount/Status/Invoice id/Linked PDF: /Open PDF link"; `:8030` "Invoice PDF (link on record)"

### Insurance (`:7747+`)
- `:7810` "Insurance policies" · `:7811` "Policies, cover dates, renewal alerts, and policy documents — use View for read-only details and files, Add insurance policy for the full form, or Edit on a row." · `:7821` "Add insurance policy" · `:7825` "No insurance policies yet. Use Add insurance policy above."
- headers `:7833-7836` "Insurer/Policy/Cover/Actions"; row `:7859-7873` "View/Edit/Delete"
- `:7885` "Property-wide insurance documents" / `:7886` help / `:7891` "Upload insurance documents (general)" / `:7898` "General insurance files"
- View `:7911` "Insurance policy details"/`:7914` "Policy files"/`:7932` "Edit policy"; Add `:7940`; Edit `:7954`; Delete `:7975` "Delete insurance policy?" + `:7976` body
- Forms (`:4663+`/`:4823+`): "Policy {…}"/"New policy"/"Insurer"/"Policy number"/"Cover start"/"Cover end"/"60-day alert"/"14-day alert"/"Save policy"/"Upload documents for this policy"/"Files for this policy"/"Queued files attach after you save the policy (display name is set in the upload dialog)."/"Add policy"; validation `:4719/4867` "Please enter at least the insurer name or the policy number."
- Read-only (`:5490+`): "Insurer/Policy number/Cover/60-day alert/14-day alert/Policy id"

## A8. File upload UI
- `FileUploadForm` (`:8796+`): title slot (varies); `:8845` "You can select several files; each one opens a short dialog to confirm the display name before upload."; `:8853` "Uploading…"; `:8860` "Choose files"; `:8881` "Images, PDFs, and other documents supported."; `:8839` "{n} more file(s) queued after this one."; `:8876` "{n} file(s) queued after the current upload."
- `AssetFileNameEditorModal` (`:3909+`): `:8887` "Confirm upload" / `:4150` "Edit file name"; `:3948` "File name"; `:3964` "Reset to original name"; `:3974` "Cancel"; `:8890/4153` "Upload"/"Save"; `:3982` "Working…"; `:3932` "file"
- `PropertyTabDocuments` (`:4038+`): `:4063` "No files in this category yet."; `:4077` "Open preview"; `:4087/4090` "PDF"/"FILE"; `:4107-4137` "Open/Open in new tab/Edit/Delete"; `:4132` "Remove this file from the snapshot?"
- `PropertyAssetPreviewModal` (`:3990+`): `:3994` "File details"; `:4005` "No inline preview for this file type. Use the link below to open it."; `:4008-4022` "File name/MIME type/Size/Uploaded/Owner/Tag/URL"; `:4031` "Open in new tab"
- Hero picker (`:4319+`): `:4357` "Hero image (optional)"; `:4370` "Uploading…"/"Replace image"/"Choose image"; `:4381` "Remove image"; `:4385` "JPEG, PNG, WebP, or GIF. The URL is stored when you save this form."; errors `:4340/4349`
- Generic upload errors: "Upload failed." (`:3493, 4905, 5688, 5982, 7294, 8902`); `:8825` "File upload is not configured (missing onFileUpload / onFiles)."

## A9. Notifications
- `:2441` "Notifications"; `:2448` "Send notification"; `:2452` "Send manual alert"; `:2471` "Log"; `:2473` "No notifications yet."; `:2493` "Delete"; `:2487` "Remove this notification from the log?"
- `ManualNotificationForm` (`:3045+`): `:3061` "Add at least one client before sending manual alerts."; `:3088` "The alert is logged and queued for the selected client."; "Client"/"Select client"/"Title"/"Body"/"Send alert"; validation `:3069-3077`

## A10. Accountant links + read-only portal
**List** (`:2503+`): "Accountant Links"/"Share with accountant"/"No accountant links yet."/"Revoked"/"Active"/"Scope ID: {…}"/"Expires: {…}"/"Token: {…}"/"Restore link"/"Block portal access"/"Delete"; `:2549` "Revoke this accountant link? The portal will deny access."; `:2563` "Permanently delete this accountant link from the list? (Revoked links can be removed this way.)"
**Generate panel** (`:3660+`): "Share with accountant"/"Link ready"/"Share this read-only URL with your accountant. It expires at the date you chose and can be revoked from the list anytime."/"Copy link"/"Done"/"Copied to clipboard."/"Select the link above to copy manually."/"Accountants open a secure read-only portal scoped to one company (all linked properties) or a single property. Choose what they should see, then set how long access stays valid."/"Add at least one company or property before generating a link."/"What should the accountant see?"/"Single property (one address / asset)"/"Whole company (all properties under that company)"/"Company"/"Property"/"No companies/properties in the portfolio yet."/"Access expires"/"Default is 30 days from now. Shorter is safer for one-off reviews."/"Create link"; validation `:3755/3760`
**Read-only portal** (`AccountantReadonlyPortal`, `:2904+`): "Accountant Link Invalid"/"This link is missing, expired, or revoked."/"YHGC Accountant Portal"/"Read-only shared view"/"Scope: {…} • Expires: {…}"/"not set"; StatCards "Companies/Properties/Invoices/Files"; tables "Companies"(Name/No/Accounts Due) / "Properties"(Title/Address/Status/Current Value) / "Invoices"(Supplier/Ref/Date/Amount/Status) / "Files"(Owner/Tag/File/URL/Path); `:3880` "No records yet."

## A11. Mobile app settings panel
- Wrapper `:2588` "Mobile app settings" / `:2589` "Control client self-signup, privacy policy, and terms of service shown in the mobile app."
- `MobileAppSettingsPanel.tsx`: `:33` "Mobile app settings saved." · `:35` "Could not save settings. Try again." · `:42` "Loading mobile app settings…" · `:50` "Mobile account creation" · `:51` "When disabled, the mobile app hides all self-signup UI. Toggle allowMobileSignup in Firestore appConfig/mobile or here." · `:63` "Allow clients to create accounts from the mobile app" · `:68` "Privacy policy (HTML)" · `:70/118` "Public page: " · `:78/126` "Path" · `:86` "Optional external URL (redirects instead of on-site HTML page)" · `:95/143` "Title" · `:103/151` "HTML content" · `:108/156` placeholders · `:111/159` "Preview" · `:116` "Terms of service (HTML)" · `:134` "Optional external URL" · `:169` "Saving…"/"Save mobile settings"

## A12. Legal public pages
- `LegalPublicPage.tsx`: `:53` "Loading…" · `:62` "Redirecting…" · `:72` "YHGC Client" · `:82` "Last updated {date}" (`toLocaleString("en-GB")` — locale)
- `HtmlLegalPreview.tsx`: `:12` "No content yet." · `:9` title slot ("Preview")

## A13. Toasts / confirms / errors (store + dialogs)
**Themed dialogs**: `:2803` "Delete Property" / `:2807` "Property: {title}" / `:2815` "Cancel" / `:2822` "Delete property"; `:2829` "Confirm Action" / `:2838` "Cancel" / `:2845` "Confirm"
**`actionNotice` toasts** (`useAppStore.ts`): "Nothing to save yet…" (`:335`) · "All changes were saved." (`:344`) · "Please enter the client's full name and email address." (`:351`) · "Client added." (`:364`) · "Choose a client, then enter the company name and Companies House number." (`:371`) · "Company added." (`:383`) · "Choose a client and company, then enter the property title and address." (`:390`) · "Property added." (`:404`) · "Client updated." (`:413`) · "Company updated." (`:424`) · "Property updated." (`:433`) · "Notification added." (`:442`) · "Accountant link created." (`:458`) · "Accountant link updated." (`:467`) · "Open a property first, then add the invoice from that property." (`:478`) · "Please enter the supplier name, invoice date, and an amount greater than zero." (`:479`) · "Invoice added." (`:498`) · "File entry added." (`:518`) · "This build programme no longer exists, so the week could not be logged." (`:527`) · "Please pick an upload date for this week." (`:533`) · "Week number must be 1 or higher." (`:537`) · "Open a property first, then add a build programme from there." (`:567`) · "Open a property first, then add the loan from that property." (`:605`) · "Loan added." (`:617`) · "Open a property first, then add the income row from that property." (`:634`) · "Please choose a month and enter valid income and cost amounts." (`:642/674`) · "Income and costs must each be a non-zero amount (not £0)." (`:651/683`) · "Open a property first, then add insurance from that property." (`:696`) · "Insurance policy added." (`:707`) · "Invoice updated." (`:723`) · "Invoice removed." (`:735`) · "Finance record removed." (`:745`) · "Income row removed." (`:754`) · "Insurance policy removed." (`:764`) · "File details updated." (`:773`) · "File removed." (`:782`) · "Client and related records removed." (`:790`) · "Company and related records removed." (`:798`) · "Property and related records removed." (`:806`) · "Notification removed." (`:818`) · "Accountant link removed." (`:830`) · "Construction programme removed." (`:847`) · "Construction stage removed." (`:868`) · "That week entry could not be found. Refresh the page and try again." (`:877`) · "Please choose an upload date." (`:886`) · "Week number must be 1 or higher." (`:890`) · "Construction week updated." (`:898`)
**Persist-error humanizer** (`useAppStore.ts:177-194`): `:185` "Cloud save could not finish (some fields were empty or unsupported). Your edits are still on this page—try Save again, or refresh once if it keeps happening." · `:188` "You do not have permission to save. Check you are signed in with an account that can edit data." · `:191` "Network problem while saving. Check your connection and try again." · plus `friendlySaveError` fallback (follow-up).

---

# PART B — MOBILE UI (`mobile-app/lib`)

> ~85% of strings are in `src/app.dart`. Many appear on both property-level and global Invoices screens (mark-paid dialog, popup-menu items, "All/Paid/Unpaid/2026" chips).

## B1. Splash
- `app.dart:265` — "Your wealth, managed\nwith precision and discretion" · `:276` — "YHG Portfolio v1.0" · `:162` — "YOUR HOME GROUP Consultancy" (a11y)

## B2. Login / first-login / set-password / sign-up / forgot-password
**Login**: `app.dart:351` "YHGC Portfolio" · `:373` "Welcome back" · `:374` "Private client access only" · `:386` "LOGIN CODE" · `:387` "Enter your issued code" · `:390` "PASSWORD" · `:418` "LOG IN" · `:420` "Forgot password?" · `:429` "Create a new account" · `:442` "FIRST LOGIN\nEnter your login code and you will be prompted to create your own password.\nCode is single-use." · snackbars `:398` "Missing code"/"Enter your login code.", `:404` "Cannot continue", `:415` "Login failed"
**First-login/set-password**: `:758` "First Login" · `:772` "Set your password" · `:773` "Secure your private portfolio access" · `:780` "New password" · `:794` "Setting up your session..." · `:818` "Save" · `:814` "Invalid"
**Sign-up**: `:533` "Create account" · `:554` "Create your account" · `:555` "Register for private portfolio access" · `:563` "FULL NAME" · `:568` "EMAIL" · `:571` "PASSWORD" · `:576` "CONFIRM PASSWORD" · `:587` "I accept the " · `:591/596` "Privacy Policy" · `:611` "I accept the " · `:615/620` "Terms of Service" · `:640` "Creating your account..." · `:672` "CREATE ACCOUNT" · `:668` "Cannot create account"
**Forgot-password**: `:705` "Forgot Password" · `:719` "Password reset" · `:720` "We will send a reset link to your email" · `:727` "Registered email" · `:738` "Send reset link" · `:732` "Missing email"/"Please enter your registered email." · `:735` "Reset sent"/"Reset link sent to {email}"
**Auth-controller messages** (`auth_controller.dart`): `:64` "Use first login with your invite code, then set a password." · `:67` "Enter your password, or leave it empty to set up access with your invite code." · `:70` "Access denied." · `:72/158` "Client record is incomplete. Contact your adviser." · `:77` "Password not set yet. Leave password blank to create one." · `:82` "Invalid password." · `:96` "Unknown or blocked login code." · `:98` "Password already set. Enter your password to login." · `:114` "You must accept the Privacy Policy and Terms of Service." · `:116` "Passwords do not match." · `:118` "App settings are still loading. Please try again." · `:122` "Account creation from the app is disabled. Contact your adviser for a login code." · `:129` "Could not create account." · `:133` "Account was created but is incomplete. Contact your adviser." · `:151` "Password must be at least 8 characters." · `:155` "This login code is no longer valid." · `:161` "Password already set. Please login with your password."
**Login-gate messages** (`client_login_gate.dart`): `:117` "Enter your login code." · `:125/152/189` "Unknown login code." · `:141` "This account is suspended. Contact your adviser." · `:146` "This account has been revoked. Contact your adviser." · `:161/165` "Portfolio not provisioned." · `:184` "Client record is incomplete. Contact your adviser." · `:192` "Unable to verify login. Check your connection." · `:278` "Enter your full name." · `:280` "Enter a valid email address." · `:283` "Password must be at least 8 characters." · `:298` "Account creation from the app is disabled. Contact your adviser for a login code." · `:303` "An account with this email already exists. Try logging in." · `:326` "No client account found." · `:362` "Could not delete your account. Check your connection and try again."

## B3. Home / dashboard
- `app.dart:902` "YHGC Portfolio" · `:913` "Open alerts" · `:849` "Loading your portfolio..." · `:952` "TOTAL PORTFOLIO VALUE" · `:960` "Monthly change currently unavailable" · `:961` "▲ {+amount} this month" · `:969` "Net Income" · `:970` "Expenditure" · `:971` "Assets" · `:978` "Your Companies" · `:979` "Tap a company to view portfolio" · `:988` "Co. No. {companyNo}"

## B4. Company screen
- `app.dart:1018` "Company" · `:1019` "This company is no longer in your portfolio." · `:1031` "Company Overview" · `:1032` "Live portfolio structure and status" · `:1044` "Directors: {directors}" · `:1045` "Accounts due: {dueDate}" · `:1049` "PROPERTIES" / "All linked assets" · `:1055` "{address} · {type}"

## B5. Property detail + 6 tabs
**Tab labels** (`:1213-1218`): "Overview" / "Construction" / "Loan" / "Income" / "Invoices" / "Insurance"
**Overview**: `:1224-1275` "Address/Property type/Current value/Portfolio status/Tenancy/Purchase price/MORTGAGE/Mortgage/OTHER BORROWING/Costs to date (incl. finance)/Costs to date/Insurance renewal/Managing agent/Income to date/Net position/Progress/Linked invoices/Linked documents" · `:1284-1286` "projected income/costs (incl. finance)/net position" · `:1292` "PROPERTY FILES"
**Construction**: `:1312` "OVERALL PROGRESS" · `:1330` "Last update" · `:1331` "Logged construction weeks" · `:1335` "PROPERTY-LEVEL CONSTRUCTION" · `:1351` "No construction weeks logged yet" · `:1357` "Week {n}" · `:1360` "Logged {date}" · `:1361` "Logged {date} · {n} file(s)" · `:1367` "No files uploaded for this week"
**Loan**: `:1384` "Borrowing on this property (from admin). Type, facility size, and monthly payment." · `:1389` "No loans from admin yet." · `:1399` "Facility {amount}" · `:1400` "PCM {amount}" · `:1407` "No facility documents linked" · `:1423` "No loan documents uploaded" · `:1430/1597` "Uploaded {date}"
**Income**: `:1438-1442` "Current monthly net/Annual income/Supplier costs (invoices)/Loan / finance (pcm)/Costs to date (incl. 12 mo finance)" · `:1445` "No income rows from admin yet" · `:1450` "Period {period}" · `:1451` "Income {amount} · Costs {amount}" · `:1457` "INCOME FILES"
**Invoices (property)**: `:1471-1474` "Invoice count/Total committed (invoices)/Paid amount/Pending amount" · `:1479-1482` "All/Paid/Unpaid/2026" · `:1502` "{n} attachments" · `:1530/2064` "Open file" · `:1532/2066` "Mark as paid" · `:1534/2068` "Mark as unpaid" · `:1546` "+ INVITE ACCOUNTANT" · mark-paid dialog `:1101/1963` "Mark as paid?" / `:1102/1964` "Confirm you have paid {supplier} ({ref})." / `:1104/1966` "Cancel" / `:1105/1967` "Mark paid" / `:1118/1980` "Marked as paid"/"Marked as unpaid" · accountant-link dialog `:1133` "Accountant link created" / `:1144` "Open link" / `:1148` "Done"
**Insurance**: `:1550-1552` "Policies (admin)/Insurance documents/Last insurance update" · `:1560` "Policy" · `:1563-1566` "Ref {policyNumber}/From {date}/To {date}/{n} file(s)" · `:1573` "No policy documents linked" · `:1589` "No insurance files uploaded"

## B6. Global Documents tab
- `app.dart:1788` "Documents" · `:1826` "Document Hub" · `:1827` "Filter and browse all uploaded files" · `:1837` "Total {n}" · `:1847` "All Property Documents" · `:1859/1878` "Document type" · `:1866/1887` "Property" · `:1898` "No documents found for selected filters." · `:1905` "{type} • {address} • Uploaded {date}" · `:1916` "Linked asset files" · `:1921` "No matching linked files for selected filters." · `:1767/1768` "All"

## B7. Global Invoices tab
- `app.dart:1988/1999` "Invoices" · `:2000` "Realtime payable and paid records" · `:2004` "Total value £{amount}" · `:2009-2012` "All/Paid/Unpaid/2026" · (shared menu/dialog/snackbar per B5)

## B8. Notifications / Alerts tab
- `app.dart:2110` "Alerts" · `:2123` "Progress update available" · `:2125` "{progress}% complete for {address}" · `:2139` "Invoice pending" · `:2140` "{supplier} • £{amount}" · `:2153` "No alerts right now" · `:2165` "Alert Center" · `:2166` "Important live portfolio updates" · `:2170` "{n} active alerts" · FCM fallbacks `fcm_service.dart:126` "Portfolio update" / `:127` "Your adviser has sent an update."

## B9. Account / profile / legal
- `app.dart:2237/2245` "Account" · `:2246` "Access mode and connected portfolio" · `:2252` "Client" · `:2258` "Portfolio scope" · `:2259` "{n} properties • {n} invoices" · `:2268` "Logout" · `:2277` "Delete Account" · delete dialog `:2205` "Delete account" / `:2206` "This removes your mobile app access, clears your session, and revokes login credentials. Portfolio records managed by your adviser may remain on file. This cannot be undone." / `:2211` "Cancel" / `:2215` "Delete account" / `:2225` "Delete failed" / `:2229` "Account deleted"/"Your app account access has been removed." · Legal viewer title passed in ("Privacy Policy"/"Terms of Service")

## B10. Shared widgets
- Bottom nav (`:878-882`): "Home"/"Documents"/"Invoices"/"Alerts"/"Account"
- Invoice attachments (`:63/91`): "No file"/"No attachment is linked to this invoice yet."/"Attachment {n}"
- Portfolio files (`:112/130`): "No files"/"Nothing to open here yet."/"Choose a file"
- File opener (`portfolio_file_opener.dart:72/127/135`): "Could not load image"/"Open or download (browser)"/"Share link"

## B11. Validation / labels (controllers + helpers)
- `app_controller.dart:143` "Could not update this invoice." · `:153` "Update failed. Please try again."
- Repository display labels (`repository.dart`): `:549` "Paid" · `:551/555` "Unpaid" · `:553` "Queried" · `:1313/1321` "In Construction" · `:1315` "Fully Tenanted" · `:1317` "Partially Tenanted" · `:1319` "Vacant" · `:1326` "General" · `:123` "Company" · `:138` "Update" · `:260/345` "Document"/"File"
- Loan-type labels (`loan_type_label.dart:5-13`): "Mortgage"/"Bridging loan"/"Development finance"/"Cash purchase"/"Loan"

---

# PART C — MOCK / SEED DATA

## C1. `admin-web/src/data/seed.ts` (canonical seed)
- **Client**: `:13` "Aarav Ventures Ltd" · `:14` "aarav@example.com" · `:15` "YHG-2026-1001"
- **Company**: `:24` "11223344" · `:25` "Aarav Holdings UK Ltd" · `:26` "10 Bishopsgate, London" · `:27` "Aarav Shah"
- **Properties**: p1 `:37-49` "Office Block - Manchester"/"22 Market St, Manchester"/"Commercial"/"Pre-let agreed (anchor tenant)"/"Knight Frank Manchester" · p2 `:58-70` "Riverside Apartments - Leeds"/"8 Wharf Approach, Leeds"/"Residential (BTR)"/"Fully let (98% occupancy)"/"Savills Residential" · p3 `:79-91` "Industrial unit – Sheffield Parkway"/"Unit 4B, Europa Link, Sheffield S9 1XZ"/"Industrial"/"Two of six units let; marketing active"/"CBRE Industrial North"
- **Finance/Loan** (`:179-219`): "HSBC UK Bank plc"/"Sarah Mitchell" · "Metro Capital Partners"/"James Okonkwo" · "Nationwide Building Society"/"Priya Nair" · "Direct buyer"/"Oliver Trent"
- **Invoices** (`:278-334`): suppliers "BuildCo Structures Ltd"/"Northern Scaffold Co"/"MEP Design Partners"/"Leeds Facilities Management"/"Yorkshire Window Co"/"Sheffield Electrical Services"/"Yorkshire Roofing Ltd"; refs "BC-440"/"NSC-2026-118"/"MEP-7781"/"LFM-Q1-992"/"YWC-4410"/"SES-8891"/"YRL-2026-03"
- **Insurance** (`:345-376`): "AXA Commercial"/"AXA-COM-9921" · "Zurich Construction"/"ZUR-CAR-44102" · "Aviva Property Owners"/"AVI-PO-883341" · "RSA Commercial"/"RSA-IND-77221"
- **Documents/Assets** (17 filenames, `:389-565`): "Property information memorandum.pdf"/"Planning consent summary.pdf"/"Week 3 site photos.zip"/"HSBC facility letter (signed).pdf"/"BuildCo_BC-440_scan.pdf"/"AXA schedule of cover.pdf"/"Zurich CAR certificate.pdf"/"Tenant handbook 2026.pdf"/"Snagging list phase A.pdf"/"Service charge budget.xlsx"/"LFM_Q1-992_receipt.pdf"/"Aviva policy schedule.pdf"/"Lease schedule units 1-6.pdf"/"Fit-out programme week 1.pdf"/"Barclays facility summary.pdf"/"SES_8891_scan.pdf"/"RSA industrial combined.pdf"

## C2. `mobile-app/lib/src/data/repository.dart` (MockRepository — parity subset + labels)
- Company `:620-623`; Invoices `_mockInvoicesSeed` `:632-683` (suppliers/refs + baked status labels "Unpaid"/"Paid"/"Queried"); Properties p1/p2 `:724-755` (titles/addresses/types + **status display labels** + **`£…` money labels**); Documents `:765-814` (names + types "General/Construction/Finance/Invoice/Insurance"); Files `_mockFilesSeed` `:827-893` (7 filenames); Finance `:909-936`; Insurance `:961-981`
- Engine labels & money: `:139` "Update" · `:549-553` "Paid/Unpaid/Queried" · `:567` `£` (`_moneyLabel`) · `:1313-1321` property status labels · `:1326` "General" · fallbacks `:123` "Company"/`:138` "Update"/`:260` "Document"/`:345` "File"

## C3. `admin-web/src/types/mobileAppConfig.ts` (default legal content)
- Titles `:20` "Privacy Policy" · `:32` "Terms of Service"
- Privacy body (`:21-29`, ~6 sentences incl. "…respects your privacy.", "We collect the information you provide…", "We do not sell your personal data.", mailto literal)
- Terms body (`:33-41`, ~7 sentences incl. "By using the YHGC client application you agree to these terms.", "You are responsible for keeping your password confidential.", "We may suspend access for security, non-payment, or breach of these terms.")
- ~130 words total HTML; preserve tags + mailto; brand "YOUR HOME GROUP Consultancy"/"YHGC" recurs.

## C4. `admin-web/src/config/settings.ts`
- `:29` `adminPortalUser.fullName` "YOUR HOME GROUP Consultancy" (brand) · `:27` email (literal) · `:28` password (credential — do NOT translate)

---

## Appendix — conversion checklist (once decisions are confirmed)
- [ ] Admin: `App.tsx` (all sections A1–A13), `components/MobileAppSettingsPanel.tsx`, `LegalPublicPage.tsx`, `HtmlLegalPreview.tsx`, `store/useAppStore.ts` (toasts + persist humanizer + `friendlySaveError`), enum-label maps (`formatPropertyStatus`, `LOAN_TYPE_OPTIONS`, `INVOICE_STATUS_OPTIONS`), raw `<option>` labels.
- [ ] Mobile: `app.dart` (B1–B10), `auth_controller.dart`, `app_controller.dart`, `client_login_gate.dart`, `fcm_service.dart`, `portfolio_file_opener.dart`, `loan_type_label.dart`, `repository.dart` normalizers + fallbacks.
- [ ] Data: `seed.ts`, `repository.dart` mock seeds, `mobileAppConfig.ts` legal content, `settings.ts` brand name.
- [ ] Locale (if D2 = full fr-FR): money formatters (`Intl.NumberFormat`, `_money`/`_moneyLabel`), date formatters (`toLocaleString`), phone/address data.
- [ ] Keep consistent: invoice status labels across the mobile seed *and* the key-derived path.
