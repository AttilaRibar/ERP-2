"use client";

import { useState, useCallback, useRef, useMemo } from "react";
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
} from "lucide-react";
import { parseExcelBuffer, type ExcelParseResult, type ParsedBudgetItem } from "@/lib/import/excel-parser";
import { mapParsedDataToBudget, type MappedBudgetData } from "@/lib/import/budget-mapper";
import { importVersionWithItems } from "@/server/actions/import";
import {
  getVersionsByBudgetId,
  getPartnersForVersionSelect,
  type VersionInfo,
  type VersionType,
} from "@/server/actions/versions";

function fmt(n: number): string {
  return new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0 }).format(n);
}

type ImportStep = "upload" | "preview" | "config" | "importing" | "done" | "error";

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
    for (const [mainCat, mainVal] of fileSel) {
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
function buildFilteredResult(files: LoadedFile[], sel: SelectionState): ExcelParseResult {
  const items: ParsedBudgetItem[] = [];
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

          items.push({ ...orig, sequenceNo: seqCounter, mainCategory: effectiveMain, subCategory: effectiveSub });
        }
      }
    }
  }

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
    warnings: files.flatMap((f) => f.parseResult.warnings),
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

interface ImportPanelProps {
  budgetId: number;
  onClose: () => void;
  onImported: (versionId: number, versionName: string, versionType: VersionType, partnerName: string | null) => void;
}

export function ImportPanel({ budgetId, onClose, onImported }: ImportPanelProps) {
  const [step, setStep] = useState<ImportStep>("upload");
  const [dragOver, setDragOver] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

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
  const [loadingConfig, setLoadingConfig] = useState(false);

  // Import state
  const [importError, setImportError] = useState<string | null>(null);
  const [importedVersion, setImportedVersion] = useState<VersionInfo | null>(null);
  const [filteredResult, setFilteredResult] = useState<ExcelParseResult | null>(null);
  const [mappedData, setMappedData] = useState<MappedBudgetData | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const goToConfig = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const [vers, parts] = await Promise.all([
        getVersionsByBudgetId(budgetId),
        getPartnersForVersionSelect(),
      ]);
      setExistingVersions(vers);
      setPartners(parts);
      if (vers.length === 0) setParentId(null);
      setStep("config");
    } finally {
      setLoadingConfig(false);
    }
  }, [budgetId]);

  const handleImport = useCallback(async () => {
    if (!mappedData || !versionName.trim()) return;

    setStep("importing");
    setImportError(null);

    try {
      const result = await importVersionWithItems({
        budgetId,
        parentId,
        versionName: versionName.trim(),
        versionType,
        partnerId,
        sections: mappedData.sections,
        items: mappedData.items,
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
  }, [mappedData, budgetId, parentId, versionName, versionType, partnerId]);

  // Build filtered result + mapped data when proceeding to config
  const handlePreviewContinue = useCallback(async () => {
    const filtered = buildFilteredResult(loadedFiles, selection);
    const mapped = mapParsedDataToBudget(filtered);
    setFilteredResult(filtered);
    setMappedData(mapped);
    await goToConfig();
  }, [loadedFiles, selection, goToConfig]);

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
        {step !== "upload" && step !== "done" && step !== "error" && (
          <div className="ml-auto flex items-center gap-1.5 text-[10px] text-[var(--slate-400)]">
            <StepDot active={step === "preview"} done={step === "config" || step === "importing"} label="1" />
            <span className="w-3 h-px bg-[var(--slate-200)]" />
            <StepDot active={step === "config"} done={step === "importing"} label="2" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {(step === "upload" || step === "preview") && (
          <PreviewStep
            loadedFiles={loadedFiles}
            selection={selection}
            selectedCount={selectedCount}
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
            onContinue={handlePreviewContinue}
            loading={loadingConfig}
          />
        )}

        {step === "config" && filteredResult && (
          <ConfigStep
            existingVersions={existingVersions}
            partners={partners}
            versionName={versionName}
            versionType={versionType}
            parentId={parentId}
            partnerId={partnerId}
            itemCount={filteredResult.totals.itemCount}
            onVersionNameChange={setVersionName}
            onVersionTypeChange={setVersionType}
            onParentIdChange={setParentId}
            onPartnerIdChange={setPartnerId}
            onBack={() => setStep("preview")}
            onImport={handleImport}
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
            <button
              onClick={() => onImported(importedVersion.id, importedVersion.versionName, importedVersion.versionType, importedVersion.partnerName)}
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
              onClick={() => setStep("config")}
              className="mt-2 px-4 py-2 rounded-lg border border-[var(--slate-200)] text-sm text-[var(--slate-700)] hover:bg-[var(--slate-50)] transition-colors cursor-pointer"
            >
              Vissza a beállításokhoz
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
  onContinue,
  loading,
}: {
  loadedFiles: LoadedFile[];
  selection: SelectionState;
  selectedCount: number;
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
  onContinue: () => void;
  loading: boolean;
}) {
  const hasFiles = loadedFiles.length > 0;
  const allWarnings = loadedFiles.flatMap((f) => f.parseResult.warnings);
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
                                    <div className="max-h-48 overflow-y-auto">
                                      <table className="w-full text-[10px]">
                                        <thead className="bg-[var(--slate-100)] sticky top-0">
                                          <tr className="text-[var(--slate-400)]">
                                            <th className="pl-12 pr-2 py-1 text-left font-medium w-6"></th>
                                            <th className="px-2 py-1 text-left font-medium">Tételszám</th>
                                            <th className="px-2 py-1 text-left font-medium">Megnevezés</th>
                                            <th className="px-2 py-1 text-right font-medium">Menny.</th>
                                            <th className="px-2 py-1 text-left font-medium">Egys.</th>
                                            <th className="px-2 py-1 text-right font-medium">összesen</th>
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
          <div className="text-[10px] text-[var(--slate-500)]">
            <span className="font-medium">Kihagyott munkalapok:</span>{" "}
            {allSkipped.join(", ")}
          </div>
        </div>
      )}

      {/* Warnings */}
      {allWarnings.length > 0 && (
        <div className="border border-amber-200 rounded-lg overflow-hidden">
          <button
            onClick={onToggleWarnings}
            className="w-full flex items-center gap-2 px-3 py-2 bg-amber-50 hover:bg-amber-100 transition-colors cursor-pointer"
          >
            <AlertTriangle size={12} className="text-amber-500" />
            <span className="text-xs text-amber-700 font-medium flex-1 text-left">
              {allWarnings.length} figyelmeztetés
            </span>
            {showWarnings ? <ChevronDown size={12} className="text-amber-400" /> : <ChevronRight size={12} className="text-amber-400" />}
          </button>
          {showWarnings && (
            <div className="max-h-40 overflow-y-auto border-t border-amber-200">
              {allWarnings.map((w, i) => (
                <div key={i} className="px-3 py-1.5 text-[10px] border-b border-amber-100 last:border-b-0">
                  <span className="text-amber-600 font-mono">[{w.sheet} sor {w.row}]</span>{" "}
                  <span className="text-amber-700">{w.message}</span>
                </div>
              ))}
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
            Tovább a beállításokhoz ({selectedCount} tétel)
          </button>
        </div>
      )}
    </div>
  );
}

function ConfigStep({
  existingVersions,
  partners,
  versionName,
  versionType,
  parentId,
  partnerId,
  itemCount,
  onVersionNameChange,
  onVersionTypeChange,
  onParentIdChange,
  onPartnerIdChange,
  onBack,
  onImport,
}: {
  existingVersions: VersionInfo[];
  partners: { id: number; name: string }[];
  versionName: string;
  versionType: VersionType;
  parentId: number | null;
  partnerId: number | null;
  itemCount: number;
  onVersionNameChange: (v: string) => void;
  onVersionTypeChange: (v: VersionType) => void;
  onParentIdChange: (v: number | null) => void;
  onPartnerIdChange: (v: number | null) => void;
  onBack: () => void;
  onImport: () => void;
}) {
  const hasVersions = existingVersions.length > 0;

  return (
    <div className="p-5 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-[var(--slate-800)] mb-1">
          Verzió beállításai
        </h3>
        <p className="text-xs text-[var(--slate-500)]">
          Add meg az importált verzió adatait, majd indítsd el az importálást.
        </p>
      </div>

      {/* Version name */}
      <div>
        <label className="block text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-1.5">
          Verzió neve *
        </label>
        <input
          type="text"
          value={versionName}
          onChange={(e) => onVersionNameChange(e.target.value)}
          placeholder="pl. Eredeti szerződött"
          className="w-full px-3 py-2 text-sm border border-[var(--slate-200)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--indigo-500)] focus:border-transparent bg-white text-[var(--slate-800)]"
        />
      </div>

      {/* Version type */}
      <div>
        <label className="block text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-1.5">
          Verzió típusa
        </label>
        <div className="flex gap-2">
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

      {/* Parent version */}
      <div>
        <label className="block text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-1.5">
          <GitBranch size={10} className="inline mr-1" />
          {hasVersions ? "Szülő verzió *" : "Szülő verzió"}
        </label>
        {!hasVersions ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--emerald-50)] border border-[var(--emerald-200)] text-xs text-[var(--emerald-700)]">
            <CheckCircle2 size={12} />
            Gyökér verzió — nincs meglévő verzió, ez lesz az első.
          </div>
        ) : (
          <select
            value={parentId ?? ""}
            onChange={(e) =>
              onParentIdChange(e.target.value ? Number(e.target.value) : null)
            }
            className="w-full px-3 py-2 text-sm border border-[var(--slate-200)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--indigo-500)] focus:border-transparent bg-white text-[var(--slate-800)]"
          >
            <option value="">Válassz szALlL� verziót…</option>
            {existingVersions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.versionName} ({v.versionType === "contracted" ? "Szerződött" : v.versionType === "unpriced" ? "Árazatlan" : "Ajánlati"})
                {v.partnerName ? ` — ${v.partnerName}` : ""}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Partner */}
      <div>
        <label className="block text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-1.5">
          Partner (opcionális)
        </label>
        <select
          value={partnerId ?? ""}
          onChange={(e) =>
            onPartnerIdChange(e.target.value ? Number(e.target.value) : null)
          }
          className="w-full px-3 py-2 text-sm border border-[var(--slate-200)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--indigo-500)] focus:border-transparent bg-white text-[var(--slate-800)]"
        >
          <option value="">Nincs partner</option>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Summary before import */}
      <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-[var(--slate-50)] border border-[var(--slate-200)]">
        <Info size={14} className="text-[var(--slate-400)] mt-0.5 shrink-0" />
        <div className="text-xs text-[var(--slate-600)] space-y-0.5">
          <p>Az importálás <strong>{itemCount} kijelA�lt tételt</strong> fog lA�trehozni az új verzióban.</p>
          {hasVersions && parentId && (
            <p>
              Szülő verzió:{" "}
              <strong>{existingVersions.find((v) => v.id === parentId)?.versionName}</strong>
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-3 border-t border-[var(--slate-100)]">
        <button
          onClick={onBack}
          className="px-4 py-2 text-xs text-[var(--slate-600)] hover:text-[var(--slate-800)] transition-colors cursor-pointer"
        >
          ← Vissza a kijelöléshez
        </button>
        <button
          onClick={onImport}
          disabled={!versionName.trim() || (hasVersions && !parentId)}
          className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-[var(--indigo-600)] text-white text-sm font-medium hover:bg-[var(--indigo-700)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Upload size={14} />
          Importálás
        </button>
      </div>
    </div>
  );
}
