"use client";

import { useState, useCallback, useRef } from "react";
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
  Hash,
  DollarSign,
  GitBranch,
  FileText,
  FileSignature,
  FileQuestion,
} from "lucide-react";
import { parseExcelBuffer, type ExcelParseResult, type ParseWarning } from "@/lib/import/excel-parser";
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

interface ImportPanelProps {
  budgetId: number;
  onClose: () => void;
  onImported: (versionId: number, versionName: string, versionType: VersionType, partnerName: string | null) => void;
}

export function ImportPanel({ budgetId, onClose, onImported }: ImportPanelProps) {
  const [step, setStep] = useState<ImportStep>("upload");
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState("");
  const [parseResult, setParseResult] = useState<ExcelParseResult | null>(null);
  const [mappedData, setMappedData] = useState<MappedBudgetData | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

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

  // Preview expansion state
  const [expandedSheets, setExpandedSheets] = useState<Set<string>>(new Set());
  const [showWarnings, setShowWarnings] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setParseError(null);

    try {
      const buffer = await file.arrayBuffer();
      const result = parseExcelBuffer(buffer);

      if (result.items.length === 0) {
        setParseError("Nem található importálható tétel az Excel fájlban.");
        return;
      }

      setParseResult(result);
      const mapped = mapParsedDataToBudget(result);
      setMappedData(mapped);
      setStep("preview");
    } catch (err) {
      setParseError(
        err instanceof Error
          ? `Hiba a fájl olvasásakor: ${err.message}`
          : "Ismeretlen hiba történt a fájl feldolgozásakor."
      );
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith(".xls") || file.name.endsWith(".xlsx"))) {
        handleFile(file);
      } else {
        setParseError("Kérlek .xls vagy .xlsx fájlt tölts fel.");
      }
    },
    [handleFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const goToConfig = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const [vers, parts] = await Promise.all([
        getVersionsByBudgetId(budgetId),
        getPartnersForVersionSelect(),
      ]);
      setExistingVersions(vers);
      setPartners(parts);
      if (vers.length === 0) {
        setParentId(null); // root
      }
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

  const toggleSheet = (name: string) => {
    setExpandedSheets((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

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
            <StepDot active={false} done={true} label="1" />
            <span className="w-3 h-px bg-[var(--slate-200)]" />
            <StepDot active={step === "preview"} done={step === "config" || step === "importing"} label="2" />
            <span className="w-3 h-px bg-[var(--slate-200)]" />
            <StepDot active={step === "config"} done={step === "importing"} label="3" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {step === "upload" && (
          <UploadStep
            dragOver={dragOver}
            parseError={parseError}
            fileName={fileName}
            fileInputRef={fileInputRef}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onFileInput={handleFileInput}
            onClickUpload={() => fileInputRef.current?.click()}
          />
        )}

        {step === "preview" && parseResult && (
          <PreviewStep
            result={parseResult}
            expandedSheets={expandedSheets}
            showWarnings={showWarnings}
            onToggleSheet={toggleSheet}
            onToggleWarnings={() => setShowWarnings((p) => !p)}
            onBack={() => { setStep("upload"); setParseResult(null); setMappedData(null); }}
            onContinue={goToConfig}
            loading={loadingConfig}
          />
        )}

        {step === "config" && (
          <ConfigStep
            existingVersions={existingVersions}
            partners={partners}
            versionName={versionName}
            versionType={versionType}
            parentId={parentId}
            partnerId={partnerId}
            itemCount={parseResult?.totals.itemCount ?? 0}
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
              {parseResult?.totals.itemCount ?? 0} tétel és {mappedData?.sections.length ?? 0} szekció létrehozása
            </p>
          </div>
        )}

        {step === "done" && importedVersion && (
          <div className="flex flex-col items-center justify-center p-12 gap-4">
            <div className="w-14 h-14 rounded-full bg-[var(--emerald-100)] flex items-center justify-center">
              <CheckCircle2 size={28} className="text-[var(--emerald-600)]" />
            </div>
            <h3 className="text-base font-semibold text-[var(--slate-800)]">
              Importálás sikeres!
            </h3>
            <p className="text-sm text-[var(--slate-500)] text-center max-w-sm">
              A <strong>{importedVersion.versionName}</strong> verzió létrehozva{" "}
              {parseResult?.totals.itemCount ?? 0} tétellel.
            </p>
            <div className="text-xs text-[var(--slate-400)] space-y-0.5 text-center">
              <div>Anyag: <strong className="text-[var(--slate-600)]">{fmt(parseResult?.totals.materialTotal ?? 0)} Ft</strong></div>
              <div>Díj: <strong className="text-[var(--slate-600)]">{fmt(parseResult?.totals.feeTotal ?? 0)} Ft</strong></div>
              <div>Összesen: <strong className="text-[var(--indigo-600)]">{fmt((parseResult?.totals.materialTotal ?? 0) + (parseResult?.totals.feeTotal ?? 0))} Ft</strong></div>
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

function UploadStep({
  dragOver,
  parseError,
  fileName,
  fileInputRef,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileInput,
  onClickUpload,
}: {
  dragOver: boolean;
  parseError: string | null;
  fileName: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClickUpload: () => void;
}) {
  return (
    <div className="p-6 flex flex-col items-center gap-6">
      <div className="text-center max-w-md">
        <h3 className="text-base font-semibold text-[var(--slate-800)] mb-1.5">
          Excel fájl feltöltése
        </h3>
        <p className="text-xs text-[var(--slate-500)]">
          Húzd ide az Excel fájlt, vagy kattints a tallózáshoz. Támogatott formátumok: .xls, .xlsx
        </p>
      </div>

      <div
        className={`w-full max-w-lg border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer ${
          dragOver
            ? "border-[var(--indigo-400)] bg-[var(--indigo-50)]"
            : "border-[var(--slate-200)] hover:border-[var(--slate-300)] bg-white"
        }`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={onClickUpload}
      >
        <Upload
          size={36}
          className={`mx-auto mb-3 ${
            dragOver ? "text-[var(--indigo-500)]" : "text-[var(--slate-300)]"
          }`}
        />
        <p className="text-sm text-[var(--slate-600)] mb-1">
          {dragOver ? "Engedd el a fájlt" : "Húzd ide az Excel fájlt"}
        </p>
        <p className="text-xs text-[var(--slate-400)]">vagy kattints a tallózáshoz</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xls,.xlsx"
          className="hidden"
          onChange={onFileInput}
        />
      </div>

      {parseError && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 max-w-lg w-full">
          <XCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-red-700">{parseError}</p>
            {fileName && (
              <p className="text-xs text-red-500 mt-0.5">Fájl: {fileName}</p>
            )}
          </div>
        </div>
      )}

      <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-[var(--blue-50)] border border-[var(--blue-200)] max-w-lg w-full">
        <Info size={14} className="text-[var(--blue-500)] mt-0.5 shrink-0" />
        <div className="text-xs text-[var(--blue-700)] space-y-0.5">
          <p>A rendszer automatikusan felismeri az Excel fájl struktúráját.</p>
          <p>A munkalapok fő kategóriákként, a munkalapon belüli csoportok alkategóriákként jelennek meg.</p>
        </div>
      </div>
    </div>
  );
}

function PreviewStep({
  result,
  expandedSheets,
  showWarnings,
  onToggleSheet,
  onToggleWarnings,
  onBack,
  onContinue,
  loading,
}: {
  result: ExcelParseResult;
  expandedSheets: Set<string>;
  showWarnings: boolean;
  onToggleSheet: (name: string) => void;
  onToggleWarnings: () => void;
  onBack: () => void;
  onContinue: () => void;
  loading: boolean;
}) {
  return (
    <div className="p-5 space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard
          icon={<Hash size={14} />}
          label="Tételek"
          value={String(result.totals.itemCount)}
          color="indigo"
        />
        <SummaryCard
          icon={<DollarSign size={14} />}
          label="Anyag összesen"
          value={`${fmt(result.totals.materialTotal)} Ft`}
          color="emerald"
        />
        <SummaryCard
          icon={<DollarSign size={14} />}
          label="Díj összesen"
          value={`${fmt(result.totals.feeTotal)} Ft`}
          color="amber"
        />
      </div>

      {/* Grand total */}
      <div className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-[var(--indigo-50)] border border-[var(--indigo-200)]">
        <span className="text-xs font-medium text-[var(--indigo-700)]">Végösszeg</span>
        <span className="text-sm font-bold text-[var(--indigo-800)]">
          {fmt(result.totals.materialTotal + result.totals.feeTotal)} Ft
        </span>
      </div>

      {/* Per-sheet breakdown */}
      <div>
        <h4 className="text-xs font-semibold text-[var(--slate-500)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Layers size={12} />
          Fejezetek ({result.sheetSummaries.length})
        </h4>
        <div className="space-y-1">
          {result.sheetSummaries.map((sheet) => {
            const expanded = expandedSheets.has(sheet.sheetName);
            const sheetItems = result.items.filter((i) => i.mainCategory === sheet.sheetName);
            return (
              <div key={sheet.sheetName} className="border border-[var(--slate-200)] rounded-lg overflow-hidden">
                <button
                  onClick={() => onToggleSheet(sheet.sheetName)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--slate-50)] transition-colors cursor-pointer"
                >
                  {expanded ? (
                    <ChevronDown size={12} className="text-[var(--slate-400)]" />
                  ) : (
                    <ChevronRight size={12} className="text-[var(--slate-400)]" />
                  )}
                  <span className="text-xs font-medium text-[var(--slate-700)] flex-1 truncate">
                    {sheet.sheetName}
                  </span>
                  <span className="text-[10px] text-[var(--slate-400)] tabular-nums">
                    {sheet.itemCount} tétel
                  </span>
                  <span className="text-[10px] text-[var(--emerald-600)] tabular-nums font-medium">
                    {fmt(sheet.materialTotal + sheet.feeTotal)} Ft
                  </span>
                </button>
                {expanded && (
                  <div className="border-t border-[var(--slate-100)]">
                    {/* Sub categories */}
                    {sheet.subCategories.length > 0 && (
                      <div className="px-3 py-1.5 bg-[var(--slate-50)]">
                        <p className="text-[10px] text-[var(--slate-400)] mb-1">Alkategóriák:</p>
                        <div className="flex flex-wrap gap-1">
                          {sheet.subCategories.map((sub) => (
                            <span
                              key={sub}
                              className="px-2 py-0.5 rounded bg-[var(--slate-200)] text-[10px] text-[var(--slate-600)]"
                            >
                              {sub}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Items table */}
                    <div className="max-h-64 overflow-y-auto">
                      <table className="w-full text-[10px]">
                        <thead className="bg-[var(--slate-50)] sticky top-0">
                          <tr className="text-[var(--slate-400)]">
                            <th className="px-2 py-1 text-left font-medium">Ssz.</th>
                            <th className="px-2 py-1 text-left font-medium">Tételszám</th>
                            <th className="px-2 py-1 text-left font-medium max-w-[200px]">Megnevezés</th>
                            <th className="px-2 py-1 text-right font-medium">Menny.</th>
                            <th className="px-2 py-1 text-left font-medium">Egys.</th>
                            <th className="px-2 py-1 text-right font-medium">Anyag</th>
                            <th className="px-2 py-1 text-right font-medium">Díj</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sheetItems.map((item, i) => (
                            <tr key={i} className="border-t border-[var(--slate-100)] hover:bg-[var(--slate-50)]">
                              <td className="px-2 py-1 text-[var(--slate-500)] tabular-nums">{item.sequenceNo}</td>
                              <td className="px-2 py-1 text-[var(--indigo-600)] font-mono">{item.itemNumber}</td>
                              <td className="px-2 py-1 text-[var(--slate-700)] max-w-[200px] truncate" title={item.name}>
                                {item.name}
                              </td>
                              <td className="px-2 py-1 text-right tabular-nums text-[var(--slate-600)]">{item.quantity}</td>
                              <td className="px-2 py-1 text-[var(--slate-500)]">{item.unit}</td>
                              <td className="px-2 py-1 text-right tabular-nums text-[var(--slate-600)]">{fmt(item.materialTotal)}</td>
                              <td className="px-2 py-1 text-right tabular-nums text-[var(--slate-600)]">{fmt(item.feeTotal)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-[var(--slate-50)] font-medium">
                          <tr className="text-[var(--slate-700)]">
                            <td colSpan={5} className="px-2 py-1 text-right">Fejezet összesen:</td>
                            <td className="px-2 py-1 text-right tabular-nums">{fmt(sheet.materialTotal)}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{fmt(sheet.feeTotal)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Skipped sheets */}
      {result.skippedSheets.length > 0 && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[var(--slate-50)] border border-[var(--slate-200)]">
          <Info size={12} className="text-[var(--slate-400)] mt-0.5 shrink-0" />
          <div className="text-[10px] text-[var(--slate-500)]">
            <span className="font-medium">Kihagyott munkalapok:</span>{" "}
            {result.skippedSheets.join(", ")}
          </div>
        </div>
      )}

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="border border-amber-200 rounded-lg overflow-hidden">
          <button
            onClick={onToggleWarnings}
            className="w-full flex items-center gap-2 px-3 py-2 bg-amber-50 hover:bg-amber-100 transition-colors cursor-pointer"
          >
            <AlertTriangle size={12} className="text-amber-500" />
            <span className="text-xs text-amber-700 font-medium flex-1 text-left">
              {result.warnings.length} figyelmeztetés
            </span>
            {showWarnings ? (
              <ChevronDown size={12} className="text-amber-400" />
            ) : (
              <ChevronRight size={12} className="text-amber-400" />
            )}
          </button>
          {showWarnings && (
            <div className="max-h-40 overflow-y-auto border-t border-amber-200">
              {result.warnings.map((w, i) => (
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
      <div className="flex items-center justify-between pt-2 border-t border-[var(--slate-100)]">
        <button
          onClick={onBack}
          className="px-4 py-2 text-xs text-[var(--slate-600)] hover:text-[var(--slate-800)] transition-colors cursor-pointer"
        >
          ← Vissza
        </button>
        <button
          onClick={onContinue}
          disabled={loading}
          className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[var(--indigo-600)] text-white text-xs font-medium hover:bg-[var(--indigo-700)] transition-colors disabled:opacity-50 cursor-pointer"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : null}
          Tovább a beállításokhoz
        </button>
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: "indigo" | "emerald" | "amber";
}) {
  const colorClasses = {
    indigo: "bg-[var(--indigo-50)] border-[var(--indigo-200)] text-[var(--indigo-700)]",
    emerald: "bg-[var(--emerald-50)] border-[var(--emerald-200)] text-[var(--emerald-700)]",
    amber: "bg-[var(--amber-50)] border-[var(--amber-200)] text-[var(--amber-700)]",
  };

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${colorClasses[color]}`}>
      <div className="flex items-center gap-1.5 text-[10px] opacity-80 mb-1">
        {icon}
        {label}
      </div>
      <div className="text-sm font-bold tabular-nums">{value}</div>
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
            <option value="">Válassz szülő verziót…</option>
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
          <p>Az importálás <strong>{itemCount} tételt</strong> fog létrehozni az új verzióban.</p>
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
          ← Vissza az előnézethez
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
