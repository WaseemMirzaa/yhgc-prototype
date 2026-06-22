export type Id = string
export type ISODate = string
export type ISODateTime = string

export type ClientStatus = "active" | "suspended" | "revoked"
export type PropertyStatus =
  | "in_construction"
  | "fully_tenanted"
  | "partially_tenanted"
  | "vacant"
export type InvoiceStatus = "paid" | "unpaid" | "queried"
export type AttachmentTag =
  | "general"
  | "finance"
  | "insurance"
  | "invoice"
  | "construction"

/** How often rent falls due for a property. */
export type RentFrequency = "monthly" | "weekly" | "fortnightly"
/** Cadence options offered when logging an income row. */
export type IncomeFrequency = "monthly" | "weekly" | "fortnightly" | "one_off"
/** Whether an expense is a single cost or recurs every month. */
export type ExpenseRecurrence = "one_off" | "repeating"

/** Selectable property types (admin "Add / edit property"). */
export const PROPERTY_TYPE_OPTIONS = [
  "Serviced Accommodation",
  "Buy to let",
  "Residential",
  "Commercial",
  "Semi Commercial",
  "Hotel",
  "HMO",
] as const

export interface Client {
  id: Id
  fullName: string
  email: string
  loginCode: string
  status: ClientStatus
  createdAt: ISODateTime
}

export interface Company {
  id: Id
  clientId: Id
  companyNumber: string
  name: string
  registeredAddress?: string
  directors?: string[]
  nextAccountsDueDate?: ISODate
  lastUpdatedAt: ISODateTime
}

export interface Property {
  id: Id
  clientId: Id
  companyId: Id
  title: string
  address: string
  propertyType: string
  status: PropertyStatus
  heroImageUrl?: string
  currentValue?: number
  monthlyNet?: number
  purchasePrice?: number
  purchaseDate?: ISODate
  refinanceDate?: ISODate
  insuranceRenewalDate?: ISODate
  tenancyStatus?: string
  managingAgent?: string
  incomeToDate?: number
  costToDate?: number
  netPosition?: number
  // Rent schedule (admin-managed) — drives automatic rent-received tracking.
  rentAmount?: number
  rentFrequency?: RentFrequency
  rentDueDay?: number // day of month (1–31) rent is due, for monthly schedules
  rentStartDate?: ISODate // first due date / cadence anchor (used for weekly/fortnightly)
}

export interface ConstructionProject {
  id: Id
  propertyId: Id
  totalWeeks: number
  completedStages: number
  startDate?: ISODate
  expectedCompletionDate?: ISODate
}

export interface ConstructionStage {
  id: Id
  projectId: Id
  weekNumber: number
  uploadDate: ISODate
  photoUrls: string[]
}

export interface FinanceRecord {
  id: Id
  propertyId: Id
  financeType?: string
  lenderName?: string
  lenderContactName?: string
  lenderContactPhone?: string
  loanAmount?: number
  monthlyPayment?: number
  interestRatePct?: number
  ltvPct?: number
  termEndDate?: ISODate
}

export interface IncomeRow {
  id: Id
  propertyId: Id
  period: string
  incomeAmount: number
  costAmount: number
  frequency?: IncomeFrequency
}

/** A confirmed (or due) rent payment for one scheduled occurrence. */
export interface RentReceipt {
  id: Id
  propertyId: Id
  dueDate: ISODate // when rent was scheduled to arrive
  amount: number
  receivedDate?: ISODate // when it actually arrived; later than dueDate ⇒ late
}

/** An ongoing or one-off operating cost for a property (e.g. communal clean, repair). */
export interface Expense {
  id: Id
  propertyId: Id
  description: string
  category?: string
  amount: number
  date: ISODate // date incurred (or first charge date for repeating)
  recurrence: ExpenseRecurrence // "one_off" | "repeating" (monthly)
}

export interface Invoice {
  id: Id
  propertyId: Id
  supplierName: string
  invoiceRef: string
  invoiceDate: ISODate
  amount: number
  status: InvoiceStatus
  pdfUrl?: string
}

export interface InsuranceRecord {
  id: Id
  propertyId: Id
  insurerName?: string
  policyNumber?: string
  coverStartDate?: ISODate
  coverEndDate?: ISODate
  renewal60DayAlertOn?: ISODate
  renewal14DayAlertOn?: ISODate
}

export interface Asset {
  id: Id
  ownerType: "client" | "property" | "construction_stage" | "invoice" | "insurance_record" | "finance_record"
  ownerId: Id
  tag: AttachmentTag
  fileName: string
  mimeType: string
  sizeBytes: number
  urlOrPath: string
  createdAt: ISODateTime
}

export interface NotificationLog {
  id: Id
  clientId: Id
  type:
    | "construction_update"
    | "new_document"
    | "new_invoice"
    | "insurance_60"
    | "insurance_14"
    | "construction_complete"
    | "new_property_added"
  title: string
  body: string
  createdAt: ISODateTime
}

export interface AccountantLink {
  id: Id
  scopeType: "company" | "property"
  scopeId: Id
  token: string
  expiresAt: ISODateTime
  isRevoked: boolean
}

export interface AppSnapshot {
  clients: Client[]
  companies: Company[]
  properties: Property[]
  constructionProjects: ConstructionProject[]
  constructionStages: ConstructionStage[]
  financeRecords: FinanceRecord[]
  incomeRows: IncomeRow[]
  rentReceipts: RentReceipt[]
  expenses: Expense[]
  invoices: Invoice[]
  insuranceRecords: InsuranceRecord[]
  assets: Asset[]
  notifications: NotificationLog[]
  accountantLinks: AccountantLink[]
  updatedAt: ISODateTime
}
