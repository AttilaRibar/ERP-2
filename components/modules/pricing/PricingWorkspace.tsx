"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeDollarSign,
  Calculator,
  CheckCircle2,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FolderKanban,
  Layers,
  Loader2,
  RefreshCw,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import {
  analyzePricingWorkbook,
  getPricingBudgetsForProject,
  getPricingProjects,
  getPricingVersionsForBudget,
} from "@/server/actions/pricing";
import { useProjectStore } from "@/stores/project-store";
import type {
  PricingAnalysisResult,
  PricingBudgetOption,
  PricingProjectOption,
  PricingVersionOption,
} from "@/types/pricing";

const VERSION_TYPE_LABEL: Record<string, string> = {
  offer: "Ajánlati",
  contracted: "Szerződött",
  unpriced: "Árazatlan",
};

function fmtMoney(value: number): string {
  return new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0 }).format(value);
}

function fmtNumber(value: number): string {
  return new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 2 }).format(value);
}

function outputName(fileName: string): string {
  const baseName = fileName.replace(/\.(xlsx|xlsm)$/i, "").trim();
  return `${baseName || "arazott_koltsegvetes"}_arazott.xlsx`;
}

function fileNameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return fallback;
    }
  }
  const plainMatch = header.match(/filename="?([^";]+)"?/);
  return plainMatch?.[1] ?? fallback;
}

function scoreClass(score: number): string {
  if (score >= 85) return "bg-green-100 text-green-800";
  if (score >= 72) return "bg-amber-100 text-amber-900";
  return "bg-red-50 text-red-600";
}

function SelectField({
  label,
  icon,
  value,
  onChange,
  disabled,
  placeholder,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  placeholder: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="flex items-center gap-1 text-[10px] text-[var(--slate-500)] font-semibold uppercase tracking-wider mb-1.5">
        {icon}
        {label}
      </label>
      <div className="relative">
        <select
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
          disabled={disabled}
          className="w-full h-8 appearance-none bg-[var(--slate-50)] border border-[var(--slate-200)] rounded-[6px] pl-2.5 pr-7 text-xs text-[var(--slate-700)] outline-none focus:border-[var(--indigo-600)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
        >
          <option value="">{placeholder}</option>
          {children}
        </select>
        <ChevronDown
          size={12}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--slate-400)] pointer-events-none"
        />
      </div>
    </div>
  );
}

function StatBox({ label, value, tone }: { label: string; value: string; tone?: "green" | "amber" | "red" | "indigo" }) {
  const toneClass =
    tone === "green"
      ? "text-green-700"
      : tone === "amber"
        ? "text-amber-700"
        : tone === "red"
          ? "text-red-600"
          : tone === "indigo"
            ? "text-[var(--indigo-600)]"
            : "text-[var(--slate-800)]";

  return (
    <div className="border border-[var(--slate-200)] bg-white rounded-[6px] px-3 py-2 min-w-0">
      <div className="text-[10px] text-[var(--slate-400)] font-semibold uppercase tracking-[0.6px] truncate">
        {label}
      </div>
      <div className={`text-base font-semibold tabular-nums truncate ${toneClass}`}>{value}</div>
    </div>
  );
}

export function PricingWorkspace() {
  const storeProjects = useProjectStore((state) => state.projects);
  const storeLoaded = useProjectStore((state) => state.loaded);
  const selectedGlobalProject = useProjectStore((state) => state.selectedProject);
  const setStoreProjects = useProjectStore((state) => state.setProjects);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [projectsList, setProjectsList] = useState<PricingProjectOption[]>(storeProjects);
  const [budgetsList, setBudgetsList] = useState<PricingBudgetOption[]>([]);
  const [versionsList, setVersionsList] = useState<PricingVersionOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(selectedGlobalProject?.id ?? null);
  const [selectedBudgetId, setSelectedBudgetId] = useState<number | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<PricingAnalysisResult | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(!storeLoaded);
  const [loadingBudgets, setLoadingBudgets] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProjectsList(storeProjects);
  }, [storeProjects]);

  useEffect(() => {
    setSelectedProjectId(selectedGlobalProject?.id ?? null);
  }, [selectedGlobalProject?.id]);

  useEffect(() => {
    if (storeLoaded) {
      setLoadingProjects(false);
      return;
    }

    let active = true;
    setLoadingProjects(true);
    getPricingProjects().then((result) => {
      if (!active) return;
      if (result.success) {
        setStoreProjects(result.data);
        setProjectsList(result.data);
      } else {
        setError(result.error);
      }
      setLoadingProjects(false);
    });

    return () => {
      active = false;
    };
  }, [setStoreProjects, storeLoaded]);

  useEffect(() => {
    setSelectedBudgetId(null);
    setSelectedVersionId(null);
    setBudgetsList([]);
    setVersionsList([]);
    setAnalysis(null);
    if (!selectedProjectId) return;

    let active = true;
    setLoadingBudgets(true);
    getPricingBudgetsForProject(selectedProjectId).then((result) => {
      if (!active) return;
      if (result.success) {
        setBudgetsList(result.data);
      } else {
        setError(result.error);
      }
      setLoadingBudgets(false);
    });

    return () => {
      active = false;
    };
  }, [selectedProjectId]);

  useEffect(() => {
    setSelectedVersionId(null);
    setVersionsList([]);
    setAnalysis(null);
    if (!selectedBudgetId) return;

    let active = true;
    setLoadingVersions(true);
    getPricingVersionsForBudget(selectedBudgetId).then((result) => {
      if (!active) return;
      if (result.success) {
        setVersionsList(result.data);
      } else {
        setError(result.error);
      }
      setLoadingVersions(false);
    });

    return () => {
      active = false;
    };
  }, [selectedBudgetId]);

  const selectedVersion = useMemo(
    () => versionsList.find((version) => version.id === selectedVersionId) ?? null,
    [selectedVersionId, versionsList],
  );

  const canAnalyze = Boolean(selectedProjectId && selectedBudgetId && selectedVersionId && file && !analyzing);
  const totals = analysis?.summary;

  const buildFormData = useCallback((): FormData | null => {
    if (!selectedProjectId || !selectedBudgetId || !selectedVersionId || !file) return null;
    const formData = new FormData();
    formData.append("projectId", String(selectedProjectId));
    formData.append("budgetId", String(selectedBudgetId));
    formData.append("versionId", String(selectedVersionId));
    formData.append("file", file);
    return formData;
  }, [file, selectedBudgetId, selectedProjectId, selectedVersionId]);

  const handleAnalyze = useCallback(async () => {
    const formData = buildFormData();
    if (!formData) return;
    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    const result = await analyzePricingWorkbook(formData);
    if (result.success) {
      setAnalysis(result.data);
    } else {
      setError(result.error);
    }
    setAnalyzing(false);
  }, [buildFormData]);

  const handleDownload = useCallback(async () => {
    const formData = buildFormData();
    if (!formData || !file) return;
    setDownloading(true);
    setError(null);

    try {
      const response = await fetch("/api/pricing/export", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof payload?.error === "string" ? payload.error : "Nem sikerült letölteni az árazott Excel fájlt");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileNameFromDisposition(response.headers.get("Content-Disposition"), outputName(file.name));
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Nem sikerült letölteni az árazott Excel fájlt");
    } finally {
      setDownloading(false);
    }
  }, [buildFormData, file]);

  const handleFileSelected = (selectedFile: File | null) => {
    setFile(selectedFile);
    setAnalysis(null);
    setError(null);
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden bg-[var(--background)]">
      <aside className="w-[246px] shrink-0 bg-white border-r border-[var(--slate-200)] flex flex-col overflow-y-auto">
        <div className="px-3 py-3 border-b border-[var(--slate-100)]">
          <div className="flex items-center gap-2">
            <BadgeDollarSign size={15} className="text-[var(--green-500)]" />
            <h2 className="text-xs font-semibold text-[var(--slate-500)] uppercase tracking-wider">
              Árazás
            </h2>
          </div>
        </div>

        <div className="flex flex-col gap-4 p-3">
          <SelectField
            label="Projekt"
            icon={<FolderKanban size={12} />}
            value={selectedProjectId}
            onChange={setSelectedProjectId}
            disabled={loadingProjects}
            placeholder={loadingProjects ? "Betöltés…" : "Projekt"}
          >
            {projectsList.map((project) => (
              <option key={project.id} value={project.id}>
                {project.projectCode ? `${project.projectCode} ` : ""}{project.name}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Költségvetés"
            icon={<Calculator size={12} />}
            value={selectedBudgetId}
            onChange={setSelectedBudgetId}
            disabled={!selectedProjectId || loadingBudgets}
            placeholder={loadingBudgets ? "Betöltés…" : "Költségvetés"}
          >
            {budgetsList.map((budget) => (
              <option key={budget.id} value={budget.id}>{budget.name}</option>
            ))}
          </SelectField>

          <SelectField
            label="Verzió"
            icon={<Layers size={12} />}
            value={selectedVersionId}
            onChange={setSelectedVersionId}
            disabled={!selectedBudgetId || loadingVersions}
            placeholder={loadingVersions ? "Betöltés…" : "Verzió"}
          >
            {versionsList.map((version) => (
              <option key={version.id} value={version.id}>
                {version.versionName}{version.partnerName ? ` — ${version.partnerName}` : ""}
              </option>
            ))}
          </SelectField>

          {selectedVersion && (
            <div className="rounded-[6px] border border-[var(--slate-200)] bg-[var(--slate-50)] px-2.5 py-2">
              <div className="text-[10px] text-[var(--slate-400)] uppercase tracking-[0.6px] font-semibold">
                Forrás verzió
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--slate-700)] min-w-0">
                <span className="truncate">{selectedVersion.versionName}</span>
                <span className="shrink-0 rounded-full bg-white border border-[var(--slate-200)] px-1.5 py-0.5 text-[9px] text-[var(--slate-500)]">
                  {VERSION_TYPE_LABEL[selectedVersion.versionType] ?? selectedVersion.versionType}
                </span>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center gap-1 text-[10px] text-[var(--slate-500)] font-semibold uppercase tracking-wider mb-1.5">
              <FileSpreadsheet size={12} />
              Excel
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xlsm"
              className="hidden"
              onChange={(event) => handleFileSelected(event.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full min-h-16 border border-dashed border-[var(--slate-300)] rounded-[6px] bg-[var(--slate-50)] hover:bg-white hover:border-[var(--indigo-300)] transition-colors flex flex-col items-center justify-center gap-1 px-3 py-2 text-center cursor-pointer"
            >
              <Upload size={16} className="text-[var(--slate-400)]" />
              <span className="text-xs text-[var(--slate-600)] max-w-full truncate">
                {file ? file.name : "Excel feltöltése"}
              </span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleAnalyze}
            disabled={!canAnalyze}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-[6px] text-xs font-medium bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] transition-colors disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
          >
            {analyzing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Beolvasás
          </button>

          {file && (
            <button
              type="button"
              onClick={() => handleFileSelected(null)}
              className="flex items-center justify-center gap-1 w-full py-[6px] rounded-[6px] text-xs text-[var(--slate-400)] hover:text-[var(--slate-700)] hover:bg-[var(--slate-100)] transition-colors"
            >
              <X size={11} />
              Fájl törlése
            </button>
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-[10px] bg-white border-b border-[var(--slate-200)] shrink-0">
          <BadgeDollarSign size={15} className="text-[var(--green-500)]" />
          <span className="text-sm font-semibold text-[var(--slate-800)]">Árazás</span>
          {totals && (
            <span className="text-xs text-[var(--slate-400)] truncate">
              {totals.sourceProjectCode ? `${totals.sourceProjectCode} ` : ""}{totals.sourceProjectName} / {totals.sourceBudgetName} / {totals.sourceVersionName}
            </span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleDownload}
            disabled={!analysis || !file || downloading}
            className="flex items-center gap-1.5 px-3 py-[6px] rounded-[6px] text-xs bg-[var(--green-500)] text-white hover:bg-green-600 transition-colors disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
          >
            {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            Letöltés
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border-b border-red-100 text-xs text-red-600">
            <XCircle size={14} />
            <span className="truncate">{error}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {analyzing ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-[var(--slate-500)]">
              <Loader2 size={32} className="animate-spin text-[var(--indigo-500)]" />
              <p className="text-sm">Beolvasás…</p>
            </div>
          ) : !analysis ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
              <FileSpreadsheet size={40} className="text-[var(--slate-300)]" />
              <p className="text-sm text-[var(--slate-400)]">Nincs beolvasott Excel.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
                <StatBox label="Tétel" value={String(analysis.summary.totalRows)} />
                <StatBox label="Találat" value={String(analysis.summary.matchedRows)} tone="green" />
                <StatBox label="Árazott" value={String(analysis.summary.pricedRows)} tone="indigo" />
                <StatBox label="Hiányzó" value={String(analysis.summary.unmatchedRows)} tone={analysis.summary.unmatchedRows > 0 ? "red" : undefined} />
                <StatBox label="Ellenőrizendő" value={String(analysis.summary.lowConfidenceRows)} tone={analysis.summary.lowConfidenceRows > 0 ? "amber" : undefined} />
                <StatBox label="Anyag" value={`${fmtMoney(analysis.summary.materialTotal)} Ft`} />
                <StatBox label="Díj" value={`${fmtMoney(analysis.summary.feeTotal)} Ft`} />
              </div>

              {analysis.warnings.length > 0 && (
                <div className="border border-amber-200 bg-amber-50 rounded-[6px] px-3 py-2 text-xs text-amber-900 flex items-start gap-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <div className="min-w-0 space-y-0.5">
                    {analysis.warnings.slice(0, 4).map((warning) => (
                      <div key={warning} className="truncate">{warning}</div>
                    ))}
                    {analysis.warnings.length > 4 && <div>+{analysis.warnings.length - 4} további jelzés</div>}
                  </div>
                </div>
              )}

              <div className="border border-[var(--slate-200)] rounded-[6px] overflow-hidden bg-white">
                <table className="w-full border-collapse text-[12px]">
                  <thead className="sticky top-0 bg-[var(--slate-50)] z-[1]">
                    <tr>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">Sor</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">Tételszám</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)]">Megnevezés</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">Menny.</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)]">Találat</th>
                      <th className="px-3 py-2 text-center text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">Pont</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">Anyag e.ár</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">Díj e.ár</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">Összesen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.rows.map((row) => {
                      const combinedTotal = row.materialTotal + row.feeTotal;
                      return (
                        <tr key={row.rowId} className="hover:bg-[var(--slate-50)] border-b border-[var(--slate-100)] last:border-b-0">
                          <td className="px-3 py-2 text-[var(--slate-500)] whitespace-nowrap">
                            <div className="font-mono text-[11px]">{row.rowNumber}</div>
                            <div className="text-[10px] max-w-[80px] truncate" title={row.sheetName}>{row.sheetName}</div>
                          </td>
                          <td className="px-3 py-2 text-[var(--indigo-600)] font-mono text-[11px] whitespace-nowrap">{row.itemNumber || "—"}</td>
                          <td className="px-3 py-2 min-w-[220px] max-w-[360px]">
                            <div className="font-medium text-[var(--slate-800)] truncate" title={row.name}>{row.name}</div>
                            <div className="text-[10px] text-[var(--slate-400)] truncate">{row.unit || "—"}</div>
                          </td>
                          <td className="px-3 py-2 text-right text-[var(--slate-600)] tabular-nums whitespace-nowrap">{fmtNumber(row.quantity)}</td>
                          <td className="px-3 py-2 min-w-[220px] max-w-[340px]">
                            {row.match ? (
                              <div className="flex items-start gap-1.5 min-w-0">
                                <CheckCircle2 size={13} className="text-green-600 shrink-0 mt-0.5" />
                                <div className="min-w-0">
                                  <div className="text-[var(--slate-700)] truncate" title={row.match.sourceName}>{row.match.sourceName}</div>
                                  <div className="text-[10px] text-[var(--slate-400)] truncate">
                                    {row.match.sourceItemNumber || "—"} / {row.match.reason}
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-red-500">
                                <XCircle size={13} />
                                <span>Nincs találat</span>
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center whitespace-nowrap">
                            {row.match ? (
                              <span className={`inline-flex items-center justify-center min-w-8 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${scoreClass(row.match.score)}`}>
                                {row.match.score}
                              </span>
                            ) : (
                              <span className="text-[var(--slate-300)]">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-[var(--slate-700)] whitespace-nowrap">
                            {row.match ? fmtMoney(row.match.materialUnitPrice) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-[var(--slate-700)] whitespace-nowrap">
                            {row.match ? fmtMoney(row.match.feeUnitPrice) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-[var(--slate-800)] whitespace-nowrap">
                            {row.match ? fmtMoney(combinedTotal) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {analysis.summary.totalRows > analysis.rows.length && (
                  <div className="px-3 py-2 bg-[var(--slate-50)] text-[11px] text-[var(--slate-400)] border-t border-[var(--slate-200)]">
                    {analysis.rows.length} / {analysis.summary.totalRows} sor megjelenítve
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}