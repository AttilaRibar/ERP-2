"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  Loader2,
  Info,
  Layers,
  GitBranch,
  FileText,
  FileSignature,
  FileQuestion,
  Plus,
  Trash2,
  Square,
  CheckSquare,
  MinusSquare,
  Pencil,
  FolderKanban,
} from "lucide-react";
import { parseExcelBuffer, type ExcelParseResult, type ParseIssue, type ParsedBudgetItem } from "@/lib/import/excel-parser";
import { mapParsedDataToBudget, type MappedBudgetData } from "@/lib/import/budget-mapper";
import { importVersionWithItems } from "@/server/actions/import";
import { getBudgets, getBudgetById } from "@/server/actions/budgets";
import { getProjectsForSelect } from "@/server/actions/projects";
import {
  getVersionsByBudgetId,
  getPartnersForVersionSelect,
  type VersionInfo,
  type VersionType,
} from "@/server/actions/versions";
import type { VersionImportIssue, VersionImportIssues } from "@/types/import-issues";

function fmt(n: number): string {
  return new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0 }).format(n);
}

type ImportStep = "target" | "upload" | "preview" | "importing" | "done" | "error";

type ProjectOption = Awaited<ReturnType<typeof getProjectsForSelect>>[number];
type BudgetOption = Awaited<ReturnType<typeof getBudgets>>[number];

// ---- Multi-file + selection state ----

/** One loaded Excel file with its parse result */
interface LoadedFile {
  id: string;
  fileName: string;
  /** Optional override: rename the top-level sections under a single root section */
  rootSectionName: string;
  parseResult: ExcelParseResult;
}

/**
 * Selection tree per file.
 * key = fileId → mainCategory → subCategory (or "__root__" for items with no subCat) → item sequenceNo
 */
type SubCatSelection = Map<string, { selected: boolean; items: Map<number, boolean> }>;
type FileSelection = Map<string, { selected: boolean; subCats: SubCatSelection }>;
type SelectionState = Map<string, FileSelection>;

function buildInitialSelection(files: LoadedFile[]): SelectionState {
  const sel: SelectionState = new Map();
  for (const f of files) {
    const fileSel: FileSelection = new Map();
    for (const sheet of f.parseResult.sheetSummaries) {
      const subCatSel: SubCatSelection = new Map();
      // collect unique subCats (plus __root__ for items without subCat)
      const allSubCats = new Set<string>(["__root__", ...sheet.subCategories]);
      for (const sub of allSubCats) {
        const items = f.parseResult.items.filter(
          (i) => i.mainCategory === sheet.sheetName && (sub === "__root__" ? !i.subCategory : i.subCategory === sub)
        );
        if (items.length === 0 && sub === "__root__") continue;
        const itemMap = new Map<number, boolean>();
        for (const item of items) itemMap.set(item.sequenceNo, true);
        subCatSel.set(sub, { selected: true, items: itemMap });
      }
      fileSel.set(sheet.sheetName, { selected: true, subCats: subCatSel });
    }
    sel.set(f.id, fileSel);
  }
  return sel;
}

/** Deep-clone a SelectionState */
function cloneSel(sel: SelectionState): SelectionState {
  const next: SelectionState = new Map();
  for (const [fid, fileSel] of sel) {
    const nextFile: FileSelection = new Map();
    for (const [mainCat, mainVal] of fileSel) {
      const nextSubCats: SubCatSelection = new Map();
      for (const [sub, subVal] of mainVal.subCats) {
        nextSubCats.set(sub, { selected: subVal.selected, items: new Map(subVal.items) });
      }
      nextFile.set(mainCat, { selected: mainVal.selected, subCats: nextSubCats });
    }
    next.set(fid, nextFile);
  }
  return next;
}

/** Count selected items across all files */
function countSelected(files: LoadedFile[], sel: SelectionState): number {
  let count = 0;
  for (const f of files) {
    const fileSel = sel.get(f.id);
    if (!fileSel) continue;
    for (const [, mainVal] of fileSel) {
      if (!mainVal.selected) continue;
      for (const [, subVal] of mainVal.subCats) {
        if (!subVal.selected) continue;
        for (const [, checked] of subVal.items) {
          if (checked) count++;
        }
      }
    }
  }
  return count;
}

/**
 * Build a merged ExcelParseResult from selected items across all files.
 * Main categories are named as: rootSectionName (if set) OR sheet name.
 * When a file has a rootSectionName, all sheets in that file are wrapped under
 * a virtual top-level section with that name, with the sheet names becoming sub-categories.
 */
function issueRowKey(sheet: string, row: number): string {
  return `${sheet}::${row}`;
}

function withFileName(issue: ParseIssue, fileName: string): ParseIssue {
  return { ...issue, fileName };
}

function buildFilteredResult(files: LoadedFile[], sel: SelectionState): ExcelParseResult {
  const items: ParsedBudgetItem[] = [];
  const selectedSheetsByFile = new Map<string, Set<string>>();
  const selectedRowsByFile = new Map<string, Set<string>>();
  let seqCounter = 0;

  for (const f of files) {
    const fileSel = sel.get(f.id);
    if (!fileSel) continue;
    const hasRoot = f.rootSectionName.trim() !== "";

    for (const [mainCat, mainVal] of fileSel) {
      if (!mainVal.selected) continue;

      for (const [sub, subVal] of mainVal.subCats) {
        if (!subVal.selected) continue;

        for (const [seqNo, checked] of subVal.items) {
          if (!checked) continue;
          const orig = f.parseResult.items.find((i) => i.sequenceNo === seqNo && i.mainCategory === mainCat);
          if (!orig) continue;
          seqCounter++;

          const sourceSheet = orig.sourceSheet ?? orig.mainCategory;
          const sourceRow = orig.sourceRow ?? orig.sequenceNo;
          const selectedSheets = selectedSheetsByFile.get(f.id) ?? new Set<string>();
          selectedSheets.add(sourceSheet);
          selectedSheetsByFile.set(f.id, selectedSheets);
          const selectedRows = selectedRowsByFile.get(f.id) ?? new Set<string>();
          selectedRows.add(issueRowKey(sourceSheet, sourceRow));
          selectedRowsByFile.set(f.id, selectedRows);

          let effectiveMain: string;
          let effectiveSub: string | null;

          if (hasRoot) {
            // root section wraps everything: rootName → sheetName → orig subCat
            effectiveMain = f.rootSectionName.trim();
            effectiveSub = sub === "__root__" ? mainCat : `${mainCat} / ${sub}`;
          } else {
            effectiveMain = mainCat;
            effectiveSub = sub === "__root__" ? null : sub;
          }

          items.push({
            ...orig,
            sequenceNo: seqCounter,
            mainCategory: effectiveMain,
            subCategory: effectiveSub,
            sourceSheet,
            sourceRow,
            sourceFileName: f.fileName,
          });
        }
      }
    }
  }

  const readErrors = files.flatMap((f) => {
    const selectedSheets = selectedSheetsByFile.get(f.id) ?? new Set<string>();
    return f.parseResult.readErrors
      .filter((issue) => selectedSheets.has(issue.sheet))
      .map((issue) => withFileName(issue, f.fileName));
  });

  const formulaErrors = files.flatMap((f) => {
    const selectedRows = selectedRowsByFile.get(f.id) ?? new Set<string>();
    return f.parseResult.formulaErrors
      .filter((issue) => selectedRows.has(issueRowKey(issue.sheet, issue.row)))
      .map((issue) => withFileName(issue, f.fileName));
  });

  // Rebuild sheetSummaries from filtered items
  const sheetMap = new Map<string, { itemCount: number; materialTotal: number; feeTotal: number; subCats: Set<string> }>();
  for (const item of items) {
    if (!sheetMap.has(item.mainCategory)) {
      sheetMap.set(item.mainCategory, { itemCount: 0, materialTotal: 0, feeTotal: 0, subCats: new Set() });
    }
    const s = sheetMap.get(item.mainCategory)!;
    s.itemCount++;
    s.materialTotal += item.materialTotal;
    s.feeTotal += item.feeTotal;
    if (item.subCategory) s.subCats.add(item.subCategory);
  }

  return {
    items,
    readErrors,
    formulaErrors,
    warnings: [...readErrors, ...formulaErrors],
    skippedSheets: files.flatMap((f) => f.parseResult.skippedSheets),
    sheetSummaries: Array.from(sheetMap.entries()).map(([sheetName, v]) => ({
      sheetName,
      itemCount: v.itemCount,
      materialTotal: v.materialTotal,
      feeTotal: v.feeTotal,
      subCategories: Array.from(v.subCats),
    })),
    totals: {
      materialTotal: items.reduce((s, i) => s + i.materialTotal, 0),
      feeTotal: items.reduce((s, i) => s + i.feeTotal, 0),
      itemCount: items.length,
    },
  };
}

function parseIssueToVersionIssue(
  issue: ParseIssue,
  category: "excel_read" | "formula",
): VersionImportIssue {
  return {
    category,
    message: issue.message,
    fileName: issue.fileName,
    sheet: issue.sheet,
    row: issue.row,
    rawData: issue.rawData,
  };
}

function buildEmptyImportIssues(): VersionImportIssues {
  return { readErrors: [], formulaErrors: [], contentErrors: [] };
}

function hasImportIssues(issues: VersionImportIssues): boolean {
  return issues.readErrors.length + issues.formulaErrors.length + issues.contentErrors.length > 0;
}

function categoryPath(item: ParsedBudgetItem): string {
  return [item.mainCategory, item.subCategory].filter(Boolean).join(" / ");
}

function priceSignature(item: ParsedBudgetItem): string {
  return `${item.materialUnitPrice.toFixed(2)}::${item.feeUnitPrice.toFixed(2)}`;
}

function itemGroupKey(item: ParsedBudgetItem): string {
  const itemNumber = item.itemNumber.trim();
  const itemName = item.name.trim().toLowerCase().replace(/\s+/g, " ");
  return `${itemNumber}::${itemName}`;
}

function formatMoney(n: number): string {
  return `${fmt(n)} Ft`;
}

function formatQuantity(item: ParsedBudgetItem): string {
  return `${new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 4 }).format(item.quantity)} ${item.unit}`.trim();
}

function buildContentErrors(items: ParsedBudgetItem[]): VersionImportIssue[] {
  const byItemNumber = new Map<string, ParsedBudgetItem[]>();

  for (const item of items) {
    const key = item.itemNumber.trim();
    if (!key) continue;
    const groupKey = itemGroupKey(item);
    const group = byItemNumber.get(groupKey) ?? [];
    group.push(item);
    byItemNumber.set(groupKey, group);
  }

  const issues: VersionImportIssue[] = [];
  for (const [, group] of byItemNumber) {
    if (group.length < 2) continue;

    const prices = new Map<string, ParsedBudgetItem[]>();
    for (const item of group) {
      const signature = priceSignature(item);
      const priceGroup = prices.get(signature) ?? [];
      priceGroup.push(item);
      prices.set(signature, priceGroup);
    }

    if (prices.size < 2) continue;

    const itemNumber = group[0].itemNumber.trim();
    const firstName = group.find((item) => item.name.trim())?.name.trim() ?? "névtelen tétel";
    const cheapestCombinedUnitPrice = Math.min(
      ...group.map((item) => item.materialUnitPrice + item.feeUnitPrice),
    );

    let totalDifference = 0;
    const priceRows = group
      .map((item) => {
        const combinedUnitPrice = item.materialUnitPrice + item.feeUnitPrice;
        const difference = Math.max(0, (combinedUnitPrice - cheapestCombinedUnitPrice) * item.quantity);
        totalDifference += difference;

        return {
          fileName: item.sourceFileName,
          categoryPath: categoryPath(item),
          quantity: formatQuantity(item),
          materialUnitPrice: formatMoney(item.materialUnitPrice),
          feeUnitPrice: formatMoney(item.feeUnitPrice),
          difference: difference > 0 ? `+${formatMoney(difference)}` : formatMoney(0),
          source: `${item.sourceSheet} sor ${item.sourceRow}`,
          sortValue: difference,
        };
      })
      .sort((a, b) => b.sortValue - a.sortValue)
      .map((row) => ({
        fileName: row.fileName,
        categoryPath: row.categoryPath,
        quantity: row.quantity,
        materialUnitPrice: row.materialUnitPrice,
        feeUnitPrice: row.feeUnitPrice,
        difference: row.difference,
        source: row.source,
      }));

    const details = priceRows.map((row) => (
      `${row.fileName ?? "Ismeretlen fájl"} | ${row.categoryPath} | ${row.quantity} | ${row.materialUnitPrice} | ${row.feeUnitPrice} | ${row.difference}`
    ));

    issues.push({
      category: "content",
      message: itemNumber ? `${itemNumber} - ${firstName}` : firstName,
      description: `Ha a legalacsonyabb egységárat vesszük alapul, a drágább előfordulások becsült többlete összesen ${formatMoney(totalDifference)}.`,
      details,
      priceRows,
      totalDifference: formatMoney(totalDifference),
    });
  }

  return issues;
}

interface ImportPanelProps {
  budgetId: number;
  onClose: () => void;
  onImported: (
    versionId: number,
    versionName: string,
    versionType: VersionType,
    partnerName: string | null,
    targetBudgetId: number,
    targetBudgetName: string | null,
  ) => void;
}

export function ImportPanel({ budgetId, onClose, onImported }: ImportPanelProps) {
  const [step, setStep] = useState<ImportStep>("target");
  const [dragOver, setDragOver] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Target step state
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [budgetOptions, setBudgetOptions] = useState<BudgetOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedBudgetId, setSelectedBudgetId] = useState<number | null>(budgetId);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [loadingTarget, setLoadingTarget] = useState(true);
  const [loadingBudgets, setLoadingBudgets] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);

  // Multi-file state
  const [loadedFiles, setLoadedFiles] = useState<LoadedFile[]>([]);
  const [selection, setSelection] = useState<SelectionState>(new Map());

  // Preview expansion state
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [showWarnings, setShowWarnings] = useState(false);

  // Config step state
  const [existingVersions, setExistingVersions] = useState<VersionInfo[]>([]);
  const [partners, setPartners] = useState<{ id: number; name: string }[]>([]);
  const [versionName, setVersionName] = useState("");
  const [versionType, setVersionType] = useState<VersionType>("offer");
  const [parentId, setParentId] = useState<number | null>(null);
  const [partnerId, setPartnerId] = useState<number | null>(null);

  // Import state
  const [importError, setImportError] = useState<string | null>(null);
  const [importedVersion, setImportedVersion] = useState<VersionInfo | null>(null);
  const [filteredResult, setFilteredResult] = useState<ExcelParseResult | null>(null);
  const [mappedData, setMappedData] = useState<MappedBudgetData | null>(null);
  const [importIssues, setImportIssues] = useState<VersionImportIssues>(buildEmptyImportIssues());

  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedBudget = useMemo(
    () => budgetOptions.find((budget) => budget.id === selectedBudgetId) ?? null,
    [budgetOptions, selectedBudgetId],
  );

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const selectedParent = useMemo(
    () => existingVersions.find((version) => version.id === parentId) ?? null,
    [existingVersions, parentId],
  );

  useEffect(() => {
    let active = true;

    async function loadInitialTarget() {
      setLoadingTarget(true);
      setTargetError(null);
      try {
        const [currentBudget, projectRows, partnerRows] = await Promise.all([
          getBudgetById(budgetId),
          getProjectsForSelect(),
          getPartnersForVersionSelect(),
        ]);

        if (!active) return;

        setProjects(projectRows);
        setPartners(partnerRows);

        const initialProjectId = currentBudget?.projectId ?? projectRows[0]?.id ?? null;
        setSelectedProjectId(initialProjectId);

        if (initialProjectId) {
          const budgetRows = await getBudgets(undefined, String(initialProjectId));
          if (!active) return;
          setBudgetOptions(budgetRows);
          const initialBudgetId = budgetRows.some((budget) => budget.id === budgetId)
            ? budgetId
            : budgetRows[0]?.id ?? null;
          setSelectedBudgetId(initialBudgetId);
        }
      } catch (err) {
        if (!active) return;
        setTargetError(err instanceof Error ? err.message : "Nem sikerült betölteni az import célját");
      } finally {
        if (active) setLoadingTarget(false);
      }
    }

    void loadInitialTarget();
    return () => {
      active = false;
    };
  }, [budgetId]);

  useEffect(() => {
    if (loadingTarget || selectedProjectId === null) return;
    let active = true;

    async function loadBudgetsForProject() {
      setLoadingBudgets(true);
      try {
        const rows = await getBudgets(undefined, String(selectedProjectId));
        if (!active) return;
        setBudgetOptions(rows);
        setSelectedBudgetId((current) => (
          rows.some((budget) => budget.id === current) ? current : rows[0]?.id ?? null
        ));
      } catch (err) {
        if (!active) return;
        setTargetError(err instanceof Error ? err.message : "Nem sikerült betölteni a költségvetéseket");
      } finally {
        if (active) setLoadingBudgets(false);
      }
    }

    void loadBudgetsForProject();
    return () => {
      active = false;
    };
  }, [loadingTarget, selectedProjectId]);

  useEffect(() => {
    if (selectedBudgetId === null) {
      setExistingVersions([]);
      setParentId(null);
      return;
    }

    let active = true;
    const budgetIdForVersions = selectedBudgetId;
    async function loadVersionsForBudget() {
      setLoadingVersions(true);
      try {
        const versions = await getVersionsByBudgetId(budgetIdForVersions);
        if (!active) return;
        setExistingVersions(versions);
        setParentId((current) => (
          current && versions.some((version) => version.id === current)
            ? current
            : versions.length === 0
              ? null
              : current
        ));
      } catch (err) {
        if (!active) return;
        setTargetError(err instanceof Error ? err.message : "Nem sikerült betölteni a verziókat");
      } finally {
        if (active) setLoadingVersions(false);
      }
    }

    void loadVersionsForBudget();
    return () => {
      active = false;
    };
  }, [selectedBudgetId]);

  const addFiles = useCallback(async (files: File[]) => {
    setParseError(null);
    const newLoaded: LoadedFile[] = [];
    for (const file of files) {
      if (!file.name.endsWith(".xls") && !file.name.endsWith(".xlsx")) {
        setParseError(`"${file.name}" nem Excel fájl (.xls / .xlsx szükséges).`);
        continue;
      }
      try {
        const buffer = await file.arrayBuffer();
        const result = parseExcelBuffer(buffer);
        if (result.items.length === 0) {
          setParseError(`"${file.name}": Nem található importálható tétel.`);
          continue;
        }
        newLoaded.push({
          id: crypto.randomUUID(),
          fileName: file.name,
          rootSectionName: "",
          parseResult: result,
        });
      } catch (err) {
        setParseError(
          err instanceof Error
            ? `"${file.name}" olvasási hiba: ${err.message}`
            : `"${file.name}": Ismeretlen hiba.`
        );
      }
    }
    if (newLoaded.length > 0) {
      setLoadedFiles((prev) => {
        const updated = [...prev, ...newLoaded];
        setSelection(buildInitialSelection(updated));
        return updated;
      });
      setStep("preview");
    }
  }, []);

  const removeFile = useCallback((id: string) => {
    setLoadedFiles((prev) => {
      const updated = prev.filter((f) => f.id !== id);
      setSelection(buildInitialSelection(updated));
      if (updated.length === 0) setStep("upload");
      return updated;
    });
  }, []);

  const updateRootSectionName = useCallback((id: string, name: string) => {
    setLoadedFiles((prev) => prev.map((f) => (f.id === id ? { ...f, rootSectionName: name } : f)));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) addFiles(files);
    },
    [addFiles]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) addFiles(files);
      // Reset input so same file can be re-added
      e.target.value = "";
    },
    [addFiles]
  );

  // ---- Selection helpers ----

  const toggleMainCat = useCallback((fileId: string, mainCat: string, checked: boolean) => {
    setSelection((prev) => {
      const next = cloneSel(prev);
      const fileSel = next.get(fileId);
      if (!fileSel) return prev;
      const mainVal = fileSel.get(mainCat);
      if (!mainVal) return prev;
      mainVal.selected = checked;
      for (const [, subVal] of mainVal.subCats) {
        subVal.selected = checked;
        for (const [itemSeq] of subVal.items) {
          subVal.items.set(itemSeq, checked);
        }
      }
      return next;
    });
  }, []);

  const toggleSubCat = useCallback((fileId: string, mainCat: string, subCat: string, checked: boolean) => {
    setSelection((prev) => {
      const next = cloneSel(prev);
      const fileSel = next.get(fileId);
      if (!fileSel) return prev;
      const mainVal = fileSel.get(mainCat);
      if (!mainVal) return prev;
      const subVal = mainVal.subCats.get(subCat);
      if (!subVal) return prev;
      subVal.selected = checked;
      for (const [itemSeq] of subVal.items) {
        subVal.items.set(itemSeq, checked);
      }
      // If checking a subCat, also check the parent main cat
      if (checked) mainVal.selected = true;
      // If unchecking, check if all subCats are unchecked → uncheck main
      if (!checked) {
        const anySubSelected = Array.from(mainVal.subCats.values()).some((s) => s.selected);
        if (!anySubSelected) mainVal.selected = false;
      }
      return next;
    });
  }, []);

  const toggleItem = useCallback((fileId: string, mainCat: string, subCat: string, seqNo: number, checked: boolean) => {
    setSelection((prev) => {
      const next = cloneSel(prev);
      const fileSel = next.get(fileId);
      if (!fileSel) return prev;
      const mainVal = fileSel.get(mainCat);
      if (!mainVal) return prev;
      const subVal = mainVal.subCats.get(subCat);
      if (!subVal) return prev;
      subVal.items.set(seqNo, checked);
      // Propagate upward
      const anyItemSelected = Array.from(subVal.items.values()).some(Boolean);
      subVal.selected = anyItemSelected;
      const anySubSelected = Array.from(mainVal.subCats.values()).some((s) => s.selected);
      mainVal.selected = anySubSelected;
      return next;
    });
  }, []);

  const toggleExpandKey = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // ---- Navigation ----

  const handleTargetContinue = useCallback(() => {
    setTargetError(null);
    if (!selectedProjectId) {
      setTargetError("Projekt kiválasztása kötelező");
      return;
    }
    if (!selectedBudgetId) {
      setTargetError("Költségvetés kiválasztása kötelező");
      return;
    }
    if (!versionName.trim()) {
      setTargetError("A verzió neve kötelező");
      return;
    }
    if (existingVersions.length > 0 && !parentId) {
      setTargetError("Meglévő költségvetésnél szülő verzió kiválasztása kötelező");
      return;
    }
    setStep(loadedFiles.length > 0 ? "preview" : "upload");
  }, [existingVersions.length, loadedFiles.length, parentId, selectedBudgetId, selectedProjectId, versionName]);

  const startImport = useCallback(async (
    filtered: ExcelParseResult,
    mapped: MappedBudgetData,
    issues: VersionImportIssues,
  ) => {
    if (!selectedBudgetId || !versionName.trim()) return;

    setStep("importing");
    setImportError(null);

    try {
      const result = await importVersionWithItems({
        budgetId: selectedBudgetId,
        parentId,
        versionName: versionName.trim(),
        versionType,
        partnerId,
        sections: mapped.sections,
        items: mapped.items,
        importIssues: hasImportIssues(issues) ? issues : null,
      });

      if (result.success && result.data) {
        setImportedVersion(result.data);
        setStep("done");
      } else {
        setImportError(result.error ?? "Ismeretlen hiba");
        setStep("error");
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Ismeretlen hiba");
      setStep("error");
    }
  }, [parentId, partnerId, selectedBudgetId, versionName, versionType]);

  // Build filtered result + mapped data, then import into the already selected target.
  const handlePreviewContinue = useCallback(async () => {
    const filtered = buildFilteredResult(loadedFiles, selection);
    const mapped = mapParsedDataToBudget(filtered);
    const issues: VersionImportIssues = {
      readErrors: filtered.readErrors.map((issue) => parseIssueToVersionIssue(issue, "excel_read")),
      formulaErrors: filtered.formulaErrors.map((issue) => parseIssueToVersionIssue(issue, "formula")),
      contentErrors: buildContentErrors(filtered.items),
    };
    setFilteredResult(filtered);
    setMappedData(mapped);
    setImportIssues(issues);
    await startImport(filtered, mapped, issues);
  }, [loadedFiles, selection, startImport]);

  const selectedCount = useMemo(() => countSelected(loadedFiles, selection), [loadedFiles, selection]);

  // ---- RENDER ----

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--slate-200)] bg-white">
        <button
          onClick={onClose}
          className="flex items-center gap-1 text-xs text-[var(--slate-500)] hover:text-[var(--slate-800)] transition-colors cursor-pointer"
        >
          <ArrowLeft size={14} />
        </button>
        <FileSpreadsheet size={18} className="text-[var(--emerald-600)]" />
        <h2 className="text-sm font-semibold text-[var(--slate-800)]">
          Verzió importálása Excelből
        </h2>
        {step !== "done" && step !== "error" && (
          <div className="ml-auto flex items-center gap-1.5 text-[10px] text-[var(--slate-400)]">
            <StepDot active={step === "target"} done={step !== "target"} label="1" />
            <span className="w-3 h-px bg-[var(--slate-200)]" />
            <StepDot active={step === "upload" || step === "preview"} done={step === "importing"} label="2" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {step === "target" && (
          <TargetStep
            projects={projects}
            budgets={budgetOptions}
            versions={existingVersions}
            partners={partners}
            selectedProjectId={selectedProjectId}
            selectedBudgetId={selectedBudgetId}
            versionName={versionName}
            versionType={versionType}
            parentId={parentId}
            partnerId={partnerId}
            loading={loadingTarget}
            loadingBudgets={loadingBudgets}
            loadingVersions={loadingVersions}
            error={targetError}
            onProjectIdChange={setSelectedProjectId}
            onBudgetIdChange={setSelectedBudgetId}
            onVersionNameChange={setVersionName}
            onVersionTypeChange={setVersionType}
            onParentIdChange={setParentId}
            onPartnerIdChange={setPartnerId}
            onContinue={handleTargetContinue}
          />
        )}

        {(step === "upload" || step === "preview") && (
          <PreviewStep
            loadedFiles={loadedFiles}
            selection={selection}
            selectedCount={selectedCount}
            targetLabel={`${selectedProject?.projectCode ? `${selectedProject.projectCode} ` : ""}${selectedProject?.name ?? "Projekt"} / ${selectedBudget?.name ?? "Költségvetés"}`}
            versionLabel={versionName.trim()}
            parentLabel={selectedParent?.versionName ?? (existingVersions.length === 0 ? "Gyökér verzió" : "Nincs szülő")}
            dragOver={dragOver}
            parseError={parseError}
            fileInputRef={fileInputRef}
            expandedKeys={expandedKeys}
            showWarnings={showWarnings}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onFileInput={handleFileInput}
            onClickUpload={() => fileInputRef.current?.click()}
            onRemoveFile={removeFile}
            onUpdateRootSectionName={updateRootSectionName}
            onToggleMainCat={toggleMainCat}
            onToggleSubCat={toggleSubCat}
            onToggleItem={toggleItem}
            onToggleExpandKey={toggleExpandKey}
            onToggleWarnings={() => setShowWarnings((p) => !p)}
            onBackToTarget={() => setStep("target")}
            onContinue={handlePreviewContinue}
            loading={false}
          />
        )}

        {step === "importing" && (
          <div className="flex flex-col items-center justify-center p-12 gap-4">
            <Loader2 size={36} className="animate-spin text-[var(--indigo-500)]" />
            <p className="text-sm text-[var(--slate-600)]">Importálás folyamatban…</p>
            <p className="text-xs text-[var(--slate-400)]">
              {filteredResult?.totals.itemCount ?? 0} tétel és {mappedData?.sections.length ?? 0} szekció létrehozása
            </p>
          </div>
        )}

        {step === "done" && importedVersion && filteredResult && (
          <div className="flex flex-col items-center justify-center p-12 gap-4">
            <div className="w-14 h-14 rounded-full bg-[var(--emerald-100)] flex items-center justify-center">
              <CheckCircle2 size={28} className="text-[var(--emerald-600)]" />
            </div>
            <h3 className="text-base font-semibold text-[var(--slate-800)]">
              Importálás sikeres!
            </h3>
            <p className="text-sm text-[var(--slate-500)] text-center max-w-sm">
              A <strong>{importedVersion.versionName}</strong> verzió létrehozva{" "}
              {filteredResult.totals.itemCount} tétellel.
            </p>
            <div className="text-xs text-[var(--slate-400)] space-y-0.5 text-center">
              <div>Anyag: <strong className="text-[var(--slate-600)]">{fmt(filteredResult.totals.materialTotal)} Ft</strong></div>
              <div>Díj: <strong className="text-[var(--slate-600)]">{fmt(filteredResult.totals.feeTotal)} Ft</strong></div>
              <div>Összesen: <strong className="text-[var(--indigo-600)]">{fmt(filteredResult.totals.materialTotal + filteredResult.totals.feeTotal)} Ft</strong></div>
            </div>
            {hasImportIssues(importIssues) && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
                <AlertTriangle size={13} />
                Az import ellenőrzési hibái mentve lettek a verzióhoz.
              </div>
            )}
            <button
              onClick={() => onImported(
                importedVersion.id,
                importedVersion.versionName,
                importedVersion.versionType,
                importedVersion.partnerName,
                importedVersion.budgetId,
                selectedBudget?.name ?? null,
              )}
              className="mt-2 px-5 py-2 rounded-lg bg-[var(--indigo-600)] text-white text-sm font-medium hover:bg-[var(--indigo-700)] transition-colors cursor-pointer"
            >
              Verzió megnyitása
            </button>
          </div>
        )}

        {step === "error" && (
          <div className="flex flex-col items-center justify-center p-12 gap-4">
            <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
              <XCircle size={28} className="text-red-500" />
            </div>
            <h3 className="text-base font-semibold text-[var(--slate-800)]">
              Importálási hiba
            </h3>
            <p className="text-sm text-red-600 text-center max-w-sm">{importError}</p>
            <button
              onClick={() => setStep(loadedFiles.length > 0 ? "preview" : "target")}
              className="mt-2 px-4 py-2 rounded-lg border border-[var(--slate-200)] text-sm text-[var(--slate-700)] hover:bg-[var(--slate-50)] transition-colors cursor-pointer"
            >
              Vissza az importhoz
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Step Sub-components ----

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <span
      className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold transition-colors ${
        active
          ? "bg-[var(--indigo-600)] text-white"
          : done
          ? "bg-[var(--emerald-500)] text-white"
          : "bg-[var(--slate-200)] text-[var(--slate-500)]"
      }`}
    >
      {done && !active ? "✓" : label}
    </span>
  );
}

// ---- Checkbox helpers ----

/** Indeterminate checkbox icon */
function CheckboxIcon({ checked, indeterminate }: { checked: boolean; indeterminate: boolean }) {
  if (indeterminate) return <MinusSquare size={14} className="text-[var(--indigo-500)] shrink-0" />;
  if (checked) return <CheckSquare size={14} className="text-[var(--indigo-600)] shrink-0" />;
  return <Square size={14} className="text-[var(--slate-400)] shrink-0" />;
}

// ---- Drop Zone (reusable inside PreviewStep) ----

function DropZone({
  dragOver,
  fileInputRef,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileInput,
  onClickUpload,
  compact,
}: {
  dragOver: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClickUpload: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`border-2 border-dashed rounded-xl text-center transition-colors cursor-pointer ${
        compact ? "px-4 py-3" : "p-10"
      } ${
        dragOver
          ? "border-[var(--indigo-400)] bg-[var(--indigo-50)]"
          : "border-[var(--slate-200)] hover:border-[var(--slate-300)] bg-white"
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClickUpload}
    >
      <div className={`flex ${compact ? "flex-row items-center gap-2" : "flex-col items-center gap-2"}`}>
        <Upload
          size={compact ? 16 : 28}
          className={dragOver ? "text-[var(--indigo-500)]" : "text-[var(--slate-300)]"}
        />
        <div>
          <p className={`${compact ? "text-xs" : "text-sm"} text-[var(--slate-600)]`}>
            {dragOver ? "Engedd el a fájlokat" : compact ? "Újabb Excel hozzáadása" : "Húzd ide az Excel fájlokat"}
          </p>
          {!compact && <p className="text-xs text-[var(--slate-400)] mt-0.5">vagy kattints a tallózáshoz → .xls, .xlsx</p>}
        </div>
        {compact && <Plus size={14} className="text-[var(--indigo-500)] ml-auto" />}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xls,.xlsx"
        multiple
        className="hidden"
        onChange={onFileInput}
      />
    </div>
  );
}

// ---- PreviewStep — combined upload + selection ----

function PreviewStep({
  loadedFiles,
  selection,
  selectedCount,
  targetLabel,
  versionLabel,
  parentLabel,
  dragOver,
  parseError,
  fileInputRef,
  expandedKeys,
  showWarnings,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileInput,
  onClickUpload,
  onRemoveFile,
  onUpdateRootSectionName,
  onToggleMainCat,
  onToggleSubCat,
  onToggleItem,
  onToggleExpandKey,
  onToggleWarnings,
  onBackToTarget,
  onContinue,
  loading,
}: {
  loadedFiles: LoadedFile[];
  selection: SelectionState;
  selectedCount: number;
  targetLabel: string;
  versionLabel: string;
  parentLabel: string;
  dragOver: boolean;
  parseError: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  expandedKeys: Set<string>;
  showWarnings: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClickUpload: () => void;
  onRemoveFile: (id: string) => void;
  onUpdateRootSectionName: (id: string, name: string) => void;
  onToggleMainCat: (fileId: string, mainCat: string, checked: boolean) => void;
  onToggleSubCat: (fileId: string, mainCat: string, subCat: string, checked: boolean) => void;
  onToggleItem: (fileId: string, mainCat: string, subCat: string, seqNo: number, checked: boolean) => void;
  onToggleExpandKey: (key: string) => void;
  onToggleWarnings: () => void;
  onBackToTarget: () => void;
  onContinue: () => void;
  loading: boolean;
}) {
  const hasFiles = loadedFiles.length > 0;
  const selectedPreviewResult = useMemo(
    () => hasFiles ? buildFilteredResult(loadedFiles, selection) : null,
    [hasFiles, loadedFiles, selection],
  );
  const previewContentErrors = useMemo(
    () => selectedPreviewResult ? buildContentErrors(selectedPreviewResult.items) : [],
    [selectedPreviewResult],
  );
  const allReadErrors = selectedPreviewResult?.readErrors ?? [];
  const allFormulaErrors = selectedPreviewResult?.formulaErrors ?? [];
  const totalIssueCount = allReadErrors.length + allFormulaErrors.length + previewContentErrors.length;
  const allSkipped = loadedFiles.flatMap((f) => f.parseResult.skippedSheets);

  // Totals across all loaded (not filtered) files
  const totalItems = loadedFiles.reduce((s, f) => s + f.parseResult.totals.itemCount, 0);
  const totalMat = loadedFiles.reduce((s, f) => s + f.parseResult.totals.materialTotal, 0);
  const totalFee = loadedFiles.reduce((s, f) => s + f.parseResult.totals.feeTotal, 0);

  // Totals for selected (to-be-imported) items only
  const selectedTotals = useMemo(() => {
    let mat = 0;
    let fee = 0;
    for (const f of loadedFiles) {
      const fileSel = selection.get(f.id);
      if (!fileSel) continue;
      for (const [mainCat, mainVal] of fileSel) {
        if (!mainVal.selected) continue;
        for (const [, subVal] of mainVal.subCats) {
          if (!subVal.selected) continue;
          for (const [seqNo, checked] of subVal.items) {
            if (!checked) continue;
            const item = f.parseResult.items.find(
              (i) => i.sequenceNo === seqNo && i.mainCategory === mainCat
            );
            if (item) {
              mat += item.materialTotal;
              fee += item.feeTotal;
            }
          }
        }
      }
    }
    return { mat, fee };
  }, [loadedFiles, selection]);

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center gap-3 rounded-lg border border-[var(--slate-200)] bg-white px-3 py-2 text-xs">
        <FolderKanban size={14} className="text-[var(--indigo-500)] shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-[var(--slate-700)]">{targetLabel}</div>
          <div className="truncate text-[10px] text-[var(--slate-400)]">
            {versionLabel} · {parentLabel}
          </div>
        </div>
        <button
          onClick={onBackToTarget}
          className="px-2 py-1 rounded-[6px] text-[10px] text-[var(--slate-500)] hover:bg-[var(--slate-50)] hover:text-[var(--slate-800)] transition-colors cursor-pointer"
        >
          Módosítás
        </button>
      </div>

      {/* Empty state: large drop zone */}
      {!hasFiles && (
        <>
          <div className="text-center max-w-md mx-auto mb-2">
            <h3 className="text-base font-semibold text-[var(--slate-800)] mb-1">Excel fájlok feltöltése</h3>
            <p className="text-xs text-[var(--slate-500)]">
              Több fájlt is egyszerre feltölthetsz. Minden fájlhoz megadhatsz egy gyökér-kategória neve.
            </p>
          </div>
          <DropZone
            dragOver={dragOver}
            fileInputRef={fileInputRef}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onFileInput={onFileInput}
            onClickUpload={onClickUpload}
          />
          <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-[var(--blue-50)] border border-[var(--blue-200)]">
            <Info size={14} className="text-[var(--blue-500)] mt-0.5 shrink-0" />
            <div className="text-xs text-[var(--blue-700)] space-y-0.5">
              <p>A munkalapok fő kategóriákként, a munkalapon belüli csoportok alkategóriákként kerülnek be.</p>
              <p>Megadhatsz egy <strong>gyökér-kategória nevet</strong> — ilyenkor a fájl összes lapja ez alá kerül.</p>
            </div>
          </div>
        </>
      )}

      {/* Parse error */}
      {parseError && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200">
          <XCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700">{parseError}</p>
        </div>
      )}

      {/* File list with selection trees */}
      {hasFiles && (
        <>
          {/* Summary: Recognized vs Selected */}
          <div className="rounded-lg border border-[var(--slate-200)] overflow-hidden text-xs">
            <table className="w-full">
              <thead>
                <tr className="bg-[var(--slate-50)] border-b border-[var(--slate-200)]">
                  <th className="text-left px-3 py-2 font-medium text-[var(--slate-500)]"></th>
                  <th className="text-right px-3 py-2 font-medium text-[var(--slate-500)]">Tételek</th>
                  <th className="text-right px-3 py-2 font-medium text-[var(--slate-500)]">Anyag</th>
                  <th className="text-right px-3 py-2 font-medium text-[var(--slate-500)]">Díj</th>
                  <th className="text-right px-3 py-2 font-medium text-[var(--slate-500)]">Összesen</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[var(--slate-100)]">
                  <td className="px-3 py-2 font-medium text-[var(--slate-600)]">Felismert</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--slate-700)]">{fmt(totalItems)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--emerald-700)]">{fmt(totalMat)} Ft</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--amber-700)]">{fmt(totalFee)} Ft</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-[var(--slate-800)]">{fmt(totalMat + totalFee)} Ft</td>
                </tr>
                <tr className="bg-[var(--indigo-50)]">
                  <td className="px-3 py-2 font-medium text-[var(--indigo-700)]">Importálandó</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-[var(--indigo-700)]">{fmt(selectedCount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--emerald-700)]">{fmt(selectedTotals.mat)} Ft</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--amber-700)]">{fmt(selectedTotals.fee)} Ft</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold text-[var(--indigo-800)]">{fmt(selectedTotals.mat + selectedTotals.fee)} Ft</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Per-file sections */}
          <div className="space-y-3">
            {loadedFiles.map((f) => {
              const fileSel = selection.get(f.id);
              const fileExpanded = expandedKeys.has(`file:${f.id}`);
              const fileSelectedCount = fileSel
                ? Array.from(fileSel.values()).reduce((s, m) => {
                    if (!m.selected) return s;
                    return s + Array.from(m.subCats.values()).reduce((ss, sub) => {
                      if (!sub.selected) return ss;
                      return ss + Array.from(sub.items.values()).filter(Boolean).length;
                    }, 0);
                  }, 0)
                : 0;
              const fileAllSelected = fileSelectedCount === f.parseResult.totals.itemCount;
              const fileIndeterminate = fileSelectedCount > 0 && !fileAllSelected;

              return (
                <div key={f.id} className="border border-[var(--slate-200)] rounded-lg overflow-hidden">
                  {/* File header */}
                  <div className="flex items-center gap-2 px-3 py-2 bg-[var(--slate-50)] border-b border-[var(--slate-200)]">
                    <button
                      onClick={() => onToggleExpandKey(`file:${f.id}`)}
                      className="flex items-center gap-1.5 flex-1 min-w-0 cursor-pointer"
                    >
                      {fileExpanded ? <ChevronDown size={12} className="text-[var(--slate-400)] shrink-0" /> : <ChevronRight size={12} className="text-[var(--slate-400)] shrink-0" />}
                      <FileSpreadsheet size={13} className="text-[var(--emerald-600)] shrink-0" />
                      <span className="text-xs font-semibold text-[var(--slate-700)] truncate">{f.fileName}</span>
                      <span className="text-[10px] text-[var(--slate-400)] tabular-nums shrink-0">
                        {fileSelectedCount}/{f.parseResult.totals.itemCount} tétel
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        // toggle all items in this file
                        const newChecked = !(fileAllSelected);
                        if (fileSel) {
                          for (const mainCat of fileSel.keys()) {
                            onToggleMainCat(f.id, mainCat, newChecked);
                          }
                        }
                      }}
                      className="shrink-0 cursor-pointer"
                      title={fileAllSelected ? "összes kijelölés törlése" : "összes kijelölése"}
                    >
                      <CheckboxIcon checked={fileAllSelected} indeterminate={fileIndeterminate} />
                    </button>
                    <button
                      onClick={() => onRemoveFile(f.id)}
                      className="p-1 rounded hover:bg-red-50 text-[var(--slate-400)] hover:text-red-500 transition-colors cursor-pointer shrink-0"
                      title="Fájl eltávolítása"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>

                  {fileExpanded && (
                    <div className="divide-y divide-[var(--slate-100)]">
                      {/* Root section name override */}
                      <div className="px-3 py-2 flex items-center gap-2 bg-white">
                        <Pencil size={11} className="text-[var(--slate-400)] shrink-0" />
                        <label className="text-[10px] text-[var(--slate-500)] shrink-0">Gyökér-kategória neve:</label>
                        <input
                          type="text"
                          value={f.rootSectionName}
                          onChange={(e) => onUpdateRootSectionName(f.id, e.target.value)}
                          placeholder={`(alapértelmezett: lap neve)`}
                          className="flex-1 min-w-0 px-2 py-0.5 text-xs border border-[var(--slate-200)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--indigo-400)] bg-white text-[var(--slate-700)]"
                        />
                      </div>

                      {/* Main categories (sheets) */}
                      {fileSel && Array.from(fileSel.entries()).map(([mainCat, mainVal]) => {
                        const mainKey = `mc:${f.id}:${mainCat}`;
                        const mainExpanded = expandedKeys.has(mainKey);
                        const mainSelectedCount = Array.from(mainVal.subCats.values()).reduce((s, sub) => {
                          if (!sub.selected) return s;
                          return s + Array.from(sub.items.values()).filter(Boolean).length;
                        }, 0);
                        const mainTotalCount = Array.from(mainVal.subCats.values()).reduce((s, sub) => s + sub.items.size, 0);
                        const mainAllSelected = mainSelectedCount === mainTotalCount && mainTotalCount > 0;
                        const mainIndeterminate = mainSelectedCount > 0 && !mainAllSelected;

                        const sheetSummary = f.parseResult.sheetSummaries.find((s) => s.sheetName === mainCat);

                        return (
                          <div key={mainCat}>
                            {/* Main cat row */}
                            <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--slate-50)]">
                              <button
                                onClick={() => onToggleExpandKey(mainKey)}
                                className="flex items-center gap-1.5 flex-1 min-w-0 cursor-pointer"
                              >
                                {mainExpanded ? <ChevronDown size={11} className="text-[var(--slate-400)] shrink-0" /> : <ChevronRight size={11} className="text-[var(--slate-400)] shrink-0" />}
                                <Layers size={11} className="text-[var(--indigo-500)] shrink-0" />
                                <span className="text-xs font-medium text-[var(--slate-700)] flex-1 truncate">{mainCat}</span>
                                <span className="text-[10px] text-[var(--slate-400)] tabular-nums shrink-0">
                                  {mainSelectedCount}/{mainTotalCount}
                                </span>
                                {sheetSummary && (
                                  <span className="text-[10px] text-[var(--emerald-600)] tabular-nums font-medium shrink-0 ml-1">
                                    {fmt(sheetSummary.materialTotal + sheetSummary.feeTotal)} Ft
                                  </span>
                                )}
                              </button>
                              <button
                                onClick={() => onToggleMainCat(f.id, mainCat, !mainAllSelected)}
                                className="shrink-0 cursor-pointer"
                              >
                                <CheckboxIcon checked={mainAllSelected} indeterminate={mainIndeterminate} />
                              </button>
                            </div>

                            {/* Sub-categories */}
                            {mainExpanded && Array.from(mainVal.subCats.entries()).map(([subCat, subVal]) => {
                              const subKey = `sc:${f.id}:${mainCat}:${subCat}`;
                              const subExpanded = expandedKeys.has(subKey);
                              const subSelectedCount = Array.from(subVal.items.values()).filter(Boolean).length;
                              const subAllSelected = subSelectedCount === subVal.items.size && subVal.items.size > 0;
                              const subIndeterminate = subSelectedCount > 0 && !subAllSelected;
                              const subLabel = subCat === "__root__" ? "(alkategória nélkül)" : subCat;

                              // Items for this subCat
                              const subItems = f.parseResult.items.filter(
                                (i) => i.mainCategory === mainCat && (subCat === "__root__" ? !i.subCategory : i.subCategory === subCat)
                              );

                              return (
                                <div key={subCat} className="bg-[var(--slate-50)/50]">
                                  {/* Sub-cat row */}
                                  <div className="flex items-center gap-2 pl-8 pr-3 py-1 hover:bg-[var(--slate-100)/50]">
                                    <button
                                      onClick={() => onToggleExpandKey(subKey)}
                                      className="flex items-center gap-1.5 flex-1 min-w-0 cursor-pointer"
                                    >
                                      {subExpanded ? <ChevronDown size={10} className="text-[var(--slate-300)] shrink-0" /> : <ChevronRight size={10} className="text-[var(--slate-300)] shrink-0" />}
                                      <span className="text-[11px] text-[var(--slate-600)] flex-1 truncate italic">
                                        {subLabel}
                                      </span>
                                      <span className="text-[10px] text-[var(--slate-400)] tabular-nums shrink-0">
                                        {subSelectedCount}/{subVal.items.size}
                                      </span>
                                    </button>
                                    <button
                                      onClick={() => onToggleSubCat(f.id, mainCat, subCat, !subAllSelected)}
                                      className="shrink-0 cursor-pointer"
                                    >
                                      <CheckboxIcon checked={subAllSelected} indeterminate={subIndeterminate} />
                                    </button>
                                  </div>

                                  {/* Items */}
                                  {subExpanded && (
                                    <div className="max-h-48 overflow-auto">
                                      <table className="w-full min-w-[760px] text-[10px]">
                                        <thead className="bg-[var(--slate-100)] sticky top-0">
                                          <tr className="text-[var(--slate-400)]">
                                            <th className="pl-12 pr-2 py-1 text-left font-medium w-6"></th>
                                            <th className="px-2 py-1 text-left font-medium whitespace-nowrap">Tételszám</th>
                                            <th className="px-2 py-1 text-left font-medium">Megnevezés</th>
                                            <th className="px-2 py-1 text-right font-medium whitespace-nowrap">Menny.</th>
                                            <th className="px-2 py-1 text-left font-medium whitespace-nowrap">Egys.</th>
                                            <th className="px-2 py-1 text-right font-medium whitespace-nowrap">Anyag e.ár</th>
                                            <th className="px-2 py-1 text-right font-medium whitespace-nowrap">Díj e.ár</th>
                                            <th className="px-2 py-1 text-right font-medium whitespace-nowrap">Összesen</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {subItems.map((item) => {
                                            const checked = subVal.items.get(item.sequenceNo) ?? false;
                                            return (
                                              <tr
                                                key={item.sequenceNo}
                                                className={`border-t border-[var(--slate-100)] ${checked ? "" : "opacity-40"}`}
                                              >
                                                <td className="pl-12 pr-2 py-0.5">
                                                  <button
                                                    onClick={() => onToggleItem(f.id, mainCat, subCat, item.sequenceNo, !checked)}
                                                    className="cursor-pointer"
                                                  >
                                                    {checked
                                                      ? <CheckSquare size={12} className="text-[var(--indigo-600)]" />
                                                      : <Square size={12} className="text-[var(--slate-400)]" />
                                                    }
                                                  </button>
                                                </td>
                                                <td className="px-2 py-0.5 text-[var(--indigo-600)] font-mono">{item.itemNumber}</td>
                                                <td className="px-2 py-0.5 text-[var(--slate-700)] max-w-[180px] truncate" title={item.name}>{item.name}</td>
                                                <td className="px-2 py-0.5 text-right tabular-nums text-[var(--slate-600)]">{item.quantity}</td>
                                                <td className="px-2 py-0.5 text-[var(--slate-500)]">{item.unit}</td>
                                                <td className="px-2 py-0.5 text-right tabular-nums text-[var(--slate-600)]">{fmt(item.materialUnitPrice)}</td>
                                                <td className="px-2 py-0.5 text-right tabular-nums text-[var(--slate-600)]">{fmt(item.feeUnitPrice)}</td>
                                                <td className="px-2 py-0.5 text-right tabular-nums text-[var(--slate-600)]">{fmt(item.materialTotal + item.feeTotal)}</td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add more files */}
          <DropZone
            dragOver={dragOver}
            fileInputRef={fileInputRef}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onFileInput={onFileInput}
            onClickUpload={onClickUpload}
            compact
          />
        </>
      )}

      {/* Skipped sheets */}
      {allSkipped.length > 0 && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[var(--slate-50)] border border-[var(--slate-200)]">
          <Info size={12} className="text-[var(--slate-400)] mt-0.5 shrink-0" />
          <div className="text-[10px] text-[var(--slate-500)] space-y-0.5">
            <div className="font-medium">Kihagyott munkalapok:</div>
            {loadedFiles
              .filter((f) => f.parseResult.skippedSheets.length > 0)
              .map((f) => (
                <div key={f.id}>
                  <span className="font-medium text-[var(--slate-600)]">{f.fileName}:</span>{" "}
                  {f.parseResult.skippedSheets.join(", ")}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Validation issues */}
      {totalIssueCount > 0 && (
        <div className="border border-amber-200 rounded-lg overflow-hidden">
          <button
            onClick={onToggleWarnings}
            className="w-full flex items-center gap-2 px-3 py-2 bg-amber-50 hover:bg-amber-100 transition-colors cursor-pointer"
          >
            <AlertTriangle size={12} className="text-amber-500" />
            <span className="text-xs text-amber-700 font-medium flex-1 text-left">
              {totalIssueCount} import ellenőrzési hiba
            </span>
            {showWarnings ? <ChevronDown size={12} className="text-amber-400" /> : <ChevronRight size={12} className="text-amber-400" />}
          </button>
          {showWarnings && (
            <div className="max-h-72 overflow-y-auto border-t border-amber-200 bg-white">
              <IssueSection title="Excel beolvasási hibák" issues={allReadErrors} />
              <IssueSection title="Képlet hibák" issues={allFormulaErrors} />
              <IssueSection title="Tartalmi hibák" issues={previewContentErrors} />
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {hasFiles && (
        <div className="flex items-center justify-end pt-2 border-t border-[var(--slate-100)]">
          <button
            onClick={onContinue}
            disabled={loading || selectedCount === 0}
            className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[var(--indigo-600)] text-white text-xs font-medium hover:bg-[var(--indigo-700)] transition-colors disabled:opacity-50 cursor-pointer"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : null}
            Importálás indítása ({selectedCount} tétel)
          </button>
        </div>
      )}
    </div>
  );
}

function IssueSection({
  title,
  issues,
}: {
  title: string;
  issues: Array<ParseIssue | VersionImportIssue>;
}) {
  if (issues.length === 0) return null;

  return (
    <div className="border-b border-amber-100 last:border-b-0">
      <div className="px-3 py-1.5 bg-amber-50/60 text-[10px] font-semibold text-amber-800 sticky top-0">
        {title} <span className="font-normal text-amber-600">({issues.length})</span>
      </div>
      {issues.map((issue, index) => {
        const location = [
          issue.fileName,
          issue.sheet,
          issue.row ? `sor ${issue.row}` : null,
        ].filter(Boolean).join(" · ");
        const details = "details" in issue ? issue.details : undefined;

        if ("priceRows" in issue && issue.priceRows && issue.priceRows.length > 0) {
          const priceRows = issue.priceRows;
          return (
            <div key={`${title}-${index}`} className="px-3 py-3 border-t border-amber-100/70 bg-white">
              <div className="text-[10px] font-semibold uppercase tracking-[0.6px] text-amber-700">
                Különböző egységárakon szereplő tétel
              </div>
              <div className="mt-1 text-xs font-semibold text-[var(--slate-800)]">
                {issue.message}
              </div>
              {issue.description && (
                <div className="mt-1 text-[11px] text-[var(--slate-600)]">
                  {issue.description}
                </div>
              )}
              {issue.totalDifference && (
                <div className="mt-2 inline-flex rounded-[6px] bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-900">
                  Szumma plusz: {issue.totalDifference}
                </div>
              )}
              <div className="mt-2 overflow-x-auto rounded-[6px] border border-[var(--slate-200)]">
                <table className="w-full min-w-[760px] text-[11px]">
                  <thead className="bg-[var(--slate-50)] text-[var(--slate-500)]">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">Fájl</th>
                      <th className="px-2 py-1.5 text-left font-medium">Kategóriák</th>
                      <th className="px-2 py-1.5 text-right font-medium">Mennyiség</th>
                      <th className="px-2 py-1.5 text-right font-medium">Anyag egységár</th>
                      <th className="px-2 py-1.5 text-right font-medium">Díj egységár</th>
                      <th className="px-2 py-1.5 text-right font-medium">Különbség</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priceRows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="border-t border-[var(--slate-100)] text-[var(--slate-700)]">
                        <td className="px-2 py-1.5 align-top">
                          <div className="max-w-[210px] truncate" title={row.fileName}>{row.fileName ?? "-"}</div>
                          {row.source && <div className="mt-0.5 text-[10px] text-[var(--slate-400)]">{row.source}</div>}
                        </td>
                        <td className="px-2 py-1.5 align-top">
                          <div className="max-w-[260px] truncate" title={row.categoryPath}>{row.categoryPath}</div>
                        </td>
                        <td className="px-2 py-1.5 text-right align-top tabular-nums">{row.quantity}</td>
                        <td className="px-2 py-1.5 text-right align-top tabular-nums">{row.materialUnitPrice}</td>
                        <td className="px-2 py-1.5 text-right align-top tabular-nums">{row.feeUnitPrice}</td>
                        <td className="px-2 py-1.5 text-right align-top tabular-nums font-semibold text-amber-800">{row.difference}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }

        return (
          <div key={`${title}-${index}`} className="px-3 py-1.5 text-[10px] border-t border-amber-100/70 bg-white">
            {location && <div className="text-amber-600 font-mono mb-0.5">[{location}]</div>}
            <div className="text-amber-800">{issue.message}</div>
            {details && details.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-amber-700">
                {details.map((detail, detailIndex) => (
                  <li key={detailIndex}>{detail}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TargetStep({
  projects,
  budgets,
  versions,
  partners,
  selectedProjectId,
  selectedBudgetId,
  versionName,
  versionType,
  parentId,
  partnerId,
  loading,
  loadingBudgets,
  loadingVersions,
  error,
  onProjectIdChange,
  onBudgetIdChange,
  onVersionNameChange,
  onVersionTypeChange,
  onParentIdChange,
  onPartnerIdChange,
  onContinue,
}: {
  projects: ProjectOption[];
  budgets: BudgetOption[];
  versions: VersionInfo[];
  partners: { id: number; name: string }[];
  selectedProjectId: number | null;
  selectedBudgetId: number | null;
  versionName: string;
  versionType: VersionType;
  parentId: number | null;
  partnerId: number | null;
  loading: boolean;
  loadingBudgets: boolean;
  loadingVersions: boolean;
  error: string | null;
  onProjectIdChange: (value: number | null) => void;
  onBudgetIdChange: (value: number | null) => void;
  onVersionNameChange: (value: string) => void;
  onVersionTypeChange: (value: VersionType) => void;
  onParentIdChange: (value: number | null) => void;
  onPartnerIdChange: (value: number | null) => void;
  onContinue: () => void;
}) {
  const hasVersions = versions.length > 0;
  const canContinue = !loading && !loadingBudgets && !loadingVersions;

  return (
    <div className="p-5 space-y-5 max-w-3xl">
      <div>
        <h3 className="text-sm font-semibold text-[var(--slate-800)] mb-1">
          Import célja
        </h3>
        <p className="text-xs text-[var(--slate-500)]">
          A projekt, költségvetés és szülő verzió kiválasztása után az Excel ellenőrzések már ehhez a verziófához készülnek.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200">
          <XCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-1.5">
            Projekt *
          </label>
          <select
            value={selectedProjectId ?? ""}
            onChange={(event) => onProjectIdChange(event.target.value ? Number(event.target.value) : null)}
            disabled={loading}
            className="w-full h-9 px-3 text-sm border border-[var(--slate-200)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--indigo-500)] focus:border-transparent bg-white text-[var(--slate-800)] disabled:bg-[var(--slate-50)]"
          >
            <option value="">Válassz projektet…</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.projectCode ? `${project.projectCode} ` : ""}{project.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-1.5">
            Költségvetés *
          </label>
          <select
            value={selectedBudgetId ?? ""}
            onChange={(event) => onBudgetIdChange(event.target.value ? Number(event.target.value) : null)}
            disabled={loading || loadingBudgets || !selectedProjectId}
            className="w-full h-9 px-3 text-sm border border-[var(--slate-200)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--indigo-500)] focus:border-transparent bg-white text-[var(--slate-800)] disabled:bg-[var(--slate-50)]"
          >
            <option value="">{loadingBudgets ? "Költségvetések betöltése…" : "Válassz költségvetést…"}</option>
            {budgets.map((budget) => (
              <option key={budget.id} value={budget.id}>{budget.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-1.5">
          <GitBranch size={10} className="inline mr-1" />
          {hasVersions ? "Szülő verzió *" : "Szülő verzió"}
        </label>
        {!selectedBudgetId ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--slate-50)] border border-[var(--slate-200)] text-xs text-[var(--slate-500)]">
            <Info size={12} />
            Előbb válassz költségvetést.
          </div>
        ) : loadingVersions ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--slate-50)] border border-[var(--slate-200)] text-xs text-[var(--slate-500)]">
            <Loader2 size={12} className="animate-spin" />
            Verziók betöltése…
          </div>
        ) : !hasVersions ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--emerald-50)] border border-[var(--emerald-200)] text-xs text-[var(--emerald-700)]">
            <CheckCircle2 size={12} />
            Gyökér verzióként jön létre, mert még nincs meglévő verzió.
          </div>
        ) : (
          <select
            value={parentId ?? ""}
            onChange={(event) => onParentIdChange(event.target.value ? Number(event.target.value) : null)}
            className="w-full h-9 px-3 text-sm border border-[var(--slate-200)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--indigo-500)] focus:border-transparent bg-white text-[var(--slate-800)]"
          >
            <option value="">Válassz szülő verziót…</option>
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.versionName} ({version.versionType === "contracted" ? "Szerződött" : version.versionType === "unpriced" ? "Árazatlan" : "Ajánlati"})
                {version.partnerName ? ` - ${version.partnerName}` : ""}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-1.5">
            Verzió neve *
          </label>
          <input
            type="text"
            value={versionName}
            onChange={(event) => onVersionNameChange(event.target.value)}
            placeholder="pl. Importált ajánlat"
            className="w-full h-9 px-3 text-sm border border-[var(--slate-200)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--indigo-500)] focus:border-transparent bg-white text-[var(--slate-800)]"
          />
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-1.5">
            Partner (opcionális)
          </label>
          <select
            value={partnerId ?? ""}
            onChange={(event) => onPartnerIdChange(event.target.value ? Number(event.target.value) : null)}
            className="w-full h-9 px-3 text-sm border border-[var(--slate-200)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--indigo-500)] focus:border-transparent bg-white text-[var(--slate-800)]"
          >
            <option value="">Nincs partner</option>
            {partners.map((partner) => (
              <option key={partner.id} value={partner.id}>{partner.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-1.5">
          Verzió típusa
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onVersionTypeChange("offer")}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
              versionType === "offer"
                ? "bg-[var(--blue-100)] border-[var(--blue-300)] text-[var(--blue-700)]"
                : "bg-white border-[var(--slate-200)] text-[var(--slate-600)] hover:bg-[var(--slate-50)]"
            }`}
          >
            <FileText size={14} />
            Ajánlati
          </button>
          <button
            onClick={() => onVersionTypeChange("contracted")}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
              versionType === "contracted"
                ? "bg-[var(--amber-100)] border-[var(--amber-300)] text-[var(--amber-800)]"
                : "bg-white border-[var(--slate-200)] text-[var(--slate-600)] hover:bg-[var(--slate-50)]"
            }`}
          >
            <FileSignature size={14} />
            Szerződött
          </button>
          <button
            onClick={() => onVersionTypeChange("unpriced")}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
              versionType === "unpriced"
                ? "bg-[var(--slate-200)] border-[var(--slate-400)] text-[var(--slate-800)]"
                : "bg-white border-[var(--slate-200)] text-[var(--slate-600)] hover:bg-[var(--slate-50)]"
            }`}
          >
            <FileQuestion size={14} />
            Árazatlan
          </button>
        </div>
      </div>

      <div className="flex items-center justify-end pt-3 border-t border-[var(--slate-100)]">
        <button
          onClick={onContinue}
          disabled={!canContinue}
          className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-[var(--indigo-600)] text-white text-sm font-medium hover:bg-[var(--indigo-700)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
          Excel import folytatása
        </button>
      </div>
    </div>
  );
}

