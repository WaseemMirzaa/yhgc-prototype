import { initializeApp, getApps } from "firebase/app"
import { collection, doc, getDoc, getDocs, getFirestore, setDoc, writeBatch } from "firebase/firestore"
import { appSettings, activeBackendMode } from "../config/settings"
import { seedSnapshot } from "../data/seed"
import type { AppSnapshot } from "../types/models"

export interface DataService {
  loadSnapshot(): Promise<AppSnapshot>
  saveSnapshot(snapshot: AppSnapshot): Promise<void>
}

/** Firestore rejects `undefined` anywhere in document data; strip recursively before writes. */
export function stripUndefinedForFirestore<T>(value: T): T {
  if (value === null || value === undefined) return value
  if (typeof value !== "object") return value
  if (value instanceof Date) return value
  if (Array.isArray(value)) {
    const next = value
      .map((item) => stripUndefinedForFirestore(item))
      .filter((item) => item !== undefined)
    return next as T
  }
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue
    out[k] = stripUndefinedForFirestore(v)
  }
  return out as T
}

/** Firestore may return Timestamp objects; normalize to JSON-safe ISO strings for the admin UI and exports. */
function stripFirestoreTimestamps<T>(input: T): T {
  if (input === null || input === undefined) return input
  if (typeof input !== "object") return input
  const maybeTs = input as { toDate?: () => Date }
  if (typeof maybeTs.toDate === "function") {
    return maybeTs.toDate().toISOString() as T
  }
  if (Array.isArray(input)) {
    return input.map((item) => stripFirestoreTimestamps(item)) as T
  }
  const obj = input as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k] = stripFirestoreTimestamps(v)
  }
  return out as T
}

function normalizeSnapshot(input: Partial<AppSnapshot> | null | undefined): AppSnapshot {
  if (!input) return seedSnapshot
  return {
    clients: input.clients ?? [],
    companies: input.companies ?? [],
    properties: input.properties ?? [],
    constructionProjects: input.constructionProjects ?? [],
    constructionStages: input.constructionStages ?? [],
    financeRecords: input.financeRecords ?? [],
    incomeRows: input.incomeRows ?? [],
    rentReceipts: input.rentReceipts ?? [],
    expenses: input.expenses ?? [],
    invoices: input.invoices ?? [],
    insuranceRecords: input.insuranceRecords ?? [],
    assets: input.assets ?? [],
    notifications: input.notifications ?? [],
    accountantLinks: input.accountantLinks ?? [],
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race<T | null>([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

class MockDataService implements DataService {
  /** Bump when default seed shape changes so browsers pick up new demo data without manual clear. */
  private key = "yhgc-admin-snapshot-v2"

  async loadSnapshot(): Promise<AppSnapshot> {
    const raw = localStorage.getItem(this.key)
    if (!raw) return seedSnapshot
    return normalizeSnapshot(JSON.parse(raw) as Partial<AppSnapshot>)
  }

  async saveSnapshot(snapshot: AppSnapshot): Promise<void> {
    const clean = stripUndefinedForFirestore(snapshot)
    localStorage.setItem(this.key, JSON.stringify(clean))
  }
}

class FirebaseDataService implements DataService {
  private db = this.initDb()
  private snapshotPath = doc(this.db, "appSnapshots", "adminPrototype")
  private readonly collectionKeys: Array<keyof Omit<AppSnapshot, "updatedAt">> = [
    "clients",
    "companies",
    "properties",
    "constructionProjects",
    "constructionStages",
    "financeRecords",
    "incomeRows",
    "rentReceipts",
    "expenses",
    "invoices",
    "insuranceRecords",
    "assets",
    "notifications",
    "accountantLinks",
  ]

  private initDb() {
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

  async loadSnapshot(): Promise<AppSnapshot> {
    const partialFromCollections = await withTimeout(this.loadFromCollections().catch(() => null), 7000)
    if (partialFromCollections) {
      // Rows come from subcollections; the legacy single doc carries the real last-saved `updatedAt`.
      // Using "now" here made every background reload look newer than local edits and wiped unpersisted rows.
      const legacySnap = await getDoc(this.snapshotPath)
      let serverUpdatedAt = "1970-01-01T00:00:00.000Z"
      if (legacySnap.exists()) {
        const legacy = stripFirestoreTimestamps(legacySnap.data() as Partial<AppSnapshot>)
        if (typeof legacy.updatedAt === "string" && legacy.updatedAt.trim()) serverUpdatedAt = legacy.updatedAt.trim()
      }
      return normalizeSnapshot({ ...partialFromCollections, updatedAt: serverUpdatedAt })
    }

    // Backward compatibility: migrate the legacy single-doc snapshot once, keep it as backup.
    const legacySnap = await getDoc(this.snapshotPath)
    if (!legacySnap.exists()) {
      const seedClean = stripUndefinedForFirestore(seedSnapshot)
      await setDoc(this.snapshotPath, seedClean)
      void this.saveToCollections(seedClean).catch(() => {})
      return normalizeSnapshot(seedSnapshot)
    }
    const migrated = normalizeSnapshot(stripFirestoreTimestamps(legacySnap.data() as Partial<AppSnapshot>))
    void this.saveToCollections(migrated).catch(() => {})
    return migrated
  }

  async saveSnapshot(snapshot: AppSnapshot): Promise<void> {
    const clean = stripUndefinedForFirestore(snapshot)
    // Keep legacy doc as backup in option A.
    await setDoc(this.snapshotPath, clean, { merge: false })
    await this.saveToCollections(clean)
  }

  private async loadFromCollections(): Promise<Partial<AppSnapshot> | null> {
    const listMap = await Promise.all(
      this.collectionKeys.map(async (key) => {
        const col = collection(this.db, key)
        const snaps = await getDocs(col)
        const rows = snaps.docs.map((d) => stripFirestoreTimestamps({ id: d.id, ...(d.data() as object) }))
        return [key, rows] as const
      }),
    )
    const asObject = Object.fromEntries(listMap) as Partial<AppSnapshot>
    const hasAnyData = this.collectionKeys.some((key) => ((asObject[key] as unknown[]) ?? []).length > 0)
    if (!hasAnyData) return null
    return asObject
  }

  private async saveToCollections(snapshot: AppSnapshot): Promise<void> {
    const batch = writeBatch(this.db)
    for (const key of this.collectionKeys) {
      const colRef = collection(this.db, key)
      const existing = await getDocs(colRef)
      const nextRows = snapshot[key] as unknown as Array<{ id: string } & Record<string, unknown>>
      const nextIds = new Set(nextRows.map((row) => String(row.id)))

      // Remove records deleted in UI.
      for (const docSnap of existing.docs) {
        if (!nextIds.has(docSnap.id)) {
          batch.delete(docSnap.ref)
        }
      }

      // Upsert current records by id.
      for (const row of nextRows) {
        const id = String(row.id)
        const { id: _ignore, ...payload } = row
        batch.set(doc(this.db, key, id), stripUndefinedForFirestore(payload), { merge: false })
      }
    }
    await batch.commit()
  }
}

export const dataService: DataService =
  activeBackendMode === "mock" ? new MockDataService() : new FirebaseDataService()
