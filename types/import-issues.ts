export type VersionImportIssueCategory = "excel_read" | "formula" | "content";

export interface VersionImportIssuePriceRow {
  fileName?: string;
  categoryPath: string;
  quantity: string;
  materialUnitPrice: string;
  feeUnitPrice: string;
  difference: string;
  source?: string;
}

export interface VersionImportIssue {
  category: VersionImportIssueCategory;
  message: string;
  description?: string;
  fileName?: string;
  sheet?: string;
  row?: number;
  details?: string[];
  priceRows?: VersionImportIssuePriceRow[];
  totalDifference?: string;
  rawData?: unknown[];
}

export interface VersionImportIssues {
  readErrors: VersionImportIssue[];
  formulaErrors: VersionImportIssue[];
  contentErrors: VersionImportIssue[];
}
