import { getApps, initializeApp } from "firebase/app"
import { addDoc, collection, getFirestore, serverTimestamp } from "firebase/firestore"
import { activeBackendMode, appSettings } from "../config/settings"
import type {
  AppSnapshot,
  Client,
  Company,
  ConstructionProject,
  ConstructionStage,
  FinanceRecord,
  IncomeRow,
  InsuranceRecord,
  Invoice,
  Property,
} from "../types/models"

function initFirestoreDb() {
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
  return getFirestore(app)
}

/** Deep-normalize for stable row comparison (sorted keys / arrays). */
function normalizeDeep(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value !== "object") return value
  if (Array.isArray(value)) {
    const mapped = value.map(normalizeDeep)
    const allScalar = mapped.every((x) => x === null || typeof x !== "object")
    if (allScalar) return [...mapped].sort((a, b) => String(a).localeCompare(String(b)))
    return mapped
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).filter((k) => k !== "id").sort()
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    out[k] = normalizeDeep(obj[k])
  }
  return out
}

function rowSig(row: unknown): string {
  return JSON.stringify(normalizeDeep(row))
}

function propertyClientMap(snap: AppSnapshot): Map<string, string> {
  const m = new Map<string, string>()
  for (const p of snap.properties) {
    m.set(p.id, p.clientId)
  }
  return m
}

function projectPropertyMap(snap: AppSnapshot): Map<string, string> {
  const m = new Map<string, string>()
  for (const p of snap.constructionProjects) {
    m.set(p.id, p.propertyId)
  }
  return m
}

function addClientForPropertyId(
  propertyId: string | undefined,
  propToClient: Map<string, string>,
  out: Set<string>,
) {
  if (!propertyId) return
  const cid = propToClient.get(propertyId)
  if (cid) out.add(cid)
}

function diffIds<T extends { id: string }>(prev: T[], next: T[]): Set<string> {
  const ids = new Set<string>()
  for (const r of prev) ids.add(r.id)
  for (const r of next) ids.add(r.id)
  return ids
}

function rowById<T extends { id: string }>(rows: T[], id: string): T | undefined {
  return rows.find((r) => r.id === id)
}

/** Clients affected by any portfolio entity change between two snapshots. */
export function collectClientsTouchedByPortfolioDiff(prev: AppSnapshot, next: AppSnapshot): Set<string> {
  const clients = new Set<string>()
  const propToClient = propertyClientMap(next)
  const projToPropPrev = projectPropertyMap(prev)
  const projToPropNext = projectPropertyMap(next)

  const touchClient = (id: string) => {
    const a = rowById<Client>(prev.clients, id)
    const b = rowById<Client>(next.clients, id)
    const pick = b ?? a
    if (pick && rowSig(a) !== rowSig(b)) clients.add(pick.id)
  }
  for (const id of diffIds(prev.clients, next.clients)) touchClient(id)

  const touchCompany = (id: string) => {
    const a = rowById<Company>(prev.companies, id)
    const b = rowById<Company>(next.companies, id)
    const pick = b ?? a
    if (pick && rowSig(a) !== rowSig(b)) clients.add(pick.clientId)
  }
  for (const id of diffIds(prev.companies, next.companies)) touchCompany(id)

  const touchProperty = (id: string) => {
    const a = rowById<Property>(prev.properties, id)
    const b = rowById<Property>(next.properties, id)
    const pick = b ?? a
    if (pick && rowSig(a) !== rowSig(b)) clients.add(pick.clientId)
  }
  for (const id of diffIds(prev.properties, next.properties)) touchProperty(id)

  const touchInvoices = (id: string) => {
    const a = rowById<Invoice>(prev.invoices, id)
    const b = rowById<Invoice>(next.invoices, id)
    const pick = b ?? a
    if (!pick) return
    if (rowSig(a) !== rowSig(b)) addClientForPropertyId(pick.propertyId, propToClient, clients)
  }
  for (const id of diffIds(prev.invoices, next.invoices)) touchInvoices(id)

  const touchFinance = (id: string) => {
    const a = rowById<FinanceRecord>(prev.financeRecords, id)
    const b = rowById<FinanceRecord>(next.financeRecords, id)
    const pick = b ?? a
    if (!pick) return
    if (rowSig(a) !== rowSig(b)) addClientForPropertyId(pick.propertyId, propToClient, clients)
  }
  for (const id of diffIds(prev.financeRecords, next.financeRecords)) touchFinance(id)

  const touchIncome = (id: string) => {
    const a = rowById<IncomeRow>(prev.incomeRows, id)
    const b = rowById<IncomeRow>(next.incomeRows, id)
    const pick = b ?? a
    if (!pick) return
    if (rowSig(a) !== rowSig(b)) addClientForPropertyId(pick.propertyId, propToClient, clients)
  }
  for (const id of diffIds(prev.incomeRows, next.incomeRows)) touchIncome(id)

  const touchInsurance = (id: string) => {
    const a = rowById<InsuranceRecord>(prev.insuranceRecords, id)
    const b = rowById<InsuranceRecord>(next.insuranceRecords, id)
    const pick = b ?? a
    if (!pick) return
    if (rowSig(a) !== rowSig(b)) addClientForPropertyId(pick.propertyId, propToClient, clients)
  }
  for (const id of diffIds(prev.insuranceRecords, next.insuranceRecords)) touchInsurance(id)

  const touchProject = (id: string) => {
    const a = rowById<ConstructionProject>(prev.constructionProjects, id)
    const b = rowById<ConstructionProject>(next.constructionProjects, id)
    const pick = b ?? a
    if (!pick) return
    if (rowSig(a) !== rowSig(b)) addClientForPropertyId(pick.propertyId, propToClient, clients)
  }
  for (const id of diffIds(prev.constructionProjects, next.constructionProjects)) touchProject(id)

  const touchStage = (id: string) => {
    const a = rowById<ConstructionStage>(prev.constructionStages, id)
    const b = rowById<ConstructionStage>(next.constructionStages, id)
    const pick = b ?? a
    if (!pick) return
    if (rowSig(a) !== rowSig(b)) {
      const pid = (b ?? a)!.projectId
      const propId = projToPropNext.get(pid) ?? projToPropPrev.get(pid)
      addClientForPropertyId(propId, propToClient, clients)
    }
  }
  for (const id of diffIds(prev.constructionStages, next.constructionStages)) touchStage(id)

  return clients
}

export async function enqueuePortfolioUpdateOutbox(clientIds: string[]): Promise<void> {
  if (activeBackendMode !== "firebase" || !appSettings.firebase.apiKey || !appSettings.firebase.projectId) return
  const unique = [...new Set(clientIds)].filter(Boolean)
  if (unique.length === 0) return
  const db = initFirestoreDb()
  await addDoc(collection(db, "fcmOutbox"), {
    userIds: unique,
    title: "Portfolio updated",
    body: "Your adviser has updated your property records. Open the app to review.",
    data: { source: "admin_portfolio_save" },
    createdAt: serverTimestamp(),
  })
}
