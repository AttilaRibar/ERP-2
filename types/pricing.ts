export type PricingVersionType = "offer" | "contracted" | "unpriced";

export interface PricingProjectOption {
  id: number;
  projectCode: string | null;
  name: string;
}

export interface PricingBudgetOption {
  id: number;
  projectId: number;
  name: string;
}

export interface PricingVersionOption {
  id: number;
  budgetId: number;
  versionName: string;
  versionType: PricingVersionType;
  partnerName: string | null;
  createdAt: Date | null;
}

export interface PricingSelection {
  projectId: number;
  budgetId: number;
  versionId: number;
}

export interface PricingMatch {
  sourceItemCode: string;
  sourceItemNumber: string;
  sourceName: string;
  sourceUnit: string;
  materialUnitPrice: number;
  feeUnitPrice: number;
  score: number;
  reason: string;
}

export interface PricingAnalysisRow {
  rowId: string;
  sheetName: string;
  rowNumber: number;
  itemNumber: string;
  name: string;
  quantity: number;
  unit: string;
  materialTotal: number;
  feeTotal: number;
  match: PricingMatch | null;
}

export interface PricingAnalysisSummary {
  fileName: string;
  sourceProjectName: string;
  sourceProjectCode: string | null;
  sourceBudgetName: string;
  sourceVersionName: string;
  sourceVersionType: PricingVersionType;
  sourcePartnerName: string | null;
  totalRows: number;
  matchedRows: number;
  pricedRows: number;
  lowConfidenceRows: number;
  unmatchedRows: number;
  materialTotal: number;
  feeTotal: number;
}

export interface PricingAnalysisResult {
  summary: PricingAnalysisSummary;
  rows: PricingAnalysisRow[];
  warnings: string[];
  previewLimit: number;
}

export interface PricedWorkbookFile {
  fileName: string;
  buffer: Buffer;
  analysis: PricingAnalysisResult;
}

export type PricingActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };