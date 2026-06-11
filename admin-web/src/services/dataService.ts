import { initializeApp, getApps } from "firebase/app"
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  setDoc,
  writeBatch,
} from "firebase/firestore"
import { appSettings, activeBackendMode } from "../config/settings"
import { seedSnapshot } from "../data/seed"
import type { AppSnapshot } from "../types/models"

export type CollectionKey = keyof Omit<AppSnapshot, "updatedAt">

export const COLLECTION_KEYS: CollectionKey[] = [
  "clients",
  "companies",
  "properties",
  "constructionProjects",
  "constructionStages",
  "financeRecords",
  "incomeRows",
  "invoices",
  "insuranceRecords",
  "assets",
  "notifications",
  "accountantLinks",
]

export type EntityRow = { id: string } & Record<string, unknown>

export interface DataService {
  /**
   * Live subscription. Calls `onChange` with the latest full snapshot whenever any record changes
   * (Firestore realtime listeners; localStorage mirror in mock mode). Returns an unsubscribe.
   */
  subscribe(onChange: (snapshot: AppSnapshot) => void, onError?: (err: unknown) => void): () => void
  /** Write a single record (create or replace), nothing else. */
  upsert(collectionKey: CollectionKey, entity: EntityRow): Promise<void>
  /** Delete a single record by id. */
  remove(collectionKey: CollectionKey, id: string): Promise<void>
  /** One-shot read (used for seeding / fallbacks). */
  loadSnapshot(): Promise<AppSnapshot>
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

function emptyCache(): Record<CollectionKey, EntityRow[]> {
  return {
    clients: [],
    companies: [],
    properties: [],
    constructionProjects: [],
    constructionStages: [],
    financeRecords: [],
    incomeRows: [],
    invoices: [],
    insuranceRecords: [],
    assets: [],
    notifications: [],
    accountantLinks: [],
  }
}

function snapshotFromCache(cache: Record<CollectionKey, EntityRow[]>): AppSnapshot {
  return normalizeSnapshot({
    ...(cache as unknown as Partial<AppSnapshot>),
    updatedAt: new Date().toISOString(),
  })
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
    invoices: input.invoices ?? [],
    insuranceRecords: input.insuranceRecords ?? [],
    assets: input.assets ?? [],
    notifications: input.notifications ?? [],
    accountantLinks: input.accountantLinks ?? [],
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  }
}

class MockDataService implements DataService {
  /** Bump when default seed shape changes so browsers pick up new demo data without manual clear. */
  private key = "yhgc-admin-snapshot-v2"
  private listeners = new Set<(snapshot: AppSnapshot) => void>()

  private read(): AppSnapshot {
    const raw = localStorage.getItem(this.key)
    if (!raw) return seedSnapshot
    try {
      return normalizeSnapshot(JSON.parse(raw) as Partial<AppSnapshot>)
    } catch {
      return seedSnapshot
    }
  }

  private write(snapshot: AppSnapshot): void {
    localStorage.setItem(this.key, JSON.stringify(stripUndefinedForFirestore(snapshot)))
  }

  private emit(): void {
    const snap = this.read()
    for (const fn of this.listeners) fn(snap)
  }

  async loadSnapshot(): Promise<AppSnapshot> {
    return this.read()
  }

  subscribe(onChange: (snapshot: AppSnapshot) => void): () => void {
    this.listeners.add(onChange)
    // Emit current state on next tick so callers can finish wiring up first.
    queueMicrotask(() => onChange(this.read()))
    return () => {
      this.listeners.delete(onChange)
    }
  }

  async upsert(collectionKey: CollectionKey, entity: EntityRow): Promise<void> {
    const snap = this.read()
    const list = (snap[collectionKey] as unknown as EntityRow[]).filter((r) => r.id !== entity.id)
    list.unshift(entity)
    const next = { ...snap, [collectionKey]: list, updatedAt: new Date().toISOString() } as AppSnapshot
    this.write(next)
    this.emit()
  }

  async remove(collectionKey: CollectionKey, id: string): Promise<void> {
    const snap = this.read()
    const list = (snap[collectionKey] as unknown as EntityRow[]).filter((r) => r.id !== id)
    const next = { ...snap, [collectionKey]: list, updatedAt: new Date().toISOString() } as AppSnapshot
    this.write(next)
    this.emit()
  }
}

class FirebaseDataService implements DataService {
  private db = this.initDb()
  private seeded = false

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

  subscribe(onChange: (snapshot: AppSnapshot) => void, onError?: (err: unknown) => void): () => void {
    const cache = emptyCache()
    const reported = new Set<CollectionKey>()
    let stopped = false
    let emitTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleEmit = () => {
      if (emitTimer) return
      // Coalesce the burst of listener callbacks (one per collection) into a single store update.
      emitTimer = setTimeout(() => {
        emitTimer = null
        if (stopped) return
        onChange(snapshotFromCache(cache))
        void this.seedIfEmpty(reported, cache)
      }, 0)
    }

    const unsubs = COLLECTION_KEYS.map((key) =>
      onSnapshot(
        collection(this.db, key),
        (qs) => {
          cache[key] = qs.docs.map((d) =>
            stripFirestoreTimestamps({ id: d.id, ...(d.data() as object) } as EntityRow),
          )
          reported.add(key)
          scheduleEmit()
        },
        (err) => {
          reported.add(key)
          onError?.(err)
        },
      ),
    )

    return () => {
      stopped = true
      if (emitTimer) clearTimeout(emitTimer)
      for (const u of unsubs) u()
    }
  }

  /** First run on an empty project: write the demo seed once so listeners populate the UI. */
  private async seedIfEmpty(
    reported: Set<CollectionKey>,
    cache: Record<CollectionKey, EntityRow[]>,
  ): Promise<void> {
    if (this.seeded) return
    if (reported.size < COLLECTION_KEYS.length) return // wait until every collection has reported
    const hasAny = COLLECTION_KEYS.some((key) => cache[key].length > 0)
    if (hasAny) {
      this.seeded = true
      return
    }
    // Guard against a legacy single-doc snapshot from before the per-collection migration.
    const legacy = await getDoc(doc(this.db, "appSnapshots", "adminPrototype")).catch(() => null)
    if (legacy?.exists()) {
      const data = normalizeSnapshot(stripFirestoreTimestamps(legacy.data() as Partial<AppSnapshot>))
      await this.seedFromSnapshot(data)
      this.seeded = true
      return
    }
    await this.seedFromSnapshot(seedSnapshot)
    this.seeded = true
  }

  private async seedFromSnapshot(snapshot: AppSnapshot): Promise<void> {
    const batch = writeBatch(this.db)
    for (const key of COLLECTION_KEYS) {
      const rows = snapshot[key] as unknown as EntityRow[]
      for (const row of rows) {
        const { id, ...payload } = row
        batch.set(doc(this.db, key, String(id)), stripUndefinedForFirestore(payload), { merge: true })
      }
    }
    await batch.commit()
  }

  async upsert(collectionKey: CollectionKey, entity: EntityRow): Promise<void> {
    const { id, ...payload } = entity
    // `clients` carries fields the admin does not model (e.g. mobile-set appPassword); merge to preserve them.
    const merge = collectionKey === "clients"
    await setDoc(doc(this.db, collectionKey, String(id)), stripUndefinedForFirestore(payload), { merge })
  }

  async remove(collectionKey: CollectionKey, id: string): Promise<void> {
    await deleteDoc(doc(this.db, collectionKey, String(id)))
  }

  async loadSnapshot(): Promise<AppSnapshot> {
    const cache = emptyCache()
    let hasAny = false
    await Promise.all(
      COLLECTION_KEYS.map(async (key) => {
        const snaps = await getDocs(collection(this.db, key))
        cache[key] = snaps.docs.map((d) =>
          stripFirestoreTimestamps({ id: d.id, ...(d.data() as object) } as EntityRow),
        )
        if (cache[key].length > 0) hasAny = true
      }),
    )
    if (hasAny) return snapshotFromCache(cache)
    const legacy = await getDoc(doc(this.db, "appSnapshots", "adminPrototype")).catch(() => null)
    if (legacy?.exists()) {
      return normalizeSnapshot(stripFirestoreTimestamps(legacy.data() as Partial<AppSnapshot>))
    }
    return seedSnapshot
  }
}

export const dataService: DataService =
  activeBackendMode === "mock" ? new MockDataService() : new FirebaseDataService()
