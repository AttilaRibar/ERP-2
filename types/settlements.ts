// ============================================================
// Settlement system types
// ============================================================

export type SettlementContractStatus = "active" | "completed" | "cancelled";
export type SettlementInvoiceStatus = "locked" | "open" | "submitted" | "approved" | "rejected";

/** Admin-facing contract row with joined names */
export interface SettlementContractRow {
  id: number;
  budgetId: number;
  versionId: number;
  partnerId: number;
  accessToken: string;
  totalNetAmount: string;
  label: string;
  status: SettlementContractStatus;
  createdBy: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  // joined
  partnerName: string;
  versionName: string;
  budgetName: string;
  projectName: string;
}

/** Admin-facing invoice row */
export interface SettlementInvoiceRow {
  id: number;
  contractId: number;
  invoiceNumber: number;
  label: string;
  maxAmount: string;
  status: SettlementInvoiceStatus;
  submittedAt: Date | null;
  submittedNote: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  claimedMaterialTotal: string;
  claimedFeeTotal: string;
  createdAt: Date | null;
}

/** Single item settlement entry */
export interface SettlementItemRow {
  id: number;
  invoiceId: number;
  itemCode: string;
  claimedMaterialAmount: string;
  claimedFeeAmount: string;
  note: string;
}

/** Input for creating a contract */
export interface CreateContractInput {
  budgetId: number;
  versionId: number;
  partnerId: number;
  password: string;
  totalNetAmount: number;
  label: string;
  invoices: Array<{
    invoiceNumber: number;
    label: string;
    maxAmount: number;
  }>;
}

/** Input for saving settlement items */
export interface SaveSettlementItemsInput {
  invoiceId: number;
  items: Array<{
    itemCode: string;
    claimedMaterialAmount: number;
    claimedFeeAmount: number;
    note: string;
  }>;
}

/** Budget item as seen by subcontractor (only necessary fields) */
export interface SettleBudgetItem {
  itemCode: string;
  sequenceNo: number;
  itemNumber: string;
  name: string;
  quantity: number;
  unit: string;
  materialUnitPrice: number;
  feeUnitPrice: number;
  sectionCode: string | null;
}

/** Section as seen by subcontractor */
export interface SettleSection {
  sectionCode: string;
  parentSectionCode: string | null;
  name: string;
  sequenceNo: number;
}

/** Previously claimed amounts (cumulative from earlier approved invoices) */
export interface PreviousClaim {
  itemCode: string;
  totalClaimedMaterial: number;
  totalClaimedFee: number;
}

/** Full data package for the invoice editor */
export interface InvoiceEditorData {
  contract: {
    label: string;
    totalNetAmount: number;
    partnerName: string;
    projectName: string;
    budgetName: string;
  };
  invoice: {
    id: number;
    invoiceNumber: number;
    label: string;
    maxAmount: number;
    status: SettlementInvoiceStatus;
  };
  budgetItems: SettleBudgetItem[];
  sections: SettleSection[];
  previousClaims: PreviousClaim[];
  currentItems: SettlementItemRow[];
}

/** Dashboard data for subcontractor portal */
export interface SettleDashboardData {
  contract: {
    label: string;
    totalNetAmount: number;
    partnerName: string;
    projectName: string;
    budgetName: string;
    status: SettlementContractStatus;
  };
  invoices: Array<{
    id: number;
    invoiceNumber: number;
    label: string;
    maxAmount: string;
    status: SettlementInvoiceStatus;
    claimedMaterialTotal: string;
    claimedFeeTotal: string;
    submittedAt: Date | null;
    reviewedAt: Date | null;
    reviewNote: string | null;
  }>;
}
