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
  invoices: Invoice[]
  insuranceRecords: InsuranceRecord[]
  assets: Asset[]
  notifications: NotificationLog[]
  accountantLinks: AccountantLink[]
  updatedAt: ISODateTime
}
