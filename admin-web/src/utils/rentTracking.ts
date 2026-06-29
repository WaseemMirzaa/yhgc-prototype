import type { AppSnapshot, Property, RentReceipt } from "../types/models"

export function parseISODateLocal(value: string | undefined): Date | null {
  if (!value?.trim()) return null
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const t = Date.parse(value)
  return Number.isFinite(t) ? new Date(t) : null
}

export function toISODateString(d: Date): string {
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-")
}

export function todayISODate(): string {
  return toISODateString(new Date())
}

function monthlyRentOccurrence(start: Date, n: number, dueDay?: number): Date {
  const base = new Date(start.getFullYear(), start.getMonth() + n, 1)
  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()
  const day = Math.min(dueDay && dueDay >= 1 ? dueDay : start.getDate(), lastDay)
  return new Date(base.getFullYear(), base.getMonth(), day)
}

export function rentDueDatesUpTo(property: Property, todayISO: string): string[] {
  const freq = property.rentFrequency
  const start = parseISODateLocal(property.rentStartDate)
  if (!freq || !start) return []
  const today = parseISODateLocal(todayISO) ?? new Date()
  const out: string[] = []
  for (let i = 0; i < 240; i++) {
    let d: Date
    if (freq === "monthly") {
      d = monthlyRentOccurrence(start, i, property.rentDueDay)
    } else {
      const stepDays = freq === "weekly" ? 7 : 14
      d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i * stepDays)
    }
    if (d.getTime() > today.getTime()) break
    out.push(toISODateString(d))
  }
  return out
}

export function isRentLate(receipt: RentReceipt): boolean {
  if (!receipt.receivedDate) return false
  const due = parseISODateLocal(receipt.dueDate)
  const rec = parseISODateLocal(receipt.receivedDate)
  return !!due && !!rec && rec.getTime() > due.getTime()
}

export function hasRentSchedule(property: Property): boolean {
  return !!property.rentFrequency && !!property.rentStartDate && (property.rentAmount ?? 0) > 0
}

export function pendingRentDueDates(property: Property, receipts: RentReceipt[], todayISO = todayISODate()): string[] {
  if (!hasRentSchedule(property)) return []
  const recorded = new Set(receipts.filter((r) => r.propertyId === property.id).map((r) => r.dueDate))
  return rentDueDatesUpTo(property, todayISO).filter((d) => !recorded.has(d))
}

export function totalRentReceivedForProperty(propertyId: string, receipts: RentReceipt[]): number {
  return receipts
    .filter((r) => r.propertyId === propertyId && r.receivedDate?.trim())
    .reduce((s, r) => s + (r.amount || 0), 0)
}

export function propertyIncomePatchFromReceipts(
  property: Property,
  receipts: RentReceipt[],
): Pick<Property, "incomeToDate" | "netPosition"> {
  const incomeToDate = totalRentReceivedForProperty(property.id, receipts)
  const costToDate = property.costToDate ?? 0
  return { incomeToDate, netPosition: incomeToDate - costToDate }
}

export function snapshotWithSyncedPropertyIncome(snapshot: AppSnapshot): AppSnapshot {
  const properties = snapshot.properties.map((p) => ({
    ...p,
    ...propertyIncomePatchFromReceipts(p, snapshot.rentReceipts),
  }))
  return { ...snapshot, properties, updatedAt: snapshot.updatedAt }
}

export function rentSchedulePatchFromMonthlyNet(
  monthlyNet: number | undefined,
  rentDueDay: number,
  rentStartDate: string,
): Partial<Pick<Property, "rentAmount" | "rentFrequency" | "rentDueDay" | "rentStartDate">> | null {
  if (monthlyNet == null || monthlyNet <= 0 || !rentStartDate.trim()) return null
  const day = Math.min(31, Math.max(1, rentDueDay))
  return {
    rentAmount: monthlyNet,
    rentFrequency: "monthly",
    rentDueDay: day,
    rentStartDate: rentStartDate.trim(),
  }
}

export type PortfolioRentMetrics = {
  pendingDueCount: number
  totalRentReceived: number
  propertiesWithPending: { propertyId: string; title: string; clientId: string; companyId: string; pendingCount: number }[]
}

export function portfolioRentMetrics(snapshot: AppSnapshot, todayISO = todayISODate()): PortfolioRentMetrics {
  let pendingDueCount = 0
  let totalRentReceived = 0
  const propertiesWithPending: PortfolioRentMetrics["propertiesWithPending"] = []

  for (const p of snapshot.properties) {
    totalRentReceived += totalRentReceivedForProperty(p.id, snapshot.rentReceipts)
    const pending = pendingRentDueDates(p, snapshot.rentReceipts, todayISO)
    if (pending.length) {
      pendingDueCount += pending.length
      propertiesWithPending.push({
        propertyId: p.id,
        title: p.title,
        clientId: p.clientId,
        companyId: p.companyId,
        pendingCount: pending.length,
      })
    }
  }

  propertiesWithPending.sort((a, b) => b.pendingCount - a.pendingCount)
  return { pendingDueCount, totalRentReceived, propertiesWithPending }
}

export function portfolioRentMetricsForClient(snapshot: AppSnapshot, clientId: string): PortfolioRentMetrics {
  const filtered: AppSnapshot = {
    ...snapshot,
    properties: snapshot.properties.filter((p) => p.clientId === clientId),
  }
  return portfolioRentMetrics(filtered)
}

export function portfolioRentMetricsForCompany(snapshot: AppSnapshot, companyId: string): PortfolioRentMetrics {
  const filtered: AppSnapshot = {
    ...snapshot,
    properties: snapshot.properties.filter((p) => p.companyId === companyId),
  }
  return portfolioRentMetrics(filtered)
}

export function defaultPropertyTab(property: Property, receipts: RentReceipt[]): "income" | "construction" {
  if (pendingRentDueDates(property, receipts).length > 0) return "income"
  if (hasRentSchedule(property)) return "income"
  return "construction"
}
