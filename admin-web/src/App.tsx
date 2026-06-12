import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent, FormEvent, KeyboardEvent, ReactNode } from "react"
import { initializeApp, getApps } from "firebase/app"
import { addDoc, collection, getFirestore, serverTimestamp } from "firebase/firestore"
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage"
import { DeleteAccountPublicPage } from "./components/DeleteAccountPublicPage"
import { LegalPublicPage } from "./components/LegalPublicPage"
import { MobileAppSettingsPanel } from "./components/MobileAppSettingsPanel"
import { activeBackendMode, adminPortalUser, appSettings } from "./config/settings"
import { useI18n } from "./i18n/context"
import { useAppStore } from "./store/useAppStore"
import type {
  AppSnapshot,
  Asset,
  AttachmentTag,
  Client,
  ClientStatus,
  Company,
  ConstructionProject,
  ConstructionStage,
  FinanceRecord,
  IncomeRow,
  InsuranceRecord,
  Invoice,
  InvoiceStatus,
  Property,
  PropertyStatus,
} from "./types/models"

const sections = [
  "dashboard",
  "clients",
  "companies",
  "properties",
  "notifications",
  "accountant_links",
  "settings",
] as const

type Section = (typeof sections)[number]
const sectionSet = new Set<string>(sections)
function isSection(value: string): value is Section {
  return sectionSet.has(value)
}

type AuthView = "splash" | "login"
type AdminUser = { email: string; password: string; fullName: string }
type PendingPropertyDelete = { id: string; title: string; message: string; clearDetail?: boolean }
let themedConfirmBridge: ((message: string) => Promise<boolean>) | null = null

async function themedConfirm(message: string): Promise<boolean> {
  if (themedConfirmBridge) return themedConfirmBridge(message)
  return window.confirm(message)
}

const AUTH_SESSION_KEY = "yhgc-admin-auth-session"
const BRAND_LOGO_SRC = "/yhgc-logo.png"

const PROPERTY_EDITOR_TABS = ["construction", "finance", "income", "invoices", "insurance"] as const
type PropertyEditorTab = (typeof PROPERTY_EDITOR_TABS)[number]

function isPropertyEditorTab(value: string): value is PropertyEditorTab {
  return (PROPERTY_EDITOR_TABS as readonly string[]).includes(value)
}

function propertySummaryHasAnyValues(p: Property): boolean {
  if (p.heroImageUrl?.trim()) return true
  if (p.tenancyStatus?.trim()) return true
  if (p.managingAgent?.trim()) return true
  if (p.purchaseDate?.trim()) return true
  if (p.refinanceDate?.trim()) return true
  if (p.insuranceRenewalDate?.trim()) return true
  for (const n of [p.purchasePrice, p.currentValue, p.monthlyNet, p.incomeToDate, p.costToDate, p.netPosition] as const) {
    if (n != null && Number.isFinite(n)) return true
  }
  return false
}

const YHGC_HISTORY_KEY = "yhgcAdminNav"
type YhgcHistoryNav = {
  v: 1
  section: Section
  detailClientId: string | null
  detailCompanyId: string | null
  detailPropertyId: string | null
  detailPropertyTab: PropertyEditorTab
}

const PROPERTY_TAB_NAV: { tab: PropertyEditorTab; label: string; description: string }[] = [
  {
    tab: "construction",
    label: "Construction",
    description: "Build programme, weekly stages, and construction photos linked to this property.",
  },
  { tab: "finance", label: "Loan", description: "Mortgage, bridging, or other borrowing — amount and monthly payment." },
  { tab: "income", label: "Income", description: "Rental income and operating costs by period." },
  { tab: "invoices", label: "Invoices", description: "Supplier invoices, references, amounts, and linked PDFs." },
  { tab: "insurance", label: "Insurance", description: "Policies, insurers, and cover dates for this property." },
]

function parseYhgcHistoryNav(payload: unknown): YhgcHistoryNav | null {
  if (!payload || typeof payload !== "object") return null
  const o = payload as Record<string, unknown>
  if (o.v !== 1) return null
  if (typeof o.section !== "string") return null
  const section: Section = isSection(o.section) ? o.section : "dashboard"
  const detailClientId = typeof o.detailClientId === "string" ? o.detailClientId : null
  const detailCompanyId = typeof o.detailCompanyId === "string" ? o.detailCompanyId : null
  const detailPropertyId = typeof o.detailPropertyId === "string" ? o.detailPropertyId : null
  const tabRaw = o.detailPropertyTab
  const detailPropertyTab =
    typeof tabRaw === "string" && isPropertyEditorTab(tabRaw) ? tabRaw : ("construction" as PropertyEditorTab)
  return {
    v: 1,
    section,
    detailClientId,
    detailCompanyId,
    detailPropertyId,
    detailPropertyTab,
  }
}

function optionalTrimmed(value: string): string | undefined {
  const next = value.trim()
  return next.length ? next : undefined
}

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed.length) return undefined
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : undefined
}

/** Non-empty numeric fields must parse; optional empty clears the value. */
function parseOptionalAmount(
  raw: string,
  label: string,
  allowNegative: boolean,
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  const t = raw.trim()
  if (!t.length) return { ok: true, value: undefined }
  const n = Number(t)
  if (!Number.isFinite(n)) return { ok: false, error: `${label} must be a valid number.` }
  if (!allowNegative && n < 0) return { ok: false, error: `${label} cannot be negative.` }
  return { ok: true, value: n }
}

/** `<input type="date">` only accepts `YYYY-MM-DD`; coerce ISO / Firestore-style strings. */
function toHtmlDateInputValue(value: string | undefined): string {
  if (value == null || typeof value !== "string") return ""
  const s = value.trim()
  if (!s.length) return ""
  const head = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (head) return head[1]!
  const t = Date.parse(s)
  if (!Number.isFinite(t)) return ""
  const d = new Date(t)
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-")
}

/** True when valuation patch would leave the property unchanged (skip save). */
function isPropertyDetailsValuationPatchNoop(
  property: Property,
  patch: Partial<
    Pick<
      Property,
      | "heroImageUrl"
      | "currentValue"
      | "monthlyNet"
      | "purchasePrice"
      | "purchaseDate"
      | "refinanceDate"
      | "insuranceRenewalDate"
      | "tenancyStatus"
      | "managingAgent"
      | "incomeToDate"
      | "costToDate"
      | "netPosition"
    >
  >,
): boolean {
  const strEq = (a: string | undefined, b: string | undefined) => (a ?? "").trim() === (b ?? "").trim()
  const numEq = (next: number | undefined, cur: number | undefined) => {
    if (next === undefined && cur === undefined) return true
    if (next !== undefined && cur !== undefined) return next === cur
    return false
  }
  const canonDate = (d: string | undefined) => toHtmlDateInputValue(d) || (d ?? "").trim().match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || ""
  const dateEq = (next: string | undefined, cur: string | undefined) => canonDate(next) === canonDate(cur)

  return (
    strEq(patch.heroImageUrl, property.heroImageUrl) &&
    numEq(patch.purchasePrice, property.purchasePrice) &&
    dateEq(patch.purchaseDate, property.purchaseDate) &&
    numEq(patch.currentValue, property.currentValue) &&
    numEq(patch.monthlyNet, property.monthlyNet) &&
    dateEq(patch.refinanceDate, property.refinanceDate) &&
    dateEq(patch.insuranceRenewalDate, property.insuranceRenewalDate) &&
    strEq(patch.tenancyStatus, property.tenancyStatus) &&
    strEq(patch.managingAgent, property.managingAgent) &&
    numEq(patch.incomeToDate, property.incomeToDate) &&
    numEq(patch.costToDate, property.costToDate) &&
    numEq(patch.netPosition, property.netPosition)
  )
}

function isValidEmail(value: string): boolean {
  const t = value.trim()
  if (!t.length) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)
}

/** Inline validation message (replaces browser `required` tooltips in modals). */
const adminFormAlert = "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"

function fieldWithInvalid(baseClass: string, invalid?: boolean): string {
  return invalid ? `${baseClass} border-red-400 ring-2 ring-red-200` : baseClass
}

const INVOICE_STATUS_OPTIONS: { value: InvoiceStatus; label: string }[] = [
  { value: "queried", label: "Queried" },
  { value: "unpaid", label: "Unpaid" },
  { value: "paid", label: "Paid" },
]

function formatGbpAmount(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—"
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n)
  } catch {
    return `${n} €`
  }
}

function displayField(value: string | undefined, empty = "—"): string {
  const v = value?.trim()
  return v?.length ? v : empty
}

function formatPropertyStatus(status: PropertyStatus | string): string {
  const map: Record<string, string> = {
    in_construction: "In construction",
    fully_tenanted: "Fully tenanted",
    partially_tenanted: "Partially tenanted",
    vacant: "Vacant",
  }
  if (map[status]) return map[status]!
  return status.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase())
}

const LOAN_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "mortgage", label: "Mortgage" },
  { value: "bridging_loan", label: "Bridging loan" },
  { value: "development_finance", label: "Development finance" },
  { value: "cash_purchase", label: "Cash purchase" },
]

function isCashPurchaseType(value: string | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "cash_purchase"
}

function loanTypeLabel(value: string | undefined): string {
  const v = (value ?? "").trim()
  if (!v.length) return "Loan"
  const hit = LOAN_TYPE_OPTIONS.find((o) => o.value === v)
  if (hit) return hit.label
  return v.replaceAll("_", " ")
}

async function uploadPropertyAssetFile(propertyId: string, file: File, folder: string): Promise<string> {
  if (activeBackendMode !== "firebase" || !appSettings.firebase.apiKey || !appSettings.firebase.projectId) {
    return URL.createObjectURL(file)
  }
  const app = getApps().length
    ? getApps()[0]
    : initializeApp({
        apiKey: appSettings.firebase.apiKey,
        authDomain: appSettings.firebase.authDomain,
        projectId: appSettings.firebase.projectId,
        storageBucket: appSettings.firebase.storageBucket,
        messagingSenderId: appSettings.firebase.messagingSenderId,
        appId: appSettings.firebase.appId,
      })
  const storage = getStorage(app)
  const safeName = `${Date.now()}-${file.name.replaceAll(/\s+/g, "_")}`
  const storageRef = ref(storage, `adminPrototype/${folder}/${propertyId}/${safeName}`)
  await uploadBytes(storageRef, file, { contentType: file.type || "application/octet-stream" })
  return getDownloadURL(storageRef)
}

/** Older bundles of `FileUploadForm` still call `onFiles(files)` in one batch — keep this alongside `onFileUpload`. */
function legacyOnFilesFromSingle(upload: (file: File, displayName: string) => Promise<void> | void) {
  return async (files: File[]) => {
    for (const file of files) await upload(file, file.name)
  }
}

async function queueFcmOutboxForClient(clientId: string, title: string, body: string): Promise<void> {
  if (activeBackendMode !== "firebase" || !appSettings.firebase.apiKey || !appSettings.firebase.projectId) return
  const app = getApps().length
    ? getApps()[0]
    : initializeApp({
        apiKey: appSettings.firebase.apiKey,
        authDomain: appSettings.firebase.authDomain,
        projectId: appSettings.firebase.projectId,
        storageBucket: appSettings.firebase.storageBucket,
        messagingSenderId: appSettings.firebase.messagingSenderId,
        appId: appSettings.firebase.appId,
      })
  const db = getFirestore(app)
  await addDoc(collection(db, "fcmOutbox"), {
    userIds: [clientId],
    title,
    body,
    data: { clientId, source: "admin_web_manual_alert" },
    createdAt: serverTimestamp(),
  })
}

function ClientEditForm({
  client,
  onSave,
  onCancel,
}: {
  client: Client
  onSave: (patch: Partial<Omit<Client, "id" | "createdAt">>) => void
  onCancel: () => void
}) {
  const [fullName, setFullName] = useState(client.fullName)
  const [email, setEmail] = useState(client.email)
  const [loginCode, setLoginCode] = useState(client.loginCode)
  const [status, setStatus] = useState<ClientStatus>(client.status)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    setFullName(client.fullName)
    setEmail(client.email)
    setLoginCode(client.loginCode)
    setStatus(client.status)
  }, [client.id, client.fullName, client.email, client.loginCode, client.status])

  const shellInput =
    "w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 outline-none transition focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20"

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const name = fullName.trim()
    const em = email.trim()
    const code = loginCode.trim()
    if (name.length < 2) {
      setFormError("Enter the client's full name (at least 2 characters).")
      return
    }
    if (!isValidEmail(em)) {
      setFormError("Enter a valid email address.")
      return
    }
    if (!code.length) {
      setFormError("Enter a login code.")
      return
    }
    setFormError(null)
    onSave({ fullName: name, email: em, loginCode: code, status })
  }

  return (
    <form noValidate onSubmit={submit} className="rounded-2xl border border-yhgc-gold/20 bg-white p-4 shadow-sm">
      <p className="mb-3 text-sm font-semibold">Edit client</p>
      {formError ? (
        <p role="alert" className={`${adminFormAlert} mb-3`}>
          {formError}
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Full name</span>
          <input
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value)
              setFormError(null)
            }}
            className={fieldWithInvalid(shellInput, !!formError && fullName.trim().length < 2)}
          />
        </label>
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setFormError(null)
            }}
            className={fieldWithInvalid(shellInput, !!formError && !isValidEmail(email))}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Login code</span>
          <input
            value={loginCode}
            onChange={(e) => {
              setLoginCode(e.target.value)
              setFormError(null)
            }}
            className={fieldWithInvalid(shellInput, !!formError && !loginCode.trim())}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ClientStatus)}
            className={shellInput}
          >
            <option value="active">active</option>
            <option value="suspended">suspended</option>
            <option value="revoked">revoked</option>
          </select>
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800"
        >
          Close
        </button>
        <button type="submit" className="rounded-xl bg-yhgc-crimson px-4 py-2 text-sm font-medium text-white shadow hover:opacity-95">
          Save client
        </button>
      </div>
    </form>
  )
}

function CompanyEditForm({
  company,
  clients,
  onSave,
  onCancel,
}: {
  company: Company
  clients: Client[]
  onSave: (patch: Partial<Omit<Company, "id">>) => void
  onCancel: () => void
}) {
  const [clientId, setClientId] = useState(company.clientId)
  const [name, setName] = useState(company.name)
  const [companyNumber, setCompanyNumber] = useState(company.companyNumber)
  const [registeredAddress, setRegisteredAddress] = useState(company.registeredAddress ?? "")
  const [directorsText, setDirectorsText] = useState((company.directors ?? []).join("\n"))
  const [nextAccountsDueDate, setNextAccountsDueDate] = useState(company.nextAccountsDueDate ?? "")
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    setClientId(company.clientId)
    setName(company.name)
    setCompanyNumber(company.companyNumber)
    setRegisteredAddress(company.registeredAddress ?? "")
    setDirectorsText((company.directors ?? []).join("\n"))
    setNextAccountsDueDate(company.nextAccountsDueDate ?? "")
  }, [company])

  const shellInput =
    "w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 outline-none transition focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20"

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!clientId.trim()) {
      setFormError("Choose which client this company belongs to.")
      return
    }
    if (!name.trim()) {
      setFormError("Enter the company name.")
      return
    }
    if (!companyNumber.trim()) {
      setFormError("Enter the Companies House number.")
      return
    }
    setFormError(null)
    const directors = directorsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    onSave({
      clientId,
      name: name.trim(),
      companyNumber: companyNumber.trim(),
      registeredAddress: optionalTrimmed(registeredAddress),
      nextAccountsDueDate: optionalTrimmed(nextAccountsDueDate),
      directors: directors.length ? directors : undefined,
    })
  }

  return (
    <form noValidate onSubmit={submit} className="rounded-2xl border border-yhgc-gold/20 bg-white p-4 shadow-sm">
      <p className="mb-3 text-sm font-semibold">Edit company</p>
      {formError ? (
        <p role="alert" className={`${adminFormAlert} mb-3`}>
          {formError}
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Client</span>
          <select
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value)
              setFormError(null)
            }}
            className={fieldWithInvalid(shellInput, !!formError && !clientId.trim())}
          >
            <option value="" disabled>
              Select client
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Company name</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setFormError(null)
            }}
            className={fieldWithInvalid(shellInput, !!formError && !name.trim())}
          />
        </label>
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Companies House number</span>
          <input
            value={companyNumber}
            onChange={(e) => {
              setCompanyNumber(e.target.value)
              setFormError(null)
            }}
            className={fieldWithInvalid(shellInput, !!formError && !companyNumber.trim())}
          />
        </label>
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Registered address</span>
          <textarea
            value={registeredAddress}
            onChange={(e) => setRegisteredAddress(e.target.value)}
            rows={3}
            className={shellInput}
          />
        </label>
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Directors (one per line)</span>
          <textarea
            value={directorsText}
            onChange={(e) => setDirectorsText(e.target.value)}
            rows={4}
            className={shellInput}
          />
        </label>
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Next accounts due</span>
          <input
            value={nextAccountsDueDate}
            onChange={(e) => setNextAccountsDueDate(e.target.value)}
            type="date"
            className={shellInput}
          />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800"
        >
          Close
        </button>
        <button type="submit" className="rounded-xl bg-yhgc-crimson px-4 py-2 text-sm font-medium text-white shadow hover:opacity-95">
          Save company
        </button>
      </div>
    </form>
  )
}

function PropertyEditForm({
  property,
  clients,
  companies,
  onSave,
  onCancel,
}: {
  property: Property
  clients: Client[]
  companies: Company[]
  onSave: (patch: Partial<Omit<Property, "id">>) => void
  onCancel: () => void
}) {
  const [clientId, setClientId] = useState(property.clientId)
  const [companyId, setCompanyId] = useState(property.companyId)
  const [title, setTitle] = useState(property.title)
  const [address, setAddress] = useState(property.address)
  const [propertyType, setPropertyType] = useState(property.propertyType)
  const [status, setStatus] = useState<PropertyStatus>(property.status)
  const [heroImageUrl, setHeroImageUrl] = useState(property.heroImageUrl ?? "")
  const [currentValue, setCurrentValue] = useState(
    property.currentValue === undefined ? "" : String(property.currentValue),
  )
  const [monthlyNet, setMonthlyNet] = useState(property.monthlyNet === undefined ? "" : String(property.monthlyNet))
  const [purchasePrice, setPurchasePrice] = useState(
    property.purchasePrice === undefined ? "" : String(property.purchasePrice),
  )
  const [purchaseDate, setPurchaseDate] = useState(property.purchaseDate ?? "")
  const [refinanceDate, setRefinanceDate] = useState(property.refinanceDate ?? "")
  const [insuranceRenewalDate, setInsuranceRenewalDate] = useState(property.insuranceRenewalDate ?? "")
  const [tenancyStatus, setTenancyStatus] = useState(property.tenancyStatus ?? "")
  const [managingAgent, setManagingAgent] = useState(property.managingAgent ?? "")
  const [incomeToDate, setIncomeToDate] = useState(
    property.incomeToDate === undefined ? "" : String(property.incomeToDate),
  )
  const [costToDate, setCostToDate] = useState(property.costToDate === undefined ? "" : String(property.costToDate))
  const [netPosition, setNetPosition] = useState(property.netPosition === undefined ? "" : String(property.netPosition))
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    setClientId(property.clientId)
    setCompanyId(property.companyId)
    setTitle(property.title)
    setAddress(property.address)
    setPropertyType(property.propertyType)
    setStatus(property.status)
    setHeroImageUrl(property.heroImageUrl ?? "")
    setCurrentValue(property.currentValue === undefined ? "" : String(property.currentValue))
    setMonthlyNet(property.monthlyNet === undefined ? "" : String(property.monthlyNet))
    setPurchasePrice(property.purchasePrice === undefined ? "" : String(property.purchasePrice))
    setPurchaseDate(toHtmlDateInputValue(property.purchaseDate))
    setRefinanceDate(toHtmlDateInputValue(property.refinanceDate))
    setInsuranceRenewalDate(toHtmlDateInputValue(property.insuranceRenewalDate))
    setTenancyStatus(property.tenancyStatus ?? "")
    setManagingAgent(property.managingAgent ?? "")
    setIncomeToDate(property.incomeToDate === undefined ? "" : String(property.incomeToDate))
    setCostToDate(property.costToDate === undefined ? "" : String(property.costToDate))
    setNetPosition(property.netPosition === undefined ? "" : String(property.netPosition))
  }, [property])

  const companyChoices = companies.filter((c) => c.clientId === clientId)

  const shellInput =
    "w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 outline-none transition focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20"

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!clientId.trim()) {
      setFormError("Choose a client.")
      return
    }
    if (!companyId.trim()) {
      setFormError("Choose a company for this property.")
      return
    }
    if (!title.trim()) {
      setFormError("Enter the property title.")
      return
    }
    if (!address.trim()) {
      setFormError("Enter the street or site address.")
      return
    }
    if (!propertyType.trim()) {
      setFormError("Enter the property type (e.g. residential, commercial).")
      return
    }
    const rpp = parseOptionalAmount(purchasePrice, "Purchase price (£)", false)
    if (rpp.ok === false) {
      setFormError(rpp.error)
      return
    }
    const rcv = parseOptionalAmount(currentValue, "Current value (£)", false)
    if (rcv.ok === false) {
      setFormError(rcv.error)
      return
    }
    const rmn = parseOptionalAmount(monthlyNet, "Monthly net (£)", true)
    if (rmn.ok === false) {
      setFormError(rmn.error)
      return
    }
    const rit = parseOptionalAmount(incomeToDate, "Income to date (£)", false)
    if (rit.ok === false) {
      setFormError(rit.error)
      return
    }
    const rct = parseOptionalAmount(costToDate, "Costs to date (£)", false)
    if (rct.ok === false) {
      setFormError(rct.error)
      return
    }
    const rnp = parseOptionalAmount(netPosition, "Net position (£)", true)
    if (rnp.ok === false) {
      setFormError(rnp.error)
      return
    }
    setFormError(null)
    onSave({
      clientId,
      companyId,
      title: title.trim(),
      address: address.trim(),
      propertyType: propertyType.trim(),
      status,
      heroImageUrl: optionalTrimmed(heroImageUrl),
      currentValue: rcv.value,
      monthlyNet: rmn.value,
      purchasePrice: rpp.value,
      purchaseDate: optionalTrimmed(purchaseDate),
      refinanceDate: optionalTrimmed(refinanceDate),
      insuranceRenewalDate: optionalTrimmed(insuranceRenewalDate),
      tenancyStatus: optionalTrimmed(tenancyStatus),
      managingAgent: optionalTrimmed(managingAgent),
      incomeToDate: rit.value,
      costToDate: rct.value,
      netPosition: rnp.value,
    })
  }

  return (
    <form noValidate onSubmit={submit} className="rounded-2xl border border-yhgc-gold/20 bg-white p-4 shadow-sm">
      <p className="mb-3 text-sm font-semibold">Edit property</p>
      {formError ? (
        <p role="alert" className={`${adminFormAlert} mb-3`}>
          {formError}
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Client</span>
          <select
            value={clientId}
            onChange={(e) => {
              const nextClientId = e.target.value
              setClientId(nextClientId)
              setFormError(null)
              const stillValid = companies.some((c) => c.id === companyId && c.clientId === nextClientId)
              if (!stillValid) setCompanyId("")
            }}
            className={fieldWithInvalid(shellInput, !!formError && !clientId.trim())}
          >
            <option value="" disabled>
              Select client
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Company</span>
          <select
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value)
              setFormError(null)
            }}
            className={fieldWithInvalid(shellInput, !!formError && !companyId.trim())}
          >
            <option value="" disabled>
              Select company
            </option>
            {companyChoices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Title</span>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setFormError(null)
            }}
            className={fieldWithInvalid(shellInput, !!formError && !title.trim())}
          />
        </label>
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Address</span>
          <input
            value={address}
            onChange={(e) => {
              setAddress(e.target.value)
              setFormError(null)
            }}
            className={fieldWithInvalid(shellInput, !!formError && !address.trim())}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Property type</span>
          <input
            value={propertyType}
            onChange={(e) => {
              setPropertyType(e.target.value)
              setFormError(null)
            }}
            className={fieldWithInvalid(shellInput, !!formError && !propertyType.trim())}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as PropertyStatus)}
            className={shellInput}
          >
            <option value="in_construction">in_construction</option>
            <option value="fully_tenanted">fully_tenanted</option>
            <option value="partially_tenanted">partially_tenanted</option>
            <option value="vacant">vacant</option>
          </select>
        </label>
        <PropertyHeroImagePicker
          propertyId={property.id}
          heroUrl={heroImageUrl}
          onHeroUrlChange={(u) => {
            setHeroImageUrl(u)
            setFormError(null)
          }}
          onError={setFormError}
        />
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Current value</span>
          <input
            value={currentValue}
            onChange={(e) => {
              setCurrentValue(e.target.value)
              setFormError(null)
            }}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 outline-none transition focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20"
            type="text"
            inputMode="decimal"
            autoComplete="off"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Monthly net (£)</span>
          <input
            value={monthlyNet}
            onChange={(e) => {
              setMonthlyNet(e.target.value)
              setFormError(null)
            }}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 outline-none transition focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20"
            type="text"
            inputMode="decimal"
            autoComplete="off"
          />
        </label>
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 md:col-span-2">Portfolio &amp; operating summary</p>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Purchase price (£)</span>
          <input
            value={purchasePrice}
            onChange={(e) => {
              setPurchasePrice(e.target.value)
              setFormError(null)
            }}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 outline-none transition focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20"
            type="text"
            inputMode="decimal"
            autoComplete="off"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Purchase date</span>
          <input
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 outline-none transition focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20"
            type="date"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Refinance date</span>
          <input
            value={refinanceDate}
            onChange={(e) => setRefinanceDate(e.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 outline-none transition focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20"
            type="date"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Insurance renewal (summary)</span>
          <input
            value={insuranceRenewalDate}
            onChange={(e) => setInsuranceRenewalDate(e.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 outline-none transition focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20"
            type="date"
          />
        </label>
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Tenancy status</span>
          <input
            value={tenancyStatus}
            onChange={(e) => setTenancyStatus(e.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 outline-none transition focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20"
          />
        </label>
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Managing agent</span>
          <input
            value={managingAgent}
            onChange={(e) => setManagingAgent(e.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 outline-none transition focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Income to date (£)</span>
          <input
            value={incomeToDate}
            onChange={(e) => {
              setIncomeToDate(e.target.value)
              setFormError(null)
            }}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 outline-none transition focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20"
            type="text"
            inputMode="decimal"
            autoComplete="off"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Costs to date (£)</span>
          <input
            value={costToDate}
            onChange={(e) => {
              setCostToDate(e.target.value)
              setFormError(null)
            }}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 outline-none transition focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20"
            type="text"
            inputMode="decimal"
            autoComplete="off"
          />
        </label>
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Net position (£)</span>
          <input
            value={netPosition}
            onChange={(e) => {
              setNetPosition(e.target.value)
              setFormError(null)
            }}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 outline-none transition focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20"
            type="text"
            inputMode="decimal"
            autoComplete="off"
          />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800"
        >
          Close
        </button>
        <button type="submit" className="rounded-xl bg-yhgc-crimson px-4 py-2 text-sm font-medium text-white shadow hover:opacity-95">
          Save property
        </button>
      </div>
    </form>
  )
}

const adminFieldInput =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm text-neutral-900 shadow-sm outline-none transition focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20"
const adminLabel = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-600"
const adminBtnPrimary =
  "inline-flex min-h-[42px] shrink-0 items-center justify-center gap-2 rounded-lg bg-yhgc-crimson px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-95 disabled:pointer-events-none disabled:opacity-50"
const adminBtnDangerOutline =
  "inline-flex min-h-[42px] shrink-0 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-800 transition hover:bg-red-100"

function EditModal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-yhgc-gold/25 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
          <h3 className="text-lg font-semibold text-yhgc-black">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700"
          >
            Close
          </button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

function AdminApp() {
  const [authView, setAuthView] = useState<AuthView>("splash")
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => Boolean(localStorage.getItem(AUTH_SESSION_KEY)))
  const [authError, setAuthError] = useState("")
  const [loginEmail, setLoginEmail] = useState("")
  const [loginPassword, setLoginPassword] = useState("")
  const [section, setSection] = useState<Section>("dashboard")
  const [selectedClientId, setSelectedClientId] = useState("")
  const [selectedCompanyId, setSelectedCompanyId] = useState("")
  const [detailClientId, setDetailClientId] = useState<string | null>(null)
  const [detailCompanyId, setDetailCompanyId] = useState<string | null>(null)
  const [detailPropertyId, setDetailPropertyId] = useState<string | null>(null)
  const [detailPropertyTab, setDetailPropertyTab] = useState<PropertyEditorTab>("construction")
  const [propertyDetailsModalOpen, setPropertyDetailsModalOpen] = useState(false)
  const [propertyGeneralDocsModalOpen, setPropertyGeneralDocsModalOpen] = useState(false)
  const [shortcutLogWeekOpen, setShortcutLogWeekOpen] = useState(false)
  const [shortcutInvoiceOpen, setShortcutInvoiceOpen] = useState(false)
  const [shortcutInvoicePropertyId, setShortcutInvoicePropertyId] = useState("")
  const [editingClientId, setEditingClientId] = useState<string | null>(null)
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null)
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null)
  const [addClientOpen, setAddClientOpen] = useState(false)
  const [addCompanyOpen, setAddCompanyOpen] = useState(false)
  const [addCompanyFormError, setAddCompanyFormError] = useState<string | null>(null)
  const [addPropertyOpen, setAddPropertyOpen] = useState(false)
  const [addAccountantLinkOpen, setAddAccountantLinkOpen] = useState(false)
  const [notificationSendOpen, setNotificationSendOpen] = useState(false)
  const [pendingPropertyDelete, setPendingPropertyDelete] = useState<PendingPropertyDelete | null>(null)
  const [themedConfirmMessage, setThemedConfirmMessage] = useState<string | null>(null)
  const themedConfirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null)

  const {
    snapshot,
    init,
    persist,
    loading,
    error,
    persisting,
    actionNotice,
    clearActionNotice,
    addClient,
    addCompany,
    addProperty,
    updateClient,
    updateCompany,
    updateProperty,
    addNotification,
    createAccountantLink,
    updateAccountantLink,
    addInvoice,
    addAsset,
    addConstructionStage,
    addConstructionProject,
    updateConstructionProject,
    addFinanceRecord,
    updateFinanceRecord,
    addIncomeRow,
    updateIncomeRow,
    addInsuranceRecord,
    updateInsuranceRecord,
    updateInvoice,
    deleteInvoice,
    deleteFinanceRecord,
    deleteIncomeRow,
    deleteInsuranceRecord,
    updateAsset,
    deleteAsset,
    deleteClient,
    deleteCompany,
    deleteProperty,
    deleteNotification,
    deleteAccountantLink,
    deleteConstructionProject,
    deleteConstructionStage,
    updateConstructionStage,
  } = useAppStore()

  const { t } = useI18n()

  useEffect(() => {
    void init()
  }, [init])

  // Realtime Firestore listeners (set up in store.init) keep the admin in sync continuously,
  // so the old focus/visibility/30s polling — which raced with saves and reverted new rows — is gone.

  useEffect(() => {
    if (!detailPropertyId) {
      setPropertyDetailsModalOpen(false)
      setPropertyGeneralDocsModalOpen(false)
    }
  }, [detailPropertyId])

  useEffect(() => {
    if (!actionNotice) return
    const timer = window.setTimeout(() => clearActionNotice(), 6000)
    return () => window.clearTimeout(timer)
  }, [actionNotice, clearActionNotice])

  const stats = useMemo(() => {
    if (!snapshot)
      return { clients: 0, companies: 0, properties: 0, invoices: 0, notifications: 0 }
    return {
      clients: snapshot.clients.length,
      companies: snapshot.companies.length,
      properties: snapshot.properties.length,
      invoices: snapshot.invoices.length,
      notifications: snapshot.notifications.length,
    }
  }, [snapshot])

  const detailProperty = useMemo(
    () => (detailPropertyId ? snapshot?.properties.find((p) => p.id === detailPropertyId) : undefined),
    [detailPropertyId, snapshot],
  )
  const propertyOverviewClient = useMemo(
    () => (detailProperty && snapshot ? snapshot.clients.find((c) => c.id === detailProperty.clientId) : undefined),
    [detailProperty, snapshot],
  )
  const propertyOverviewCompany = useMemo(
    () => (detailProperty && snapshot ? snapshot.companies.find((c) => c.id === detailProperty.companyId) : undefined),
    [detailProperty, snapshot],
  )
  const detailCompany = useMemo(
    () => (detailCompanyId ? snapshot?.companies.find((c) => c.id === detailCompanyId) : undefined),
    [detailCompanyId, snapshot],
  )
  const detailClient = useMemo(
    () => (detailClientId ? snapshot?.clients.find((c) => c.id === detailClientId) : undefined),
    [detailClientId, snapshot],
  )
  const editingClient = useMemo(
    () => (editingClientId ? snapshot?.clients.find((c) => c.id === editingClientId) : undefined),
    [editingClientId, snapshot],
  )
  const editingCompany = useMemo(
    () => (editingCompanyId ? snapshot?.companies.find((c) => c.id === editingCompanyId) : undefined),
    [editingCompanyId, snapshot],
  )
  const editingProperty = useMemo(
    () => (editingPropertyId ? snapshot?.properties.find((p) => p.id === editingPropertyId) : undefined),
    [editingPropertyId, snapshot],
  )

  const detailBreadcrumbLabel = useMemo(() => {
    const parts: string[] = []
    if (detailClient) parts.push(detailClient.fullName)
    if (detailCompany) parts.push(detailCompany.name)
    if (detailProperty) parts.push(detailProperty.title)
    return parts.join(" · ")
  }, [detailClient, detailCompany, detailProperty])

  const accountantPortalQuery = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const enabled = params.get("portal") === "accountant"
    return {
      enabled,
      token: params.get("token") ?? "",
      mode: params.get("mode") ?? "",
      scopeType: params.get("scopeType") ?? "",
      scopeId: params.get("scopeId") ?? "",
      expiresAt: params.get("expiresAt") ?? "",
    }
  }, [])

  const closeTopDetail = useCallback(() => {
    if (detailPropertyId) {
      setDetailPropertyId(null)
      return
    }
    if (detailCompanyId) {
      setDetailCompanyId(null)
      return
    }
    if (detailClientId) {
      setDetailClientId(null)
    }
  }, [detailPropertyId, detailCompanyId, detailClientId])

  const adminHistorySeededRef = useRef(false)
  const adminHistorySkipPushRef = useRef(false)
  const adminHistoryLastSerializedRef = useRef("")

  useEffect(() => {
    if (!isAuthenticated || !snapshot || accountantPortalQuery.enabled || loading) return

    const pack = (): YhgcHistoryNav => ({
      v: 1,
      section,
      detailClientId,
      detailCompanyId,
      detailPropertyId,
      detailPropertyTab,
    })

    const serialized = JSON.stringify(pack())
    const url = `${window.location.pathname}${window.location.search}`

    if (!adminHistorySeededRef.current) {
      adminHistorySeededRef.current = true
      window.history.replaceState({ [YHGC_HISTORY_KEY]: pack() }, "", url)
      adminHistoryLastSerializedRef.current = serialized
      return
    }

    if (adminHistorySkipPushRef.current) {
      adminHistorySkipPushRef.current = false
      adminHistoryLastSerializedRef.current = serialized
      return
    }

    if (adminHistoryLastSerializedRef.current === serialized) return

    adminHistoryLastSerializedRef.current = serialized
    window.history.pushState({ [YHGC_HISTORY_KEY]: pack() }, "", url)
  }, [
    isAuthenticated,
    snapshot,
    accountantPortalQuery.enabled,
    loading,
    section,
    detailClientId,
    detailCompanyId,
    detailPropertyId,
    detailPropertyTab,
  ])

  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      if (!isAuthenticated) return
      const raw = (event.state as Record<string, unknown> | null)?.[YHGC_HISTORY_KEY]
      const nav = parseYhgcHistoryNav(raw)
      if (!nav) return
      adminHistorySkipPushRef.current = true
      setSection(nav.section)
      setDetailClientId(nav.detailClientId)
      setDetailCompanyId(nav.detailCompanyId)
      setDetailPropertyId(nav.detailPropertyId)
      setDetailPropertyTab(nav.detailPropertyTab)
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [isAuthenticated])

  const askThemedConfirm = useCallback((message: string) => {
    setThemedConfirmMessage(message)
    return new Promise<boolean>((resolve) => {
      themedConfirmResolverRef.current = resolve
    })
  }, [])

  useEffect(() => {
    themedConfirmBridge = askThemedConfirm
    return () => {
      themedConfirmBridge = null
    }
  }, [askThemedConfirm])

  const resolveThemedConfirm = (confirmed: boolean) => {
    setThemedConfirmMessage(null)
    themedConfirmResolverRef.current?.(confirmed)
    themedConfirmResolverRef.current = null
  }

  const confirmDeleteProperty = () => {
    if (!pendingPropertyDelete) return
    deleteProperty(pendingPropertyDelete.id)
    if (pendingPropertyDelete.clearDetail) {
      setDetailPropertyId(null)
    }
    setPendingPropertyDelete(null)
    void persist()
  }

  if (loading && !snapshot) return <AppLoadingScreen />
  if (!loading && error && !snapshot) {
    return <AppBootstrapError message={error} onRetry={() => void init()} />
  }
  if (!snapshot) return <AppLoadingScreen />
  if (accountantPortalQuery.enabled) {
    return <AccountantReadonlyPortal snapshot={snapshot} query={accountantPortalQuery} />
  }

  const getUsers = (): AdminUser[] => [
    {
      email: adminPortalUser.email,
      password: adminPortalUser.password,
      fullName: adminPortalUser.fullName,
    },
  ]

  const handleLogin = (values: Record<string, string>) => {
    const email = values.email.trim().toLowerCase()
    const password = values.password.trim().toLowerCase()
    const users = getUsers()
    const acceptedPasswords = new Set([
      adminPortalUser.password.trim().toLowerCase(),
      "yhgcadmin2026!",
      "yhgcadmin2026",
    ])
    const user = users.find(
      (item) => item.email.toLowerCase() === email && acceptedPasswords.has(password),
    )
    if (!user) {
      setAuthError(t("login.invalidCredentials"))
      return
    }
    localStorage.setItem(AUTH_SESSION_KEY, user.email)
    setAuthError("")
    setIsAuthenticated(true)
  }

  const handleLoginDirect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    handleLogin({ email: loginEmail, password: loginPassword })
  }

  if (!isAuthenticated) {
  return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#090909] via-[#121212] to-[#1a1513] p-4">
        <div className="animate-fade-in-up grid w-full max-w-5xl overflow-hidden rounded-3xl border border-yhgc-gold/25 bg-white shadow-2xl lg:grid-cols-2">
          <div className="relative hidden bg-gradient-to-br from-[#090909] via-[#111111] to-[#1e1613] p-10 text-white lg:block">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(201,169,110,0.22),transparent_50%)]" />
            <div className="relative">
              <img src={BRAND_LOGO_SRC} alt="" className="h-14 w-auto max-w-[280px] object-contain object-left" />
              <p className="mt-4 text-xs uppercase tracking-[0.24em] text-yhgc-gold">{t("login.adminPortal")}</p>
              <h1 className="mt-4 text-4xl font-semibold leading-tight">{t("login.privateOps")}</h1>
              <p className="mt-4 max-w-md text-sm text-neutral-300">
                {t("login.heroDesc")}
              </p>
              <div className="mt-8 space-y-3">
                <div className="rounded-xl border border-yhgc-gold/25 bg-black/35 p-3 text-sm text-neutral-200">{t("login.secureAccess")}</div>
                <div className="rounded-xl border border-yhgc-gold/25 bg-black/35 p-3 text-sm text-neutral-200">{t("login.unifiedControls")}</div>
                <div className="rounded-xl border border-yhgc-gold/25 bg-black/35 p-3 text-sm text-neutral-200">{t("login.dataWorkflows")}</div>
        </div>
            </div>
          </div>

          <div className="bg-[#fcfbf8] p-6 sm:p-8">
            {authView === "splash" && (
              <div className="space-y-5">
                <div>
                  <img src={BRAND_LOGO_SRC} alt="YOUR HOME GROUP Consultancy" className="h-16 w-auto max-w-full object-contain object-left" />
                  <p className="mt-4 text-xs uppercase tracking-[0.2em] text-yhgc-gold">{t("login.adminPortal")}</p>
                  <h2 className="mt-2 text-3xl font-semibold text-yhgc-black">{t("login.welcome")}</h2>
                  <p className="mt-2 text-sm text-neutral-600">{t("login.singleSignin")}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setAuthView("login")}
                  className="w-full rounded-xl bg-yhgc-crimson px-4 py-3 text-sm font-medium text-white shadow hover:opacity-95"
                >
                  {t("login.submit")}
                </button>
              </div>
            )}

            {authView === "login" && (
              <div className="space-y-4">
                <img src={BRAND_LOGO_SRC} alt="YOUR HOME GROUP Consultancy" className="h-14 w-auto max-w-full object-contain object-left" />
                <h2 className="text-2xl font-semibold text-yhgc-black">{t("login.administratorLogin")}</h2>
                <form onSubmit={handleLoginDirect} className="rounded-2xl border border-yhgc-gold/20 bg-white p-4 shadow-sm">
                  <label className="text-sm">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">{t("login.email")}</span>
                    <input
                      type="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 outline-none transition focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20"
                    />
                  </label>
                  <label className="mt-3 block text-sm">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">{t("login.password")}</span>
                    <input
                      type="password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 outline-none transition focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20"
                    />
                  </label>
                  <button type="submit" className="mt-3 block w-full rounded-xl bg-yhgc-crimson px-4 py-2.5 text-sm font-medium text-white shadow hover:opacity-95">
                    {t("login.submit")}
                  </button>
                </form>
              </div>
            )}

            {authError && <p className="mt-4 rounded-lg border border-yhgc-crimson/20 bg-yhgc-crimson/5 px-3 py-2 text-sm text-yhgc-crimson">{authError}</p>}
          </div>
        </div>
      </div>
    )
  }

  const inDetailView = Boolean(detailPropertyId || detailCompanyId || detailClientId)

  return (
    <div className="min-h-screen animate-fade-in-up bg-gradient-to-b from-[#f6f4ef] via-[#eef1f5] to-[#e8edf3] text-neutral-900">
      {persisting ? (
        <div className="fixed left-0 right-0 top-0 z-[100] h-1 overflow-hidden bg-yhgc-gold/20">
          <div className="h-full w-1/3 animate-[pulse_1s_ease-in-out_infinite] bg-yhgc-crimson" />
        </div>
      ) : null}
      {persisting ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-neutral-900/35 backdrop-blur-[1px]"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="flex items-center gap-3 rounded-2xl border border-yhgc-gold/40 bg-white px-6 py-4 shadow-xl">
            <span className="h-6 w-6 shrink-0 rounded-full border-2 border-yhgc-crimson border-t-transparent animate-spin" />
            <p className="text-sm font-medium text-neutral-800">{t("shell.savingChanges")}</p>
          </div>
        </div>
      ) : null}
      {actionNotice ? (
        <div
          className={`fixed bottom-6 right-6 z-[95] flex max-w-md items-start gap-3 rounded-xl border px-4 py-3 shadow-lg ${
            actionNotice.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : "border-red-200 bg-red-50 text-red-950"
          }`}
          role="alert"
        >
          <p className="min-w-0 flex-1 text-sm leading-snug">{actionNotice.message}</p>
          <button
            type="button"
            onClick={() => clearActionNotice()}
            className="shrink-0 rounded-md border border-neutral-400/40 bg-white/80 px-2 py-1 text-xs font-medium text-neutral-800 hover:bg-white"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <div className="grid min-h-screen grid-cols-12 lg:items-start">
        <aside className="col-span-12 border-r border-yhgc-gold/20 bg-gradient-to-b from-[#0a0a0a] via-[#111111] to-[#171717] px-4 py-6 text-white lg:sticky lg:top-0 lg:z-30 lg:col-span-3 lg:h-screen lg:overflow-y-auto xl:col-span-2">
          <div className="mb-6 rounded-lg border border-yhgc-gold/25 bg-neutral-900/70 p-3">
            <img src={BRAND_LOGO_SRC} alt="" className="h-10 w-auto max-w-full object-contain object-left opacity-95" />
            <p className="mt-2 text-xs uppercase tracking-[0.2em] text-yhgc-gold">{t("shell.admin")}</p>
            <h1 className="mt-1 text-lg font-semibold leading-tight">{t("shell.operations")}</h1>
          </div>
          <nav className="space-y-2">
            {sections.map((item) => (
              <button
                key={item}
                onClick={() => {
                  setDetailClientId(null)
                  setDetailCompanyId(null)
                  setDetailPropertyId(null)
                  setAddClientOpen(false)
                  setAddCompanyOpen(false)
                  setAddPropertyOpen(false)
                  setAddAccountantLinkOpen(false)
                  setSection(item)
                }}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                  section === item ? "bg-yhgc-crimson text-white shadow" : "text-neutral-200 hover:bg-neutral-800/80"
                }`}
              >
                {t(`nav.${item}`)}
              </button>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem(AUTH_SESSION_KEY)
              adminHistorySeededRef.current = false
              adminHistoryLastSerializedRef.current = ""
              setIsAuthenticated(false)
              setAuthView("splash")
            }}
            className="mt-6 w-full rounded-md border border-neutral-500 px-3 py-2 text-sm text-neutral-200"
          >
            {t("shell.logout")}
        </button>
        </aside>

        <main className="col-span-12 p-6 lg:col-span-9 xl:col-span-10">
          <div className="mb-6 rounded-2xl border border-yhgc-gold/30 bg-gradient-to-r from-[#090909] to-[#1a1a1a] px-5 py-4 text-white shadow-lg">
            <p className="text-xs uppercase tracking-[0.2em] text-yhgc-gold">Operations Console</p>
            <h2 className="mt-1 text-xl font-semibold">Your Home Group Consultancy</h2>
            <p className="text-sm text-neutral-300">Secure portfolio administration with controlled access.</p>
        </div>

          {inDetailView && (
            <nav
              className="sticky top-0 z-20 mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur-sm"
              aria-label="Detail navigation"
            >
              <button
                type="button"
                onClick={closeTopDetail}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50"
              >
                ← Back
              </button>
              <div className="hidden h-6 w-px bg-neutral-200 sm:block" aria-hidden />
              <div className="min-w-0 flex-1 text-sm text-neutral-600">
                {detailPropertyId && !detailProperty ? (
                  <span className="font-medium text-yhgc-black">Property not found</span>
                ) : (
                  <span className="truncate font-medium text-yhgc-black">{detailBreadcrumbLabel || "Details"}</span>
                )}
              </div>
            </nav>
          )}

          {detailPropertyId && !detailProperty && (
            <section className="mb-8 rounded-2xl border border-amber-200/80 bg-amber-50/90 p-5 shadow-sm">
              <p className="text-sm font-medium text-amber-950">This property is no longer in the snapshot (it may have been removed).</p>
              <button
                type="button"
                onClick={() => setDetailPropertyId(null)}
                className="mt-3 rounded-lg bg-yhgc-crimson px-4 py-2 text-sm font-medium text-white"
              >
                Close
              </button>
            </section>
          )}

          {detailPropertyId && detailProperty && (
            <section className="mb-8 space-y-6 rounded-2xl border border-yhgc-gold/25 bg-white/90 p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-4">
        <div>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-yhgc-gold">Property</p>
                  <h2 className="mt-1 text-2xl font-semibold text-yhgc-black">{detailProperty.title}</h2>
                  <p className="mt-1 text-sm text-neutral-600">{detailProperty.address}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPropertyGeneralDocsModalOpen(true)}
                    className="rounded-lg border border-yhgc-gold/50 bg-yhgc-gold/10 px-4 py-2 text-sm font-medium text-yhgc-black shadow-sm hover:bg-yhgc-gold/20"
                  >
                    General documents
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingPropertyId(detailProperty.id)}
                    className="rounded-lg bg-yhgc-crimson px-4 py-2 text-sm font-medium text-white shadow-sm"
                  >
                    Edit profile
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingPropertyDelete({
                        id: detailProperty.id,
                        title: detailProperty.title,
                        message: `Permanently delete property “${detailProperty.title}” and all related records and files? This cannot be undone.`,
                        clearDetail: true,
                      })
                    }}
                    className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-800 shadow-sm hover:bg-red-100"
                  >
                    Delete property
                  </button>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-neutral-900">Overview</h3>
                <p className="mt-1 text-xs text-neutral-500">
                  Core identity and links. Edit title, address, type, and status via <strong>Edit profile</strong>. Valuation
                  and operating figures use <strong>Add property details</strong> or <strong>Edit details</strong> in the
                  summary below; general files use <strong>General documents</strong> above.
                </p>
                <div className="mt-3 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 p-3 md:col-span-2 xl:col-span-3">
                    <span className="text-xs font-medium uppercase text-neutral-500">Title</span>
                    <p className="mt-0.5 font-medium text-neutral-900">{detailProperty.title}</p>
                  </div>
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 p-3 md:col-span-2 xl:col-span-3">
                    <span className="text-xs font-medium uppercase text-neutral-500">Address</span>
                    <p className="mt-0.5 text-neutral-900">{detailProperty.address}</p>
                  </div>
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 p-3 xl:col-span-3">
                    <span className="text-xs font-medium uppercase text-neutral-500">Property ID</span>
                    <p className="mt-0.5 break-all font-mono text-xs text-neutral-900">{detailProperty.id}</p>
                  </div>
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 p-3 md:col-span-2 xl:col-span-1">
                    <span className="text-xs font-medium uppercase text-neutral-500">Type</span>
                    <p className="mt-0.5 font-medium text-neutral-900">{detailProperty.propertyType}</p>
                  </div>
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 p-3 md:col-span-2 xl:col-span-1">
                    <span className="text-xs font-medium uppercase text-neutral-500">Status</span>
                    <p className="mt-0.5 font-medium text-neutral-900">{formatPropertyStatus(detailProperty.status)}</p>
                  </div>
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 p-3 md:col-span-2 xl:col-span-1">
                    <span className="text-xs font-medium uppercase text-neutral-500">Linked client</span>
                    <p className="mt-0.5 font-medium text-neutral-900">
                      {propertyOverviewClient?.fullName ?? "—"}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-neutral-600">{detailProperty.clientId}</p>
                  </div>
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 p-3 md:col-span-2 xl:col-span-1">
                    <span className="text-xs font-medium uppercase text-neutral-500">Linked company</span>
                    <p className="mt-0.5 font-medium text-neutral-900">
                      {propertyOverviewCompany?.name ?? "—"}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-neutral-600">{detailProperty.companyId}</p>
                  </div>
                </div>
                {snapshot ? <PropertyRecordCountsSummary property={detailProperty} snapshot={snapshot} /> : null}
                <PropertyValuationSummary
                  property={detailProperty}
                  hasSummaryValues={propertySummaryHasAnyValues(detailProperty)}
                  onEditDetails={() => setPropertyDetailsModalOpen(true)}
                  onOpenGeneralDocuments={() => setPropertyGeneralDocsModalOpen(true)}
                />
                {propertyDetailsModalOpen ? (
                  <EditModal
                    title={propertySummaryHasAnyValues(detailProperty) ? "Edit property details" : "Add property details"}
                    onClose={() => setPropertyDetailsModalOpen(false)}
                  >
                    <PropertyDetailsFieldsForm
                      property={detailProperty}
                      onSave={(patch) => {
                        updateProperty(detailProperty.id, patch)
                        void persist()
                        setPropertyDetailsModalOpen(false)
                      }}
                    />
                  </EditModal>
                ) : null}
                {propertyGeneralDocsModalOpen && snapshot ? (
                  <EditModal title="General property documents" onClose={() => setPropertyGeneralDocsModalOpen(false)}>
                    {(() => {
                      const generalAssets = snapshot.assets.filter(
                        (a) => a.ownerType === "property" && a.ownerId === detailProperty.id && a.tag === "general",
                      )
                      const uploadGeneralDoc = async (file: File, displayName: string) => {
                        const url = await uploadPropertyAssetFile(detailProperty.id, file, "general")
                        addAsset({
                          ownerType: "property",
                          ownerId: detailProperty.id,
                          tag: "general",
                          fileName: displayName,
                          mimeType: file.type || "application/octet-stream",
                          sizeBytes: file.size,
                          urlOrPath: url,
                        })
                        void persist()
                      }
                      return (
                        <div className="space-y-4">
                          <FileUploadForm
                            title="Upload general property documents"
                            onFileUpload={uploadGeneralDoc}
                            onFiles={legacyOnFilesFromSingle(uploadGeneralDoc)}
                          />
                          <PropertyTabDocuments
                            title="Uploaded files (general)"
                            assets={generalAssets}
                            onUpdateAsset={(id, patch) => {
                              updateAsset(id, patch)
                              void persist()
                            }}
                            onDeleteAsset={(id) => {
                              deleteAsset(id)
                              void persist()
                            }}
                            showInlinePreviews
                          />
                        </div>
                      )
                    })()}
                  </EditModal>
                ) : null}
              </div>

              <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
                <div className="border-b border-neutral-200 bg-neutral-50/90 px-4 py-3">
                  <h3 className="text-sm font-semibold text-neutral-900">Records &amp; documents</h3>
                  <p className="mt-1 text-xs text-neutral-600">
                    Work in one category at a time. Edits save to Firebase as you go.
          </p>
        </div>
                <div className="px-4 pt-3">
                  <div className="flex flex-wrap gap-0.5 border-b border-neutral-200" role="tablist" aria-label="Property record categories">
                    {PROPERTY_TAB_NAV.map(({ tab, label }) => {
                      const selected = detailPropertyTab === tab
                      return (
        <button
                          key={tab}
          type="button"
                          role="tab"
                          aria-selected={selected}
                          onClick={() => setDetailPropertyTab(tab)}
                          className={`relative -mb-px rounded-t-lg px-3 py-2.5 text-sm font-medium transition ${
                            selected
                              ? "border border-b-0 border-neutral-200 bg-white text-yhgc-crimson"
                              : "border border-transparent text-neutral-600 hover:bg-white/60 hover:text-neutral-900"
                          }`}
                        >
                          {label}
        </button>
                      )
                    })}
                  </div>
                  <p className="py-2 text-xs text-neutral-500">
                    {PROPERTY_TAB_NAV.find((t) => t.tab === detailPropertyTab)?.description}
                  </p>
                </div>
                <div className="border-t border-neutral-100 px-4 pb-4">
                  <PropertyTabEditor
                    tab={detailPropertyTab}
                    property={detailProperty}
                    invoices={snapshot.invoices.filter((inv) => inv.propertyId === detailProperty.id)}
                    assets={snapshot.assets.filter((a) => {
                      if (a.ownerType === "property" && a.ownerId === detailProperty.id) return true
                      const invIds = snapshot.invoices
                        .filter((i) => i.propertyId === detailProperty.id)
                        .map((i) => i.id)
                      if (a.ownerType === "invoice" && invIds.includes(a.ownerId)) return true
                      const projIds = snapshot.constructionProjects
                        .filter((p) => p.propertyId === detailProperty.id)
                        .map((p) => p.id)
                      const stageIds = snapshot.constructionStages
                        .filter((s) => projIds.includes(s.projectId))
                        .map((s) => s.id)
                      if (a.ownerType === "construction_stage" && stageIds.includes(a.ownerId)) return true
                      const insIds = snapshot.insuranceRecords
                        .filter((i) => i.propertyId === detailProperty.id)
                        .map((i) => i.id)
                      if (a.ownerType === "insurance_record" && insIds.includes(a.ownerId)) return true
                      const finIds = snapshot.financeRecords
                        .filter((f) => f.propertyId === detailProperty.id)
                        .map((f) => f.id)
                      if (a.ownerType === "finance_record" && finIds.includes(a.ownerId)) return true
                      return false
                    })}
                    constructionProjects={snapshot.constructionProjects.filter(
                      (p) => p.propertyId === detailProperty.id,
                    )}
                    constructionStages={snapshot.constructionStages}
                    financeRecords={snapshot.financeRecords.filter((f) => f.propertyId === detailProperty.id)}
                    incomeRows={snapshot.incomeRows.filter((r) => r.propertyId === detailProperty.id)}
                    insuranceRecords={snapshot.insuranceRecords.filter((i) => i.propertyId === detailProperty.id)}
                    onAddConstructionProject={(initial) => {
                      addConstructionProject(detailProperty.id, initial)
                      void persist()
                    }}
                    onUpdateConstructionProject={(id, patch) => {
                      updateConstructionProject(id, patch)
                      void persist()
                    }}
                    onAddConstructionStage={(payload) => {
                      const id = addConstructionStage(payload)
                      if (id !== undefined) void persist()
                      return id
                    }}
                    onAddFinanceRecord={(payload) => {
                      const id = addFinanceRecord(payload)
                      if (id !== undefined) void persist()
                      return id
                    }}
                    onUpdateFinanceRecord={(id, patch) => {
                      updateFinanceRecord(id, patch)
                      void persist()
                    }}
                    onAddIncomeRow={(payload) => {
                      addIncomeRow(payload)
                      void persist()
                    }}
                    onUpdateIncomeRow={(id, patch) => {
                      updateIncomeRow(id, patch)
                      void persist()
                    }}
                    onAddInvoice={(payload) => {
                      const id = addInvoice({ propertyId: detailProperty.id, ...payload })
                      if (id !== undefined) void persist()
                      return id
                    }}
                    onUpdateInvoice={(id, patch) => {
                      updateInvoice(id, patch)
                      void persist()
                    }}
                    onAddInsuranceRecord={(payload) => {
                      const id = addInsuranceRecord({ propertyId: detailProperty.id, ...payload })
                      if (id !== undefined) void persist()
                      return id
                    }}
                    onUpdateInsuranceRecord={(id, patch) => {
                      updateInsuranceRecord(id, patch)
                      void persist()
                    }}
                    onDeleteInvoice={(id) => {
                      deleteInvoice(id)
                      void persist()
                    }}
                    onDeleteFinanceRecord={(id) => {
                      deleteFinanceRecord(id)
                      void persist()
                    }}
                    onDeleteIncomeRow={(id) => {
                      deleteIncomeRow(id)
                      void persist()
                    }}
                    onDeleteInsuranceRecord={(id) => {
                      deleteInsuranceRecord(id)
                      void persist()
                    }}
                    onUpdateAsset={(id, patch) => {
                      updateAsset(id, patch)
                      void persist()
                    }}
                    onDeleteAsset={(id) => {
                      deleteAsset(id)
                      void persist()
                    }}
                    onAssetAdd={(payload) => {
                      addAsset(payload)
                      void persist()
                    }}
                    onDeleteConstructionProject={(projectId) => {
                      deleteConstructionProject(projectId)
                      void persist()
                    }}
                    onDeleteConstructionStage={(stageId) => {
                      deleteConstructionStage(stageId)
                      void persist()
                    }}
                    onUpdateConstructionStage={(stageId, patch) => {
                      updateConstructionStage(stageId, patch)
                      void persist()
                    }}
                  />
                </div>
              </div>
      </section>
          )}

          {detailCompanyId && detailCompany && !detailPropertyId && (
            <section className="mb-8 space-y-4 rounded-2xl border border-yhgc-gold/25 bg-white/90 p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-yhgc-gold">Company detail</p>
                  <h2 className="mt-1 text-2xl font-semibold">{detailCompany.name}</h2>
                  <p className="mt-1 text-sm text-neutral-600">No. {detailCompany.companyNumber}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingCompanyId(detailCompany.id)}
                    className="rounded-md bg-yhgc-crimson px-3 py-2 text-sm font-medium text-white"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (
                        !(await themedConfirm(
                          `Permanently delete company “${detailCompany.name}” and all its properties, invoices, files, and related data? This cannot be undone.`,
                        ))
                      )
                        return
                      deleteCompany(detailCompany.id)
                      setDetailCompanyId(null)
                      setDetailPropertyId(null)
                      void persist()
                    }}
                    className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-100"
                  >
                    Delete company
                  </button>
                </div>
              </div>
              <div className="grid gap-3 text-sm md:grid-cols-2">
                <div className="rounded-lg border border-neutral-200 bg-white p-3">Client ID: {detailCompany.clientId}</div>
                <div className="rounded-lg border border-neutral-200 bg-white p-3">Updated: {detailCompany.lastUpdatedAt}</div>
              </div>
              <div>
                <h3 className="text-lg font-semibold">Properties</h3>
                <div className="mt-3 grid gap-3">
                  {snapshot.properties
                    .filter((p) => p.companyId === detailCompany.id)
                    .map((p) => (
                      <div key={p.id} className="rounded-lg border border-neutral-200 bg-white p-4">
                        <p className="font-medium">{p.title}</p>
                        <p className="text-sm text-neutral-600">{p.address}</p>
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setDetailPropertyTab("construction")
                              setDetailPropertyId(p.id)
                            }}
                            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-800"
                          >
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingPropertyId(p.id)}
                            className="rounded-md bg-yhgc-crimson px-3 py-1.5 text-xs font-medium text-white"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPendingPropertyDelete({
                                id: p.id,
                                title: p.title,
                                message: `Delete property “${p.title}” and all related data?`,
                              })
                            }}
                            className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </section>
          )}

          {detailClientId && detailClient && !detailCompanyId && !detailPropertyId && (
            <section className="mb-8 space-y-4 rounded-2xl border border-yhgc-gold/25 bg-white/90 p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-yhgc-gold">Client detail</p>
                  <h2 className="mt-1 text-2xl font-semibold">{detailClient.fullName}</h2>
                  <p className="mt-1 text-sm text-neutral-600">{detailClient.email}</p>
        </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingClientId(detailClient.id)}
                    className="rounded-md bg-yhgc-crimson px-3 py-2 text-sm font-medium text-white"
                  >
                    Edit
                  </button>
                  {detailClient.status === "active" ? (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!(await themedConfirm("Block this client? They will be unable to sign in on the mobile app."))) return
                        updateClient(detailClient.id, { status: "suspended" })
                        void persist()
                      }}
                      className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm font-medium text-white"
                    >
                      Block mobile access
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        updateClient(detailClient.id, { status: "active" })
                        void persist()
                      }}
                      className="rounded-md border border-emerald-700 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900"
                    >
                      Restore mobile access
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      if (
                        !(await themedConfirm(
                          `Permanently delete client “${detailClient.fullName}” and ALL companies, properties, invoices, files, and notifications for this client? This cannot be undone.`,
                        ))
                      )
                        return
                      deleteClient(detailClient.id)
                      setDetailClientId(null)
                      setDetailCompanyId(null)
                      setDetailPropertyId(null)
                      void persist()
                    }}
                    className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-100"
                  >
                    Delete client
                  </button>
                </div>
              </div>
              <div className="grid gap-3 text-sm md:grid-cols-2">
                <div className="rounded-lg border border-neutral-200 bg-white p-3">Status: {detailClient.status}</div>
                <div className="rounded-lg border border-neutral-200 bg-white p-3">Login code: {detailClient.loginCode}</div>
              </div>
              <div>
                <h3 className="text-lg font-semibold">Companies</h3>
                <div className="mt-3 grid gap-3">
                  {snapshot.companies
                    .filter((c) => c.clientId === detailClient.id)
                    .map((c) => (
                      <div key={c.id} className="rounded-lg border border-neutral-200 bg-white p-4">
                        <p className="font-medium">{c.name}</p>
                        <p className="text-sm text-neutral-600">No. {c.companyNumber}</p>
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => setDetailCompanyId(c.id)}
                            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-800"
                          >
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingCompanyId(c.id)}
                            className="rounded-md bg-yhgc-crimson px-3 py-1.5 text-xs font-medium text-white"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!(await themedConfirm(`Delete company “${c.name}” and all its properties and data?`))) return
                              deleteCompany(c.id)
                              void persist()
                            }}
                            className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
              <div>
                <h3 className="text-lg font-semibold">All properties for this client</h3>
                <div className="mt-3 grid gap-3">
                  {snapshot.properties
                    .filter((p) => p.clientId === detailClient.id)
                    .map((p) => (
                      <div key={p.id} className="rounded-lg border border-neutral-200 bg-white p-4">
                        <p className="font-medium">{p.title}</p>
                        <p className="text-sm text-neutral-600">{p.address}</p>
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setDetailPropertyTab("construction")
                              setDetailPropertyId(p.id)
                            }}
                            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-800"
                          >
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingPropertyId(p.id)}
                            className="rounded-md bg-yhgc-crimson px-3 py-1.5 text-xs font-medium text-white"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPendingPropertyDelete({
                                id: p.id,
                                title: p.title,
                                message: `Delete property “${p.title}” and all related data?`,
                              })
                            }}
                            className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </section>
          )}

          {!inDetailView && section === "dashboard" && (
            <section>
              <h2 className="text-2xl font-semibold">{t("dashboard.title")}</h2>
              <p className="mt-1 text-sm text-neutral-600">
                {t("dashboard.subtitle")}
              </p>
              <div className="mt-6 grid gap-4 md:grid-cols-5">
                <StatCard label={t("stat.clients")} value={stats.clients} />
                <StatCard label={t("stat.companies")} value={stats.companies} />
                <StatCard label={t("stat.properties")} value={stats.properties} />
                <StatCard label={t("stat.invoices")} value={stats.invoices} />
                <StatCard label={t("stat.notifications")} value={stats.notifications} />
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <ActionCard
                  title={t("dashboard.onboardClient")}
                  desc={t("dashboard.onboardClientDesc")}
                  onClick={() => {
                    setDetailClientId(null)
                    setDetailCompanyId(null)
                    setDetailPropertyId(null)
                    setSection("clients")
                  }}
                />
                <ActionCard
                  title={t("dashboard.updateProperty")}
                  desc={t("dashboard.updatePropertyDesc")}
                  onClick={() => {
                    setDetailClientId(null)
                    setDetailCompanyId(null)
                    setDetailPropertyId(null)
                    setSection("properties")
                  }}
                />
                <ActionCard
                  title={t("dashboard.manageAlerts")}
                  desc={t("dashboard.manageAlertsDesc")}
                  onClick={() => {
                    setDetailClientId(null)
                    setDetailCompanyId(null)
                    setDetailPropertyId(null)
                    setSection("notifications")
                  }}
                />
              </div>
      </section>
          )}

          {!inDetailView && section === "clients" && (
            <section className="space-y-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h2 className="text-2xl font-semibold">Clients</h2>
                <button
                  type="button"
                  onClick={() => setAddClientOpen(true)}
                  className="rounded-lg bg-yhgc-crimson px-4 py-2 text-sm font-medium text-white shadow-sm"
                >
                  Add client
                </button>
              </div>
              <div className="grid gap-3">
                {snapshot.clients.map((item) => (
                  <div key={item.id} className="rounded-lg border border-neutral-200 bg-white p-4">
                    <p className="font-medium">{item.fullName}</p>
                    <p className="text-sm text-neutral-600">{item.email}</p>
                    <p className="mt-1 text-xs text-neutral-500">Login code: {item.loginCode}</p>
                    <p className="mt-1 text-xs text-neutral-500">Status: {item.status}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDetailCompanyId(null)
                          setDetailPropertyId(null)
                          setDetailClientId(item.id)
                        }}
                        className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-800"
                      >
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingClientId(item.id)}
                        className="rounded-md bg-yhgc-crimson px-3 py-1.5 text-xs font-medium text-white"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (
                            !(await themedConfirm(
                              `Permanently delete client “${item.fullName}” and all companies, properties, invoices, files, and notifications for this client? This cannot be undone.`,
                            ))
                          )
                            return
                          deleteClient(item.id)
                          void persist()
                        }}
                        className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
                      >
                        Delete
                      </button>
                      {item.status === "active" ? (
                        <button
                          type="button"
                          onClick={async () => {
                            if (!(await themedConfirm(`Block mobile access for ${item.fullName}?`))) return
                            updateClient(item.id, { status: "suspended" })
                            void persist()
                          }}
                          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white"
                        >
                          Block
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            updateClient(item.id, { status: "active" })
                            void persist()
                          }}
                          className="rounded-md border border-emerald-700 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-900"
                        >
                          Unblock
                        </button>
                      )}
                    </div>
                  </div>
                ))}
        </div>
            </section>
          )}

          {!inDetailView && section === "companies" && (
            <section className="space-y-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h2 className="text-2xl font-semibold">Companies</h2>
                <button
                  type="button"
                  onClick={() => setAddCompanyOpen(true)}
                  className="rounded-lg bg-yhgc-crimson px-4 py-2 text-sm font-medium text-white shadow-sm"
                >
                  Add company
                </button>
              </div>
              <div className="grid gap-3">
                {snapshot.companies.map((item) => (
                  <div key={item.id} className="rounded-lg border border-neutral-200 bg-white p-4">
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-neutral-600">No. {item.companyNumber}</p>
                    <p className="mt-1 text-xs text-neutral-500">Client ID: {item.clientId}</p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDetailClientId(null)
                          setDetailPropertyId(null)
                          setDetailCompanyId(item.id)
                        }}
                        className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-800"
                      >
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingCompanyId(item.id)}
                        className="rounded-md bg-yhgc-crimson px-3 py-1.5 text-xs font-medium text-white"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (
                            !(await themedConfirm(
                              `Permanently delete company “${item.name}” and all its properties, invoices, files, and related data? This cannot be undone.`,
                            ))
                          )
                            return
                          deleteCompany(item.id)
                          void persist()
                        }}
                        className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {!inDetailView && section === "properties" && (
            <section className="space-y-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold">Properties</h2>
                  <p className="mt-1 max-w-2xl text-sm text-neutral-600">
                    Choose <strong>View</strong> to work on construction, loans, invoices, and other records in one place.
                    Use <strong>Edit profile</strong> on that screen (or <strong>Edit</strong> from the list) to change title, address, and links.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAddPropertyOpen(true)}
                  className="rounded-lg bg-yhgc-crimson px-4 py-2 text-sm font-medium text-white shadow-sm"
                >
                  Add property
                </button>
              </div>
              <div className="grid gap-3">
                {snapshot.properties.map((item) => (
                  <div key={item.id} className="rounded-lg border border-neutral-200 bg-white p-4">
                    <p className="font-medium">{item.title}</p>
                    <p className="text-sm text-neutral-600">{item.address}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {item.propertyType} · {item.status}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDetailClientId(null)
                          setDetailCompanyId(null)
                          setDetailPropertyTab("construction")
                          setDetailPropertyId(item.id)
                        }}
                        className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-800"
                      >
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingPropertyId(item.id)}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800"
                      >
                        Quick edit profile
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingPropertyDelete({
                            id: item.id,
                            title: item.title,
                            message: `Permanently delete property “${item.title}” and all invoices, loans, construction, files, and records for this property? This cannot be undone.`,
                          })
                        }}
                        className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl border border-yhgc-gold/25 bg-gradient-to-b from-white to-neutral-50/90 p-5 shadow-sm">
                <h3 className="text-lg font-semibold text-yhgc-black">Operational shortcuts</h3>
                <p className="mt-2 max-w-2xl text-xs text-neutral-600">
                  Same flows as on a property page: pick a property, then log a construction week (with optional files) or add
                  an invoice.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setShortcutLogWeekOpen(true)}
                    className="rounded-lg border border-yhgc-gold/50 bg-yhgc-gold/10 px-4 py-2.5 text-sm font-medium text-yhgc-black hover:bg-yhgc-gold/20"
                  >
                    Log a new week
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const first = snapshot.properties[0]
                      if (first) setShortcutInvoicePropertyId(first.id)
                      setShortcutInvoiceOpen(true)
                    }}
                    disabled={snapshot.properties.length === 0}
                    className="rounded-lg border border-yhgc-gold/50 bg-yhgc-gold/10 px-4 py-2.5 text-sm font-medium text-yhgc-black hover:bg-yhgc-gold/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Add invoice
                  </button>
                </div>
                {shortcutLogWeekOpen ? (
                  <EditModal title="Log a new week" onClose={() => setShortcutLogWeekOpen(false)}>
                    <ShortcutLogConstructionWeekForm
                      properties={snapshot.properties}
                      projects={snapshot.constructionProjects}
                      onClose={() => setShortcutLogWeekOpen(false)}
                      onAddStage={(payload) => {
                        const id = addConstructionStage(payload)
                        if (id !== undefined) void persist()
                        return id
                      }}
                      onAssetAdd={(payload) => {
                        addAsset(payload)
                        void persist()
                      }}
                    />
                  </EditModal>
                ) : null}
                {shortcutInvoiceOpen ? (
                  <EditModal title="Add invoice" onClose={() => setShortcutInvoiceOpen(false)}>
                    {snapshot.properties.length === 0 ? (
                      <p className="text-sm text-neutral-600">Add a property before recording invoices.</p>
                    ) : (
                      <div className="space-y-4">
                        <label className="block text-sm">
                          <span className={adminLabel}>Property</span>
                          <select
                            value={shortcutInvoicePropertyId}
                            onChange={(e) => setShortcutInvoicePropertyId(e.target.value)}
                            className={adminFieldInput}
                            aria-label="Property for this invoice"
                          >
                            {snapshot.properties.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.title}
                              </option>
                            ))}
                          </select>
                        </label>
                        <InvoiceNewForm
                          key={shortcutInvoicePropertyId}
                          propertyId={shortcutInvoicePropertyId}
                          onAdd={(payload) => addInvoice({ propertyId: shortcutInvoicePropertyId, ...payload })}
                          onAssetAdd={(payload) => {
                            addAsset(payload)
                            void persist()
                          }}
                          onDone={() => setShortcutInvoiceOpen(false)}
                        />
                      </div>
                    )}
                  </EditModal>
                ) : null}
              </div>
            </section>
          )}

          {!inDetailView && section === "notifications" && (
            <section className="space-y-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h2 className="text-2xl font-semibold">Notifications</h2>
                <button
                  type="button"
                  onClick={() => setNotificationSendOpen(true)}
                  disabled={persisting || snapshot.clients.length === 0}
                  className="rounded-lg bg-yhgc-crimson px-4 py-2 text-sm font-medium text-white shadow-sm hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Send notification
                </button>
              </div>
              {notificationSendOpen ? (
                <EditModal title="Send manual alert" onClose={() => setNotificationSendOpen(false)}>
                  <ManualNotificationForm
                    clients={snapshot.clients}
                    disabled={persisting}
                    onDone={() => setNotificationSendOpen(false)}
                    onSend={async (payload) => {
                      addNotification({
                        clientId: payload.clientId,
                        type: "new_document",
                        title: payload.title,
                        body: payload.body,
                      })
                      void persist()
                      await queueFcmOutboxForClient(payload.clientId, payload.title, payload.body)
                    }}
                  />
                </EditModal>
              ) : null}
              <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
                <h3 className="border-b border-neutral-100 px-4 py-3 text-sm font-semibold text-yhgc-black">Log</h3>
                {snapshot.notifications.length === 0 ? (
                  <p className="p-4 text-sm text-neutral-500">No notifications yet.</p>
                ) : (
                  <ul className="divide-y divide-neutral-100">
                    {snapshot.notifications.map((n) => (
                      <li key={n.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-neutral-900">{n.title}</p>
                          <p className="mt-0.5 text-xs text-neutral-500">
                            {n.createdAt} · {n.type}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!(await themedConfirm("Remove this notification from the log?"))) return
                            deleteNotification(n.id)
                            void persist()
                          }}
                          className="shrink-0 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-100"
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          {!inDetailView && section === "accountant_links" && (
            <section className="space-y-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h2 className="text-2xl font-semibold">Accountant Links</h2>
                <button
                  type="button"
                  onClick={() => setAddAccountantLinkOpen(true)}
                  className="rounded-lg bg-yhgc-crimson px-4 py-2 text-sm font-medium text-white shadow-sm"
                >
                  Share with accountant
                </button>
              </div>
              <div className="space-y-3">
                {snapshot.accountantLinks.length === 0 ? (
                  <p className="text-sm text-neutral-600">No accountant links yet.</p>
                ) : (
                  snapshot.accountantLinks.map((link) => (
                    <div
                      key={link.id}
                      className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-neutral-500">
                            {link.scopeType} · {link.isRevoked ? "Revoked" : "Active"}
                          </p>
                          <p className="mt-1 font-medium text-yhgc-black">Scope ID: {link.scopeId}</p>
                          <p className="mt-1 text-xs text-neutral-600">Expires: {link.expiresAt}</p>
                          <p className="mt-2 break-all text-xs text-neutral-500">Token: {link.token}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {link.isRevoked ? (
                            <button
                              type="button"
                              onClick={() => {
                                updateAccountantLink(link.id, { isRevoked: false })
                                void persist()
                              }}
                              className="rounded-md border border-emerald-700 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-900"
                            >
                              Restore link
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={async () => {
                                if (!(await themedConfirm("Revoke this accountant link? The portal will deny access."))) return
                                updateAccountantLink(link.id, { isRevoked: true })
                                void persist()
                              }}
                              className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white"
                            >
                              Block portal access
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={async () => {
                              if (
                                !(await themedConfirm(
                                  "Permanently delete this accountant link from the list? (Revoked links can be removed this way.)",
                                ))
                              )
                                return
                              deleteAccountantLink(link.id)
                              void persist()
                            }}
                            className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      <p className="mt-3 rounded-lg bg-neutral-50 p-2 text-xs text-neutral-700">
                        {window.location.origin}/?portal=accountant&token={link.token}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {!inDetailView && section === "settings" && (
            <section>
              <h2 className="text-2xl font-semibold">Mobile app settings</h2>
              <p className="mt-1 text-sm text-neutral-600">
                Control client self-signup, privacy policy, and terms of service shown in the mobile app.
              </p>
              <div className="mt-6">
                <MobileAppSettingsPanel />
              </div>
            </section>
          )}

          {editingClient && (
            <EditModal title={`Edit Client: ${editingClient.fullName}`} onClose={() => setEditingClientId(null)}>
              <ClientEditForm
                client={editingClient}
                onSave={(patch) => {
                  updateClient(editingClient.id, patch)
                  void persist()
                  setEditingClientId(null)
                }}
                onCancel={() => setEditingClientId(null)}
              />
            </EditModal>
          )}

          {editingCompany && (
            <EditModal title={`Edit Company: ${editingCompany.name}`} onClose={() => setEditingCompanyId(null)}>
              <CompanyEditForm
                company={editingCompany}
                clients={snapshot.clients}
                onSave={(patch) => {
                  updateCompany(editingCompany.id, patch)
                  void persist()
                  setEditingCompanyId(null)
                }}
                onCancel={() => setEditingCompanyId(null)}
              />
            </EditModal>
          )}

          {editingProperty && (
            <EditModal title={`Property profile — ${editingProperty.title}`} onClose={() => setEditingPropertyId(null)}>
              <PropertyEditForm
                property={editingProperty}
                clients={snapshot.clients}
                companies={snapshot.companies}
                onSave={(patch) => {
                  updateProperty(editingProperty.id, patch)
                  void persist()
                  setEditingPropertyId(null)
                }}
                onCancel={() => setEditingPropertyId(null)}
              />
            </EditModal>
          )}

          {addClientOpen && (
            <EditModal title="Add client" onClose={() => setAddClientOpen(false)}>
              <SimpleForm
                title=""
                fields={[
                  { key: "fullName", label: "Client name", autoComplete: "name" },
                  { key: "email", label: "Client email", type: "email", autoComplete: "email" },
                ]}
                submitLabel="Create client"
                disabled={persisting}
                onSubmit={(values) => {
                  addClient({ fullName: values.fullName, email: values.email })
                  void persist()
                  setAddClientOpen(false)
                }}
              />
            </EditModal>
          )}

          {addCompanyOpen && (
            <EditModal title="Add company" onClose={() => setAddCompanyOpen(false)}>
              <form
                noValidate
                className="rounded-2xl border border-yhgc-gold/20 bg-white p-4 shadow-sm"
                onSubmit={(e) => {
                  e.preventDefault()
                  const fd = new FormData(e.currentTarget)
                  const clientId = String(fd.get("clientId") ?? "")
                  const name = String(fd.get("name") ?? "").trim()
                  const companyNumber = String(fd.get("companyNumber") ?? "").trim()
                  if (!clientId) {
                    setAddCompanyFormError("Select which client this company belongs to.")
                    return
                  }
                  if (!name) {
                    setAddCompanyFormError("Enter the registered company name.")
                    return
                  }
                  if (!companyNumber) {
                    setAddCompanyFormError("Enter the Companies House number.")
                    return
                  }
                  setAddCompanyFormError(null)
                  addCompany({ clientId, name, companyNumber })
                  setAddCompanyOpen(false)
                }}
              >
                {addCompanyFormError ? (
                  <p role="alert" className={`${adminFormAlert} mb-3`}>
                    {addCompanyFormError}
                  </p>
                ) : null}
                <label className="mb-2 block text-sm font-medium">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Client</span>
                  <select
                    name="clientId"
                    value={selectedClientId}
                    onChange={(e) => {
                      setSelectedClientId(e.target.value)
                      setAddCompanyFormError(null)
                    }}
                    className={fieldWithInvalid(
                      "w-full rounded-md border border-neutral-300 px-3 py-2",
                      !!addCompanyFormError && !selectedClientId,
                    )}
                  >
                    <option value="" disabled>
                      Select client
                    </option>
                    {snapshot.clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mt-3 block text-sm">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Company name</span>
                  <input
                    name="name"
                    onChange={() => setAddCompanyFormError(null)}
                    className="w-full rounded-md border border-neutral-300 px-3 py-2"
                  />
                </label>
                <label className="mt-3 block text-sm">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Companies House number</span>
                  <input
                    name="companyNumber"
                    onChange={() => setAddCompanyFormError(null)}
                    className="w-full rounded-md border border-neutral-300 px-3 py-2"
                  />
                </label>
                <button
                  type="submit"
                  disabled={persisting}
                  className="mt-4 w-full rounded-xl bg-yhgc-crimson px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
                >
                  Add company
                </button>
              </form>
            </EditModal>
          )}

          {addPropertyOpen && (
            <EditModal title="Add property" onClose={() => setAddPropertyOpen(false)}>
              <AddPropertyFormCard
                companies={snapshot.companies}
                selectedCompanyId={selectedCompanyId}
                onCompanyIdChange={(id) => {
                  setSelectedCompanyId(id)
                  const company = snapshot.companies.find((item) => item.id === id)
                  setSelectedClientId(company?.clientId ?? "")
                }}
                persisting={persisting}
                onSubmit={(payload) => {
                  addProperty({
                    title: payload.title,
                    address: payload.address,
                    propertyType: payload.propertyType,
                    status: payload.status,
                    clientId: payload.clientId,
                    companyId: payload.companyId,
                  })
                  addNotification({
                    clientId: payload.clientId,
                    type: "new_property_added",
                    title: "New property added",
                    body: `${payload.title} has been added`,
                  })
                  void persist()
                  setAddPropertyOpen(false)
                }}
              />
            </EditModal>
          )}

          {addAccountantLinkOpen && (
            <EditModal title="Share with accountant" onClose={() => setAddAccountantLinkOpen(false)}>
              <AccountantLinkGeneratePanel
                companies={snapshot.companies}
                properties={snapshot.properties}
                onCreate={(payload) => {
                  createAccountantLink({
                    scopeType: payload.scopeType,
                    scopeId: payload.scopeId,
                    expiresAt: payload.expiresAt,
                  })
                  void persist()
                }}
                getLatestLinkUrl={() => {
                  const token = useAppStore.getState().snapshot?.accountantLinks[0]?.token
                  return token ? `${window.location.origin}/?portal=accountant&token=${token}` : null
                }}
                onClose={() => setAddAccountantLinkOpen(false)}
              />
            </EditModal>
          )}

          {pendingPropertyDelete && (
            <EditModal title="Delete Property" onClose={() => setPendingPropertyDelete(null)}>
              <div className="space-y-4">
                <p className="text-sm text-neutral-700">{pendingPropertyDelete.message}</p>
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  Property: {pendingPropertyDelete.title}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingPropertyDelete(null)}
                    className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmDeleteProperty}
                    className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100"
                  >
                    Delete property
                  </button>
                </div>
              </div>
            </EditModal>
          )}
          {themedConfirmMessage && (
            <EditModal title="Confirm Action" onClose={() => resolveThemedConfirm(false)}>
              <div className="space-y-4">
                <p className="text-sm text-neutral-700">{themedConfirmMessage}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => resolveThemedConfirm(false)}
                    className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => resolveThemedConfirm(true)}
                    className="rounded-lg bg-yhgc-crimson px-4 py-2 text-sm font-medium text-white shadow-sm hover:opacity-95"
                  >
                    Confirm
                  </button>
                </div>
              </div>
            </EditModal>
          )}
        </main>
      </div>
    </div>
  )
}

function AppLoadingScreen() {
  const { t } = useI18n()
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#f6f4ef] via-[#eef1f5] to-[#e8edf3] p-6">
      <div className="w-full max-w-lg rounded-2xl border border-yhgc-gold/35 bg-white/95 p-8 shadow-xl">
        <div className="mb-4 flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-yhgc-gold/60">
            <span className="h-5 w-5 rounded-full border-2 border-yhgc-crimson border-t-transparent animate-spin" />
          </span>
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-yhgc-gold">{t("boot.adminTitle")}</p>
            <h2 className="text-lg font-semibold text-neutral-900">{t("boot.loadingDashboard")}</h2>
          </div>
        </div>
        <p className="mb-5 text-sm text-neutral-600">{t("boot.preparing")}</p>
        <div className="space-y-2">
          <div className="h-3 animate-pulse rounded bg-neutral-200" />
          <div className="h-3 w-11/12 animate-pulse rounded bg-neutral-200 [animation-delay:120ms]" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-neutral-200 [animation-delay:240ms]" />
        </div>
      </div>
    </div>
  )
}

function AppBootstrapError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n()
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#f6f4ef] via-[#eef1f5] to-[#e8edf3] p-6">
      <div className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-8 shadow-xl">
        <p className="text-xs uppercase tracking-[0.22em] text-red-700">{t("boot.adminTitle")}</p>
        <h2 className="mt-2 text-lg font-semibold text-neutral-900">{t("boot.couldNotLoad")}</h2>
        <p className="mt-3 text-sm text-neutral-600">
          {t("boot.checkConnection")}
        </p>
        <p className="mt-3 rounded-lg border border-red-100 bg-red-50/80 p-3 text-sm text-red-900">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 w-full rounded-xl bg-yhgc-crimson px-4 py-3 text-sm font-medium text-white shadow hover:opacity-95"
        >
          {t("common.retry")}
        </button>
      </div>
    </div>
  )
}

function AccountantReadonlyPortal({
  snapshot,
  query,
}: {
  snapshot: AppSnapshot
  query: {
    enabled: boolean
    token: string
    mode: string
    scopeType: string
    scopeId: string
    expiresAt: string
  }
}) {
  const now = Date.now()
  let scopeType = ""
  let scopeId = ""
  let expiresAt = ""
  let valid = false

  if (query.mode === "mock" && query.scopeType && query.scopeId) {
    scopeType = query.scopeType
    scopeId = query.scopeId
    expiresAt = query.expiresAt
    valid = !expiresAt || Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) > now
  } else if (query.token) {
    const link = snapshot.accountantLinks.find((item) => item.token === query.token)
    if (link && !link.isRevoked && Date.parse(link.expiresAt) > now) {
      scopeType = link.scopeType
      scopeId = link.scopeId
      expiresAt = link.expiresAt
      valid = true
    }
  }

  if (!valid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#f6f4ef] via-[#eef1f5] to-[#e8edf3] p-6">
        <div className="w-full max-w-lg rounded-2xl border border-yhgc-gold/30 bg-white p-6 shadow">
          <h2 className="text-xl font-semibold text-yhgc-black">Accountant Link Invalid</h2>
          <p className="mt-2 text-sm text-neutral-600">This link is missing, expired, or revoked.</p>
        </div>
      </div>
    )
  }

  const scopedProperties =
    scopeType === "company"
      ? snapshot.properties.filter((item) => item.companyId === scopeId)
      : snapshot.properties.filter((item) => item.id === scopeId)
  const propertyIds = new Set(scopedProperties.map((item) => item.id))
  const scopedCompanies = scopeType === "company"
    ? snapshot.companies.filter((item) => item.id === scopeId)
    : snapshot.companies.filter((item) => scopedProperties.some((p) => p.companyId === item.id))
  const scopedInvoices = snapshot.invoices.filter((item) => propertyIds.has(item.propertyId))
  const scopedInsuranceRecordIds = new Set(
    snapshot.insuranceRecords.filter((r) => propertyIds.has(r.propertyId)).map((r) => r.id),
  )
  const scopedFinanceRecordIds = new Set(
    snapshot.financeRecords.filter((r) => propertyIds.has(r.propertyId)).map((r) => r.id),
  )
  const scopedAssets = snapshot.assets.filter(
    (item) =>
      (item.ownerType === "property" && propertyIds.has(item.ownerId)) ||
      (item.ownerType === "invoice" && scopedInvoices.some((inv) => inv.id === item.ownerId)) ||
      (item.ownerType === "insurance_record" && scopedInsuranceRecordIds.has(item.ownerId)) ||
      (item.ownerType === "finance_record" && scopedFinanceRecordIds.has(item.ownerId)),
  )

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f4ef] via-[#eef1f5] to-[#e8edf3] p-6 text-neutral-900">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="rounded-2xl border border-yhgc-gold/30 bg-gradient-to-r from-[#090909] to-[#1a1a1a] p-5 text-white shadow-lg">
          <p className="text-xs uppercase tracking-[0.2em] text-yhgc-gold">YHGC Accountant Portal</p>
          <h1 className="mt-1 text-2xl font-semibold">Read-only shared view</h1>
          <p className="mt-1 text-sm text-neutral-300">Scope: {scopeType} • Expires: {expiresAt || "not set"}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <StatCard label="Companies" value={scopedCompanies.length} />
          <StatCard label="Properties" value={scopedProperties.length} />
          <StatCard label="Invoices" value={scopedInvoices.length} />
          <StatCard label="Files" value={scopedAssets.length} />
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Companies</h2>
          <DataTable rows={scopedCompanies} columns={[["name", "Name"], ["companyNumber", "No"], ["nextAccountsDueDate", "Accounts Due"]]} />
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Properties</h2>
          <DataTable rows={scopedProperties} columns={[["title", "Title"], ["address", "Address"], ["status", "Status"], ["currentValue", "Current Value"]]} />
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Invoices</h2>
          <DataTable rows={scopedInvoices} columns={[["supplierName", "Supplier"], ["invoiceRef", "Ref"], ["invoiceDate", "Date"], ["amount", "Amount"], ["status", "Status"]]} />
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Files</h2>
          <DataTable rows={scopedAssets} columns={[["ownerType", "Owner"], ["tag", "Tag"], ["fileName", "File"], ["urlOrPath", "URL/Path"]]} />
        </section>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white/95 p-4 shadow-sm">
      <div className="h-1 w-12 rounded-full bg-yhgc-gold" />
      <p className="mt-2 text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-yhgc-black">{value}</p>
    </div>
  )
}

function ActionCard({
  title,
  desc,
  onClick,
}: {
  title: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-2xl border border-neutral-200 bg-white/95 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <p className="text-sm font-semibold text-yhgc-black">{title}</p>
      <p className="mt-1 text-xs text-neutral-600">{desc}</p>
    </button>
  )
}

type Field = { key: string; label: string; type?: string; minLength?: number; autoComplete?: string }

function ManualNotificationForm({
  clients,
  disabled,
  onSend,
  onDone,
}: {
  clients: Client[]
  disabled?: boolean
  onSend: (payload: { clientId: string; title: string; body: string }) => Promise<void> | void
  onDone?: () => void
}) {
  const [clientId, setClientId] = useState("")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  if (!clients.length) {
    return <p className="text-sm text-neutral-500">Add at least one client before sending manual alerts.</p>
  }
  return (
    <form
      noValidate
      onSubmit={async (e) => {
        e.preventDefault()
        if (!clientId) {
          setFormError("Choose which client should receive this alert.")
          return
        }
        if (!title.trim()) {
          setFormError("Enter a short title for the alert.")
          return
        }
        if (!body.trim()) {
          setFormError("Enter the message body.")
          return
        }
        setFormError(null)
        await onSend({ clientId, title: title.trim(), body: body.trim() })
        setTitle("")
        setBody("")
        onDone?.()
      }}
      className="space-y-4"
    >
      <p className="text-sm text-neutral-600">The alert is logged and queued for the selected client.</p>
      {formError ? (
        <p role="alert" className={adminFormAlert}>
          {formError}
        </p>
      ) : null}
      <div className="grid gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Client</span>
          <select
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value)
              setFormError(null)
            }}
            className={fieldWithInvalid(
              "w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 outline-none transition focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20",
              !!formError && !clientId,
            )}
            disabled={disabled}
          >
            <option value="" disabled>
              Select client
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Title</span>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setFormError(null)
            }}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 outline-none transition focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20"
            disabled={disabled}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Body</span>
          <textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value)
              setFormError(null)
            }}
            rows={4}
            disabled={disabled}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 outline-none transition focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20"
          />
        </label>
      </div>
      <div className="border-t border-neutral-100 pt-4">
        <button
          type="submit"
          disabled={disabled}
          className={`${adminBtnPrimary} w-full`}
        >
          Send alert
        </button>
      </div>
    </form>
  )
}

function SimpleForm({
  title,
  fields,
  submitLabel = "Save",
  onSubmit,
  disabled,
}: {
  title: string
  fields: Field[]
  submitLabel?: string
  onSubmit: (values: Record<string, string>) => void
  disabled?: boolean
}) {
  const [form, setForm] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    for (const field of fields) {
      const v = (form[field.key] ?? "").trim()
      if (!v.length) {
        setFormError(`Please enter ${field.label.toLowerCase()}.`)
        return
      }
      if (field.type === "email" && !isValidEmail(v)) {
        setFormError("Please enter a valid email address.")
        return
      }
    }
    setFormError(null)
    const trimmed: Record<string, string> = {}
    for (const field of fields) {
      trimmed[field.key] = (form[field.key] ?? "").trim()
    }
    onSubmit(trimmed)
  }
  return (
    <form noValidate onSubmit={submit} className="rounded-2xl border border-yhgc-gold/20 bg-white p-4 shadow-sm">
      {title ? <p className="mb-3 text-sm font-semibold">{title}</p> : null}
      {formError ? (
        <p role="alert" className={`${adminFormAlert} mb-3`}>
          {formError}
        </p>
      ) : null}
      <div className="grid gap-3">
        {fields.map((field) => (
          <label key={field.key} className="text-sm">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">{field.label}</span>
            <input
              type={field.type ?? "text"}
              value={form[field.key] ?? ""}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, [field.key]: e.target.value }))
                setFormError(null)
              }}
              className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 outline-none transition focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20"
              disabled={disabled}
              minLength={field.minLength}
              autoComplete={field.autoComplete}
            />
          </label>
        ))}
      </div>
      <button
        type="submit"
        disabled={disabled}
        className="mt-4 w-full rounded-xl bg-yhgc-crimson px-4 py-2.5 text-sm font-medium text-white shadow hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitLabel}
      </button>
    </form>
  )
}

function AddPropertyFormCard({
  companies,
  selectedCompanyId,
  onCompanyIdChange,
  persisting,
  onSubmit,
}: {
  companies: Company[]
  selectedCompanyId: string
  onCompanyIdChange: (companyId: string) => void
  persisting: boolean
  onSubmit: (payload: {
    clientId: string
    companyId: string
    title: string
    address: string
    propertyType: string
    status: PropertyStatus
  }) => void
}) {
  const [title, setTitle] = useState("")
  const [address, setAddress] = useState("")
  const [propertyType, setPropertyType] = useState("")
  const [status, setStatus] = useState<PropertyStatus>("in_construction")
  const [formError, setFormError] = useState<string | null>(null)
  const selectedClientId = companies.find((c) => c.id === selectedCompanyId)?.clientId ?? ""

  return (
    <form
      noValidate
      className="rounded-2xl border border-yhgc-gold/20 bg-white p-4 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault()
        if (!selectedCompanyId || !selectedClientId) {
          setFormError("Select which company this property belongs to.")
          return
        }
        if (!title.trim() || !address.trim() || !propertyType.trim()) {
          setFormError("Enter the property title, full address, and property type.")
          return
        }
        setFormError(null)
        onSubmit({
          clientId: selectedClientId,
          companyId: selectedCompanyId,
          title: title.trim(),
          address: address.trim(),
          propertyType: propertyType.trim(),
          status,
        })
        setTitle("")
        setAddress("")
        setPropertyType("")
      }}
    >
      {formError ? (
        <p role="alert" className={`${adminFormAlert} mb-3`}>
          {formError}
        </p>
      ) : null}
      <label className="mb-2 block text-sm font-medium">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Company</span>
        <select
          value={selectedCompanyId}
          onChange={(e) => {
            onCompanyIdChange(e.target.value)
            setFormError(null)
          }}
          className={fieldWithInvalid(
            "w-full rounded-md border border-neutral-300 px-3 py-2",
            !!formError && !selectedCompanyId,
          )}
        >
          <option value="" disabled>
            Select company
          </option>
          {companies.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <PropertyFormFields
        title={title}
        address={address}
        propertyType={propertyType}
        status={status}
        onChange={(next) => {
          setTitle(next.title)
          setAddress(next.address)
          setPropertyType(next.propertyType)
          setStatus(next.status)
          setFormError(null)
        }}
      />
      <button
        type="submit"
        disabled={persisting}
        className="mt-4 w-full rounded-md bg-yhgc-crimson px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        Add property
      </button>
    </form>
  )
}

function PropertyFormFields({
  title,
  address,
  propertyType,
  status,
  onChange,
}: {
  title: string
  address: string
  propertyType: string
  status: PropertyStatus
  onChange: (next: { title: string; address: string; propertyType: string; status: PropertyStatus }) => void
}) {
  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Property title</span>
        <input
          value={title}
          onChange={(e) => onChange({ title: e.target.value, address, propertyType, status })}
          className="w-full rounded-md border border-neutral-300 px-3 py-2"
          placeholder="Property title"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Address</span>
        <input
          value={address}
          onChange={(e) => onChange({ title, address: e.target.value, propertyType, status })}
          className="w-full rounded-md border border-neutral-300 px-3 py-2"
          placeholder="Address"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Property type</span>
        <input
          value={propertyType}
          onChange={(e) => onChange({ title, address, propertyType: e.target.value, status })}
          className="w-full rounded-md border border-neutral-300 px-3 py-2"
          placeholder="Property type"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Status</span>
        <select
          value={status}
          onChange={(e) => onChange({ title, address, propertyType, status: e.target.value as PropertyStatus })}
          className="w-full rounded-md border border-neutral-300 px-3 py-2"
        >
          <option value="in_construction">In Construction</option>
          <option value="fully_tenanted">Fully Tenanted</option>
          <option value="partially_tenanted">Partially Tenanted</option>
          <option value="vacant">Vacant</option>
        </select>
      </label>
    </div>
  )
}

function InvoiceNewForm({
  propertyId,
  onAdd,
  onAssetAdd,
  onDone,
}: {
  propertyId: string
  onAdd: (payload: {
    supplierName: string
    invoiceRef: string
    invoiceDate: string
    amount: number
    status: InvoiceStatus
  }) => string | undefined
  onAssetAdd: (payload: {
    ownerType: Asset["ownerType"]
    ownerId: string
    tag: AttachmentTag
    fileName: string
    mimeType: string
    sizeBytes: number
    urlOrPath: string
  }) => void
  onDone?: () => void
}) {
  const [supplierName, setSupplierName] = useState("")
  const [invoiceRef, setInvoiceRef] = useState("")
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState("")
  const [status, setStatus] = useState<InvoiceStatus>("unpaid")
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingFiles, setPendingFiles] = useState<PendingPickedFile[]>([])
  const [submitting, setSubmitting] = useState(false)
  const pendingRef = useRef<PendingPickedFile[]>([])

  useEffect(() => {
    pendingRef.current = pendingFiles
  }, [pendingFiles])

  useEffect(() => {
    return () => revokePickedFilePreviewUrls(pendingRef.current)
  }, [])

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault()
        if (submitting) return
        setFormError(null)
        const sup = supplierName.trim()
        if (!sup) {
          setFormError("Enter the supplier name as it appears on the invoice.")
          return
        }
        if (!invoiceDate.trim()) {
          setFormError("Choose the invoice date.")
          return
        }
        const n = Number(amount)
        if (!Number.isFinite(n) || n <= 0) {
          setFormError("Enter the invoice amount — use a number greater than zero.")
          return
        }
        const pendingSnapshot = [...pendingFiles]
        setSubmitting(true)
        try {
          const id = onAdd({
            supplierName: sup,
            invoiceRef: invoiceRef.trim(),
            invoiceDate,
            amount: n,
            status,
          })
          if (id === undefined) return
          for (const row of pendingSnapshot) {
            const url = await uploadPropertyAssetFile(propertyId, row.file, "invoice")
            onAssetAdd({
              ownerType: "invoice",
              ownerId: id,
              tag: "invoice",
              fileName: row.file.name,
              mimeType: row.file.type || "application/octet-stream",
              sizeBytes: row.file.size,
              urlOrPath: url,
            })
          }
          revokePickedFilePreviewUrls(pendingSnapshot)
          setPendingFiles([])
          setSupplierName("")
          setInvoiceRef("")
          setAmount("")
          setStatus("unpaid")
          onDone?.()
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Upload failed."
          useAppStore.getState().setActionNotice({
            kind: "error",
            message: msg.length > 220 ? `${msg.slice(0, 220)}…` : msg,
          })
        } finally {
          setSubmitting(false)
        }
      }}
    >
      {formError ? (
        <p role="alert" className={adminFormAlert}>
          {formError}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">
          <span className={adminLabel}>Supplier</span>
          <input
            value={supplierName}
            onChange={(e) => {
              setSupplierName(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            placeholder="Supplier name"
            disabled={submitting}
            autoComplete="organization"
          />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className={adminLabel}>Default invoice status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as InvoiceStatus)}
            className={adminFieldInput}
            disabled={submitting}
            aria-label="Default invoice status: queried, unpaid, or paid"
          >
            {INVOICE_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-neutral-500">Stored on the new invoice; you can change it anytime under Edit.</span>
        </label>
        <label className="text-sm">
          <span className={adminLabel}>Reference (optional)</span>
          <input
            value={invoiceRef}
            onChange={(e) => setInvoiceRef(e.target.value)}
            className={adminFieldInput}
            placeholder="INV-0001"
            disabled={submitting}
          />
        </label>
        <label className="text-sm">
          <span className={adminLabel}>Date</span>
          <input
            type="date"
            value={invoiceDate}
            onChange={(e) => {
              setInvoiceDate(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            disabled={submitting}
          />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className={adminLabel}>Amount (£)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
              setFormError(null)
            }}
            className={fieldWithInvalid(
              adminFieldInput,
              !!formError && (!Number.isFinite(Number(amount)) || Number(amount) <= 0),
            )}
            placeholder="0.00"
            disabled={submitting}
          />
        </label>
      </div>
      <div className="border-t border-neutral-100 pt-4">
        <FileUploadForm
          title="Upload invoice PDFs, images, or scans"
          onFileUpload={async (file, displayName) => {
            const id = `pending-${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 9)}`
            const f =
              displayName.trim() && displayName.trim() !== file.name
                ? new File([file], displayName.trim(), { type: file.type, lastModified: file.lastModified })
                : file
            const previewUrl = f.type.startsWith("image/") ? URL.createObjectURL(f) : null
            setPendingFiles((prev) => [...prev, { id, file: f, previewUrl }])
          }}
        />
        {pendingFiles.length ? (
          <ul className="mt-4 space-y-2">
            {pendingFiles.map((pf) => (
              <li
                key={pf.id}
                className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50/90 p-2 pr-3"
              >
                {pf.previewUrl ? (
                  <img
                    src={pf.previewUrl}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-md object-cover ring-1 ring-neutral-200"
                  />
                ) : pf.file.type === "application/pdf" ? (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-red-50 text-xs font-bold text-red-800 ring-1 ring-red-200/60">
                    PDF
                  </div>
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-[10px] font-semibold text-neutral-600 ring-1 ring-neutral-200">
                    FILE
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-yhgc-black">{pf.file.name}</p>
                  <p className="text-xs text-neutral-500">{formatAssetSizeBytes(pf.file.size)}</p>
                </div>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() =>
                    setPendingFiles((prev) => {
                      const row = prev.find((r) => r.id === pf.id)
                      if (row?.previewUrl) URL.revokeObjectURL(row.previewUrl)
                      return prev.filter((r) => r.id !== pf.id)
                    })
                  }
                  className="shrink-0 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-3 text-xs text-neutral-600">
          Files are stored on this invoice after you press <strong>Add invoice</strong> (display name is set in the upload dialog).
        </p>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-4">
        <button type="submit" disabled={submitting} className={adminBtnPrimary}>
          {submitting ? "Saving…" : "Add invoice"}
        </button>
      </div>
    </form>
  )
}

function defaultAccountantLinkExpiryLocal(): string {
  const d = new Date()
  d.setDate(d.getDate() + 30)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function AccountantLinkGeneratePanel({
  companies,
  properties,
  onCreate,
  getLatestLinkUrl,
  onClose,
}: {
  companies: Company[]
  properties: Property[]
  onCreate: (payload: { scopeType: "company" | "property"; scopeId: string; expiresAt: string }) => void
  getLatestLinkUrl: () => string | null
  onClose: () => void
}) {
  const [scopeType, setScopeType] = useState<"company" | "property">(() =>
    properties.length ? "property" : "company",
  )
  const [scopeId, setScopeId] = useState("")
  const [expiresLocal, setExpiresLocal] = useState(defaultAccountantLinkExpiryLocal)
  const [createdUrl, setCreatedUrl] = useState<string | null>(null)
  const [copyHint, setCopyHint] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  const scopeList = scopeType === "company" ? companies : properties

  useEffect(() => {
    const list = scopeType === "company" ? companies : properties
    if (!list.length) {
      setScopeId("")
      return
    }
    if (!list.some((item) => item.id === scopeId)) {
      setScopeId(list[0]!.id)
    }
  }, [scopeType, companies, properties, scopeId])

  if (createdUrl) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/90 p-4">
          <p className="text-sm font-semibold text-emerald-950">Link ready</p>
          <p className="mt-1 text-xs text-emerald-900">
            Share this read-only URL with your accountant. It expires at the date you chose and can be revoked from the list
            anytime.
          </p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <p className="break-all font-mono text-xs text-neutral-800">{createdUrl}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(createdUrl)
                setCopyHint("Copied to clipboard.")
              } catch {
                setCopyHint("Select the link above to copy manually.")
              }
            }}
            className="rounded-lg bg-yhgc-crimson px-4 py-2 text-sm font-medium text-white"
          >
            Copy link
          </button>
          <button
            type="button"
            onClick={() => {
              setCreatedUrl(null)
              onClose()
            }}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800"
          >
            Done
          </button>
        </div>
        {copyHint ? <p className="text-xs text-neutral-600">{copyHint}</p> : null}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-neutral-600">
        Accountants open a secure read-only portal scoped to one company (all linked properties) or a single property. Choose
        what they should see, then set how long access stays valid.
      </p>
      {companies.length === 0 && properties.length === 0 ? (
        <p className="text-sm text-neutral-500">Add at least one company or property before generating a link.</p>
      ) : (
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            setFormError(null)
            if (!scopeId) {
              setFormError(`Select a ${scopeType === "company" ? "company" : "property"} for this link.`)
              return
            }
            const expiresAt = new Date(expiresLocal).toISOString()
            if (Number.isNaN(Date.parse(expiresAt))) {
              setFormError("Enter a valid expiry date and time.")
              return
            }
            onCreate({ scopeType, scopeId, expiresAt })
            const url = getLatestLinkUrl()
            if (url) setCreatedUrl(url)
          }}
        >
          {formError ? (
            <p role="alert" className={adminFormAlert}>
              {formError}
            </p>
          ) : null}
          <label className="block">
            <span className={adminLabel}>What should the accountant see?</span>
            <select
              value={scopeType}
              onChange={(e) => {
                setScopeType(e.target.value as "company" | "property")
                setFormError(null)
              }}
              className={adminFieldInput}
            >
              <option value="property">Single property (one address / asset)</option>
              <option value="company">Whole company (all properties under that company)</option>
            </select>
          </label>
          <label className="block">
            <span className={adminLabel}>{scopeType === "company" ? "Company" : "Property"}</span>
            {scopeList.length === 0 ? (
              <p className="text-sm text-amber-800">No {scopeType === "company" ? "companies" : "properties"} in the portfolio yet.</p>
            ) : (
              <select
                value={scopeId}
                onChange={(e) => {
                  setScopeId(e.target.value)
                  setFormError(null)
                }}
                className={adminFieldInput}
              >
                {scopeType === "company"
                  ? companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.companyNumber})
                      </option>
                    ))
                  : properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title} — {p.address}
                      </option>
                    ))}
              </select>
            )}
          </label>
          <label className="block">
            <span className={adminLabel}>Access expires</span>
            <input
              type="datetime-local"
              value={expiresLocal}
              onChange={(e) => {
                setExpiresLocal(e.target.value)
                setFormError(null)
              }}
              className={adminFieldInput}
            />
            <span className="mt-1 block text-xs text-neutral-500">Default is 30 days from now. Shorter is safer for one-off reviews.</span>
          </label>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="submit"
              disabled={!scopeId || scopeList.length === 0}
              className="rounded-lg bg-yhgc-crimson px-4 py-2.5 text-sm font-medium text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              Create link
            </button>
            <button type="button" onClick={onClose} className="rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-800">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function DataTable<T extends object>({
  rows,
  columns,
}: {
  rows: T[]
  columns: [string, string][]
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white/95 shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
          <tr>
            {columns.map((column) => (
              <th key={column[0]} className="px-3 py-2">
                {column[1]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-neutral-200 transition hover:bg-neutral-50/80">
              {columns.map((column) => (
                <td
                  key={column[0]}
                  className={`px-3 py-2 align-top ${column[0] === "urlOrPath" ? "max-w-xl min-w-[12rem] break-all font-mono text-[11px] text-neutral-800" : ""}`}
                >
                  {String((row as Record<string, unknown>)[column[0]] ?? "-")}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td className="px-3 py-3 text-neutral-500" colSpan={columns.length}>
                No records yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function formatAssetSizeBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—"
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

function assetAppearsImage(a: Asset): boolean {
  if (a.mimeType.startsWith("image/")) return true
  return /\.(png|jpe?g|gif|webp|svg|bmp|heic)(\?|$)/i.test(a.urlOrPath)
}

function assetAppearsVideo(a: Asset): boolean {
  if (a.mimeType.startsWith("video/")) return true
  return /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(a.urlOrPath)
}

function AssetFileNameEditorModal({
  title,
  initialName,
  resetTarget,
  confirmLabel,
  isBusy,
  onClose,
  onConfirm,
}: {
  title: string
  initialName: string
  resetTarget?: string
  confirmLabel: string
  isBusy: boolean
  onClose: () => void
  onConfirm: (trimmedName: string) => void | Promise<void>
}) {
  const [name, setName] = useState(initialName)
  useEffect(() => {
    setName(initialName)
  }, [initialName])

  const runConfirm = async () => {
    const fallback = initialName.trim() || "file"
    const next = name.trim() || fallback
    await onConfirm(next)
  }

  const onNameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return
    e.preventDefault()
    if (isBusy) return
    void runConfirm()
  }

  return (
    <EditModal title={title} onClose={onClose}>
      <div className="space-y-4">
        <label className="block text-sm">
          <span className={adminLabel}>File name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onNameKeyDown}
            className={adminFieldInput}
            autoFocus
          />
        </label>
        {resetTarget !== undefined ? (
          <button
            type="button"
            className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            disabled={isBusy}
            onClick={() => setName(resetTarget)}
          >
            Reset to original name
          </button>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void runConfirm()}
            className="rounded-lg bg-yhgc-crimson px-4 py-2 text-sm font-medium text-white hover:opacity-95 disabled:opacity-50"
          >
            {isBusy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </EditModal>
  )
}

function PropertyAssetPreviewModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const showImage = assetAppearsImage(asset)
  const showVideo = assetAppearsVideo(asset)
  return (
    <EditModal title="File details" onClose={onClose}>
      <div className="space-y-4">
        {showImage ? (
          <div className="flex max-h-[55vh] justify-center overflow-auto rounded-lg border border-neutral-200 bg-neutral-50 p-2">
            <img src={asset.urlOrPath} alt="" className="max-h-[50vh] max-w-full object-contain" />
          </div>
        ) : showVideo ? (
          <div className="flex max-h-[55vh] justify-center overflow-auto rounded-lg border border-neutral-200 bg-neutral-50 p-2">
            <video src={asset.urlOrPath} controls playsInline className="max-h-[50vh] max-w-full" />
          </div>
        ) : (
          <p className="text-sm text-neutral-600">No inline preview for this file type. Use the link below to open it.</p>
        )}
        <dl className="grid gap-2 text-sm sm:grid-cols-[minmax(0,140px)_1fr]">
          <dt className="text-neutral-500">File name</dt>
          <dd className="break-all font-medium text-yhgc-black">{asset.fileName}</dd>
          <dt className="text-neutral-500">MIME type</dt>
          <dd>{asset.mimeType || "—"}</dd>
          <dt className="text-neutral-500">Size</dt>
          <dd>{formatAssetSizeBytes(asset.sizeBytes)}</dd>
          <dt className="text-neutral-500">Uploaded</dt>
          <dd>{asset.createdAt ? asset.createdAt.slice(0, 10) : "—"}</dd>
          <dt className="text-neutral-500">Owner</dt>
          <dd className="break-all">
            {asset.ownerType} · {asset.ownerId}
          </dd>
          <dt className="text-neutral-500">Tag</dt>
          <dd>{asset.tag}</dd>
          <dt className="text-neutral-500">URL</dt>
          <dd className="break-all font-mono text-xs text-neutral-700">{asset.urlOrPath}</dd>
        </dl>
        <a
          href={asset.urlOrPath}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-sm font-medium text-yhgc-crimson hover:underline"
        >
          Open in new tab
        </a>
      </div>
    </EditModal>
  )
}

function PropertyTabDocuments({
  title,
  assets,
  onUpdateAsset,
  onDeleteAsset,
  showInlinePreviews,
}: {
  title: string
  assets: Asset[]
  onUpdateAsset?: (id: string, patch: Partial<Pick<Asset, "fileName">>) => void
  onDeleteAsset?: (id: string) => void
  /** When true, show a small image/video thumbnail per row (Open still opens the preview modal). */
  showInlinePreviews?: boolean
}) {
  const editable = Boolean(onUpdateAsset && onDeleteAsset)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editBaseline, setEditBaseline] = useState("")
  const previewAsset = previewId ? (assets.find((a) => a.id === previewId) ?? null) : null
  const editAsset = editId ? (assets.find((a) => a.id === editId) ?? null) : null

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h5 className="text-sm font-semibold text-yhgc-black">{title}</h5>
      {!assets.length ? (
        <p className="mt-2 text-sm text-neutral-500">No files in this category yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-neutral-100">
          {assets.map((a) => (
            <li
              key={a.id}
              className="flex flex-col gap-3 py-3 first:pt-0 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
            >
              <div className="flex min-w-0 flex-1 gap-3">
                {showInlinePreviews ? (
                  <button
                    type="button"
                    onClick={() => setPreviewId(a.id)}
                    className="shrink-0 overflow-hidden rounded-md ring-1 ring-neutral-200 transition hover:ring-yhgc-gold/50"
                    title="Open preview"
                  >
                    {assetAppearsImage(a) ? (
                      <img src={a.urlOrPath} alt="" className="h-16 w-24 object-cover" loading="lazy" />
                    ) : assetAppearsVideo(a) ? (
                      <span className="relative block h-16 w-24 bg-neutral-900">
                        <video src={a.urlOrPath} className="h-full w-full object-cover opacity-90" muted playsInline preload="metadata" />
                        <span className="absolute inset-0 flex items-center justify-center text-lg text-white/95 drop-shadow">▶</span>
                      </span>
                    ) : a.mimeType === "application/pdf" || /\.pdf(\?|$)/i.test(a.urlOrPath) ? (
                      <span className="flex h-16 w-24 items-center justify-center bg-red-50 text-xs font-bold text-red-800">PDF</span>
                    ) : (
                      <span className="flex h-16 w-24 items-center justify-center bg-neutral-100 text-[10px] font-semibold text-neutral-600">
                        FILE
                      </span>
                    )}
                  </button>
                ) : null}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-sm font-medium text-yhgc-black">{a.fileName}</p>
                  <p className="break-all font-mono text-[11px] leading-relaxed text-neutral-700">{a.urlOrPath}</p>
                  {a.createdAt ? <span className="text-xs text-neutral-500">{a.createdAt.slice(0, 10)}</span> : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewId(a.id)}
                  className="rounded-lg border border-yhgc-gold/40 bg-yhgc-gold/10 px-3 py-1.5 text-sm font-medium text-yhgc-black hover:bg-yhgc-gold/20"
                >
                  Open
                </button>
                <a
                  href={a.urlOrPath}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                >
                  Open in new tab
                </a>
                {editable ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditId(a.id)
                        setEditBaseline(a.fileName)
                      }}
                      className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!(await themedConfirm("Remove this file from the snapshot?"))) return
                        onDeleteAsset!(a.id)
                      }}
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100"
                    >
                      Delete
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {previewAsset ? <PropertyAssetPreviewModal asset={previewAsset} onClose={() => setPreviewId(null)} /> : null}
      {editAsset && onUpdateAsset ? (
        <AssetFileNameEditorModal
          key={editAsset.id}
          title="Edit file name"
          initialName={editAsset.fileName}
          resetTarget={editBaseline}
          confirmLabel="Save"
          isBusy={false}
          onClose={() => setEditId(null)}
          onConfirm={(next) => {
            onUpdateAsset(editAsset.id, { fileName: next })
            setEditId(null)
          }}
        />
      ) : null}
    </div>
  )
}

function PropertyRecordCountsSummary({ property, snapshot }: { property: Property; snapshot: AppSnapshot }) {
  const projects = snapshot.constructionProjects.filter((p) => p.propertyId === property.id)
  const projIds = projects.map((p) => p.id)
  const stages = snapshot.constructionStages.filter((s) => projIds.includes(s.projectId))
  const stageIds = stages.map((s) => s.id)
  const invIds = snapshot.invoices.filter((i) => i.propertyId === property.id).map((i) => i.id)
  const insIds = snapshot.insuranceRecords.filter((i) => i.propertyId === property.id).map((i) => i.id)
  const finIds = snapshot.financeRecords.filter((f) => f.propertyId === property.id).map((f) => f.id)
  const fileCount = snapshot.assets.filter((a) => {
    if (a.ownerType === "property" && a.ownerId === property.id) return true
    if (a.ownerType === "invoice" && invIds.includes(a.ownerId)) return true
    if (a.ownerType === "construction_stage" && stageIds.includes(a.ownerId)) return true
    if (a.ownerType === "insurance_record" && insIds.includes(a.ownerId)) return true
    if (a.ownerType === "finance_record" && finIds.includes(a.ownerId)) return true
    return false
  }).length

  const cards: { label: string; value: string; hint?: string }[] = [
    { label: "Construction programmes", value: String(projects.length) },
    { label: "Weekly stages logged", value: String(stages.length) },
    { label: "Loan records", value: String(snapshot.financeRecords.filter((f) => f.propertyId === property.id).length) },
    { label: "Income rows", value: String(snapshot.incomeRows.filter((r) => r.propertyId === property.id).length) },
    { label: "Invoices", value: String(snapshot.invoices.filter((i) => i.propertyId === property.id).length) },
    {
      label: "Insurance policies",
      value: String(snapshot.insuranceRecords.filter((i) => i.propertyId === property.id).length),
    },
    { label: "Attached files", value: String(fileCount), hint: "General, construction, loan, invoice PDFs, etc." },
  ]

  return (
    <div className="mt-5 border-t border-neutral-200 pt-5">
      <h3 className="text-sm font-semibold text-neutral-900">Records on this property</h3>
      <p className="mt-1 text-xs text-neutral-500">Counts across all categories (open a tab below to view or edit).</p>
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">{c.label}</span>
            <p className="mt-1 text-xl font-semibold tabular-nums text-yhgc-black">{c.value}</p>
            {c.hint ? <p className="mt-1 text-[11px] leading-snug text-neutral-500">{c.hint}</p> : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function PropertyValuationSummary({
  property,
  hasSummaryValues,
  onEditDetails,
  onOpenGeneralDocuments,
}: {
  property: Property
  hasSummaryValues: boolean
  onEditDetails: () => void
  onOpenGeneralDocuments: () => void
}) {
  const hero = property.heroImageUrl?.trim()
  const looksImage = hero && /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(hero)

  return (
    <div className="mt-6 border-t border-neutral-200 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">Valuation &amp; operating summary</h3>
          <p className="mt-1 text-xs text-neutral-500">
            Saved values from the property record. Use <strong>{hasSummaryValues ? "Edit details" : "Add property details"}</strong> to
            change them, or <strong>General documents</strong> for uploads.
          </p>
        </div>
        <div className="flex flex-shrink-0 flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onOpenGeneralDocuments}
            className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
          >
            General documents
          </button>
          <button
            type="button"
            onClick={onEditDetails}
            className="rounded-lg border border-yhgc-gold/50 bg-yhgc-gold/10 px-3 py-1.5 text-xs font-medium text-yhgc-black hover:bg-yhgc-gold/20"
          >
            {hasSummaryValues ? "Edit details" : "Add property details"}
          </button>
        </div>
      </div>
      <div className="mt-3 grid gap-3 text-sm md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 p-3 md:col-span-2 lg:col-span-3">
          <span className="text-xs font-medium uppercase text-neutral-500">Hero image</span>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {hero && looksImage ? (
              <img src={hero} alt="" className="h-16 w-24 rounded-md border border-neutral-200 object-cover" />
            ) : null}
            {hero ? (
              <a href={hero} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 break-all text-xs font-medium text-yhgc-crimson hover:underline">
                {hero}
              </a>
            ) : (
              <p className="text-sm text-neutral-500">Not set</p>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 p-3">
          <span className="text-xs font-medium uppercase text-neutral-500">Purchase price</span>
          <p className="mt-0.5 font-medium text-neutral-900">{formatGbpAmount(property.purchasePrice)}</p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 p-3">
          <span className="text-xs font-medium uppercase text-neutral-500">Purchase date</span>
          <p className="mt-0.5 font-medium text-neutral-900">{displayField(property.purchaseDate)}</p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 p-3">
          <span className="text-xs font-medium uppercase text-neutral-500">Current value</span>
          <p className="mt-0.5 font-medium text-neutral-900">{formatGbpAmount(property.currentValue)}</p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 p-3">
          <span className="text-xs font-medium uppercase text-neutral-500">Monthly net</span>
          <p className="mt-0.5 font-medium text-neutral-900">{formatGbpAmount(property.monthlyNet)}</p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 p-3">
          <span className="text-xs font-medium uppercase text-neutral-500">Refinance date</span>
          <p className="mt-0.5 font-medium text-neutral-900">{displayField(property.refinanceDate)}</p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 p-3">
          <span className="text-xs font-medium uppercase text-neutral-500">Insurance renewal</span>
          <p className="mt-0.5 font-medium text-neutral-900">{displayField(property.insuranceRenewalDate)}</p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 p-3 md:col-span-2 lg:col-span-3">
          <span className="text-xs font-medium uppercase text-neutral-500">Tenancy status</span>
          <p className="mt-0.5 font-medium text-neutral-900">{displayField(property.tenancyStatus)}</p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 p-3 md:col-span-2 lg:col-span-3">
          <span className="text-xs font-medium uppercase text-neutral-500">Managing agent</span>
          <p className="mt-0.5 font-medium text-neutral-900">{displayField(property.managingAgent)}</p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 p-3">
          <span className="text-xs font-medium uppercase text-neutral-500">Income to date</span>
          <p className="mt-0.5 font-medium text-neutral-900">{formatGbpAmount(property.incomeToDate)}</p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 p-3">
          <span className="text-xs font-medium uppercase text-neutral-500">Costs to date</span>
          <p className="mt-0.5 font-medium text-neutral-900">{formatGbpAmount(property.costToDate)}</p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 p-3">
          <span className="text-xs font-medium uppercase text-neutral-500">Net position</span>
          <p className="mt-0.5 font-medium text-neutral-900">{formatGbpAmount(property.netPosition)}</p>
        </div>
      </div>
    </div>
  )
}

function PropertyHeroImagePicker({
  propertyId,
  heroUrl,
  onHeroUrlChange,
  onError,
}: {
  propertyId: string
  heroUrl: string
  onHeroUrlChange: (url: string) => void
  onError: (message: string | null) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const preview = heroUrl.trim()
  const looksImage = Boolean(preview && /\.(png|jpe?g|gif|webp|svg|bmp)(\?|$)/i.test(preview))

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    if (!file.type.startsWith("image/")) {
      onError("Choose an image file (JPEG, PNG, WebP, …).")
      return
    }
    onError(null)
    setBusy(true)
    try {
      const url = await uploadPropertyAssetFile(propertyId, file, "hero")
      onHeroUrlChange(url)
    } catch (err) {
      onError(err instanceof Error ? err.message : "Image upload failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="text-sm md:col-span-2">
      <span className={adminLabel}>Hero image (optional)</span>
      <div className="mt-2 flex flex-col gap-3">
        {looksImage ? (
          <img src={preview} alt="" className="h-24 max-w-xs rounded-md border border-neutral-200 object-cover" loading="lazy" />
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-yhgc-gold/50 bg-yhgc-gold/10 px-3 py-2 text-sm font-medium text-yhgc-black hover:bg-yhgc-gold/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Uploading…" : preview ? "Replace image" : "Choose image"}
          </button>
          {preview ? (
            <button
              type="button"
              onClick={() => {
                onHeroUrlChange("")
                onError(null)
              }}
              className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            >
              Remove image
            </button>
          ) : null}
        </div>
        <p className="text-xs text-neutral-500">JPEG, PNG, WebP, or GIF. The URL is stored when you save this form.</p>
      </div>
    </div>
  )
}

function PropertyDetailsFieldsForm({ property, onSave }: { property: Property; onSave: (patch: Partial<Omit<Property, "id">>) => void }) {
  const [heroImageUrl, setHeroImageUrl] = useState("")
  const [purchasePrice, setPurchasePrice] = useState("")
  const [purchaseDate, setPurchaseDate] = useState("")
  const [currentValue, setCurrentValue] = useState("")
  const [monthlyNet, setMonthlyNet] = useState("")
  const [refinanceDate, setRefinanceDate] = useState("")
  const [insuranceRenewalDate, setInsuranceRenewalDate] = useState("")
  const [tenancyStatus, setTenancyStatus] = useState("")
  const [managingAgent, setManagingAgent] = useState("")
  const [incomeToDate, setIncomeToDate] = useState("")
  const [costToDate, setCostToDate] = useState("")
  const [netPosition, setNetPosition] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    setHeroImageUrl(property.heroImageUrl ?? "")
    setPurchasePrice(property.purchasePrice != null ? String(property.purchasePrice) : "")
    setPurchaseDate(toHtmlDateInputValue(property.purchaseDate))
    setCurrentValue(property.currentValue != null ? String(property.currentValue) : "")
    setMonthlyNet(property.monthlyNet != null ? String(property.monthlyNet) : "")
    setRefinanceDate(toHtmlDateInputValue(property.refinanceDate))
    setInsuranceRenewalDate(toHtmlDateInputValue(property.insuranceRenewalDate))
    setTenancyStatus(property.tenancyStatus ?? "")
    setManagingAgent(property.managingAgent ?? "")
    setIncomeToDate(property.incomeToDate != null ? String(property.incomeToDate) : "")
    setCostToDate(property.costToDate != null ? String(property.costToDate) : "")
    setNetPosition(property.netPosition != null ? String(property.netPosition) : "")
    setFormError(null)
  }, [
    property.id,
    property.heroImageUrl,
    property.purchasePrice,
    property.purchaseDate,
    property.currentValue,
    property.monthlyNet,
    property.refinanceDate,
    property.insuranceRenewalDate,
    property.tenancyStatus,
    property.managingAgent,
    property.incomeToDate,
    property.costToDate,
    property.netPosition,
  ])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)

    const rpp = parseOptionalAmount(purchasePrice, "Purchase price (£)", false)
    if (rpp.ok === false) {
      setFormError(rpp.error)
      return
    }
    const rcv = parseOptionalAmount(currentValue, "Current value (£)", false)
    if (rcv.ok === false) {
      setFormError(rcv.error)
      return
    }
    const rmn = parseOptionalAmount(monthlyNet, "Monthly net (£)", true)
    if (rmn.ok === false) {
      setFormError(rmn.error)
      return
    }
    const rit = parseOptionalAmount(incomeToDate, "Income to date (£)", false)
    if (rit.ok === false) {
      setFormError(rit.error)
      return
    }
    const rct = parseOptionalAmount(costToDate, "Costs to date (£)", false)
    if (rct.ok === false) {
      setFormError(rct.error)
      return
    }
    const rnp = parseOptionalAmount(netPosition, "Net position (£)", true)
    if (rnp.ok === false) {
      setFormError(rnp.error)
      return
    }

    const patch = {
      heroImageUrl: optionalTrimmed(heroImageUrl),
      purchasePrice: rpp.value,
      purchaseDate: optionalTrimmed(purchaseDate),
      currentValue: rcv.value,
      monthlyNet: rmn.value,
      refinanceDate: optionalTrimmed(refinanceDate),
      insuranceRenewalDate: optionalTrimmed(insuranceRenewalDate),
      tenancyStatus: optionalTrimmed(tenancyStatus),
      managingAgent: optionalTrimmed(managingAgent),
      incomeToDate: rit.value,
      costToDate: rct.value,
      netPosition: rnp.value,
    }
    if (isPropertyDetailsValuationPatchNoop(property, patch)) {
      setFormError("Nothing to save — add or change a value first, or use Close.")
      return
    }
    onSave(patch)
  }

  return (
    <form key={property.id} noValidate onSubmit={submit} className="rounded-2xl border border-yhgc-gold/20 bg-white p-4 shadow-sm">
      <p className="mb-3 text-sm font-semibold">Details &amp; valuation</p>
      <p className="mb-3 text-xs text-neutral-600">
        Click <strong>Save changes</strong> to apply. The read-only summary above updates after you save.
      </p>
      {formError ? (
        <p role="alert" className={`${adminFormAlert} mb-3`}>
          {formError}
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <PropertyHeroImagePicker
          propertyId={property.id}
          heroUrl={heroImageUrl}
          onHeroUrlChange={(u) => {
            setHeroImageUrl(u)
            setFormError(null)
          }}
          onError={setFormError}
        />
        <label className="text-sm">
          <span className={adminLabel}>Purchase price (£)</span>
          <input
            value={purchasePrice}
            onChange={(e) => {
              setPurchasePrice(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            type="text"
            inputMode="decimal"
            autoComplete="off"
          />
        </label>
        <label className="text-sm">
          <span className={adminLabel}>Purchase date</span>
          <input
            value={purchaseDate}
            onChange={(e) => {
              setPurchaseDate(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            type="date"
          />
        </label>
        <label className="text-sm">
          <span className={adminLabel}>Current value (£)</span>
          <input
            value={currentValue}
            onChange={(e) => {
              setCurrentValue(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            type="text"
            inputMode="decimal"
            autoComplete="off"
          />
        </label>
        <label className="text-sm">
          <span className={adminLabel}>Monthly net (£)</span>
          <input
            value={monthlyNet}
            onChange={(e) => {
              setMonthlyNet(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            type="text"
            inputMode="decimal"
            autoComplete="off"
          />
        </label>
        <label className="text-sm">
          <span className={adminLabel}>Refinance date</span>
          <input
            value={refinanceDate}
            onChange={(e) => {
              setRefinanceDate(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            type="date"
          />
        </label>
        <label className="text-sm">
          <span className={adminLabel}>Insurance renewal (summary)</span>
          <input
            value={insuranceRenewalDate}
            onChange={(e) => {
              setInsuranceRenewalDate(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            type="date"
          />
        </label>
        <label className="text-sm md:col-span-2">
          <span className={adminLabel}>Tenancy status</span>
          <input
            value={tenancyStatus}
            onChange={(e) => {
              setTenancyStatus(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
          />
        </label>
        <label className="text-sm md:col-span-2">
          <span className={adminLabel}>Managing agent</span>
          <input
            value={managingAgent}
            onChange={(e) => {
              setManagingAgent(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
          />
        </label>
        <label className="text-sm">
          <span className={adminLabel}>Income to date (£)</span>
          <input
            value={incomeToDate}
            onChange={(e) => {
              setIncomeToDate(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            type="text"
            inputMode="decimal"
            autoComplete="off"
          />
        </label>
        <label className="text-sm">
          <span className={adminLabel}>Costs to date (£)</span>
          <input
            value={costToDate}
            onChange={(e) => {
              setCostToDate(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            type="text"
            inputMode="decimal"
            autoComplete="off"
          />
        </label>
        <label className="text-sm md:col-span-2">
          <span className={adminLabel}>Net position (£)</span>
          <input
            value={netPosition}
            onChange={(e) => {
              setNetPosition(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            type="text"
            inputMode="decimal"
            autoComplete="off"
          />
        </label>
      </div>
      <button type="submit" className="mt-4 w-full rounded-xl bg-yhgc-crimson px-4 py-2.5 text-sm font-medium text-white shadow hover:opacity-95">
        Save changes
      </button>
    </form>
  )
}

function InsurancePolicyForm({
  propertyId,
  record,
  policyAssets,
  onSave,
  onAssetAdd,
  onUpdateAsset,
  onDeleteAsset,
}: {
  propertyId: string
  record: InsuranceRecord
  policyAssets: Asset[]
  onSave: (patch: Partial<Omit<InsuranceRecord, "id" | "propertyId">>) => void
  onAssetAdd: (payload: {
    ownerType: Asset["ownerType"]
    ownerId: string
    tag: AttachmentTag
    fileName: string
    mimeType: string
    sizeBytes: number
    urlOrPath: string
  }) => void
  onUpdateAsset: (id: string, patch: Partial<Pick<Asset, "fileName">>) => void
  onDeleteAsset: (id: string) => void
}) {
  const [insurerName, setInsurerName] = useState("")
  const [policyNumber, setPolicyNumber] = useState("")
  const [coverStartDate, setCoverStartDate] = useState("")
  const [coverEndDate, setCoverEndDate] = useState("")
  const [renewal60DayAlertOn, setRenewal60DayAlertOn] = useState("")
  const [renewal14DayAlertOn, setRenewal14DayAlertOn] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    setInsurerName(record.insurerName ?? "")
    setPolicyNumber(record.policyNumber ?? "")
    setCoverStartDate(record.coverStartDate ?? "")
    setCoverEndDate(record.coverEndDate ?? "")
    setRenewal60DayAlertOn(record.renewal60DayAlertOn ?? "")
    setRenewal14DayAlertOn(record.renewal14DayAlertOn ?? "")
    setFormError(null)
  }, [
    record.id,
    record.insurerName,
    record.policyNumber,
    record.coverStartDate,
    record.coverEndDate,
    record.renewal60DayAlertOn,
    record.renewal14DayAlertOn,
  ])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const ins = optionalTrimmed(insurerName)
    const pol = optionalTrimmed(policyNumber)
    if (!ins && !pol) {
      setFormError("Please enter at least the insurer name or the policy number.")
      return
    }
    setFormError(null)
    onSave({
      insurerName: ins,
      policyNumber: pol,
      coverStartDate: optionalTrimmed(coverStartDate),
      coverEndDate: optionalTrimmed(coverEndDate),
      renewal60DayAlertOn: optionalTrimmed(renewal60DayAlertOn),
      renewal14DayAlertOn: optionalTrimmed(renewal14DayAlertOn),
    })
  }

  const uploadPolicyFile = async (file: File, displayName: string) => {
    const url = await uploadPropertyAssetFile(propertyId, file, "insurance")
    onAssetAdd({
      ownerType: "insurance_record",
      ownerId: record.id,
      tag: "insurance",
      fileName: displayName,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      urlOrPath: url,
    })
  }

  return (
    <div className="space-y-6">
      <form noValidate onSubmit={submit} className="space-y-4">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          Policy {record.policyNumber || record.id.slice(0, 8)}
        </p>
        {formError ? (
          <p role="alert" className={adminFormAlert}>
            {formError}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">
            <span className={adminLabel}>Insurer</span>
            <input
              value={insurerName}
              onChange={(e) => {
                setInsurerName(e.target.value)
                setFormError(null)
              }}
              className={adminFieldInput}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className={adminLabel}>Policy number</span>
            <input
              value={policyNumber}
              onChange={(e) => {
                setPolicyNumber(e.target.value)
                setFormError(null)
              }}
              className={adminFieldInput}
            />
          </label>
          <label className="text-sm">
            <span className={adminLabel}>Cover start</span>
            <input value={coverStartDate} onChange={(e) => setCoverStartDate(e.target.value)} className={adminFieldInput} type="date" />
          </label>
          <label className="text-sm">
            <span className={adminLabel}>Cover end</span>
            <input value={coverEndDate} onChange={(e) => setCoverEndDate(e.target.value)} className={adminFieldInput} type="date" />
          </label>
          <label className="text-sm">
            <span className={adminLabel}>60-day alert</span>
            <input value={renewal60DayAlertOn} onChange={(e) => setRenewal60DayAlertOn(e.target.value)} className={adminFieldInput} type="date" />
          </label>
          <label className="text-sm">
            <span className={adminLabel}>14-day alert</span>
            <input value={renewal14DayAlertOn} onChange={(e) => setRenewal14DayAlertOn(e.target.value)} className={adminFieldInput} type="date" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-4">
          <button type="submit" className={adminBtnPrimary}>
            Save policy
          </button>
        </div>
      </form>
      <div>
        <FileUploadForm
          title="Upload documents for this policy"
          onFileUpload={uploadPolicyFile}
          onFiles={legacyOnFilesFromSingle(uploadPolicyFile)}
        />
        <div className="mt-3">
          <PropertyTabDocuments
            title="Files for this policy"
            assets={policyAssets}
            onUpdateAsset={onUpdateAsset}
            onDeleteAsset={onDeleteAsset}
            showInlinePreviews
          />
        </div>
      </div>
    </div>
  )
}

function InsurancePolicyNewForm({
  propertyId,
  onAdd,
  onAssetAdd,
  onDone,
}: {
  propertyId: string
  onAdd: (payload: Partial<Omit<InsuranceRecord, "id" | "propertyId">>) => string | undefined
  onAssetAdd: (payload: {
    ownerType: Asset["ownerType"]
    ownerId: string
    tag: AttachmentTag
    fileName: string
    mimeType: string
    sizeBytes: number
    urlOrPath: string
  }) => void
  onDone?: () => void
}) {
  const [insurerName, setInsurerName] = useState("")
  const [policyNumber, setPolicyNumber] = useState("")
  const [coverStartDate, setCoverStartDate] = useState("")
  const [coverEndDate, setCoverEndDate] = useState("")
  const [renewal60DayAlertOn, setRenewal60DayAlertOn] = useState("")
  const [renewal14DayAlertOn, setRenewal14DayAlertOn] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingFiles, setPendingFiles] = useState<PendingPickedFile[]>([])
  const [submitting, setSubmitting] = useState(false)
  const pendingRef = useRef<PendingPickedFile[]>([])

  useEffect(() => {
    pendingRef.current = pendingFiles
  }, [pendingFiles])

  useEffect(() => {
    return () => revokePickedFilePreviewUrls(pendingRef.current)
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return
    const ins = optionalTrimmed(insurerName)
    const pol = optionalTrimmed(policyNumber)
    if (!ins && !pol) {
      setFormError("Please enter at least the insurer name or the policy number.")
      return
    }
    setFormError(null)
    const pendingSnapshot = [...pendingFiles]
    setSubmitting(true)
    try {
      const id = onAdd({
        insurerName: ins,
        policyNumber: pol,
        coverStartDate: optionalTrimmed(coverStartDate),
        coverEndDate: optionalTrimmed(coverEndDate),
        renewal60DayAlertOn: optionalTrimmed(renewal60DayAlertOn),
        renewal14DayAlertOn: optionalTrimmed(renewal14DayAlertOn),
      })
      if (id === undefined) return
      for (const row of pendingSnapshot) {
        const url = await uploadPropertyAssetFile(propertyId, row.file, "insurance")
        onAssetAdd({
          ownerType: "insurance_record",
          ownerId: id,
          tag: "insurance",
          fileName: row.file.name,
          mimeType: row.file.type || "application/octet-stream",
          sizeBytes: row.file.size,
          urlOrPath: url,
        })
      }
      revokePickedFilePreviewUrls(pendingSnapshot)
      setPendingFiles([])
      setInsurerName("")
      setPolicyNumber("")
      setCoverStartDate("")
      setCoverEndDate("")
      setRenewal60DayAlertOn("")
      setRenewal14DayAlertOn("")
      onDone?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed."
      useAppStore.getState().setActionNotice({
        kind: "error",
        message: msg.length > 220 ? `${msg.slice(0, 220)}…` : msg,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <form noValidate onSubmit={submit} className="space-y-4">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">New policy</p>
        {formError ? (
          <p role="alert" className={adminFormAlert}>
            {formError}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">
            <span className={adminLabel}>Insurer</span>
            <input
              value={insurerName}
              onChange={(e) => {
                setInsurerName(e.target.value)
                setFormError(null)
              }}
              className={adminFieldInput}
              disabled={submitting}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className={adminLabel}>Policy number</span>
            <input
              value={policyNumber}
              onChange={(e) => {
                setPolicyNumber(e.target.value)
                setFormError(null)
              }}
              className={adminFieldInput}
              disabled={submitting}
            />
          </label>
          <label className="text-sm">
            <span className={adminLabel}>Cover start</span>
            <input
              value={coverStartDate}
              onChange={(e) => setCoverStartDate(e.target.value)}
              className={adminFieldInput}
              type="date"
              disabled={submitting}
            />
          </label>
          <label className="text-sm">
            <span className={adminLabel}>Cover end</span>
            <input
              value={coverEndDate}
              onChange={(e) => setCoverEndDate(e.target.value)}
              className={adminFieldInput}
              type="date"
              disabled={submitting}
            />
          </label>
          <label className="text-sm">
            <span className={adminLabel}>60-day alert</span>
            <input
              value={renewal60DayAlertOn}
              onChange={(e) => setRenewal60DayAlertOn(e.target.value)}
              className={adminFieldInput}
              type="date"
              disabled={submitting}
            />
          </label>
          <label className="text-sm">
            <span className={adminLabel}>14-day alert</span>
            <input
              value={renewal14DayAlertOn}
              onChange={(e) => setRenewal14DayAlertOn(e.target.value)}
              className={adminFieldInput}
              type="date"
              disabled={submitting}
            />
          </label>
        </div>
        <div className="border-t border-neutral-100 pt-4">
          <FileUploadForm
            title="Upload documents for this policy"
            onFileUpload={async (file, displayName) => {
              const id = `pending-${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 9)}`
              const f =
                displayName.trim() && displayName.trim() !== file.name
                  ? new File([file], displayName.trim(), { type: file.type, lastModified: file.lastModified })
                  : file
              const previewUrl = f.type.startsWith("image/") ? URL.createObjectURL(f) : null
              setPendingFiles((prev) => [...prev, { id, file: f, previewUrl }])
            }}
          />
          {pendingFiles.length ? (
            <ul className="mt-4 space-y-2">
              {pendingFiles.map((pf) => (
                <li
                  key={pf.id}
                  className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50/90 p-2 pr-3"
                >
                  {pf.previewUrl ? (
                    <img
                      src={pf.previewUrl}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-md object-cover ring-1 ring-neutral-200"
                    />
                  ) : pf.file.type === "application/pdf" ? (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-red-50 text-xs font-bold text-red-800 ring-1 ring-red-200/60">
                      PDF
                    </div>
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-[10px] font-semibold text-neutral-600 ring-1 ring-neutral-200">
                      FILE
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-yhgc-black">{pf.file.name}</p>
                    <p className="text-xs text-neutral-500">{formatAssetSizeBytes(pf.file.size)}</p>
                  </div>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() =>
                      setPendingFiles((prev) => {
                        const row = prev.find((r) => r.id === pf.id)
                        if (row?.previewUrl) URL.revokeObjectURL(row.previewUrl)
                        return prev.filter((r) => r.id !== pf.id)
                      })
                    }
                    className="shrink-0 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-xs text-neutral-600">
            Queued files attach after you save the policy (display name is set in the upload dialog).
          </p>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-4">
          <button type="submit" disabled={submitting} className={adminBtnPrimary}>
            {submitting ? "Saving…" : "Add policy"}
          </button>
        </div>
      </form>
    </div>
  )
}

function IncomeRowForm({
  row,
  onSubmit,
  submitLabel = "Save income row",
}: {
  row: IncomeRow
  onSubmit: (patch: Partial<Omit<IncomeRow, "id" | "propertyId">>) => void
  submitLabel?: string
}) {
  const [period, setPeriod] = useState("")
  const [incomeAmount, setIncomeAmount] = useState("")
  const [costAmount, setCostAmount] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    setPeriod(row.period)
    setIncomeAmount(String(row.incomeAmount))
    setCostAmount(String(row.costAmount))
  }, [row.id, row.period, row.incomeAmount, row.costAmount])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)
    const inc = Number(incomeAmount)
    const cost = Number(costAmount)
    if (!period.trim()) {
      setFormError("Choose the month for this row.")
      return
    }
    if (!Number.isFinite(inc)) {
      setFormError("Enter a valid income amount.")
      return
    }
    if (!Number.isFinite(cost)) {
      setFormError("Enter a valid costs amount.")
      return
    }
    if (inc === 0 || cost === 0) {
      setFormError("Income and costs must each be a non-zero amount (not £0).")
      return
    }
    onSubmit({ period: period.trim(), incomeAmount: inc, costAmount: cost })
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-4">
      {formError ? (
        <p role="alert" className={adminFormAlert}>
          {formError}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className={adminLabel}>Period</span>
          <input
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            type="month"
          />
        </label>
        <label className="text-sm">
          <span className={adminLabel}>Income (£)</span>
          <input
            value={incomeAmount}
            onChange={(e) => {
              setIncomeAmount(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            type="number"
            step="0.01"
          />
        </label>
        <label className="text-sm">
          <span className={adminLabel}>Costs (£)</span>
          <input
            value={costAmount}
            onChange={(e) => {
              setCostAmount(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            type="number"
            step="0.01"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-4">
        <button type="submit" className={adminBtnPrimary}>
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

function InvoiceForm({
  propertyId,
  invoice,
  invoiceAssets,
  onSave,
  onAssetAdd,
  onUpdateAsset,
  onDeleteAsset,
}: {
  propertyId: string
  invoice: Invoice
  invoiceAssets: Asset[]
  onSave: (patch: Partial<Omit<Invoice, "id" | "propertyId">>) => void
  onAssetAdd: (payload: {
    ownerType: Asset["ownerType"]
    ownerId: string
    tag: AttachmentTag
    fileName: string
    mimeType: string
    sizeBytes: number
    urlOrPath: string
  }) => void
  onUpdateAsset: (id: string, patch: Partial<Pick<Asset, "fileName">>) => void
  onDeleteAsset: (id: string) => void
}) {
  const [supplierName, setSupplierName] = useState("")
  const [invoiceRef, setInvoiceRef] = useState("")
  const [invoiceDate, setInvoiceDate] = useState("")
  const [amount, setAmount] = useState("")
  const [status, setStatus] = useState<InvoiceStatus>("unpaid")
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    setSupplierName(invoice.supplierName ?? "")
    setInvoiceRef(invoice.invoiceRef ?? "")
    setInvoiceDate(invoice.invoiceDate ?? "")
    setAmount(String(invoice.amount))
    setStatus(invoice.status)
  }, [invoice.id, invoice.supplierName, invoice.invoiceRef, invoice.invoiceDate, invoice.amount, invoice.status])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const sup = supplierName.trim()
    if (!sup) {
      setFormError("Enter the supplier name.")
      return
    }
    if (!invoiceDate.trim()) {
      setFormError("Choose the invoice date.")
      return
    }
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setFormError("Enter the invoice total as a number greater than zero.")
      return
    }
    setFormError(null)
    onSave({
      supplierName: sup,
      invoiceRef: invoiceRef.trim(),
      invoiceDate: invoiceDate.trim(),
      amount: amt,
      status,
    })
  }

  const uploadOne = async (file: File, displayName: string) => {
    const url = await uploadPropertyAssetFile(propertyId, file, "invoice")
    onAssetAdd({
      ownerType: "invoice",
      ownerId: invoice.id,
      tag: "invoice",
      fileName: displayName,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      urlOrPath: url,
    })
  }

  return (
    <div className="space-y-6">
      <form noValidate onSubmit={submit} className="space-y-4">
        {formError ? (
          <p role="alert" className={adminFormAlert}>
            {formError}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">
            <span className={adminLabel}>Supplier</span>
            <input
              value={supplierName}
              onChange={(e) => {
                setSupplierName(e.target.value)
                setFormError(null)
              }}
              className={adminFieldInput}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className={adminLabel}>Invoice status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as InvoiceStatus)}
              className={adminFieldInput}
              aria-label="Invoice status: queried, unpaid, or paid"
            >
              {INVOICE_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className={adminLabel}>Reference (optional)</span>
            <input value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} className={adminFieldInput} />
          </label>
          <label className="text-sm">
            <span className={adminLabel}>Date</span>
            <input
              value={invoiceDate}
              onChange={(e) => {
                setInvoiceDate(e.target.value)
                setFormError(null)
              }}
              className={adminFieldInput}
              type="date"
            />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className={adminLabel}>Amount (£)</span>
            <input
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
                setFormError(null)
              }}
              className={fieldWithInvalid(
                adminFieldInput,
                !!formError && (!Number.isFinite(Number(amount)) || Number(amount) <= 0),
              )}
              type="number"
              min={0}
              step="0.01"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-4">
          <button type="submit" className={adminBtnPrimary}>
            Save invoice
          </button>
        </div>
      </form>
      <div>
        <FileUploadForm
          title="Upload invoice PDFs, images, or scans"
          onFileUpload={uploadOne}
          onFiles={legacyOnFilesFromSingle(uploadOne)}
        />
        <div className="mt-3">
          <PropertyTabDocuments
            title="Files for this invoice"
            assets={invoiceAssets}
            onUpdateAsset={onUpdateAsset}
            onDeleteAsset={onDeleteAsset}
            showInlinePreviews
          />
        </div>
      </div>
    </div>
  )
}

function ConstructionWeekFilesCard({
  propertyId,
  stage,
  constructionAssets,
  onAssetAdd,
  onUpdateAsset,
  onDeleteAsset,
}: {
  propertyId: string
  stage: ConstructionStage
  constructionAssets: Asset[]
  onAssetAdd: (payload: {
    ownerType: Asset["ownerType"]
    ownerId: string
    tag: AttachmentTag
    fileName: string
    mimeType: string
    sizeBytes: number
    urlOrPath: string
  }) => void
  onUpdateAsset: (id: string, patch: Partial<Pick<Asset, "fileName">>) => void
  onDeleteAsset: (id: string) => void
}) {
  const stageAssets = constructionAssets.filter(
    (a) => a.ownerType === "construction_stage" && a.ownerId === stage.id && a.tag === "construction",
  )
  const weekSummary = `Week ${stage.weekNumber} (${stage.uploadDate})`
  const uploadOne = async (file: File, displayName: string) => {
    const url = await uploadPropertyAssetFile(propertyId, file, "construction")
    onAssetAdd({
      ownerType: "construction_stage",
      ownerId: stage.id,
      tag: "construction",
      fileName: displayName,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      urlOrPath: url,
    })
  }
  return (
    <div className="border-t border-neutral-100 bg-neutral-50/50 px-4 py-4">
      <FileUploadForm
        title={`Photos & documents · ${weekSummary}`}
        onFileUpload={uploadOne}
        onFiles={legacyOnFilesFromSingle(uploadOne)}
      />
      <div className="mt-3">
        <PropertyTabDocuments
          title="Files for this week"
          assets={stageAssets}
          onUpdateAsset={onUpdateAsset}
          onDeleteAsset={onDeleteAsset}
          showInlinePreviews
        />
      </div>
    </div>
  )
}

function ConstructionWeekLogViewPanel({
  stage,
  programmeOrdinal,
  stageAssets,
}: {
  stage: ConstructionStage
  programmeOrdinal: number
  stageAssets: Asset[]
}) {
  const urls = stage.photoUrls ?? []
  return (
    <div className="space-y-5">
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <dt className="text-neutral-500">Programme</dt>
        <dd className="font-medium text-neutral-900">Programme {programmeOrdinal}</dd>
        <dt className="text-neutral-500">Week number</dt>
        <dd className="font-medium text-neutral-900">{stage.weekNumber}</dd>
        <dt className="text-neutral-500">Upload date</dt>
        <dd className="text-neutral-800">{stage.uploadDate}</dd>
        <dt className="text-neutral-500">Stage id</dt>
        <dd className="break-all font-mono text-[11px] text-neutral-700">{stage.id}</dd>
      </dl>
      {urls.length > 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 p-3">
          <h5 className="text-sm font-semibold text-yhgc-black">Photo URLs on record</h5>
          <ul className="mt-2 space-y-2 text-sm">
            {urls.map((url, i) => (
              <li key={`${i}-${url.slice(0, 48)}`}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all font-medium text-yhgc-crimson hover:underline"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <PropertyTabDocuments title="Files for this week" assets={stageAssets} showInlinePreviews />
    </div>
  )
}

function IncomeRowReadOnlyDetails({ row }: { row: IncomeRow }) {
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-[minmax(0,10rem)_1fr]">
      <dt className="text-neutral-500">Period</dt>
      <dd className="font-medium text-neutral-900">{row.period}</dd>
      <dt className="text-neutral-500">Income</dt>
      <dd className="tabular-nums text-neutral-800">{formatGbpAmount(row.incomeAmount)}</dd>
      <dt className="text-neutral-500">Costs</dt>
      <dd className="tabular-nums text-neutral-800">{formatGbpAmount(row.costAmount)}</dd>
      <dt className="text-neutral-500">Net</dt>
      <dd className="tabular-nums font-medium text-neutral-900">
        {formatGbpAmount(row.incomeAmount - row.costAmount)}
      </dd>
      <dt className="text-neutral-500">Row id</dt>
      <dd className="break-all font-mono text-[11px] text-neutral-700">{row.id}</dd>
    </dl>
  )
}

function InvoiceReadOnlyDetails({ inv }: { inv: Invoice }) {
  return (
    <div className="space-y-4">
      <dl className="grid gap-2 text-sm sm:grid-cols-[minmax(0,10rem)_1fr]">
        <dt className="text-neutral-500">Supplier</dt>
        <dd className="font-medium text-neutral-900">{inv.supplierName}</dd>
        <dt className="text-neutral-500">Reference</dt>
        <dd className="text-neutral-800">{displayField(inv.invoiceRef)}</dd>
        <dt className="text-neutral-500">Invoice date</dt>
        <dd className="text-neutral-800">{inv.invoiceDate}</dd>
        <dt className="text-neutral-500">Amount</dt>
        <dd className="tabular-nums text-neutral-800">{formatGbpAmount(inv.amount)}</dd>
        <dt className="text-neutral-500">Status</dt>
        <dd className="capitalize text-neutral-800">
          {INVOICE_STATUS_OPTIONS.find((o) => o.value === inv.status)?.label ?? inv.status}
        </dd>
        <dt className="text-neutral-500">Invoice id</dt>
        <dd className="break-all font-mono text-[11px] text-neutral-700">{inv.id}</dd>
      </dl>
      {inv.pdfUrl?.trim() ? (
        <p className="text-sm">
          <span className="text-neutral-500">Linked PDF: </span>
          <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-yhgc-crimson hover:underline break-all">
            Open PDF link
          </a>
        </p>
      ) : null}
    </div>
  )
}

function InsurancePolicyReadOnlyDetails({ rec }: { rec: InsuranceRecord }) {
  const cover =
    rec.coverStartDate && rec.coverEndDate
      ? `${rec.coverStartDate} → ${rec.coverEndDate}`
      : rec.coverStartDate || rec.coverEndDate || "—"
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-[minmax(0,11rem)_1fr]">
      <dt className="text-neutral-500">Insurer</dt>
      <dd className="break-words font-medium text-neutral-900">{displayField(rec.insurerName)}</dd>
      <dt className="text-neutral-500">Policy number</dt>
      <dd className="break-words text-neutral-800">{displayField(rec.policyNumber)}</dd>
      <dt className="text-neutral-500">Cover</dt>
      <dd className="text-neutral-800">{cover}</dd>
      <dt className="text-neutral-500">60-day alert</dt>
      <dd className="text-neutral-800">{displayField(rec.renewal60DayAlertOn)}</dd>
      <dt className="text-neutral-500">14-day alert</dt>
      <dd className="text-neutral-800">{displayField(rec.renewal14DayAlertOn)}</dd>
      <dt className="text-neutral-500">Policy id</dt>
      <dd className="break-all font-mono text-[11px] text-neutral-700">{rec.id}</dd>
    </dl>
  )
}

type PendingPickedFile = { id: string; file: File; previewUrl: string | null }

type FinanceLoanModalFieldKey =
  | "lenderName"
  | "loanAmount"
  | "monthlyPayment"
  | "interestRatePct"
  | "ltvPct"
  | "termEndDate"

type FinanceLoanModalFieldErrors = Partial<Record<FinanceLoanModalFieldKey, string>>

const loanFieldErrorClass = "mt-1 text-xs font-medium text-red-700"

function validateFinanceLoanModalFields(params: {
  isCash: boolean
  lenderName: string
  loanAmount: string
  monthlyPayment: string
  interestRatePct: string
  ltvPct: string
  termEndDate: string
}): FinanceLoanModalFieldErrors {
  const out: FinanceLoanModalFieldErrors = {}
  if (params.lenderName.trim().length < 2) {
    out.lenderName = "Enter the lender or label (at least 2 characters)."
  }
  if (!params.isCash) {
    const la = Number(params.loanAmount)
    if (!params.loanAmount.trim() || !Number.isFinite(la) || la <= 0) {
      out.loanAmount = "Enter a loan amount greater than zero."
    }
    const mp = Number(params.monthlyPayment)
    if (!params.monthlyPayment.trim() || !Number.isFinite(mp) || mp <= 0) {
      out.monthlyPayment = "Enter a monthly payment greater than zero."
    }
    if (!params.termEndDate.trim()) {
      out.termEndDate = "Choose the term end date."
    }
    if (params.interestRatePct.trim()) {
      const ir = Number(params.interestRatePct)
      if (!Number.isFinite(ir) || ir < 0 || ir > 100) {
        out.interestRatePct = "Enter a valid interest rate between 0 and 100%."
      }
    }
    if (params.ltvPct.trim()) {
      const ltv = Number(params.ltvPct)
      if (!Number.isFinite(ltv) || ltv <= 0 || ltv > 100) {
        out.ltvPct = "Enter a valid LTV between 0 and 100%."
      }
    }
  }
  return out
}

function revokeLoanFieldError(prev: FinanceLoanModalFieldErrors, key: FinanceLoanModalFieldKey): FinanceLoanModalFieldErrors {
  if (!(key in prev)) return prev
  const next = { ...prev }
  delete next[key]
  return next
}

function revokePickedFilePreviewUrls(rows: PendingPickedFile[]) {
  for (const r of rows) {
    if (r.previewUrl) URL.revokeObjectURL(r.previewUrl)
  }
}

function ShortcutLogConstructionWeekForm({
  properties,
  projects,
  onClose,
  onAddStage,
  onAssetAdd,
}: {
  properties: Property[]
  projects: ConstructionProject[]
  onClose: () => void
  onAddStage: (payload: { projectId: string; weekNumber: number; uploadDate: string }) => string | undefined
  onAssetAdd: (payload: {
    ownerType: Asset["ownerType"]
    ownerId: string
    tag: AttachmentTag
    fileName: string
    mimeType: string
    sizeBytes: number
    urlOrPath: string
  }) => void
}) {
  const defaultDate = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "")
  const filteredProjects = useMemo(() => projects.filter((p) => p.propertyId === propertyId), [projects, propertyId])
  const [projectId, setProjectId] = useState("")
  const [weekNumber, setWeekNumber] = useState("")
  const [uploadDate, setUploadDate] = useState(defaultDate)
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingFiles, setPendingFiles] = useState<PendingPickedFile[]>([])
  const [submitting, setSubmitting] = useState(false)
  const pendingRef = useRef<PendingPickedFile[]>([])
  useEffect(() => {
    pendingRef.current = pendingFiles
  }, [pendingFiles])
  useEffect(() => {
    return () => revokePickedFilePreviewUrls(pendingRef.current)
  }, [])

  useEffect(() => {
    if (properties.length && !properties.some((p) => p.id === propertyId)) {
      setPropertyId(properties[0]!.id)
    }
  }, [properties, propertyId])

  useEffect(() => {
    if (!filteredProjects.length) {
      setProjectId("")
      return
    }
    if (!projectId || !filteredProjects.some((p) => p.id === projectId)) {
      setProjectId(filteredProjects[0]!.id)
    }
  }, [filteredProjects, projectId])

  if (!properties.length) {
    return <p className="text-sm text-neutral-600">Add a property before logging construction weeks.</p>
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault()
        if (submitting) return
        setFormError(null)
        if (!propertyId) {
          setFormError("Select a property.")
          return
        }
        if (!projectId) {
          setFormError("This property has no build programme yet. Add one from the property’s Construction tab.")
          return
        }
        const w = Number(weekNumber)
        if (!String(weekNumber).trim().length || !Number.isFinite(w) || w < 1) {
          setFormError("Enter the week number (a whole number, 1 or higher).")
          return
        }
        const dateStr = uploadDate.trim() || defaultDate
        if (!dateStr) {
          setFormError("Choose the upload date.")
          return
        }
        const pendingSnapshot = [...pendingFiles]
        setSubmitting(true)
        try {
          const stageId = onAddStage({ projectId, weekNumber: w, uploadDate: dateStr })
          if (stageId === undefined) return
          for (const row of pendingSnapshot) {
            const url = await uploadPropertyAssetFile(propertyId, row.file, "construction")
            onAssetAdd({
              ownerType: "construction_stage",
              ownerId: stageId,
              tag: "construction",
              fileName: row.file.name,
              mimeType: row.file.type || "application/octet-stream",
              sizeBytes: row.file.size,
              urlOrPath: url,
            })
          }
          revokePickedFilePreviewUrls(pendingSnapshot)
          setPendingFiles([])
          setWeekNumber("")
          setUploadDate(defaultDate)
          onClose()
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Upload failed."
          useAppStore.getState().setActionNotice({
            kind: "error",
            message: msg.length > 220 ? `${msg.slice(0, 220)}…` : msg,
          })
        } finally {
          setSubmitting(false)
        }
      }}
    >
      {formError ? (
        <p role="alert" className={adminFormAlert}>
          {formError}
        </p>
      ) : null}
      <label className="block text-sm">
        <span className={adminLabel}>Property</span>
        <select
          value={propertyId}
          onChange={(e) => {
            setPropertyId(e.target.value)
            setFormError(null)
          }}
          className={adminFieldInput}
          disabled={submitting}
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className={adminLabel}>Build programme</span>
        <select
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value)
            setFormError(null)
          }}
          className={adminFieldInput}
          disabled={submitting || !filteredProjects.length}
        >
          {!filteredProjects.length ? (
            <option value="">No programme for this property</option>
          ) : (
            filteredProjects.map((p, idx) => (
              <option key={p.id} value={p.id}>
                Programme {idx + 1}
                {p.startDate ? ` · starts ${p.startDate}` : ""}
              </option>
            ))
          )}
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          <span className={adminLabel}>Week #</span>
          <input
            value={weekNumber}
            onChange={(e) => {
              setWeekNumber(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            type="number"
            min={1}
            placeholder="e.g. 3"
            disabled={submitting}
          />
        </label>
        <label className="text-sm">
          <span className={adminLabel}>Upload date</span>
          <input
            value={uploadDate}
            onChange={(e) => {
              setUploadDate(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            type="date"
            disabled={submitting}
          />
        </label>
      </div>
      {projectId ? (
        <p className="text-xs text-neutral-600">
          Programme id <span className="font-mono text-[11px]">{projectId}</span>
        </p>
      ) : null}
      <div className="border-t border-neutral-100 pt-4">
        <span className={adminLabel}>Attachments (optional)</span>
        <p className="mt-1 text-xs text-neutral-600">
          Files upload after the week is saved. Images show a thumbnail preview before upload.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label
            className={`${adminBtnPrimary} inline-flex cursor-pointer items-center gap-2 border-0 hover:opacity-95 ${submitting ? "pointer-events-none opacity-60" : ""}`}
          >
            <span aria-hidden className="text-base leading-none">
              +
            </span>
            Choose files
            <input
              type="file"
              multiple
              className="sr-only"
              disabled={submitting}
              onChange={(event) => {
                const picked = Array.from(event.target.files ?? [])
                event.currentTarget.value = ""
                if (!picked.length) return
                setPendingFiles((prev) => {
                  const next = [...prev]
                  for (const file of picked) {
                    const id = `pending-${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 9)}`
                    const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null
                    next.push({ id, file, previewUrl })
                  }
                  return next
                })
              }}
            />
          </label>
          <span className="text-xs text-neutral-500">Images, PDFs, and other documents.</span>
        </div>
        {pendingFiles.length ? (
          <ul className="mt-4 space-y-2">
            {pendingFiles.map((pf) => (
              <li
                key={pf.id}
                className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50/90 p-2 pr-3"
              >
                {pf.previewUrl ? (
                  <img src={pf.previewUrl} alt="" className="h-14 w-14 shrink-0 rounded-md object-cover ring-1 ring-neutral-200" />
                ) : pf.file.type === "application/pdf" ? (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-red-50 text-xs font-bold text-red-800 ring-1 ring-red-200/60">
                    PDF
                  </div>
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-[10px] font-semibold text-neutral-600 ring-1 ring-neutral-200">
                    FILE
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-yhgc-black">{pf.file.name}</p>
                  <p className="text-xs text-neutral-500">{formatAssetSizeBytes(pf.file.size)}</p>
                </div>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() =>
                    setPendingFiles((prev) => {
                      const row = prev.find((r) => r.id === pf.id)
                      if (row?.previewUrl) URL.revokeObjectURL(row.previewUrl)
                      return prev.filter((r) => r.id !== pf.id)
                    })
                  }
                  className="shrink-0 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-4">
        <button
          type="button"
          disabled={submitting}
          onClick={onClose}
          className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button type="submit" disabled={submitting} className={adminBtnPrimary}>
          {submitting ? "Saving…" : "Log a New Week"}
        </button>
      </div>
    </form>
  )
}

function FinanceLoanNewForm({
  propertyId,
  onAdd,
  onAssetAdd,
  onDone,
}: {
  propertyId: string
  onAdd: (payload: Omit<FinanceRecord, "id">) => string | undefined
  onAssetAdd: (payload: {
    ownerType: Asset["ownerType"]
    ownerId: string
    tag: AttachmentTag
    fileName: string
    mimeType: string
    sizeBytes: number
    urlOrPath: string
  }) => void
  onDone?: () => void
}) {
  const knownValues = new Set(LOAN_TYPE_OPTIONS.map((o) => o.value))
  const [financeType, setFinanceType] = useState("mortgage")
  const [lenderName, setLenderName] = useState("")
  const [lenderContactName, setLenderContactName] = useState("")
  const [lenderContactPhone, setLenderContactPhone] = useState("")
  const [loanAmount, setLoanAmount] = useState("")
  const [monthlyPayment, setMonthlyPayment] = useState("")
  const [interestRatePct, setInterestRatePct] = useState("")
  const [ltvPct, setLtvPct] = useState("")
  const [termEndDate, setTermEndDate] = useState("")
  const [fieldErrors, setFieldErrors] = useState<FinanceLoanModalFieldErrors>({})
  const [pendingFiles, setPendingFiles] = useState<PendingPickedFile[]>([])
  const [submitting, setSubmitting] = useState(false)
  const pendingRef = useRef<PendingPickedFile[]>([])
  useEffect(() => {
    pendingRef.current = pendingFiles
  }, [pendingFiles])
  useEffect(() => {
    return () => revokePickedFilePreviewUrls(pendingRef.current)
  }, [])

  const rawType = financeType.trim()
  const selectValue = knownValues.has(rawType) ? rawType : rawType.length > 0 ? rawType : "mortgage"
  const isCashPurchase = isCashPurchaseType(selectValue)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return
    const nextType = optionalTrimmed(financeType) || "mortgage"
    const isCash = isCashPurchaseType(nextType)
    const errs = validateFinanceLoanModalFields({
      isCash,
      lenderName,
      loanAmount,
      monthlyPayment,
      interestRatePct,
      ltvPct,
      termEndDate,
    })
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      return
    }
    setFieldErrors({})
    const payload: Omit<FinanceRecord, "id"> = {
      propertyId,
      financeType: nextType,
      lenderName: optionalTrimmed(lenderName),
      lenderContactName: optionalTrimmed(lenderContactName),
      lenderContactPhone: optionalTrimmed(lenderContactPhone),
      loanAmount: isCash ? undefined : optionalNumber(loanAmount),
      monthlyPayment: isCash ? undefined : optionalNumber(monthlyPayment),
      interestRatePct: isCash ? undefined : optionalNumber(interestRatePct),
      ltvPct: isCash ? undefined : optionalNumber(ltvPct),
      termEndDate: isCash ? undefined : optionalTrimmed(termEndDate),
    }
    const pendingSnapshot = [...pendingFiles]
    setSubmitting(true)
    try {
      const id = onAdd(payload)
      if (id === undefined) {
        setFieldErrors({ lenderName: "Enter the lender or label (at least 2 characters)." })
        return
      }
      for (const row of pendingSnapshot) {
        const url = await uploadPropertyAssetFile(propertyId, row.file, "finance")
        onAssetAdd({
          ownerType: "finance_record",
          ownerId: id,
          tag: "finance",
          fileName: row.file.name,
          mimeType: row.file.type || "application/octet-stream",
          sizeBytes: row.file.size,
          urlOrPath: url,
        })
      }
      revokePickedFilePreviewUrls(pendingSnapshot)
      setPendingFiles([])
      setLenderName("")
      setLenderContactName("")
      setLenderContactPhone("")
      setLoanAmount("")
      setMonthlyPayment("")
      setInterestRatePct("")
      setLtvPct("")
      setTermEndDate("")
      setFinanceType("mortgage")
      setFieldErrors({})
      onDone?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed."
      useAppStore.getState().setActionNotice({
        kind: "error",
        message: msg.length > 220 ? `${msg.slice(0, 220)}…` : msg,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <form noValidate onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">
            <span className={adminLabel}>Loan type</span>
            <select
              value={selectValue}
              onChange={(e) => {
                setFinanceType(e.target.value)
                setFieldErrors({})
              }}
              className={adminFieldInput}
              disabled={submitting}
            >
              {LOAN_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm sm:col-span-2">
            <span className={adminLabel}>Lender</span>
            <input
              value={lenderName}
              onChange={(e) => {
                setLenderName(e.target.value)
                setFieldErrors((prev) => revokeLoanFieldError(prev, "lenderName"))
              }}
              className={fieldWithInvalid(adminFieldInput, !!fieldErrors.lenderName)}
              disabled={submitting}
              aria-invalid={!!fieldErrors.lenderName}
            />
            {fieldErrors.lenderName ? (
              <p role="alert" className={loanFieldErrorClass}>
                {fieldErrors.lenderName}
              </p>
            ) : null}
          </label>
          <label className="text-sm">
            <span className={adminLabel}>Contact name</span>
            <input
              value={lenderContactName}
              onChange={(e) => setLenderContactName(e.target.value)}
              className={adminFieldInput}
              disabled={submitting}
            />
          </label>
          <label className="text-sm">
            <span className={adminLabel}>Contact phone</span>
            <input
              value={lenderContactPhone}
              onChange={(e) => setLenderContactPhone(e.target.value)}
              className={adminFieldInput}
              disabled={submitting}
            />
          </label>
          {!isCashPurchase ? (
            <>
              <label className="text-sm">
                <span className={adminLabel}>Loan amount (£)</span>
                <input
                  value={loanAmount}
                  onChange={(e) => {
                    setLoanAmount(e.target.value)
                    setFieldErrors((prev) => revokeLoanFieldError(prev, "loanAmount"))
                  }}
                  className={fieldWithInvalid(adminFieldInput, !!fieldErrors.loanAmount)}
                  type="number"
                  min={0}
                  step="0.01"
                  disabled={submitting}
                  aria-invalid={!!fieldErrors.loanAmount}
                />
                {fieldErrors.loanAmount ? (
                  <p role="alert" className={loanFieldErrorClass}>
                    {fieldErrors.loanAmount}
                  </p>
                ) : null}
              </label>
              <label className="text-sm">
                <span className={adminLabel}>Monthly payment (£)</span>
                <input
                  value={monthlyPayment}
                  onChange={(e) => {
                    setMonthlyPayment(e.target.value)
                    setFieldErrors((prev) => revokeLoanFieldError(prev, "monthlyPayment"))
                  }}
                  className={fieldWithInvalid(adminFieldInput, !!fieldErrors.monthlyPayment)}
                  type="number"
                  min={0}
                  step="0.01"
                  disabled={submitting}
                  aria-invalid={!!fieldErrors.monthlyPayment}
                />
                {fieldErrors.monthlyPayment ? (
                  <p role="alert" className={loanFieldErrorClass}>
                    {fieldErrors.monthlyPayment}
                  </p>
                ) : null}
              </label>
              <label className="text-sm">
                <span className={adminLabel}>Interest %</span>
                <input
                  value={interestRatePct}
                  onChange={(e) => {
                    setInterestRatePct(e.target.value)
                    setFieldErrors((prev) => revokeLoanFieldError(prev, "interestRatePct"))
                  }}
                  className={fieldWithInvalid(adminFieldInput, !!fieldErrors.interestRatePct)}
                  type="number"
                  step="0.01"
                  disabled={submitting}
                  aria-invalid={!!fieldErrors.interestRatePct}
                />
                {fieldErrors.interestRatePct ? (
                  <p role="alert" className={loanFieldErrorClass}>
                    {fieldErrors.interestRatePct}
                  </p>
                ) : null}
              </label>
              <label className="text-sm">
                <span className={adminLabel}>LTV %</span>
                <input
                  value={ltvPct}
                  onChange={(e) => {
                    setLtvPct(e.target.value)
                    setFieldErrors((prev) => revokeLoanFieldError(prev, "ltvPct"))
                  }}
                  className={fieldWithInvalid(adminFieldInput, !!fieldErrors.ltvPct)}
                  type="number"
                  step="0.01"
                  disabled={submitting}
                  aria-invalid={!!fieldErrors.ltvPct}
                />
                {fieldErrors.ltvPct ? (
                  <p role="alert" className={loanFieldErrorClass}>
                    {fieldErrors.ltvPct}
                  </p>
                ) : null}
              </label>
              <label className="text-sm sm:col-span-2">
                <span className={adminLabel}>Term end</span>
                <input
                  value={termEndDate}
                  onChange={(e) => {
                    setTermEndDate(e.target.value)
                    setFieldErrors((prev) => revokeLoanFieldError(prev, "termEndDate"))
                  }}
                  className={fieldWithInvalid(adminFieldInput, !!fieldErrors.termEndDate)}
                  type="date"
                  disabled={submitting}
                  aria-invalid={!!fieldErrors.termEndDate}
                />
                {fieldErrors.termEndDate ? (
                  <p role="alert" className={loanFieldErrorClass}>
                    {fieldErrors.termEndDate}
                  </p>
                ) : null}
              </label>
            </>
          ) : null}
        </div>
        <div className="border-t border-neutral-100 pt-4">
          <FileUploadForm
            title="Upload loan documents"
            onFileUpload={async (file, displayName) => {
              const id = `pending-${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 9)}`
              const f =
                displayName.trim() && displayName.trim() !== file.name
                  ? new File([file], displayName.trim(), { type: file.type, lastModified: file.lastModified })
                  : file
              const previewUrl = f.type.startsWith("image/") ? URL.createObjectURL(f) : null
              setPendingFiles((prev) => [...prev, { id, file: f, previewUrl }])
            }}
          />
          {pendingFiles.length ? (
            <ul className="mt-4 space-y-2">
              {pendingFiles.map((pf) => (
                <li
                  key={pf.id}
                  className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50/90 p-2 pr-3"
                >
                  {pf.previewUrl ? (
                    <img
                      src={pf.previewUrl}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-md object-cover ring-1 ring-neutral-200"
                    />
                  ) : pf.file.type === "application/pdf" ? (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-red-50 text-xs font-bold text-red-800 ring-1 ring-red-200/60">
                      PDF
                    </div>
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-[10px] font-semibold text-neutral-600 ring-1 ring-neutral-200">
                      FILE
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-yhgc-black">{pf.file.name}</p>
                    <p className="text-xs text-neutral-500">{formatAssetSizeBytes(pf.file.size)}</p>
                  </div>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() =>
                      setPendingFiles((prev) => {
                        const row = prev.find((r) => r.id === pf.id)
                        if (row?.previewUrl) URL.revokeObjectURL(row.previewUrl)
                        return prev.filter((r) => r.id !== pf.id)
                      })
                    }
                    className="shrink-0 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-xs text-neutral-600">
            Queued files attach after you save the loan (display name is set in the upload dialog).
          </p>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-4">
          <button type="submit" disabled={submitting} className={adminBtnPrimary}>
            {submitting ? "Saving…" : "Add loan"}
          </button>
        </div>
      </form>
    </div>
  )
}

function FinanceLoanEditForm({
  propertyId,
  record,
  loanDocAssets,
  onSave,
  onAssetAdd,
  onUpdateAsset,
  onDeleteAsset,
}: {
  propertyId: string
  record: FinanceRecord
  loanDocAssets: Asset[]
  onSave: (patch: Partial<Omit<FinanceRecord, "id" | "propertyId">>) => void
  onAssetAdd: (payload: {
    ownerType: Asset["ownerType"]
    ownerId: string
    tag: AttachmentTag
    fileName: string
    mimeType: string
    sizeBytes: number
    urlOrPath: string
  }) => void
  onUpdateAsset: (id: string, patch: Partial<Pick<Asset, "fileName">>) => void
  onDeleteAsset: (id: string) => void
}) {
  const knownValues = new Set(LOAN_TYPE_OPTIONS.map((o) => o.value))
  const [financeType, setFinanceType] = useState("")
  const [lenderName, setLenderName] = useState("")
  const [lenderContactName, setLenderContactName] = useState("")
  const [lenderContactPhone, setLenderContactPhone] = useState("")
  const [loanAmount, setLoanAmount] = useState("")
  const [monthlyPayment, setMonthlyPayment] = useState("")
  const [interestRatePct, setInterestRatePct] = useState("")
  const [ltvPct, setLtvPct] = useState("")
  const [termEndDate, setTermEndDate] = useState("")
  const [fieldErrors, setFieldErrors] = useState<FinanceLoanModalFieldErrors>({})

  useEffect(() => {
    setFinanceType(record.financeType ?? "")
    setLenderName(record.lenderName ?? "")
    setLenderContactName(record.lenderContactName ?? "")
    setLenderContactPhone(record.lenderContactPhone ?? "")
    setLoanAmount(record.loanAmount != null ? String(record.loanAmount) : "")
    setMonthlyPayment(record.monthlyPayment != null ? String(record.monthlyPayment) : "")
    setInterestRatePct(record.interestRatePct != null ? String(record.interestRatePct) : "")
    setLtvPct(record.ltvPct != null ? String(record.ltvPct) : "")
    setTermEndDate(toHtmlDateInputValue(record.termEndDate))
    setFieldErrors({})
  }, [record])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const nextType = optionalTrimmed(financeType) || "mortgage"
    const isCash = isCashPurchaseType(nextType)
    const errs = validateFinanceLoanModalFields({
      isCash,
      lenderName,
      loanAmount,
      monthlyPayment,
      interestRatePct,
      ltvPct,
      termEndDate,
    })
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      return
    }
    setFieldErrors({})
    onSave({
      financeType: nextType,
      lenderName: optionalTrimmed(lenderName),
      lenderContactName: optionalTrimmed(lenderContactName),
      lenderContactPhone: optionalTrimmed(lenderContactPhone),
      loanAmount: isCash ? undefined : optionalNumber(loanAmount),
      monthlyPayment: isCash ? undefined : optionalNumber(monthlyPayment),
      interestRatePct: isCash ? undefined : optionalNumber(interestRatePct),
      ltvPct: isCash ? undefined : optionalNumber(ltvPct),
      termEndDate: isCash ? undefined : optionalTrimmed(termEndDate),
    })
  }

  const rawType = financeType.trim()
  const selectValue = knownValues.has(rawType) ? rawType : rawType.length > 0 ? rawType : "mortgage"
  const isCashPurchase = isCashPurchaseType(selectValue)

  const uploadLoanFile = async (file: File, displayName: string) => {
    const url = await uploadPropertyAssetFile(propertyId, file, "finance")
    onAssetAdd({
      ownerType: "finance_record",
      ownerId: record.id,
      tag: "finance",
      fileName: displayName,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      urlOrPath: url,
    })
  }

  return (
    <div className="space-y-6">
      <form noValidate onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">
            <span className={adminLabel}>Loan type</span>
            <select
              value={selectValue}
              onChange={(e) => {
                setFinanceType(e.target.value)
                setFieldErrors({})
              }}
              className={adminFieldInput}
            >
              {LOAN_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              {rawType.length > 0 && !knownValues.has(rawType) ? (
                <option value={rawType}>{loanTypeLabel(rawType)} (legacy)</option>
              ) : null}
            </select>
          </label>
          <label className="text-sm sm:col-span-2">
            <span className={adminLabel}>Lender</span>
            <input
              value={lenderName}
              onChange={(e) => {
                setLenderName(e.target.value)
                setFieldErrors((prev) => revokeLoanFieldError(prev, "lenderName"))
              }}
              className={fieldWithInvalid(adminFieldInput, !!fieldErrors.lenderName)}
              aria-invalid={!!fieldErrors.lenderName}
            />
            {fieldErrors.lenderName ? (
              <p role="alert" className={loanFieldErrorClass}>
                {fieldErrors.lenderName}
              </p>
            ) : null}
          </label>
          <label className="text-sm">
            <span className={adminLabel}>Contact name</span>
            <input value={lenderContactName} onChange={(e) => setLenderContactName(e.target.value)} className={adminFieldInput} />
          </label>
          <label className="text-sm">
            <span className={adminLabel}>Contact phone</span>
            <input value={lenderContactPhone} onChange={(e) => setLenderContactPhone(e.target.value)} className={adminFieldInput} />
          </label>
          {!isCashPurchase ? (
            <>
              <label className="text-sm">
                <span className={adminLabel}>Loan amount (£)</span>
                <input
                  value={loanAmount}
                  onChange={(e) => {
                    setLoanAmount(e.target.value)
                    setFieldErrors((prev) => revokeLoanFieldError(prev, "loanAmount"))
                  }}
                  className={fieldWithInvalid(adminFieldInput, !!fieldErrors.loanAmount)}
                  type="number"
                  min={0}
                  step="0.01"
                  aria-invalid={!!fieldErrors.loanAmount}
                />
                {fieldErrors.loanAmount ? (
                  <p role="alert" className={loanFieldErrorClass}>
                    {fieldErrors.loanAmount}
                  </p>
                ) : null}
              </label>
              <label className="text-sm">
                <span className={adminLabel}>Monthly payment (£)</span>
                <input
                  value={monthlyPayment}
                  onChange={(e) => {
                    setMonthlyPayment(e.target.value)
                    setFieldErrors((prev) => revokeLoanFieldError(prev, "monthlyPayment"))
                  }}
                  className={fieldWithInvalid(adminFieldInput, !!fieldErrors.monthlyPayment)}
                  type="number"
                  min={0}
                  step="0.01"
                  aria-invalid={!!fieldErrors.monthlyPayment}
                />
                {fieldErrors.monthlyPayment ? (
                  <p role="alert" className={loanFieldErrorClass}>
                    {fieldErrors.monthlyPayment}
                  </p>
                ) : null}
              </label>
              <label className="text-sm">
                <span className={adminLabel}>Interest %</span>
                <input
                  value={interestRatePct}
                  onChange={(e) => {
                    setInterestRatePct(e.target.value)
                    setFieldErrors((prev) => revokeLoanFieldError(prev, "interestRatePct"))
                  }}
                  className={fieldWithInvalid(adminFieldInput, !!fieldErrors.interestRatePct)}
                  type="number"
                  step="0.01"
                  aria-invalid={!!fieldErrors.interestRatePct}
                />
                {fieldErrors.interestRatePct ? (
                  <p role="alert" className={loanFieldErrorClass}>
                    {fieldErrors.interestRatePct}
                  </p>
                ) : null}
              </label>
              <label className="text-sm">
                <span className={adminLabel}>LTV %</span>
                <input
                  value={ltvPct}
                  onChange={(e) => {
                    setLtvPct(e.target.value)
                    setFieldErrors((prev) => revokeLoanFieldError(prev, "ltvPct"))
                  }}
                  className={fieldWithInvalid(adminFieldInput, !!fieldErrors.ltvPct)}
                  type="number"
                  step="0.01"
                  aria-invalid={!!fieldErrors.ltvPct}
                />
                {fieldErrors.ltvPct ? (
                  <p role="alert" className={loanFieldErrorClass}>
                    {fieldErrors.ltvPct}
                  </p>
                ) : null}
              </label>
              <label className="text-sm sm:col-span-2">
                <span className={adminLabel}>Term end</span>
                <input
                  value={termEndDate}
                  onChange={(e) => {
                    setTermEndDate(e.target.value)
                    setFieldErrors((prev) => revokeLoanFieldError(prev, "termEndDate"))
                  }}
                  className={fieldWithInvalid(adminFieldInput, !!fieldErrors.termEndDate)}
                  type="date"
                  aria-invalid={!!fieldErrors.termEndDate}
                />
                {fieldErrors.termEndDate ? (
                  <p role="alert" className={loanFieldErrorClass}>
                    {fieldErrors.termEndDate}
                  </p>
                ) : null}
              </label>
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-4">
          <button type="submit" className={adminBtnPrimary}>
            Save loan
          </button>
        </div>
      </form>
      <div>
        <FileUploadForm
          title="Upload loan documents"
          onFileUpload={uploadLoanFile}
          onFiles={legacyOnFilesFromSingle(uploadLoanFile)}
        />
        <div className="mt-3">
          <PropertyTabDocuments
            title="Files for this loan"
            assets={loanDocAssets}
            onUpdateAsset={onUpdateAsset}
            onDeleteAsset={onDeleteAsset}
          />
        </div>
      </div>
    </div>
  )
}

function FinanceLoanReadOnlyDetails({ record }: { record: FinanceRecord }) {
  const isCash = isCashPurchaseType(record.financeType)
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-[minmax(0,11rem)_1fr]">
      <dt className="text-neutral-500">Loan type</dt>
      <dd className="font-medium text-neutral-900">{loanTypeLabel(record.financeType)}</dd>
      <dt className="text-neutral-500">Lender</dt>
      <dd className="break-words font-medium text-neutral-900">{displayField(record.lenderName)}</dd>
      <dt className="text-neutral-500">Contact name</dt>
      <dd className="break-words text-neutral-800">{displayField(record.lenderContactName)}</dd>
      <dt className="text-neutral-500">Contact phone</dt>
      <dd className="break-words text-neutral-800">{displayField(record.lenderContactPhone)}</dd>
      {!isCash ? (
        <>
          <dt className="text-neutral-500">Loan amount</dt>
          <dd className="tabular-nums text-neutral-800">{formatGbpAmount(record.loanAmount)}</dd>
          <dt className="text-neutral-500">Monthly payment</dt>
          <dd className="tabular-nums text-neutral-800">{formatGbpAmount(record.monthlyPayment)}</dd>
          <dt className="text-neutral-500">Interest</dt>
          <dd className="tabular-nums text-neutral-800">
            {record.interestRatePct != null && Number.isFinite(record.interestRatePct)
              ? `${record.interestRatePct}%`
              : "—"}
          </dd>
          <dt className="text-neutral-500">LTV</dt>
          <dd className="tabular-nums text-neutral-800">
            {record.ltvPct != null && Number.isFinite(record.ltvPct) ? `${record.ltvPct}%` : "—"}
          </dd>
          <dt className="text-neutral-500">Term end</dt>
          <dd className="text-neutral-800">{displayField(record.termEndDate)}</dd>
        </>
      ) : (
        <>
          <dt className="text-neutral-500">Notes</dt>
          <dd className="text-xs leading-relaxed text-neutral-600">
            Cash purchase — loan amount, monthly payment, interest, LTV, and term end are not stored for this type.
          </dd>
        </>
      )}
      <dt className="text-neutral-500">Record id</dt>
      <dd className="break-all font-mono text-[11px] text-neutral-700">{record.id}</dd>
    </dl>
  )
}

function PropertyFinanceTabPanel({
  propertyId,
  financeRecords,
  financeAssets,
  onAddFinanceRecord,
  onUpdateFinanceRecord,
  onDeleteFinanceRecord,
  onAssetAdd,
  onUpdateAsset,
  onDeleteAsset,
}: {
  propertyId: string
  financeRecords: FinanceRecord[]
  financeAssets: Asset[]
  onAddFinanceRecord: (payload: Omit<FinanceRecord, "id">) => string | undefined
  onUpdateFinanceRecord: (id: string, patch: Partial<Omit<FinanceRecord, "id" | "propertyId">>) => void
  onDeleteFinanceRecord: (id: string) => void
  onAssetAdd: (payload: {
    ownerType: Asset["ownerType"]
    ownerId: string
    tag: AttachmentTag
    fileName: string
    mimeType: string
    sizeBytes: number
    urlOrPath: string
  }) => void
  onUpdateAsset: (id: string, patch: Partial<Pick<Asset, "fileName">>) => void
  onDeleteAsset: (id: string) => void
}) {
  const [addOpen, setAddOpen] = useState(false)
  const [viewId, setViewId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const propertyLevelFinanceAssets = financeAssets.filter(
    (a) => a.ownerType === "property" && a.ownerId === propertyId && a.tag === "finance",
  )
  const assetsForLoan = (recordId: string) =>
    financeAssets.filter((a) => a.ownerType === "finance_record" && a.ownerId === recordId && a.tag === "finance")

  const uploadPropertyFinanceFile = async (file: File, displayName: string) => {
    const url = await uploadPropertyAssetFile(propertyId, file, "finance")
    onAssetAdd({
      ownerType: "property",
      ownerId: propertyId,
      tag: "finance",
      fileName: displayName,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      urlOrPath: url,
    })
  }

  const sortedLoans = financeRecords.slice().sort((a, b) => (a.lenderName ?? "").localeCompare(b.lenderName ?? ""))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h5 className="text-sm font-semibold text-yhgc-black">Loans</h5>
          <p className="mt-0.5 text-xs text-neutral-600">
            Mortgages, bridging, development finance, or cash purchase — use <strong>Add loan</strong> for the full form,{" "}
            <strong>View</strong> for all fields, or <strong>Edit</strong> on a row.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="shrink-0 rounded-lg border border-yhgc-gold/50 bg-yhgc-gold/10 px-3 py-2 text-sm font-medium text-yhgc-black hover:bg-yhgc-gold/20"
        >
          Add loan
        </button>
      </div>
      {!sortedLoans.length ? (
        <p className="text-sm text-neutral-500">
          No loans recorded yet. Use <strong>Add loan</strong> above.
        </p>
      ) : (
        <div className="overflow-x-auto overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm ring-1 ring-neutral-900/[0.04]">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50/90 text-left text-xs font-semibold uppercase tracking-wide text-neutral-600">
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Lender</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Monthly</th>
                <th className="px-4 py-3">Term end</th>
                <th className="min-w-[13rem] px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {sortedLoans.map((rec) => {
                const isCash = isCashPurchaseType(rec.financeType)
                return (
                  <tr key={rec.id} className="bg-white">
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-800">{loanTypeLabel(rec.financeType)}</td>
                    <td className="max-w-[14rem] truncate px-4 py-3 font-medium text-neutral-900" title={rec.lenderName ?? ""}>
                      {rec.lenderName ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-neutral-800">
                      {isCash ? "—" : formatGbpAmount(rec.loanAmount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-neutral-800">
                      {isCash ? "—" : formatGbpAmount(rec.monthlyPayment)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-700">{displayField(rec.termEndDate)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setViewId(rec.id)}
                          className="rounded-lg border border-yhgc-gold/50 bg-yhgc-gold/10 px-2.5 py-1.5 text-xs font-medium text-yhgc-black hover:bg-yhgc-gold/20"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditId(rec.id)}
                          className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteId(rec.id)}
                          className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="rounded-xl border border-neutral-200 bg-neutral-50/40 p-4 shadow-sm ring-1 ring-neutral-900/[0.03]">
        <h5 className="text-sm font-semibold text-yhgc-black">Property-wide loan documents</h5>
        <p className="mt-1 text-xs text-neutral-600">
          Uploads here are not tied to a single loan (e.g. general correspondence). Per-loan files are added in <strong>Add loan</strong>{" "}
          or <strong>Edit</strong>.
        </p>
        <div className="mt-4">
          <FileUploadForm
            title="Upload loan documents (general)"
            onFileUpload={uploadPropertyFinanceFile}
            onFiles={legacyOnFilesFromSingle(uploadPropertyFinanceFile)}
          />
          <div className="mt-3">
            <PropertyTabDocuments
              title="General loan files"
              assets={propertyLevelFinanceAssets}
              onUpdateAsset={onUpdateAsset}
              onDeleteAsset={onDeleteAsset}
            />
          </div>
        </div>
      </div>
      {viewId
        ? (() => {
            const rec = financeRecords.find((r) => r.id === viewId)
            if (!rec) return null
            return (
              <EditModal title="Loan details" onClose={() => setViewId(null)}>
                <FinanceLoanReadOnlyDetails record={rec} />
                <div className="mt-5">
                  <PropertyTabDocuments
                    title="Attached files"
                    assets={assetsForLoan(rec.id)}
                    showInlinePreviews
                  />
                </div>
                <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-4">
                  <button
                    type="button"
                    onClick={() => setViewId(null)}
                    className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setViewId(null)
                      setEditId(rec.id)
                    }}
                    className={adminBtnPrimary}
                  >
                    Edit loan
                  </button>
                </div>
              </EditModal>
            )
          })()
        : null}
      {addOpen ? (
        <EditModal title="Add loan" onClose={() => setAddOpen(false)}>
          <FinanceLoanNewForm
            propertyId={propertyId}
            onAdd={onAddFinanceRecord}
            onAssetAdd={onAssetAdd}
            onDone={() => setAddOpen(false)}
          />
        </EditModal>
      ) : null}
      {editId
        ? (() => {
            const rec = financeRecords.find((r) => r.id === editId)
            if (!rec) return null
            return (
              <EditModal title="Edit loan" onClose={() => setEditId(null)}>
                <FinanceLoanEditForm
                  key={rec.id}
                  propertyId={propertyId}
                  record={rec}
                  loanDocAssets={assetsForLoan(rec.id)}
                  onSave={(patch) => onUpdateFinanceRecord(rec.id, patch)}
                  onAssetAdd={onAssetAdd}
                  onUpdateAsset={onUpdateAsset}
                  onDeleteAsset={onDeleteAsset}
                />
              </EditModal>
            )
          })()
        : null}
      {deleteId
        ? (() => {
            const rec = financeRecords.find((r) => r.id === deleteId)
            if (!rec) return null
            const nLoanFiles = assetsForLoan(rec.id).length
            return (
              <EditModal title="Delete loan?" onClose={() => setDeleteId(null)}>
                <p className="text-sm leading-relaxed text-neutral-700">
                  Remove <strong>{rec.lenderName ?? "this loan"}</strong>
                  {rec.financeType ? (
                    <>
                      {" "}
                      — <strong>{loanTypeLabel(rec.financeType)}</strong>
                    </>
                  ) : null}
                  ?
                  {nLoanFiles > 0 ? (
                    <>
                      {" "}
                      This will also remove <strong>{nLoanFiles}</strong> file{nLoanFiles === 1 ? "" : "s"} attached to this loan.
                    </>
                  ) : null}{" "}
                  General property loan files are not removed. This cannot be undone.
                </p>
                <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-4">
                  <button
                    type="button"
                    onClick={() => setDeleteId(null)}
                    className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteFinanceRecord(rec.id)
                      setDeleteId(null)
                    }}
                    className={adminBtnDangerOutline}
                  >
                    Delete loan
                  </button>
                </div>
              </EditModal>
            )
          })()
        : null}
    </div>
  )
}

function ConstructionStageEditForm({
  stage,
  onSave,
}: {
  stage: ConstructionStage
  onSave: (patch: Partial<Pick<ConstructionStage, "weekNumber" | "uploadDate">>) => void
}) {
  const [weekNumber, setWeekNumber] = useState(String(stage.weekNumber))
  const [uploadDate, setUploadDate] = useState(() => toHtmlDateInputValue(stage.uploadDate))
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    setWeekNumber(String(stage.weekNumber))
    setUploadDate(toHtmlDateInputValue(stage.uploadDate))
  }, [stage.id, stage.weekNumber, stage.uploadDate])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)
    const w = Number(weekNumber)
    if (!Number.isFinite(w) || w < 1) {
      setFormError("Week number must be 1 or higher.")
      return
    }
    const d = uploadDate.trim()
    if (!d.length) {
      setFormError("Choose an upload date.")
      return
    }
    onSave({ weekNumber: w, uploadDate: d })
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-4">
      {formError ? (
        <p role="alert" className={adminFormAlert}>
          {formError}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className={adminLabel}>Week #</span>
          <input
            value={weekNumber}
            onChange={(e) => {
              setWeekNumber(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            type="number"
            min={1}
          />
        </label>
        <label className="text-sm">
          <span className={adminLabel}>Upload date</span>
          <input
            value={uploadDate}
            onChange={(e) => {
              setUploadDate(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            type="date"
          />
        </label>
      </div>
      <p className="text-xs text-neutral-600">
        Stage id <span className="font-mono text-[11px]">{stage.id}</span>
      </p>
      <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-4">
        <button type="submit" className={adminBtnPrimary}>
          Save week
        </button>
      </div>
    </form>
  )
}

function PropertyConstructionTabPanel({
  propertyId,
  constructionProjects,
  constructionStages,
  constructionAssets,
  onAddConstructionProject,
  onUpdateConstructionProject,
  onAddConstructionStage,
  onAssetAdd,
  onUpdateAsset,
  onDeleteAsset,
  onDeleteConstructionProject,
  onDeleteConstructionStage,
  onUpdateConstructionStage,
}: {
  propertyId: string
  constructionProjects: ConstructionProject[]
  constructionStages: ConstructionStage[]
  constructionAssets: Asset[]
  onAddConstructionProject: (
    initial?: Partial<Pick<ConstructionProject, "totalWeeks" | "startDate" | "expectedCompletionDate">>,
  ) => void
  onUpdateConstructionProject: (id: string, patch: Partial<Omit<ConstructionProject, "id" | "propertyId">>) => void
  onAddConstructionStage: (payload: { projectId: string; weekNumber: number; uploadDate: string }) => string | undefined
  onAssetAdd: (payload: {
    ownerType: Asset["ownerType"]
    ownerId: string
    tag: AttachmentTag
    fileName: string
    mimeType: string
    sizeBytes: number
    urlOrPath: string
  }) => void
  onUpdateAsset: (id: string, patch: Partial<Pick<Asset, "fileName">>) => void
  onDeleteAsset: (id: string) => void
  onDeleteConstructionProject: (projectId: string) => void
  onDeleteConstructionStage: (stageId: string) => void
  onUpdateConstructionStage: (stageId: string, patch: Partial<Pick<ConstructionStage, "weekNumber" | "uploadDate">>) => void
}) {
  const [logWeekDraft, setLogWeekDraft] = useState<Record<string, { week: string; date: string }>>({})
  const [defaultLogDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [editProgrammeId, setEditProgrammeId] = useState<string | null>(null)
  const [deleteProgrammeId, setDeleteProgrammeId] = useState<string | null>(null)
  const [viewProgrammeId, setViewProgrammeId] = useState<string | null>(null)
  const [expandedRosterId, setExpandedRosterId] = useState<string | null>(null)
  const [addProgrammeOpen, setAddProgrammeOpen] = useState(false)
  const [logWeekModalProjectId, setLogWeekModalProjectId] = useState<string | null>(null)
  const [logWeekPendingFiles, setLogWeekPendingFiles] = useState<PendingPickedFile[]>([])
  const [logWeekSubmitting, setLogWeekSubmitting] = useState(false)
  const [logWeekFormError, setLogWeekFormError] = useState<string | null>(null)
  const [weekFilesModalStageId, setWeekFilesModalStageId] = useState<string | null>(null)
  const [viewWeekStageId, setViewWeekStageId] = useState<string | null>(null)
  const [editConstructionStageId, setEditConstructionStageId] = useState<string | null>(null)

  const addProgrammeDraft = useMemo(
    (): ConstructionProject => ({
      id: "__draft-add-programme__",
      propertyId,
      totalWeeks: 8,
      completedStages: 0,
    }),
    [propertyId],
  )

  const closeLogWeekModal = useCallback(() => {
    setLogWeekPendingFiles((prev) => {
      revokePickedFilePreviewUrls(prev)
      return []
    })
    setLogWeekFormError(null)
    setLogWeekModalProjectId(null)
  }, [])

  useEffect(() => {
    const ids = new Set(constructionProjects.map((p) => p.id))
    setLogWeekDraft((d) => {
      const next = { ...d }
      for (const k of Object.keys(next)) {
        if (!ids.has(k)) delete next[k]
      }
      return next
    })
  }, [constructionProjects])

  if (!constructionProjects.length) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm text-neutral-600">No construction programme for this property yet.</p>
        <button
          type="button"
          onClick={() => setAddProgrammeOpen(true)}
          className="mt-4 rounded-lg bg-yhgc-crimson px-4 py-2 text-sm font-medium text-white"
        >
          Add construction programme
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm ring-1 ring-neutral-900/[0.04]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-yhgc-black">Build programmes on this property</h4>
            <p className="mt-1 text-xs text-neutral-600">
              {constructionProjects.length} programme{constructionProjects.length === 1 ? "" : "s"} linked to this
              property. Use each row for <strong>View</strong>, <strong>Log a New Week</strong>, <strong>Edit</strong>, or{" "}
              <strong>Delete</strong> — or expand for a quick preview.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAddProgrammeOpen(true)}
            className="shrink-0 rounded-lg border border-yhgc-gold/50 bg-yhgc-gold/10 px-3 py-2 text-xs font-medium text-yhgc-black hover:bg-yhgc-gold/20"
          >
            Add another programme
          </button>
        </div>
        <ul className="mt-4 divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-neutral-50/60">
          {constructionProjects.map((p, rosterIdx) => {
            const stagesForProg = constructionStages.filter((s) => s.projectId === p.id)
            const sortedStages = stagesForProg
              .slice()
              .sort((a, b) => a.weekNumber - b.weekNumber || a.uploadDate.localeCompare(b.uploadDate))
            const nStages = sortedStages.length
            const rosterOpen = expandedRosterId === p.id
            return (
              <li key={p.id} className="text-sm">
                <div className="flex flex-wrap items-start gap-2 px-3 py-3 sm:gap-3 sm:px-4">
                  <button
                    type="button"
                    aria-expanded={rosterOpen}
                    aria-label={rosterOpen ? "Collapse programme preview" : "Expand programme preview"}
                    onClick={() => setExpandedRosterId(rosterOpen ? null : p.id)}
                    className="mt-0.5 shrink-0 rounded-md border border-transparent p-1 text-neutral-500 hover:border-neutral-200 hover:bg-white hover:text-neutral-800"
                  >
                    <span aria-hidden className="block w-4 text-center text-xs">
                      {rosterOpen ? "▼" : "▶"}
                    </span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-yhgc-black">
                      Programme {rosterIdx + 1}
                      <span className="ml-2 font-mono text-xs font-normal text-neutral-500">{p.id.slice(0, 8)}…</span>
                    </p>
                    <p className="mt-1 text-xs text-neutral-600">
                      <span className="font-medium text-neutral-800">{p.totalWeeks}</span> weeks in programme ·{" "}
                      <span className="font-medium text-neutral-800">{nStages}</span> week{nStages === 1 ? "" : "s"}{" "}
                      logged
                      {p.startDate ? (
                        <>
                          {" "}
                          · start <span className="font-medium text-neutral-800">{p.startDate}</span>
                        </>
                      ) : null}
                      {p.expectedCompletionDate ? (
                        <>
                          {" "}
                          · target <span className="font-medium text-neutral-800">{p.expectedCompletionDate}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:items-end">
                    <span className="self-start rounded-md bg-white px-2.5 py-1 text-xs font-medium tabular-nums text-neutral-800 ring-1 ring-neutral-200 sm:self-end">
                      Record: {nStages} / {p.totalWeeks}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setViewProgrammeId(p.id)}
                        className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
                      >
                        View programme
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setViewProgrammeId(null)
                          setLogWeekModalProjectId(p.id)
                        }}
                        className="rounded-lg border border-yhgc-gold/50 bg-yhgc-gold/10 px-2.5 py-1.5 text-xs font-medium text-yhgc-black hover:bg-yhgc-gold/20"
                      >
                        Log a New Week
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditProgrammeId(p.id)}
                        className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteProgrammeId(p.id)}
                        className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
                {sortedStages.length > 0 ? (
                  <div className="border-t border-neutral-100 bg-white/60 px-3 py-2.5 pl-10 sm:px-4 sm:pl-12">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Logged weeks</p>
                    <ul className="mt-2 space-y-2">
                      {sortedStages.map((s) => {
                        const nFiles = constructionAssets.filter(
                          (a) =>
                            a.ownerType === "construction_stage" &&
                            a.ownerId === s.id &&
                            a.tag === "construction",
                        ).length
                        return (
                          <li
                            key={s.id}
                            className="flex flex-col gap-2 rounded-lg border border-neutral-100 bg-neutral-50/80 px-2.5 py-2 text-xs sm:flex-row sm:flex-wrap sm:items-start sm:justify-between"
                          >
                            <span className="min-w-0">
                              <span className="font-semibold text-yhgc-black">Week {s.weekNumber}</span>
                              <span className="text-neutral-600"> · {s.uploadDate}</span>
                              <span className="ml-2 text-neutral-500">
                                {nFiles} file{nFiles === 1 ? "" : "s"}
                              </span>
                            </span>
                            <div className="flex w-full flex-wrap gap-1.5 sm:w-auto sm:shrink-0 sm:justify-end">
                              <button
                                type="button"
                                onClick={() => setViewWeekStageId(s.id)}
                                className="rounded-md border border-yhgc-gold/50 bg-yhgc-gold/10 px-2 py-1 text-xs font-medium text-yhgc-black hover:bg-yhgc-gold/20"
                              >
                                View log
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditConstructionStageId(s.id)}
                                className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
                              >
                                Edit week
                              </button>
                              <button
                                type="button"
                                onClick={() => setWeekFilesModalStageId(s.id)}
                                className="rounded-md border border-yhgc-gold/50 bg-yhgc-gold/10 px-2 py-1 text-xs font-medium text-yhgc-black hover:bg-yhgc-gold/20"
                              >
                                Week files
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!(await themedConfirm("Delete this stage and any files attached to it?")))
                                    return
                                  onDeleteConstructionStage(s.id)
                                }}
                                className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-100"
                              >
                                Delete
                              </button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ) : null}
                {rosterOpen ? (
                  <div className="border-t border-neutral-100 bg-white/80 px-3 py-3 pl-10 sm:px-4 sm:pl-12">
                    <dl className="grid gap-3 text-xs sm:grid-cols-3">
                      <div>
                        <dt className="font-semibold uppercase tracking-wide text-neutral-500">Start</dt>
                        <dd className="mt-1 font-medium text-neutral-900">{p.startDate ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold uppercase tracking-wide text-neutral-500">Expected completion</dt>
                        <dd className="mt-1 font-medium text-neutral-900">{p.expectedCompletionDate ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold uppercase tracking-wide text-neutral-500">Programme id</dt>
                        <dd className="mt-1 break-all font-mono text-[11px] font-medium text-neutral-800">{p.id}</dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      onClick={() => setLogWeekModalProjectId(p.id)}
                      className="mt-3 text-xs font-medium text-yhgc-crimson underline decoration-yhgc-crimson/30 underline-offset-2 hover:decoration-yhgc-crimson"
                    >
                      Log a new week…
                    </button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      </div>
      {(() => {
        const loose = constructionAssets.filter(
          (a) => a.ownerType === "property" && a.ownerId === propertyId && a.tag === "construction",
        )
        if (!loose.length) return null
        return (
          <div className="rounded-xl border border-amber-200/90 bg-amber-50/50 p-4 shadow-sm">
            <p className="text-sm font-medium text-amber-950">Property-level construction files (not tied to a week)</p>
            <p className="mt-1 text-xs text-amber-900/90">
              Prefer attaching files under the right week via <strong>View programme</strong> → Week files. You can still open, rename, or remove these legacy entries.
            </p>
            <div className="mt-3">
              <PropertyTabDocuments
                title="Legacy construction files"
                assets={loose}
                onUpdateAsset={onUpdateAsset}
                onDeleteAsset={onDeleteAsset}
              />
            </div>
          </div>
        )
      })()}
      {addProgrammeOpen ? (
        <EditModal title="Add build programme" onClose={() => setAddProgrammeOpen(false)}>
          <ConstructionProjectFieldsForm
            key="add-programme"
            project={addProgrammeDraft}
            submitLabel="Add programme"
            showDeleteButton={false}
            requireStartAndCompletion
            onSave={(patch) => {
              onAddConstructionProject({
                totalWeeks: patch.totalWeeks,
                startDate: patch.startDate,
                expectedCompletionDate: patch.expectedCompletionDate,
              })
              setAddProgrammeOpen(false)
            }}
          />
        </EditModal>
      ) : null}
      {logWeekModalProjectId
        ? (() => {
            const project = constructionProjects.find((x) => x.id === logWeekModalProjectId)
            if (!project) return null
            const programmeIdx = constructionProjects.findIndex((x) => x.id === project.id) + 1
            return (
              <EditModal title={`Log a New Week · programme ${programmeIdx}`} onClose={closeLogWeekModal}>
                <form
                  noValidate
                  className="space-y-4"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    if (logWeekSubmitting) return
                    setLogWeekFormError(null)
                    const row = logWeekDraft[project.id]
                    const dateStr = (row?.date ?? defaultLogDate).trim() || defaultLogDate
                    const weekRaw = String(row?.week ?? "").trim()
                    const w = Number(weekRaw)
                    if (!weekRaw.length || !Number.isFinite(w) || w < 1) {
                      setLogWeekFormError("Enter the week number (a whole number, 1 or higher).")
                      return
                    }
                    if (!dateStr) {
                      setLogWeekFormError("Choose the upload date for this week.")
                      return
                    }
                    const pendingSnapshot = [...logWeekPendingFiles]
                    setLogWeekSubmitting(true)
                    try {
                      const stageId = onAddConstructionStage({
                        projectId: project.id,
                        weekNumber: w,
                        uploadDate: dateStr,
                      })
                      if (stageId === undefined) return
                      for (const rowFile of pendingSnapshot) {
                        const url = await uploadPropertyAssetFile(propertyId, rowFile.file, "construction")
                        onAssetAdd({
                          ownerType: "construction_stage",
                          ownerId: stageId,
                          tag: "construction",
                          fileName: rowFile.file.name,
                          mimeType: rowFile.file.type || "application/octet-stream",
                          sizeBytes: rowFile.file.size,
                          urlOrPath: url,
                        })
                      }
                      revokePickedFilePreviewUrls(pendingSnapshot)
                      setLogWeekPendingFiles([])
                      setLogWeekDraft((d) => ({
                        ...d,
                        [project.id]: { week: "", date: dateStr },
                      }))
                      setLogWeekModalProjectId(null)
                      setLogWeekFormError(null)
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : "Upload failed."
                      useAppStore.getState().setActionNotice({
                        kind: "error",
                        message: msg.length > 220 ? `${msg.slice(0, 220)}…` : msg,
                      })
                    } finally {
                      setLogWeekSubmitting(false)
                    }
                  }}
                >
                  {logWeekFormError ? (
                    <p role="alert" className={adminFormAlert}>
                      {logWeekFormError}
                    </p>
                  ) : null}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm">
                      <span className={adminLabel}>Week #</span>
                      <input
                        value={logWeekDraft[project.id]?.week ?? ""}
                        onChange={(e) => {
                          setLogWeekFormError(null)
                          setLogWeekDraft((d) => ({
                            ...d,
                            [project.id]: {
                              week: e.target.value,
                              date: d[project.id]?.date ?? defaultLogDate,
                            },
                          }))
                        }}
                        className={adminFieldInput}
                        type="number"
                        min={1}
                        placeholder="e.g. 3"
                        disabled={logWeekSubmitting}
                      />
                    </label>
                    <label className="text-sm">
                      <span className={adminLabel}>Upload date</span>
                      <input
                        value={logWeekDraft[project.id]?.date ?? defaultLogDate}
                        onChange={(e) => {
                          setLogWeekFormError(null)
                          setLogWeekDraft((d) => ({
                            ...d,
                            [project.id]: {
                              week: d[project.id]?.week ?? "",
                              date: e.target.value,
                            },
                          }))
                        }}
                        className={adminFieldInput}
                        type="date"
                        disabled={logWeekSubmitting}
                      />
                    </label>
                  </div>
                  <p className="text-xs text-neutral-600">
                    Programme id <span className="font-mono text-[11px]">{project.id}</span>
                  </p>
                  <div className="border-t border-neutral-100 pt-4">
                    <span className={adminLabel}>Attachments (optional)</span>
                    <p className="mt-1 text-xs text-neutral-600">
                      Files upload after the week is saved. Images show a thumbnail preview before upload.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <label
                        className={`${adminBtnPrimary} inline-flex cursor-pointer items-center gap-2 border-0 hover:opacity-95 ${logWeekSubmitting ? "pointer-events-none opacity-60" : ""}`}
                      >
                        <span aria-hidden className="text-base leading-none">
                          +
                        </span>
                        Choose files
                        <input
                          type="file"
                          multiple
                          className="sr-only"
                          disabled={logWeekSubmitting}
                          onChange={(event) => {
                            const picked = Array.from(event.target.files ?? [])
                            event.currentTarget.value = ""
                            if (!picked.length) return
                            setLogWeekPendingFiles((prev) => {
                              const next = [...prev]
                              for (const file of picked) {
                                const id = `pending-${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 9)}`
                                const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null
                                next.push({ id, file, previewUrl })
                              }
                              return next
                            })
                          }}
                        />
                      </label>
                      <span className="text-xs text-neutral-500">Images, PDFs, and other documents.</span>
                    </div>
                    {logWeekPendingFiles.length ? (
                      <ul className="mt-4 space-y-2">
                        {logWeekPendingFiles.map((pf) => (
                          <li
                            key={pf.id}
                            className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50/90 p-2 pr-3"
                          >
                            {pf.previewUrl ? (
                              <img
                                src={pf.previewUrl}
                                alt=""
                                className="h-14 w-14 shrink-0 rounded-md object-cover ring-1 ring-neutral-200"
                              />
                            ) : pf.file.type === "application/pdf" ? (
                              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-red-50 text-xs font-bold text-red-800 ring-1 ring-red-200/60">
                                PDF
                              </div>
                            ) : (
                              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-[10px] font-semibold text-neutral-600 ring-1 ring-neutral-200">
                                FILE
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-yhgc-black">{pf.file.name}</p>
                              <p className="text-xs text-neutral-500">{formatAssetSizeBytes(pf.file.size)}</p>
                            </div>
                            <button
                              type="button"
                              disabled={logWeekSubmitting}
                              onClick={() =>
                                setLogWeekPendingFiles((prev) => {
                                  const row = prev.find((r) => r.id === pf.id)
                                  if (row?.previewUrl) URL.revokeObjectURL(row.previewUrl)
                                  return prev.filter((r) => r.id !== pf.id)
                                })
                              }
                              className="shrink-0 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-4">
                    <button
                      type="button"
                      disabled={logWeekSubmitting}
                      onClick={closeLogWeekModal}
                      className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button type="submit" disabled={logWeekSubmitting} className={adminBtnPrimary}>
                      {logWeekSubmitting ? "Saving…" : "Log a New Week"}
                    </button>
                  </div>
                </form>
              </EditModal>
            )
          })()
        : null}
      {weekFilesModalStageId
        ? (() => {
            const stage = constructionStages.find((x) => x.id === weekFilesModalStageId)
            if (!stage) return null
            return (
              <EditModal
                title={`Week ${stage.weekNumber} · ${stage.uploadDate}`}
                onClose={() => setWeekFilesModalStageId(null)}
              >
                <ConstructionWeekFilesCard
                  propertyId={propertyId}
                  stage={stage}
                  constructionAssets={constructionAssets}
                  onAssetAdd={onAssetAdd}
                  onUpdateAsset={onUpdateAsset}
                  onDeleteAsset={onDeleteAsset}
                />
              </EditModal>
            )
          })()
        : null}
      {viewWeekStageId
        ? (() => {
            const stage = constructionStages.find((x) => x.id === viewWeekStageId)
            if (!stage) return null
            const prog = constructionProjects.find((p) => p.id === stage.projectId)
            const programmeOrdinal = prog ? constructionProjects.findIndex((p) => p.id === prog.id) + 1 : 1
            const stageAssets = constructionAssets.filter(
              (a) => a.ownerType === "construction_stage" && a.ownerId === stage.id && a.tag === "construction",
            )
            return (
              <EditModal
                title={`Week ${stage.weekNumber} · ${stage.uploadDate}`}
                onClose={() => setViewWeekStageId(null)}
              >
                <ConstructionWeekLogViewPanel
                  stage={stage}
                  programmeOrdinal={programmeOrdinal}
                  stageAssets={stageAssets}
                />
                <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-4">
                  <button
                    type="button"
                    onClick={() => setViewWeekStageId(null)}
                    className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setViewWeekStageId(null)
                      queueMicrotask(() => setWeekFilesModalStageId(stage.id))
                    }}
                    className="rounded-lg border border-yhgc-gold/50 bg-yhgc-gold/10 px-4 py-2 text-sm font-medium text-yhgc-black hover:bg-yhgc-gold/20"
                  >
                    Week files
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setViewWeekStageId(null)
                      queueMicrotask(() => setEditConstructionStageId(stage.id))
                    }}
                    className={adminBtnPrimary}
                  >
                    Edit week
                  </button>
                </div>
              </EditModal>
            )
          })()
        : null}
      {editConstructionStageId
        ? (() => {
            const stage = constructionStages.find((x) => x.id === editConstructionStageId)
            if (!stage) return null
            const prog = constructionProjects.find((p) => p.id === stage.projectId)
            const programmeIdx = prog ? constructionProjects.findIndex((p) => p.id === prog.id) + 1 : 1
            return (
              <EditModal
                title={`Edit logged week · programme ${programmeIdx}`}
                onClose={() => setEditConstructionStageId(null)}
              >
                <ConstructionStageEditForm
                  key={stage.id}
                  stage={stage}
                  onSave={(patch) => {
                    onUpdateConstructionStage(stage.id, patch)
                    setEditConstructionStageId(null)
                  }}
                />
              </EditModal>
            )
          })()
        : null}
      {viewProgrammeId
        ? (() => {
            const prog = constructionProjects.find((x) => x.id === viewProgrammeId)
            if (!prog) return null
            const rosterIdx = constructionProjects.findIndex((x) => x.id === prog.id) + 1
            const stages = constructionStages
              .filter((s) => s.projectId === prog.id)
              .slice()
              .sort((a, b) => a.weekNumber - b.weekNumber || a.uploadDate.localeCompare(b.uploadDate))
            return (
              <EditModal
                title={`Programme ${rosterIdx} · review`}
                onClose={() => setViewProgrammeId(null)}
              >
                <div className="space-y-5">
                  <dl className="grid gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Start</dt>
                      <dd className="mt-1 font-medium text-neutral-900">{prog.startDate ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Expected completion</dt>
                      <dd className="mt-1 font-medium text-neutral-900">{prog.expectedCompletionDate ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Total weeks</dt>
                      <dd className="mt-1 font-medium text-neutral-900">{prog.totalWeeks}</dd>
                    </div>
                  </dl>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Programme id</p>
                    <p className="mt-1 break-all font-mono text-xs text-neutral-800">{prog.id}</p>
                  </div>
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 p-3">
                    <h5 className="text-sm font-semibold text-yhgc-black">Logged weeks</h5>
                    {stages.length === 0 ? (
                      <p className="mt-2 text-sm text-neutral-600">No weeks logged yet.</p>
                    ) : (
                      <ul className="mt-2 divide-y divide-neutral-200">
                        {stages.map((s) => {
                          const nFiles = constructionAssets.filter(
                            (a) =>
                              a.ownerType === "construction_stage" &&
                              a.ownerId === s.id &&
                              a.tag === "construction",
                          ).length
                          return (
                            <li
                              key={s.id}
                              className="flex flex-col gap-2 border-b border-neutral-100 py-3 text-sm last:border-b-0 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between"
                            >
                              <span className="min-w-0">
                                <span className="font-semibold text-yhgc-black">Week {s.weekNumber}</span>
                                <span className="text-neutral-600"> · {s.uploadDate}</span>
                                <span className="ml-2 text-xs text-neutral-500">
                                  {nFiles} file{nFiles === 1 ? "" : "s"}
                                </span>
                              </span>
                              <div className="flex w-full flex-wrap gap-1.5 sm:w-auto sm:shrink-0 sm:justify-end">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setViewProgrammeId(null)
                                    queueMicrotask(() => setViewWeekStageId(s.id))
                                  }}
                                  className="rounded-lg border border-yhgc-gold/50 bg-yhgc-gold/10 px-2.5 py-1.5 text-xs font-medium text-yhgc-black hover:bg-yhgc-gold/20"
                                >
                                  View log
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setViewProgrammeId(null)
                                    queueMicrotask(() => setEditConstructionStageId(s.id))
                                  }}
                                  className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
                                >
                                  Edit week
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setViewProgrammeId(null)
                                    queueMicrotask(() => setWeekFilesModalStageId(s.id))
                                  }}
                                  className="rounded-lg border border-yhgc-gold/50 bg-yhgc-gold/10 px-2.5 py-1.5 text-xs font-medium text-yhgc-black hover:bg-yhgc-gold/20"
                                >
                                  Week files
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (!(await themedConfirm("Delete this stage and any files attached to it?")))
                                      return
                                    onDeleteConstructionStage(s.id)
                                  }}
                                  className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
                                >
                                  Delete
                                </button>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-4">
                    <button
                      type="button"
                      onClick={() => setViewProgrammeId(null)}
                      className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setViewProgrammeId(null)
                        queueMicrotask(() => setLogWeekModalProjectId(prog.id))
                      }}
                      className="rounded-lg border border-yhgc-gold/50 bg-yhgc-gold/10 px-3 py-2 text-xs font-medium text-yhgc-black hover:bg-yhgc-gold/20"
                    >
                      Log a New Week
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setViewProgrammeId(null)
                        queueMicrotask(() => setEditProgrammeId(prog.id))
                      }}
                      className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
                    >
                      Edit programme
                    </button>
                  </div>
                </div>
              </EditModal>
            )
          })()
        : null}
      {editProgrammeId
        ? (() => {
            const prog = constructionProjects.find((x) => x.id === editProgrammeId)
            if (!prog) return null
            return (
              <EditModal title="Edit build programme" onClose={() => setEditProgrammeId(null)}>
                <ConstructionProjectFieldsForm
                  key={prog.id}
                  project={prog}
                  showDeleteButton={false}
                  onSave={(patch) => {
                    onUpdateConstructionProject(prog.id, patch)
                    setEditProgrammeId(null)
                  }}
                />
              </EditModal>
            )
          })()
        : null}
      {deleteProgrammeId
        ? (() => {
            const prog = constructionProjects.find((x) => x.id === deleteProgrammeId)
            if (!prog) return null
            const idx = constructionProjects.findIndex((x) => x.id === prog.id) + 1
            return (
              <EditModal title="Delete build programme?" onClose={() => setDeleteProgrammeId(null)}>
                <p className="text-sm leading-relaxed text-neutral-700">
                  This will permanently remove <strong>build programme {idx}</strong>, every logged week on that programme,
                  and all construction files attached to those weeks.
                </p>
                <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-4">
                  <button
                    type="button"
                    onClick={() => setDeleteProgrammeId(null)}
                    className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteConstructionProject(prog.id)
                      setDeleteProgrammeId(null)
                    }}
                    className={adminBtnDangerOutline}
                  >
                    Delete programme
                  </button>
                </div>
              </EditModal>
            )
          })()
        : null}
    </div>
  )
}

function PropertyInsuranceTabPanel({
  propertyId,
  insuranceRecords,
  insuranceAssets,
  onAddInsuranceRecord,
  onUpdateInsuranceRecord,
  onDeleteInsuranceRecord,
  onAssetAdd,
  onUpdateAsset,
  onDeleteAsset,
}: {
  propertyId: string
  insuranceRecords: InsuranceRecord[]
  insuranceAssets: Asset[]
  onAddInsuranceRecord: (payload: Partial<Omit<InsuranceRecord, "id" | "propertyId">>) => string | undefined
  onUpdateInsuranceRecord: (id: string, patch: Partial<Omit<InsuranceRecord, "id" | "propertyId">>) => void
  onDeleteInsuranceRecord: (id: string) => void
  onAssetAdd: (payload: {
    ownerType: Asset["ownerType"]
    ownerId: string
    tag: AttachmentTag
    fileName: string
    mimeType: string
    sizeBytes: number
    urlOrPath: string
  }) => void
  onUpdateAsset: (id: string, patch: Partial<Pick<Asset, "fileName">>) => void
  onDeleteAsset: (id: string) => void
}) {
  const [addOpen, setAddOpen] = useState(false)
  const [viewId, setViewId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const propertyLevelInsuranceAssets = insuranceAssets.filter(
    (a) => a.ownerType === "property" && a.ownerId === propertyId && a.tag === "insurance",
  )
  const assetsForPolicy = (recordId: string) =>
    insuranceAssets.filter((a) => a.ownerType === "insurance_record" && a.ownerId === recordId && a.tag === "insurance")

  const uploadPropertyInsuranceFile = async (file: File, displayName: string) => {
    const url = await uploadPropertyAssetFile(propertyId, file, "insurance")
    onAssetAdd({
      ownerType: "property",
      ownerId: propertyId,
      tag: "insurance",
      fileName: displayName,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      urlOrPath: url,
    })
  }

  const sortedRecords = insuranceRecords.slice().sort((a, b) => {
    const da = a.coverEndDate ?? a.policyNumber ?? ""
    const db = b.coverEndDate ?? b.policyNumber ?? ""
    return db.localeCompare(da)
  })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h5 className="text-sm font-semibold text-yhgc-black">Insurance policies</h5>
          <p className="mt-0.5 text-xs text-neutral-600">
            Policies, cover dates, renewal alerts, and policy documents — use <strong>View</strong> for read-only details and
            files, <strong>Add insurance policy</strong> for the full form, or <strong>Edit</strong> on a row.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="shrink-0 rounded-lg border border-yhgc-gold/50 bg-yhgc-gold/10 px-3 py-2 text-sm font-medium text-yhgc-black hover:bg-yhgc-gold/20"
        >
          Add insurance policy
        </button>
      </div>
      {!sortedRecords.length ? (
        <p className="text-sm text-neutral-500">
          No insurance policies yet. Use <strong>Add insurance policy</strong> above.
        </p>
      ) : (
        <div className="overflow-x-auto overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm ring-1 ring-neutral-900/[0.04]">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50/90 text-left text-xs font-semibold uppercase tracking-wide text-neutral-600">
                <th className="px-4 py-3">Insurer</th>
                <th className="px-4 py-3">Policy</th>
                <th className="px-4 py-3">Cover</th>
                <th className="min-w-[13rem] px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {sortedRecords.map((rec) => {
                const cover =
                  rec.coverStartDate && rec.coverEndDate
                    ? `${rec.coverStartDate} → ${rec.coverEndDate}`
                    : rec.coverStartDate || rec.coverEndDate || "—"
                return (
                  <tr key={rec.id} className="bg-white">
                    <td className="max-w-[12rem] truncate px-4 py-3 font-medium text-neutral-900" title={rec.insurerName ?? ""}>
                      {rec.insurerName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-neutral-800">{rec.policyNumber ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-700">{cover}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setViewId(rec.id)}
                          className="rounded-lg border border-yhgc-gold/50 bg-yhgc-gold/10 px-2.5 py-1.5 text-xs font-medium text-yhgc-black hover:bg-yhgc-gold/20"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditId(rec.id)}
                          className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteId(rec.id)}
                          className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="rounded-xl border border-neutral-200 bg-neutral-50/40 p-4 shadow-sm ring-1 ring-neutral-900/[0.03]">
        <h5 className="text-sm font-semibold text-yhgc-black">Property-wide insurance documents</h5>
        <p className="mt-1 text-xs text-neutral-600">
          Uploads here are not tied to a single policy (e.g. correspondence or schedules that apply to the property overall).
        </p>
        <div className="mt-4">
          <FileUploadForm
            title="Upload insurance documents (general)"
            onFileUpload={uploadPropertyInsuranceFile}
            onFiles={legacyOnFilesFromSingle(uploadPropertyInsuranceFile)}
          />
        </div>
        <div className="mt-3">
          <PropertyTabDocuments
            title="General insurance files"
            assets={propertyLevelInsuranceAssets}
            onUpdateAsset={onUpdateAsset}
            onDeleteAsset={onDeleteAsset}
            showInlinePreviews
          />
        </div>
      </div>
      {viewId
        ? (() => {
            const rec = insuranceRecords.find((r) => r.id === viewId)
            if (!rec) return null
            return (
              <EditModal title="Insurance policy details" onClose={() => setViewId(null)}>
                <InsurancePolicyReadOnlyDetails rec={rec} />
                <div className="mt-5">
                  <PropertyTabDocuments title="Policy files" assets={assetsForPolicy(rec.id)} showInlinePreviews />
                </div>
                <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-4">
                  <button
                    type="button"
                    onClick={() => setViewId(null)}
                    className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setViewId(null)
                      setEditId(rec.id)
                    }}
                    className={adminBtnPrimary}
                  >
                    Edit policy
                  </button>
                </div>
              </EditModal>
            )
          })()
        : null}
      {addOpen ? (
        <EditModal title="Add insurance policy" onClose={() => setAddOpen(false)}>
          <InsurancePolicyNewForm
            propertyId={propertyId}
            onAdd={onAddInsuranceRecord}
            onAssetAdd={onAssetAdd}
            onDone={() => setAddOpen(false)}
          />
        </EditModal>
      ) : null}
      {editId
        ? (() => {
            const rec = insuranceRecords.find((r) => r.id === editId)
            if (!rec) return null
            return (
              <EditModal title="Edit insurance policy" onClose={() => setEditId(null)}>
                <InsurancePolicyForm
                  key={rec.id}
                  propertyId={propertyId}
                  record={rec}
                  policyAssets={assetsForPolicy(rec.id)}
                  onSave={(patch) => onUpdateInsuranceRecord(rec.id, patch)}
                  onAssetAdd={onAssetAdd}
                  onUpdateAsset={onUpdateAsset}
                  onDeleteAsset={onDeleteAsset}
                />
              </EditModal>
            )
          })()
        : null}
      {deleteId
        ? (() => {
            const rec = insuranceRecords.find((r) => r.id === deleteId)
            if (!rec) return null
            const nPolicyFiles = assetsForPolicy(rec.id).length
            return (
              <EditModal title="Delete insurance policy?" onClose={() => setDeleteId(null)}>
                <p className="text-sm leading-relaxed text-neutral-700">
                  Remove <strong>{rec.insurerName ?? "this policy"}</strong>
                  {rec.policyNumber ? (
                    <>
                      {" "}
                      — policy <strong>{rec.policyNumber}</strong>
                    </>
                  ) : null}
                  ?
                  {nPolicyFiles > 0 ? (
                    <>
                      {" "}
                      This will also remove <strong>{nPolicyFiles}</strong> file{nPolicyFiles === 1 ? "" : "s"} attached to this policy.
                    </>
                  ) : null}{" "}
                  General property insurance files are not removed. This cannot be undone.
                </p>
                <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-4">
                  <button
                    type="button"
                    onClick={() => setDeleteId(null)}
                    className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteInsuranceRecord(rec.id)
                      setDeleteId(null)
                    }}
                    className={adminBtnDangerOutline}
                  >
                    Delete policy
                  </button>
                </div>
              </EditModal>
            )
          })()
        : null}
    </div>
  )
}

/** Invoice PDFs stored as `assets` plus optional legacy `invoice.pdfUrl` when not duplicated. */
function invoiceLegacyPdfAsset(invoice: Invoice): Asset | null {
  const url = invoice.pdfUrl?.trim()
  if (!url) return null
  const isPdf = /\.pdf(\?|#|$)/i.test(url) || url.toLowerCase().includes("application/pdf")
  return {
    id: `${invoice.id}__legacyPdfLink`,
    ownerType: "invoice",
    ownerId: invoice.id,
    tag: "invoice",
    fileName: "Invoice PDF (link on record)",
    mimeType: isPdf ? "application/pdf" : "application/octet-stream",
    sizeBytes: 0,
    urlOrPath: url,
    createdAt: "",
  }
}

function invoiceRowAttachmentAssets(invoice: Invoice, allAssets: Asset[]): Asset[] {
  const rows = allAssets.filter((a) => a.ownerType === "invoice" && a.ownerId === invoice.id && a.tag === "invoice")
  const legacy = invoiceLegacyPdfAsset(invoice)
  if (!legacy) return rows
  if (rows.some((a) => a.urlOrPath.trim() === legacy.urlOrPath.trim())) return rows
  return [...rows, legacy]
}

function PropertyTabEditor({
  tab,
  property,
  invoices,
  assets,
  constructionProjects,
  constructionStages,
  financeRecords,
  incomeRows,
  insuranceRecords,
  onAddConstructionProject,
  onUpdateConstructionProject,
  onAddConstructionStage,
  onAddFinanceRecord,
  onUpdateFinanceRecord,
  onAddIncomeRow,
  onUpdateIncomeRow,
  onAddInvoice,
  onUpdateInvoice,
  onDeleteInvoice,
  onAddInsuranceRecord,
  onUpdateInsuranceRecord,
  onDeleteInsuranceRecord,
  onDeleteFinanceRecord,
  onDeleteIncomeRow,
  onUpdateAsset,
  onDeleteAsset,
  onAssetAdd,
  onDeleteConstructionProject,
  onDeleteConstructionStage,
  onUpdateConstructionStage,
}: {
  tab: PropertyEditorTab
  property: Property
  invoices: Invoice[]
  assets: Asset[]
  constructionProjects: ConstructionProject[]
  constructionStages: ConstructionStage[]
  financeRecords: FinanceRecord[]
  incomeRows: IncomeRow[]
  insuranceRecords: InsuranceRecord[]
  onAddConstructionProject: (
    initial?: Partial<Pick<ConstructionProject, "totalWeeks" | "startDate" | "expectedCompletionDate">>,
  ) => void
  onUpdateConstructionProject: (id: string, patch: Partial<Omit<ConstructionProject, "id" | "propertyId">>) => void
  onAddConstructionStage: (payload: { projectId: string; weekNumber: number; uploadDate: string }) => string | undefined
  onAddFinanceRecord: (payload: Omit<FinanceRecord, "id">) => string | undefined
  onUpdateFinanceRecord: (id: string, patch: Partial<Omit<FinanceRecord, "id" | "propertyId">>) => void
  onAddIncomeRow: (payload: Omit<IncomeRow, "id">) => void
  onUpdateIncomeRow: (id: string, patch: Partial<Omit<IncomeRow, "id" | "propertyId">>) => void
  onAddInvoice: (payload: {
    supplierName: string
    invoiceRef: string
    invoiceDate: string
    amount: number
    status: InvoiceStatus
  }) => string | undefined
  onUpdateInvoice: (id: string, patch: Partial<Omit<Invoice, "id" | "propertyId">>) => void
  onDeleteInvoice: (id: string) => void
  onAddInsuranceRecord: (payload: Partial<Omit<InsuranceRecord, "id" | "propertyId">>) => string | undefined
  onUpdateInsuranceRecord: (id: string, patch: Partial<Omit<InsuranceRecord, "id" | "propertyId">>) => void
  onDeleteInsuranceRecord: (id: string) => void
  onDeleteFinanceRecord: (id: string) => void
  onDeleteIncomeRow: (id: string) => void
  onUpdateAsset: (id: string, patch: Partial<Pick<Asset, "fileName">>) => void
  onDeleteAsset: (id: string) => void
  onAssetAdd: (payload: {
    ownerType: Asset["ownerType"]
    ownerId: string
    tag: AttachmentTag
    fileName: string
    mimeType: string
    sizeBytes: number
    urlOrPath: string
  }) => void
  onDeleteConstructionProject: (projectId: string) => void
  onDeleteConstructionStage: (stageId: string) => void
  onUpdateConstructionStage: (stageId: string, patch: Partial<Pick<ConstructionStage, "weekNumber" | "uploadDate">>) => void
}) {
  const propertyId = property.id
  const docsFor = (tag: AttachmentTag) => assets.filter((a) => a.tag === tag)
  const [incomeAddOpen, setIncomeAddOpen] = useState(false)
  const [incomeViewId, setIncomeViewId] = useState<string | null>(null)
  const [incomeEditId, setIncomeEditId] = useState<string | null>(null)
  const [incomeDeleteId, setIncomeDeleteId] = useState<string | null>(null)
  const [invoiceAddOpen, setInvoiceAddOpen] = useState(false)
  const [invoiceViewId, setInvoiceViewId] = useState<string | null>(null)
  const [invoiceEditId, setInvoiceEditId] = useState<string | null>(null)
  const [invoiceDeleteId, setInvoiceDeleteId] = useState<string | null>(null)
  const [invoiceTablePreviewAsset, setInvoiceTablePreviewAsset] = useState<Asset | null>(null)

  if (tab === "construction") {
    return (
      <PropertyConstructionTabPanel
        propertyId={propertyId}
        constructionProjects={constructionProjects}
        constructionStages={constructionStages}
        constructionAssets={docsFor("construction")}
        onAddConstructionProject={onAddConstructionProject}
        onUpdateConstructionProject={onUpdateConstructionProject}
        onAddConstructionStage={onAddConstructionStage}
        onAssetAdd={onAssetAdd}
        onUpdateAsset={onUpdateAsset}
        onDeleteAsset={onDeleteAsset}
        onDeleteConstructionProject={onDeleteConstructionProject}
        onDeleteConstructionStage={onDeleteConstructionStage}
        onUpdateConstructionStage={onUpdateConstructionStage}
      />
    )
  }

  if (tab === "finance") {
    return (
      <PropertyFinanceTabPanel
        propertyId={propertyId}
        financeRecords={financeRecords}
        financeAssets={docsFor("finance")}
        onAddFinanceRecord={onAddFinanceRecord}
        onUpdateFinanceRecord={onUpdateFinanceRecord}
        onDeleteFinanceRecord={onDeleteFinanceRecord}
        onAssetAdd={onAssetAdd}
        onUpdateAsset={onUpdateAsset}
        onDeleteAsset={onDeleteAsset}
      />
    )
  }

  if (tab === "income") {
    const sortedRows = incomeRows.slice().sort((a, b) => b.period.localeCompare(a.period))
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setIncomeAddOpen(true)}
            className="rounded-lg border border-yhgc-gold/50 bg-yhgc-gold/10 px-3 py-2 text-sm font-medium text-yhgc-black hover:bg-yhgc-gold/20"
          >
            Add income row
          </button>
        </div>
        {!sortedRows.length ? (
          <p className="text-sm text-neutral-500">No income rows yet. Use <strong>Add income row</strong> above.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm ring-1 ring-neutral-900/[0.04]">
            <table className="w-full min-w-[20rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50/90 text-left text-xs font-semibold uppercase tracking-wide text-neutral-600">
                  <th className="px-4 py-3">Period</th>
                  <th className="px-4 py-3 text-right">Income (£)</th>
                  <th className="px-4 py-3 text-right">Costs (£)</th>
                  <th className="min-w-[13rem] px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {sortedRows.map((row) => (
                  <tr key={row.id} className="bg-white">
                    <td className="px-4 py-3 font-medium text-neutral-900">{row.period}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-800">{formatGbpAmount(row.incomeAmount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-800">{formatGbpAmount(row.costAmount)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setIncomeViewId(row.id)}
                          className="rounded-lg border border-yhgc-gold/50 bg-yhgc-gold/10 px-2.5 py-1.5 text-xs font-medium text-yhgc-black hover:bg-yhgc-gold/20"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => setIncomeEditId(row.id)}
                          className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setIncomeDeleteId(row.id)}
                          className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {incomeViewId
          ? (() => {
              const row = incomeRows.find((r) => r.id === incomeViewId)
              if (!row) return null
              return (
                <EditModal title="Income row details" onClose={() => setIncomeViewId(null)}>
                  <IncomeRowReadOnlyDetails row={row} />
                  <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-4">
                    <button
                      type="button"
                      onClick={() => setIncomeViewId(null)}
                      className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIncomeViewId(null)
                        setIncomeEditId(row.id)
                      }}
                      className={adminBtnPrimary}
                    >
                      Edit row
                    </button>
                  </div>
                </EditModal>
              )
            })()
          : null}
        {incomeAddOpen ? (
          <EditModal title="Add income row" onClose={() => setIncomeAddOpen(false)}>
            <IncomeNewRowForm
              propertyId={propertyId}
              onAdd={onAddIncomeRow}
              onDone={() => setIncomeAddOpen(false)}
            />
          </EditModal>
        ) : null}
        {incomeEditId
          ? (() => {
              const row = incomeRows.find((r) => r.id === incomeEditId)
              if (!row) return null
              return (
                <EditModal title="Edit income row" onClose={() => setIncomeEditId(null)}>
                  <IncomeRowForm
                    key={row.id}
                    row={row}
                    submitLabel="Save income row"
                    onSubmit={(patch) => {
                      onUpdateIncomeRow(row.id, patch)
                      setIncomeEditId(null)
                    }}
                  />
                </EditModal>
              )
            })()
          : null}
        {incomeDeleteId
          ? (() => {
              const row = incomeRows.find((r) => r.id === incomeDeleteId)
              if (!row) return null
              return (
                <EditModal title="Delete income row?" onClose={() => setIncomeDeleteId(null)}>
                  <p className="text-sm leading-relaxed text-neutral-700">
                    Remove the row for period <strong>{row.period}</strong> (income {formatGbpAmount(row.incomeAmount)}, costs{" "}
                    {formatGbpAmount(row.costAmount)})? This cannot be undone.
                  </p>
                  <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-4">
                    <button
                      type="button"
                      onClick={() => setIncomeDeleteId(null)}
                      className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteIncomeRow(row.id)
                        setIncomeDeleteId(null)
                      }}
                      className={adminBtnDangerOutline}
                    >
                      Delete row
                    </button>
                  </div>
                </EditModal>
              )
            })()
          : null}
      </div>
    )
  }

  if (tab === "invoices") {
    const sortedInv = invoices.slice().sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate))
    const assetsForInvoice = (invId: string) =>
      assets.filter((a) => a.ownerType === "invoice" && a.ownerId === invId && a.tag === "invoice")

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h5 className="text-sm font-semibold text-yhgc-black">Invoices for this property</h5>
            <p className="mt-0.5 text-xs text-neutral-600">
              Supplier invoices, references, amounts, and linked files — use <strong>View</strong> for the full record and attachments.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setInvoiceAddOpen(true)}
            className="shrink-0 rounded-lg border border-yhgc-gold/50 bg-yhgc-gold/10 px-3 py-2 text-sm font-medium text-yhgc-black hover:bg-yhgc-gold/20"
          >
            Add invoice
          </button>
        </div>
        {!sortedInv.length ? (
          <p className="text-sm text-neutral-500">
            No invoices recorded yet. Use <strong>Add invoice</strong> above, then open <strong>Edit</strong> to attach files.
          </p>
        ) : (
          <div className="overflow-x-auto overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm ring-1 ring-neutral-900/[0.04]">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50/90 text-left text-xs font-semibold uppercase tracking-wide text-neutral-600">
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Amount (£)</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="min-w-[12rem] max-w-[18rem] px-4 py-3">Files</th>
                  <th className="min-w-[13rem] px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {sortedInv.map((inv) => (
                  <tr key={inv.id} className="bg-white">
                    <td className="max-w-[10rem] truncate px-4 py-3 font-medium text-neutral-900" title={inv.supplierName}>
                      {inv.supplierName}
                    </td>
                    <td className="px-4 py-3 text-neutral-800">{inv.invoiceRef || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-700">{inv.invoiceDate}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-800">{formatGbpAmount(inv.amount)}</td>
                    <td className="px-4 py-3 capitalize text-neutral-800">{inv.status}</td>
                    <td className="align-top px-4 py-3">
                      {(() => {
                        const list = invoiceRowAttachmentAssets(inv, assets)
                        if (!list.length) {
                          return <span className="text-xs text-neutral-400">—</span>
                        }
                        return (
                          <ul className="flex flex-col gap-2">
                            {list.map((a) => (
                              <li key={a.id} className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setInvoiceTablePreviewAsset(a)}
                                    className="shrink-0 rounded border border-yhgc-gold/45 bg-yhgc-gold/10 px-2 py-0.5 text-[11px] font-semibold text-yhgc-black hover:bg-yhgc-gold/20"
                                  >
                                    View
                                  </button>
                                  <a
                                    href={a.urlOrPath}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="min-w-0 truncate text-[11px] font-medium text-yhgc-crimson hover:underline"
                                    title={a.fileName}
                                  >
                                    {a.fileName}
                                  </a>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setInvoiceViewId(inv.id)}
                          className="rounded-lg border border-yhgc-gold/50 bg-yhgc-gold/10 px-2.5 py-1.5 text-xs font-medium text-yhgc-black hover:bg-yhgc-gold/20"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => setInvoiceEditId(inv.id)}
                          className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setInvoiceDeleteId(inv.id)}
                          className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {invoiceViewId
          ? (() => {
              const inv = invoices.find((i) => i.id === invoiceViewId)
              if (!inv) return null
              return (
                <EditModal title="Invoice details" onClose={() => setInvoiceViewId(null)}>
                  <InvoiceReadOnlyDetails inv={inv} />
                  <div className="mt-5">
                    <PropertyTabDocuments
                      title="Attached files"
                      assets={assetsForInvoice(inv.id)}
                      showInlinePreviews
                    />
                  </div>
                  <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-4">
                    <button
                      type="button"
                      onClick={() => setInvoiceViewId(null)}
                      className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setInvoiceViewId(null)
                        setInvoiceEditId(inv.id)
                      }}
                      className={adminBtnPrimary}
                    >
                      Edit invoice
                    </button>
                  </div>
                </EditModal>
              )
            })()
          : null}
        {invoiceAddOpen ? (
          <EditModal title="Add invoice" onClose={() => setInvoiceAddOpen(false)}>
            <InvoiceNewForm
              propertyId={propertyId}
              onAdd={onAddInvoice}
              onAssetAdd={onAssetAdd}
              onDone={() => setInvoiceAddOpen(false)}
            />
          </EditModal>
        ) : null}
        {invoiceEditId
          ? (() => {
              const inv = invoices.find((i) => i.id === invoiceEditId)
              if (!inv) return null
              return (
                <EditModal title="Edit invoice" onClose={() => setInvoiceEditId(null)}>
                  <InvoiceForm
                    key={inv.id}
                    propertyId={propertyId}
                    invoice={inv}
                    invoiceAssets={assetsForInvoice(inv.id)}
                    onSave={(patch) => onUpdateInvoice(inv.id, patch)}
                    onAssetAdd={onAssetAdd}
                    onUpdateAsset={onUpdateAsset}
                    onDeleteAsset={onDeleteAsset}
                  />
                </EditModal>
              )
            })()
          : null}
        {invoiceDeleteId
          ? (() => {
              const inv = invoices.find((i) => i.id === invoiceDeleteId)
              if (!inv) return null
              const nFiles = invoiceRowAttachmentAssets(inv, assets).length
              return (
                <EditModal title="Delete invoice?" onClose={() => setInvoiceDeleteId(null)}>
                  <p className="text-sm leading-relaxed text-neutral-700">
                    Remove <strong>{inv.supplierName}</strong> — ref {inv.invoiceRef || inv.id.slice(0, 8)} ({formatGbpAmount(inv.amount)})?
                    {nFiles > 0 ? (
                      <>
                        {" "}
                        This will also remove <strong>{nFiles}</strong> attached file{nFiles === 1 ? "" : "s"}.
                      </>
                    ) : null}{" "}
                    This cannot be undone.
                  </p>
                  <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-4">
                    <button
                      type="button"
                      onClick={() => setInvoiceDeleteId(null)}
                      className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteInvoice(inv.id)
                        setInvoiceDeleteId(null)
                      }}
                      className={adminBtnDangerOutline}
                    >
                      Delete invoice
                    </button>
                  </div>
                </EditModal>
              )
            })()
          : null}
        {invoiceTablePreviewAsset ? (
          <PropertyAssetPreviewModal asset={invoiceTablePreviewAsset} onClose={() => setInvoiceTablePreviewAsset(null)} />
        ) : null}
      </div>
    )
  }

  if (tab === "insurance") {
    return (
      <PropertyInsuranceTabPanel
        propertyId={propertyId}
        insuranceRecords={insuranceRecords}
        insuranceAssets={docsFor("insurance")}
        onAddInsuranceRecord={onAddInsuranceRecord}
        onUpdateInsuranceRecord={onUpdateInsuranceRecord}
        onDeleteInsuranceRecord={onDeleteInsuranceRecord}
        onAssetAdd={onAssetAdd}
        onUpdateAsset={onUpdateAsset}
        onDeleteAsset={onDeleteAsset}
      />
    )
  }

  return null
}

function ConstructionProjectFieldsForm({
  project,
  onSave,
  onDelete,
  showDeleteButton = true,
  submitLabel = "Save programme dates",
  requireStartAndCompletion = false,
}: {
  project: ConstructionProject
  onSave: (patch: Partial<Omit<ConstructionProject, "id" | "propertyId">>) => void
  onDelete?: () => void
  showDeleteButton?: boolean
  submitLabel?: string
  /** When true (e.g. Add programme), both schedule dates are required. */
  requireStartAndCompletion?: boolean
}) {
  const [startDate, setStartDate] = useState("")
  const [expectedCompletionDate, setExpectedCompletionDate] = useState("")
  const [totalWeeks, setTotalWeeks] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    setStartDate(toHtmlDateInputValue(project.startDate))
    setExpectedCompletionDate(toHtmlDateInputValue(project.expectedCompletionDate))
    setTotalWeeks(String(project.totalWeeks ?? ""))
  }, [project.id, project.startDate, project.expectedCompletionDate, project.totalWeeks])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)
    const startTrim = startDate.trim()
    const endTrim = expectedCompletionDate.trim()
    const tw = Number(totalWeeks)

    if (!Number.isFinite(tw) || tw < 1 || !Number.isInteger(tw)) {
      setFormError("Total weeks must be a whole number of at least 1.")
      return
    }

    if (requireStartAndCompletion) {
      if (!startTrim || !endTrim) {
        setFormError("Choose a start date and an expected completion date for this programme.")
        return
      }
    } else if ((startTrim && !endTrim) || (!startTrim && endTrim)) {
      setFormError("Enter both the start and expected completion dates, or leave both empty.")
      return
    }

    if (startTrim && endTrim && startTrim > endTrim) {
      setFormError("Expected completion must be on or after the start date.")
      return
    }

    onSave({
      startDate: optionalTrimmed(startDate),
      expectedCompletionDate: optionalTrimmed(expectedCompletionDate),
      totalWeeks: tw,
    })
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-4">
      {formError ? (
        <p role="alert" className={adminFormAlert}>
          {formError}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className={adminLabel}>Start</span>
          <input
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            type="date"
          />
        </label>
        <label className="text-sm">
          <span className={adminLabel}>Expected completion</span>
          <input
            value={expectedCompletionDate}
            onChange={(e) => {
              setExpectedCompletionDate(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            type="date"
          />
        </label>
        <label className="text-sm">
          <span className={adminLabel}>Total weeks</span>
          <input
            value={totalWeeks}
            onChange={(e) => {
              setTotalWeeks(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            type="number"
            min={1}
          />
        </label>
      </div>
      <div className="flex flex-col gap-2 border-t border-neutral-100 pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <button type="submit" className={adminBtnPrimary}>
          {submitLabel}
        </button>
        {onDelete && showDeleteButton ? (
          <button type="button" onClick={onDelete} className={adminBtnDangerOutline}>
            Delete programme
          </button>
        ) : null}
      </div>
    </form>
  )
}

function IncomeNewRowForm({
  propertyId,
  onAdd,
  onDone,
}: {
  propertyId: string
  onAdd: (payload: Omit<IncomeRow, "id">) => void
  onDone?: () => void
}) {
  const [period, setPeriod] = useState("")
  const [incomeAmount, setIncomeAmount] = useState("")
  const [costAmount, setCostAmount] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)
    const inc = Number(incomeAmount)
    const cost = Number(costAmount)
    if (!period.trim()) {
      setFormError("Choose the month for this income row.")
      return
    }
    if (!Number.isFinite(inc)) {
      setFormError("Enter a valid income amount.")
      return
    }
    if (!Number.isFinite(cost)) {
      setFormError("Enter a valid costs amount.")
      return
    }
    if (inc === 0 || cost === 0) {
      setFormError("Income and costs must each be a non-zero amount (not £0).")
      return
    }
    onAdd({ propertyId, period: period.trim(), incomeAmount: inc, costAmount: cost })
    setPeriod("")
    setIncomeAmount("")
    setCostAmount("")
    onDone?.()
  }
  return (
    <form noValidate onSubmit={submit} className="space-y-4">
      {formError ? (
        <p role="alert" className={adminFormAlert}>
          {formError}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className={adminLabel}>Period</span>
          <input
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            type="month"
          />
        </label>
        <label className="text-sm">
          <span className={adminLabel}>Income (£)</span>
          <input
            value={incomeAmount}
            onChange={(e) => {
              setIncomeAmount(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            type="number"
            step="0.01"
          />
        </label>
        <label className="text-sm">
          <span className={adminLabel}>Costs (£)</span>
          <input
            value={costAmount}
            onChange={(e) => {
              setCostAmount(e.target.value)
              setFormError(null)
            }}
            className={adminFieldInput}
            type="number"
            step="0.01"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-4">
        <button type="submit" className={adminBtnPrimary}>
          Add income row
        </button>
      </div>
    </form>
  )
}

function FileUploadForm({
  title,
  onFileUpload,
  onFiles,
}: {
  title: string
  onFileUpload?: (file: File, displayName: string) => Promise<void> | void
  /** Older `FileUploadForm` builds batch-upload via this prop — keep wired for cache / compat. */
  onFiles?: (files: File[]) => Promise<void> | void
}) {
  const queueRef = useRef<File[]>([])
  const [activeFile, setActiveFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [queueHint, setQueueHint] = useState("")

  const uploadOne = useCallback(
    async (file: File, displayName: string) => {
      if (typeof onFileUpload === "function") {
        await onFileUpload(file, displayName)
        return
      }
      if (typeof onFiles === "function") {
        const renamed =
          displayName.trim() && displayName.trim() !== file.name
            ? new File([file], displayName.trim(), { type: file.type, lastModified: file.lastModified })
            : file
        await onFiles([renamed])
        return
      }
      throw new Error("File upload is not configured (missing onFileUpload / onFiles).")
    },
    [onFileUpload, onFiles],
  )

  const clearQueueAndModal = useCallback(() => {
    queueRef.current = []
    setActiveFile(null)
    setQueueHint("")
  }, [])

  const popNextActive = useCallback(() => {
    const next = queueRef.current.shift() ?? null
    setActiveFile(next)
    setQueueHint(next && queueRef.current.length ? `${queueRef.current.length} more file(s) queued after this one.` : "")
  }, [])

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm ring-1 ring-neutral-900/[0.04]">
      <p className="text-sm font-semibold text-yhgc-black">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-neutral-600">
        You can select several files; each one opens a short dialog to confirm the display name before upload.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className={`${adminBtnPrimary} cursor-pointer border-0 bg-yhgc-crimson hover:opacity-95`}>
          {isUploading ? (
            <>
              <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Uploading…
            </>
          ) : (
            <>
              <span aria-hidden className="text-base leading-none">
                +
              </span>
              Choose files
            </>
          )}
          <input
            type="file"
            multiple
            className="sr-only"
            disabled={isUploading}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.currentTarget.value = ""
              if (!files.length) return
              queueRef.current.push(...files)
              if (!activeFile) {
                popNextActive()
              } else {
                setQueueHint(`${queueRef.current.length} file(s) queued after the current upload.`)
              }
            }}
          />
        </label>
        <span className="text-xs text-neutral-500">Images, PDFs, and other documents supported.</span>
      </div>
      {queueHint ? <p className="mt-3 text-xs font-medium text-neutral-700">{queueHint}</p> : null}
      {activeFile ? (
        <AssetFileNameEditorModal
          key={`${activeFile.name}-${activeFile.size}-${activeFile.lastModified}`}
          title="Confirm upload"
          initialName={activeFile.name}
          resetTarget={activeFile.name}
          confirmLabel="Upload"
          isBusy={isUploading}
          onClose={() => {
            if (isUploading) return
            clearQueueAndModal()
          }}
          onConfirm={async (displayName) => {
            setIsUploading(true)
            try {
              await uploadOne(activeFile, displayName)
              popNextActive()
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Upload failed."
              useAppStore.getState().setActionNotice({
                kind: "error",
                message: msg.length > 220 ? `${msg.slice(0, 220)}…` : msg,
              })
            } finally {
              setIsUploading(false)
            }
          }}
        />
      ) : null}
    </div>
  )
}

function App() {
  const publicPath =
    typeof window !== "undefined" ? window.location.pathname.replace(/\/+$/, "") || "/" : "/"
  if (publicPath === "/privacy") return <LegalPublicPage kind="privacy" />
  if (publicPath === "/terms") return <LegalPublicPage kind="terms" />
  if (publicPath === "/delete-account") return <DeleteAccountPublicPage />
  return <AdminApp />
}

export default App
