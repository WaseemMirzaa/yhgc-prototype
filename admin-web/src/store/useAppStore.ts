import { create } from "zustand"
import { v4 as uuid } from "uuid"
import { handlePersistSuccessNotifyClients, resetPortfolioPersistBaseline } from "../services/clientPortfolioPush"
import { dataService } from "../services/dataService"
import type {
  AccountantLink,
  AppSnapshot,
  Asset,
  Client,
  Company,
  ConstructionProject,
  ConstructionStage,
  FinanceRecord,
  IncomeRow,
  InsuranceRecord,
  Invoice,
  NotificationLog,
  Property,
} from "../types/models"

export type ActionNotice = { kind: "success" | "error"; message: string } | null

function stampSnapshot(s: AppSnapshot): AppSnapshot {
  return { ...s, updatedAt: new Date().toISOString() }
}

/** Remove a property and all dependent rows (programmes, invoices, files, scoped links). */
function removePropertyCascade(snap: AppSnapshot, propertyId: string): AppSnapshot {
  const projectIds = snap.constructionProjects.filter((p) => p.propertyId === propertyId).map((p) => p.id)
  const stageIds = snap.constructionStages
    .filter((st) => projectIds.includes(st.projectId))
    .map((st) => st.id)
  const invoiceIds = snap.invoices.filter((inv) => inv.propertyId === propertyId).map((inv) => inv.id)
  const insuranceRecordIds = snap.insuranceRecords.filter((i) => i.propertyId === propertyId).map((i) => i.id)
  const financeRecordIds = snap.financeRecords.filter((f) => f.propertyId === propertyId).map((f) => f.id)
  const assets = snap.assets.filter((a) => {
    if (a.ownerType === "property" && a.ownerId === propertyId) return false
    if (a.ownerType === "invoice" && invoiceIds.includes(a.ownerId)) return false
    if (a.ownerType === "construction_stage" && stageIds.includes(a.ownerId)) return false
    if (a.ownerType === "insurance_record" && insuranceRecordIds.includes(a.ownerId)) return false
    if (a.ownerType === "finance_record" && financeRecordIds.includes(a.ownerId)) return false
    return true
  })
  return stampSnapshot({
    ...snap,
    properties: snap.properties.filter((p) => p.id !== propertyId),
    constructionProjects: snap.constructionProjects.filter((p) => p.propertyId !== propertyId),
    constructionStages: snap.constructionStages.filter((st) => !projectIds.includes(st.projectId)),
    financeRecords: snap.financeRecords.filter((f) => f.propertyId !== propertyId),
    incomeRows: snap.incomeRows.filter((r) => r.propertyId !== propertyId),
    insuranceRecords: snap.insuranceRecords.filter((i) => i.propertyId !== propertyId),
    invoices: snap.invoices.filter((inv) => inv.propertyId !== propertyId),
    assets,
    accountantLinks: snap.accountantLinks.filter((l) => !(l.scopeType === "property" && l.scopeId === propertyId)),
  })
}

function removeCompanyCascade(snap: AppSnapshot, companyId: string): AppSnapshot {
  const propertyIds = snap.properties.filter((p) => p.companyId === companyId).map((p) => p.id)
  let next = snap
  for (const pid of propertyIds) {
    next = removePropertyCascade(next, pid)
  }
  return stampSnapshot({
    ...next,
    companies: next.companies.filter((c) => c.id !== companyId),
    accountantLinks: next.accountantLinks.filter((l) => !(l.scopeType === "company" && l.scopeId === companyId)),
  })
}

function stageCountForProject(stages: ConstructionStage[], projectId: string): number {
  return stages.filter((s) => s.projectId === projectId).length
}

function removeClientCascade(snap: AppSnapshot, clientId: string): AppSnapshot {
  const companyIds = snap.companies.filter((c) => c.clientId === clientId).map((c) => c.id)
  const scopedPropertyIds = snap.properties
    .filter((p) => p.clientId === clientId || companyIds.includes(p.companyId))
    .map((p) => p.id)

  let next = snap
  for (const cid of companyIds) {
    next = removeCompanyCascade(next, cid)
  }
  for (const p of [...next.properties.filter((x) => x.clientId === clientId)]) {
    next = removePropertyCascade(next, p.id)
  }

  return stampSnapshot({
    ...next,
    clients: next.clients.filter((c) => c.id !== clientId),
    notifications: next.notifications.filter((n) => n.clientId !== clientId),
    assets: next.assets.filter((a) => !(a.ownerType === "client" && a.ownerId === clientId)),
    accountantLinks: next.accountantLinks.filter((l) => {
      if (l.scopeType === "company") return !companyIds.includes(l.scopeId)
      if (l.scopeType === "property") return !scopedPropertyIds.includes(l.scopeId)
      return true
    }),
  })
}

interface AppState {
  snapshot: AppSnapshot | null
  loading: boolean
  error?: string
  persisting: boolean
  actionNotice: ActionNotice
  init: () => Promise<void>
  persist: () => Promise<void>
  clearActionNotice: () => void
  setActionNotice: (notice: ActionNotice) => void
  addClient: (payload: Pick<Client, "fullName" | "email">) => void
  addCompany: (payload: Pick<Company, "clientId" | "companyNumber" | "name">) => void
  addProperty: (
    payload: Pick<Property, "clientId" | "companyId" | "title" | "address" | "propertyType" | "status">,
  ) => void
  updateClient: (id: string, patch: Partial<Omit<Client, "id" | "createdAt">>) => void
  updateCompany: (id: string, patch: Partial<Omit<Company, "id">>) => void
  updateProperty: (id: string, patch: Partial<Omit<Property, "id">>) => void
  addNotification: (payload: Pick<NotificationLog, "clientId" | "type" | "title" | "body">) => void
  createAccountantLink: (payload: Pick<AccountantLink, "scopeType" | "scopeId" | "expiresAt">) => void
  updateAccountantLink: (id: string, patch: Partial<Pick<AccountantLink, "isRevoked">>) => void
  addInvoice: (
    payload: Pick<Invoice, "propertyId" | "supplierName" | "invoiceRef" | "invoiceDate" | "amount"> & {
      status?: Invoice["status"]
    },
  ) => string | undefined
  addAsset: (
    payload: Pick<Asset, "ownerType" | "ownerId" | "tag" | "fileName" | "mimeType" | "sizeBytes" | "urlOrPath">,
  ) => void
  addConstructionStage: (payload: { projectId: string; weekNumber: number; uploadDate: string }) => string | undefined
  addConstructionProject: (
    propertyId: string,
    initial?: Partial<Pick<ConstructionProject, "totalWeeks" | "startDate" | "expectedCompletionDate">>,
  ) => string | undefined
  updateConstructionProject: (id: string, patch: Partial<Omit<ConstructionProject, "id" | "propertyId">>) => void
  addFinanceRecord: (payload: Omit<FinanceRecord, "id">) => string | undefined
  updateFinanceRecord: (id: string, patch: Partial<Omit<FinanceRecord, "id" | "propertyId">>) => void
  addIncomeRow: (payload: Omit<IncomeRow, "id">) => void
  updateIncomeRow: (id: string, patch: Partial<Omit<IncomeRow, "id" | "propertyId">>) => void
  addInsuranceRecord: (payload: Omit<InsuranceRecord, "id">) => string | undefined
  updateInsuranceRecord: (id: string, patch: Partial<Omit<InsuranceRecord, "id" | "propertyId">>) => void
  updateInvoice: (id: string, patch: Partial<Omit<Invoice, "id" | "propertyId">>) => void
  deleteInvoice: (id: string) => void
  deleteFinanceRecord: (id: string) => void
  deleteIncomeRow: (id: string) => void
  deleteInsuranceRecord: (id: string) => void
  updateAsset: (id: string, patch: Partial<Pick<Asset, "fileName">>) => void
  deleteAsset: (id: string) => void
  deleteClient: (id: string) => void
  deleteCompany: (id: string) => void
  deleteProperty: (id: string) => void
  deleteNotification: (id: string) => void
  deleteAccountantLink: (id: string) => void
  deleteConstructionProject: (projectId: string) => void
  deleteConstructionStage: (stageId: string) => void
  updateConstructionStage: (
    stageId: string,
    patch: Partial<Pick<ConstructionStage, "weekNumber" | "uploadDate">>,
  ) => void
}

const now = () => new Date().toISOString()

function friendlySaveError(err: unknown): string {
  if (err instanceof Error) {
    const m = err.message.trim()
    if (!m) return "Could not save changes. Please try again."
    return m.length > 180 ? `${m.slice(0, 180)}…` : m
  }
  return "Could not save changes. Please try again."
}

function humanizePersistError(err: unknown): string {
  const raw = friendlySaveError(err)
  const low = raw.toLowerCase()
  if (
    low.includes("unsupported field value") ||
    low.includes("invalid data") ||
    low.includes("undefined")
  ) {
    return "Cloud save could not finish (some fields were empty or unsupported). Your edits are still on this page—try Save again, or refresh once if it keeps happening."
  }
  if (low.includes("permission") || low.includes("insufficient")) {
    return "You do not have permission to save. Check you are signed in with an account that can edit data."
  }
  if (low.includes("network") || low.includes("offline") || low.includes("failed to fetch")) {
    return "Network problem while saving. Check your connection and try again."
  }
  return raw
}

function normalizeFinanceRecord<T extends Partial<FinanceRecord>>(record: T): T {
  const financeType = (record.financeType ?? "").trim().toLowerCase()
  if (financeType !== "cash_purchase") return record
  const next = { ...(record as Record<string, unknown>) }
  delete next.loanAmount
  delete next.monthlyPayment
  delete next.interestRatePct
  delete next.ltvPct
  delete next.termEndDate
  return next as T
}

function isCashPurchaseFinanceType(financeType: string | undefined): boolean {
  return (financeType ?? "").trim().toLowerCase() === "cash_purchase"
}

function isBlank(value: string | undefined): boolean {
  return !(value ?? "").trim().length
}

export const useAppStore = create<AppState>((set, get) => ({
  snapshot: null,
  loading: false,
  persisting: false,
  actionNotice: null,
  clearActionNotice: () => set({ actionNotice: null }),
  setActionNotice: (actionNotice) => set({ actionNotice }),
  init: async () => {
    set({ loading: true, error: undefined, actionNotice: null, persisting: false })
    try {
      const loaded = await dataService.loadSnapshot()
      let appliedLoaded = false
      set((state) => {
        const cur = state.snapshot
        if (cur?.updatedAt && loaded.updatedAt && cur.updatedAt > loaded.updatedAt) {
          return { loading: false, error: undefined }
        }
        appliedLoaded = true
        return { snapshot: loaded, loading: false, error: undefined }
      })
      if (appliedLoaded) resetPortfolioPersistBaseline(loaded)
    } catch (err) {
      const message =
        err instanceof Error && err.message.trim().length
          ? err.message.trim()
          : "We could not load your data. Check your connection and try again."
      set({
        loading: false,
        error: message,
        snapshot: null,
      })
    }
  },
  persist: async () => {
    const snapshot = get().snapshot
    if (!snapshot) {
      set({
        actionNotice: {
          kind: "error",
          message: "Nothing to save yet. If this keeps appearing, reload the page.",
        },
      })
      return
    }
    set({ persisting: true })
    try {
      await dataService.saveSnapshot({ ...snapshot, updatedAt: now() })
      const after = get().snapshot
      if (after) await handlePersistSuccessNotifyClients(after)
      set({
        persisting: false,
        actionNotice: { kind: "success", message: "All changes were saved." },
      })
    } catch (err) {
      set({
        persisting: false,
        actionNotice: { kind: "error", message: humanizePersistError(err) },
      })
    }
  },
  addClient: ({ fullName, email }) => {
    const current = get().snapshot
    if (!current) return
    if (isBlank(fullName) || isBlank(email)) {
      set({ actionNotice: { kind: "error", message: "Please enter the client's full name and email address." } })
      return
    }
    const next: Client = {
      id: uuid(),
      fullName,
      email,
      loginCode: `YHG-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 8999)}`,
      status: "active",
      createdAt: now(),
    }
    set({
      snapshot: { ...current, clients: [next, ...current.clients], updatedAt: now() },
      actionNotice: { kind: "success", message: "Client added." },
    })
  },
  addCompany: ({ clientId, companyNumber, name }) => {
    const current = get().snapshot
    if (!current) return
    if (isBlank(clientId) || isBlank(companyNumber) || isBlank(name)) {
      set({ actionNotice: { kind: "error", message: "Choose a client, then enter the company name and Companies House number." } })
      return
    }
    const next: Company = {
      id: uuid(),
      clientId,
      companyNumber,
      name,
      lastUpdatedAt: now(),
    }
    set({
      snapshot: { ...current, companies: [next, ...current.companies], updatedAt: now() },
      actionNotice: { kind: "success", message: "Company added." },
    })
  },
  addProperty: ({ clientId, companyId, title, address, propertyType, status }) => {
    const current = get().snapshot
    if (!current) return
    if (isBlank(clientId) || isBlank(companyId) || isBlank(title) || isBlank(address)) {
      set({ actionNotice: { kind: "error", message: "Choose a client and company, then enter the property title and address." } })
      return
    }
    const next: Property = {
      id: uuid(),
      clientId,
      companyId,
      title,
      address,
      propertyType,
      status,
    }
    set({
      snapshot: { ...current, properties: [next, ...current.properties], updatedAt: now() },
      actionNotice: { kind: "success", message: "Property added." },
    })
  },
  updateClient: (id, patch) => {
    const current = get().snapshot
    if (!current) return
    const clients = current.clients.map((item) => (item.id === id ? { ...item, ...patch } : item))
    set({
      snapshot: { ...current, clients, updatedAt: now() },
      actionNotice: { kind: "success", message: "Client updated." },
    })
  },
  updateCompany: (id, patch) => {
    const current = get().snapshot
    if (!current) return
    const companies = current.companies.map((item) =>
      item.id === id ? { ...item, ...patch, lastUpdatedAt: now() } : item,
    )
    set({
      snapshot: { ...current, companies, updatedAt: now() },
      actionNotice: { kind: "success", message: "Company updated." },
    })
  },
  updateProperty: (id, patch) => {
    const current = get().snapshot
    if (!current) return
    const properties = current.properties.map((item) => (item.id === id ? { ...item, ...patch } : item))
    set({
      snapshot: { ...current, properties, updatedAt: now() },
      actionNotice: { kind: "success", message: "Property updated." },
    })
  },
  addNotification: ({ clientId, type, title, body }) => {
    const current = get().snapshot
    if (!current) return
    const next: NotificationLog = { id: uuid(), clientId, type, title, body, createdAt: now() }
    set({
      snapshot: { ...current, notifications: [next, ...current.notifications], updatedAt: now() },
      actionNotice: { kind: "success", message: "Notification added." },
    })
  },
  createAccountantLink: ({ scopeType, scopeId, expiresAt }) => {
    const current = get().snapshot
    if (!current) return
    const next: AccountantLink = {
      id: uuid(),
      scopeType,
      scopeId,
      expiresAt,
      token: crypto.randomUUID().replaceAll("-", ""),
      isRevoked: false,
    }
    set({
      snapshot: { ...current, accountantLinks: [next, ...current.accountantLinks], updatedAt: now() },
      actionNotice: { kind: "success", message: "Accountant link created." },
    })
  },
  updateAccountantLink: (id, patch) => {
    const current = get().snapshot
    if (!current) return
    const accountantLinks = current.accountantLinks.map((item) => (item.id === id ? { ...item, ...patch } : item))
    set({
      snapshot: { ...current, accountantLinks, updatedAt: now() },
      actionNotice: { kind: "success", message: "Accountant link updated." },
    })
  },
  addInvoice: ({ propertyId, supplierName, invoiceRef, invoiceDate, amount, status }) => {
    const current = get().snapshot
    if (!current) return undefined
    if (isBlank(propertyId) || isBlank(supplierName) || isBlank(invoiceDate) || !Number.isFinite(amount) || amount <= 0) {
      set({
        actionNotice: {
          kind: "error",
          message: isBlank(propertyId)
            ? "Open a property first, then add the invoice from that property."
            : "Please enter the supplier name, invoice date, and an amount greater than zero.",
        },
      })
      return undefined
    }
    const nextStatus: Invoice["status"] =
      status === "paid" || status === "unpaid" || status === "queried" ? status : "unpaid"
    const id = uuid()
    const next: Invoice = {
      id,
      propertyId,
      supplierName,
      invoiceRef,
      invoiceDate,
      amount,
      status: nextStatus,
    }
    set({
      snapshot: { ...current, invoices: [next, ...current.invoices], updatedAt: now() },
      actionNotice: { kind: "success", message: "Invoice added." },
    })
    return id
  },
  addAsset: ({ ownerType, ownerId, tag, fileName, mimeType, sizeBytes, urlOrPath }) => {
    const current = get().snapshot
    if (!current) return
    const next: Asset = {
      id: uuid(),
      ownerType,
      ownerId,
      tag,
      fileName,
      mimeType,
      sizeBytes,
      urlOrPath,
      createdAt: now(),
    }
    set({
      snapshot: { ...current, assets: [next, ...current.assets], updatedAt: now() },
      actionNotice: { kind: "success", message: "File entry added." },
    })
  },
  addConstructionStage: ({ projectId, weekNumber, uploadDate }) => {
    const current = get().snapshot
    if (!current) return undefined
    const project = current.constructionProjects.find((p) => p.id === projectId)
    if (!project) {
      set({
        actionNotice: { kind: "error", message: "This build programme no longer exists, so the week could not be logged." },
      })
      return undefined
    }
    const trimmedDate = String(uploadDate ?? "").trim()
    if (!trimmedDate) {
      set({ actionNotice: { kind: "error", message: "Please pick an upload date for this week." } })
      return undefined
    }
    if (!Number.isFinite(weekNumber) || weekNumber < 1) {
      set({ actionNotice: { kind: "error", message: "Week number must be 1 or higher." } })
      return undefined
    }
    const id = uuid()
    const stage: ConstructionStage = {
      id,
      projectId,
      weekNumber,
      uploadDate: trimmedDate,
      photoUrls: [],
    }
    const constructionStages = [stage, ...current.constructionStages]
    const constructionProjects = current.constructionProjects.map((item) =>
      item.id === projectId ? { ...item, completedStages: stageCountForProject(constructionStages, projectId) } : item,
    )
    set({
      snapshot: {
        ...current,
        constructionStages,
        constructionProjects,
        updatedAt: now(),
      },
    })
    return id
  },
  addConstructionProject: (propertyId, initial) => {
    const current = get().snapshot
    if (!current) return undefined
    if (isBlank(propertyId)) {
      set({
        actionNotice: { kind: "error", message: "Open a property first, then add a build programme from there." },
      })
      return undefined
    }
    const id = uuid()
    const tw = initial?.totalWeeks
    const totalWeeks =
      typeof tw === "number" && Number.isFinite(tw) && tw >= 1 ? tw : 8
    const next: ConstructionProject = {
      id,
      propertyId,
      totalWeeks,
      completedStages: 0,
    }
    if (initial?.startDate) next.startDate = initial.startDate
    if (initial?.expectedCompletionDate) next.expectedCompletionDate = initial.expectedCompletionDate
    set({
      snapshot: {
        ...current,
        constructionProjects: [next, ...current.constructionProjects],
        updatedAt: now(),
      },
    })
    return id
  },
  updateConstructionProject: (id, patch) => {
    const current = get().snapshot
    if (!current) return
    const constructionProjects = current.constructionProjects.map((item) =>
      item.id === id ? { ...item, ...patch } : item,
    )
    set({ snapshot: { ...current, constructionProjects, updatedAt: now() } })
  },
  addFinanceRecord: (payload) => {
    const current = get().snapshot
    if (!current) return undefined
    if (isBlank(payload.propertyId)) {
      set({
        actionNotice: { kind: "error", message: "Open a property first, then add the loan from that property." },
      })
      return undefined
    }
    const normalized = normalizeFinanceRecord({ ...payload })
    if (!isCashPurchaseFinanceType(normalized.financeType) && isBlank(normalized.lenderName)) {
      return undefined
    }
    const id = uuid()
    const next: FinanceRecord = { id, ...normalized }
    set({
      snapshot: { ...current, financeRecords: [next, ...current.financeRecords], updatedAt: now() },
      actionNotice: { kind: "success", message: "Loan added." },
    })
    return id
  },
  updateFinanceRecord: (id, patch) => {
    const current = get().snapshot
    if (!current) return
    const financeRecords = current.financeRecords.map((item) =>
      item.id === id ? normalizeFinanceRecord({ ...item, ...patch }) : item,
    )
    set({ snapshot: { ...current, financeRecords, updatedAt: now() } })
  },
  addIncomeRow: (payload) => {
    const current = get().snapshot
    if (!current) return
    if (isBlank(payload.propertyId)) {
      set({
        actionNotice: { kind: "error", message: "Open a property first, then add the income row from that property." },
      })
      return
    }
    if (isBlank(payload.period) || !Number.isFinite(payload.incomeAmount) || !Number.isFinite(payload.costAmount)) {
      set({
        actionNotice: {
          kind: "error",
          message: "Please choose a month and enter valid income and cost amounts.",
        },
      })
      return
    }
    if (payload.incomeAmount === 0 || payload.costAmount === 0) {
      set({
        actionNotice: {
          kind: "error",
          message: "Income and costs must each be a non-zero amount (not £0).",
        },
      })
      return
    }
    const next: IncomeRow = { id: uuid(), ...payload }
    set({
      snapshot: { ...current, incomeRows: [next, ...current.incomeRows], updatedAt: now() },
      actionNotice: { kind: "success", message: "Income row added." },
    })
  },
  updateIncomeRow: (id, patch) => {
    const current = get().snapshot
    if (!current) return
    const item = current.incomeRows.find((r) => r.id === id)
    if (!item) return
    const nextIncome = patch.incomeAmount !== undefined ? patch.incomeAmount : item.incomeAmount
    const nextCost = patch.costAmount !== undefined ? patch.costAmount : item.costAmount
    const nextPeriod = patch.period !== undefined ? patch.period : item.period
    if (isBlank(nextPeriod) || !Number.isFinite(nextIncome) || !Number.isFinite(nextCost)) {
      set({
        actionNotice: {
          kind: "error",
          message: "Please choose a month and enter valid income and cost amounts.",
        },
      })
      return
    }
    if (nextIncome === 0 || nextCost === 0) {
      set({
        actionNotice: {
          kind: "error",
          message: "Income and costs must each be a non-zero amount (not £0).",
        },
      })
      return
    }
    const incomeRows = current.incomeRows.map((row) => (row.id === id ? { ...row, ...patch } : row))
    set({ snapshot: { ...current, incomeRows, updatedAt: now() } })
  },
  addInsuranceRecord: (payload) => {
    const current = get().snapshot
    if (!current) return undefined
    if (isBlank(payload.propertyId)) {
      set({
        actionNotice: { kind: "error", message: "Open a property first, then add insurance from that property." },
      })
      return undefined
    }
    if (isBlank(payload.insurerName) && isBlank(payload.policyNumber)) {
      return undefined
    }
    const id = uuid()
    const next: InsuranceRecord = { id, ...payload }
    set({
      snapshot: { ...current, insuranceRecords: [next, ...current.insuranceRecords], updatedAt: now() },
      actionNotice: { kind: "success", message: "Insurance policy added." },
    })
    return id
  },
  updateInsuranceRecord: (id, patch) => {
    const current = get().snapshot
    if (!current) return
    const insuranceRecords = current.insuranceRecords.map((item) => (item.id === id ? { ...item, ...patch } : item))
    set({ snapshot: { ...current, insuranceRecords, updatedAt: now() } })
  },
  updateInvoice: (id, patch) => {
    const current = get().snapshot
    if (!current) return
    const invoices = current.invoices.map((item) => (item.id === id ? { ...item, ...patch } : item))
    set({
      snapshot: { ...current, invoices, updatedAt: now() },
      actionNotice: { kind: "success", message: "Invoice updated." },
    })
  },
  deleteInvoice: (id) => {
    const current = get().snapshot
    if (!current) return
    const invoices = current.invoices.filter((item) => item.id !== id)
    const assets = current.assets.filter(
      (a) => !(a.ownerType === "invoice" && a.ownerId === id),
    )
    set({
      snapshot: { ...current, invoices, assets, updatedAt: now() },
      actionNotice: { kind: "success", message: "Invoice removed." },
    })
  },
  deleteFinanceRecord: (id) => {
    const current = get().snapshot
    if (!current) return
    const financeRecords = current.financeRecords.filter((item) => item.id !== id)
    const assets = current.assets.filter((a) => !(a.ownerType === "finance_record" && a.ownerId === id))
    set({
      snapshot: { ...current, financeRecords, assets, updatedAt: now() },
      actionNotice: { kind: "success", message: "Finance record removed." },
    })
  },
  deleteIncomeRow: (id) => {
    const current = get().snapshot
    if (!current) return
    const incomeRows = current.incomeRows.filter((item) => item.id !== id)
    set({
      snapshot: { ...current, incomeRows, updatedAt: now() },
      actionNotice: { kind: "success", message: "Income row removed." },
    })
  },
  deleteInsuranceRecord: (id) => {
    const current = get().snapshot
    if (!current) return
    const insuranceRecords = current.insuranceRecords.filter((item) => item.id !== id)
    const assets = current.assets.filter((a) => !(a.ownerType === "insurance_record" && a.ownerId === id))
    set({
      snapshot: { ...current, insuranceRecords, assets, updatedAt: now() },
      actionNotice: { kind: "success", message: "Insurance policy removed." },
    })
  },
  updateAsset: (id, patch) => {
    const current = get().snapshot
    if (!current) return
    const assets = current.assets.map((item) => (item.id === id ? { ...item, ...patch } : item))
    set({
      snapshot: { ...current, assets, updatedAt: now() },
      actionNotice: { kind: "success", message: "File details updated." },
    })
  },
  deleteAsset: (id) => {
    const current = get().snapshot
    if (!current) return
    const assets = current.assets.filter((item) => item.id !== id)
    set({
      snapshot: { ...current, assets, updatedAt: now() },
      actionNotice: { kind: "success", message: "File removed." },
    })
  },
  deleteClient: (id) => {
    const current = get().snapshot
    if (!current) return
    set({
      snapshot: removeClientCascade(current, id),
      actionNotice: { kind: "success", message: "Client and related records removed." },
    })
  },
  deleteCompany: (id) => {
    const current = get().snapshot
    if (!current) return
    set({
      snapshot: removeCompanyCascade(current, id),
      actionNotice: { kind: "success", message: "Company and related records removed." },
    })
  },
  deleteProperty: (id) => {
    const current = get().snapshot
    if (!current) return
    set({
      snapshot: removePropertyCascade(current, id),
      actionNotice: { kind: "success", message: "Property and related records removed." },
    })
  },
  deleteNotification: (id) => {
    const current = get().snapshot
    if (!current) return
    set({
      snapshot: {
        ...current,
        notifications: current.notifications.filter((n) => n.id !== id),
        updatedAt: now(),
      },
      actionNotice: { kind: "success", message: "Notification removed." },
    })
  },
  deleteAccountantLink: (id) => {
    const current = get().snapshot
    if (!current) return
    set({
      snapshot: {
        ...current,
        accountantLinks: current.accountantLinks.filter((l) => l.id !== id),
        updatedAt: now(),
      },
      actionNotice: { kind: "success", message: "Accountant link removed." },
    })
  },
  deleteConstructionProject: (projectId) => {
    const current = get().snapshot
    if (!current) return
    const stageIds = current.constructionStages.filter((s) => s.projectId === projectId).map((s) => s.id)
    set({
      snapshot: {
        ...current,
        constructionProjects: current.constructionProjects.filter((p) => p.id !== projectId),
        constructionStages: current.constructionStages.filter((s) => s.projectId !== projectId),
        assets: current.assets.filter(
          (a) => !(a.ownerType === "construction_stage" && stageIds.includes(a.ownerId)),
        ),
        updatedAt: now(),
      },
      actionNotice: { kind: "success", message: "Construction programme removed." },
    })
  },
  deleteConstructionStage: (stageId) => {
    const current = get().snapshot
    if (!current) return
    const stage = current.constructionStages.find((s) => s.id === stageId)
    if (!stage) return
    const constructionStages = current.constructionStages.filter((s) => s.id !== stageId)
    const pid = stage.projectId
    const constructionProjects = current.constructionProjects.map((p) =>
      p.id === pid ? { ...p, completedStages: stageCountForProject(constructionStages, pid) } : p,
    )
    set({
      snapshot: {
        ...current,
        constructionStages,
        constructionProjects,
        assets: current.assets.filter((a) => !(a.ownerType === "construction_stage" && a.ownerId === stageId)),
        updatedAt: now(),
      },
      actionNotice: { kind: "success", message: "Construction stage removed." },
    })
  },
  updateConstructionStage: (stageId, patch) => {
    const current = get().snapshot
    if (!current) return
    const stage = current.constructionStages.find((s) => s.id === stageId)
    if (!stage) {
      set({
        actionNotice: { kind: "error", message: "That week entry could not be found. Refresh the page and try again." },
      })
      return
    }
    const nextWeek =
      patch.weekNumber !== undefined ? patch.weekNumber : stage.weekNumber
    const nextDateRaw = patch.uploadDate !== undefined ? patch.uploadDate : stage.uploadDate
    const trimmedDate = String(nextDateRaw ?? "").trim()
    if (!trimmedDate) {
      set({ actionNotice: { kind: "error", message: "Please choose an upload date." } })
      return
    }
    if (!Number.isFinite(nextWeek) || nextWeek < 1) {
      set({ actionNotice: { kind: "error", message: "Week number must be 1 or higher." } })
      return
    }
    const constructionStages = current.constructionStages.map((s) =>
      s.id === stageId ? { ...s, weekNumber: nextWeek, uploadDate: trimmedDate } : s,
    )
    set({
      snapshot: { ...current, constructionStages, updatedAt: now() },
      actionNotice: { kind: "success", message: "Construction week updated." },
    })
  },
}))
