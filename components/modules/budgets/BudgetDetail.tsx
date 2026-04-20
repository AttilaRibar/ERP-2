"use client";

import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Database, GitBranch, Pencil, Trash2, FileSpreadsheet, GitCompareArrows } from "lucide-react";
import { getBudgetById, deleteBudget } from "@/server/actions/budgets";
import { type VersionType } from "@/server/actions/versions";
import { type CompareType, type CompareState, type SimpleCompareState, type MultiCompareState } from "@/server/actions/comparisons";
import { useTabStore } from "@/stores/tab-store";
import { VersionGraph } from "./VersionGraph";
import { VersionComparison } from "./VersionComparison";
import { MultiVersionComparison } from "./MultiVersionComparison";
import { BudgetItemsPanel } from "./BudgetItemsPanel";
import { ImportPanel } from "./ImportPanel";
import { SavedComparisons } from "./SavedComparisons";

type DetailView =
  | { type: "data" }
  | { type: "versions" }
  | { type: "import" }
  | { type: "comparisons" }
  | { type: "version-items"; versionId: number; versionName: string; versionType: VersionType; partnerName: string | null }
  | { type: "comparison"; versionAId: number; versionBId: number; nameA: string; nameB: string; savedState?: SimpleCompareState }
  | { type: "multi-comparison"; versionIds: number[]; versionNames: string[]; savedState?: MultiCompareState };

interface BudgetDetailProps {
  budgetId: number;
  tabId: string;
}

type BudgetData = {
  id: number;
  name: string;
  projectId: number;
  projectName: string | null;
  projectCode: string | null;
  createdAt: Date | null;
};

export function BudgetDetail({ budgetId, tabId }: BudgetDetailProps) {
  const [view, setView] = useState<DetailView>({ type: "data" });
  const [budget, setBudget] = useState<BudgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const closeTab = useTabStore((s) => s.closeTab);
  const openTab = useTabStore((s) => s.openTab);

  useEffect(() => {
    setLoading(true);
    getBudgetById(budgetId).then((data) => {
      setBudget(data);
      setLoading(false);
    });
  }, [budgetId]);

  const goBack = () => {
    closeTab(tabId);
    openTab({ moduleKey: "budgets", title: "Költségvetések", color: "#f59e0b" });
  };

  const handleEdit = () => {
    openTab({
      moduleKey: "budgets-form",
      title: `Költségvetés szerkesztése #${budgetId}`,
      color: "#f59e0b",
      tabType: "edit",
      params: { budgetId },
    });
  };

  const handleDelete = async () => {
    if (!confirm("Biztosan törölni szeretné ezt a költségvetést?")) return;
    await deleteBudget(budgetId);
    goBack();
  };

  const handleOpenVersion = useCallback((versionId: number, versionName: string, versionType: VersionType = "offer", partnerName: string | null = null) => {
    setView({ type: "version-items", versionId, versionName, versionType, partnerName });
  }, []);

  const handleCompare = useCallback(
    (versionAId: number, versionBId: number, nameA: string, nameB: string) => {
      setView({ type: "comparison", versionAId, versionBId, nameA, nameB });
    },
    []
  );

  const handleMultiCompare = useCallback(
    (versionIds: number[], versionNames: string[]) => {
      setView({ type: "multi-comparison", versionIds, versionNames });
    },
    []
  );

  const handleBackToVersions = useCallback(() => {
    setView({ type: "versions" });
  }, []);

  const handleOpenComparisonInTab = useCallback(
    (_comparisonId: number, name: string, compareType: CompareType, versionIds: number[], versionNames: string[], state: CompareState) => {
      openTab({
        moduleKey: "budgets-comparison",
        title: name,
        color: "#f59e0b",
        tabType: "view",
        params: { budgetId, compareType, versionIds, versionNames, state },
      });
    },
    [budgetId, openTab]
  );

  const handleOpenSavedComparison = useCallback(
    (compareType: CompareType, versionIds: number[], versionNames: string[], state: CompareState) => {
      if (compareType === "simple" && versionIds.length === 2) {
        const simpleState = state as SimpleCompareState;
        setView({ type: "comparison", versionAId: versionIds[0], versionBId: versionIds[1], nameA: versionNames[0], nameB: versionNames[1], savedState: simpleState });
      } else {
        const multiState = state as MultiCompareState;
        setView({ type: "multi-comparison", versionIds, versionNames, savedState: multiState });
      }
    },
    []
  );

  const handleNewComparison = useCallback(() => {
    setView({ type: "versions" });
  }, []);

  const sidebarItems: { key: string; label: string; icon: typeof Database }[] = [
    { key: "data", label: "Adatok", icon: Database },
    { key: "versions", label: "Verziók", icon: GitBranch },
    { key: "comparisons", label: "Összehasonlítások", icon: GitCompareArrows },
    { key: "import", label: "Importálás", icon: FileSpreadsheet },
  ];

  const activeSidebarKey =
    view.type === "version-items" || view.type === "comparison" || view.type === "multi-comparison" ? "versions" : view.type;

  const handleImported = useCallback((versionId: number, versionName: string, versionType: VersionType, partnerName: string | null) => {
    setView({ type: "version-items", versionId, versionName, versionType, partnerName });
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-[var(--slate-400)]">
        Betöltés…
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0">
      {/* Sidebar */}
      <aside className="w-[180px] shrink-0 bg-white border-r border-[var(--slate-200)] flex flex-col overflow-y-auto">
        <div className="p-3 pb-2">
          <button
            onClick={goBack}
            className="flex items-center gap-1.5 text-xs text-[var(--slate-500)] hover:text-[var(--slate-800)] transition-colors mb-3 cursor-pointer"
          >
            <ArrowLeft size={12} />
            Vissza a listához
          </button>
          <div
            className="text-sm font-semibold text-[var(--slate-800)] truncate"
            title={budget?.name}
          >
            {budget?.name ?? "…"}
          </div>
          {budget?.projectCode && (
            <div className="text-[11px] text-[var(--slate-400)] mt-0.5">
              {budget.projectCode} — {budget.projectName}
            </div>
          )}
        </div>

        <div className="h-px bg-[var(--slate-100)] mx-3 my-1" />

        <nav className="flex flex-col gap-0.5 p-2">
          {sidebarItems.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setView({ type: key as "data" | "versions" | "import" | "comparisons" })}
              className={`flex items-center gap-2 px-3 py-[7px] rounded-[6px] text-xs transition-colors cursor-pointer ${
                activeSidebarKey === key
                  ? "bg-[var(--violet-100)] text-[var(--violet-900)] font-medium"
                  : "text-[var(--slate-600)] hover:bg-[var(--slate-100)] hover:text-[var(--slate-800)]"
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {view.type === "data" && budget && (
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-2xl mx-auto p-6">
              <h2 className="text-lg font-semibold text-[var(--slate-800)] mb-6">
                Költségvetés adatai
              </h2>

              <div className="space-y-4">
                <div>
                  <div className="text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-1">
                    Megnevezés
                  </div>
                  <div className="text-sm text-[var(--slate-800)]">{budget.name}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-1">
                    Projekt
                  </div>
                  <div className="text-sm text-[var(--slate-800)]">
                    {budget.projectCode ? (
                      <>
                        <span className="text-[var(--indigo-600)] font-mono text-xs">
                          {budget.projectCode}
                        </span>{" "}
                        — {budget.projectName}
                      </>
                    ) : (
                      "—"
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-1">
                    Létrehozva
                  </div>
                  <div className="text-sm text-[var(--slate-800)]">
                    {budget.createdAt
                      ? new Date(budget.createdAt).toLocaleDateString("hu-HU")
                      : "—"}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-8">
                <button
                  onClick={handleEdit}
                  className="flex items-center gap-[5px] px-4 py-2 rounded-[6px] text-sm bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] cursor-pointer transition-colors"
                >
                  <Pencil size={14} />
                  Szerkesztés
                </button>
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-[5px] px-4 py-2 rounded-[6px] text-sm border border-red-200 text-red-600 hover:bg-red-50 cursor-pointer transition-colors"
                >
                  <Trash2 size={14} />
                  Törlés
                </button>
              </div>
            </div>
          </div>
        )}

        {view.type === "versions" && (
          <VersionGraph
            budgetId={budgetId}
            onOpenVersion={handleOpenVersion}
            onCompare={handleCompare}
            onMultiCompare={handleMultiCompare}
          />
        )}

        {view.type === "version-items" && (
          <BudgetItemsPanel
            versionId={view.versionId}
            versionName={view.versionName}
            versionType={view.versionType}
            partnerName={view.partnerName}
            budgetId={budgetId}
            onBack={handleBackToVersions}
            onVersionCreated={handleOpenVersion}
          />
        )}

        {view.type === "comparison" && (
          <VersionComparison
            versionAId={view.versionAId}
            versionBId={view.versionBId}
            nameA={view.nameA}
            nameB={view.nameB}
            onBack={handleBackToVersions}
            budgetId={budgetId}
            initialState={view.savedState}
          />
        )}

        {view.type === "multi-comparison" && (
          <MultiVersionComparison
            versionIds={view.versionIds}
            versionNames={view.versionNames}
            onBack={handleBackToVersions}
            budgetId={budgetId}
            initialState={view.savedState}
          />
        )}

        {view.type === "comparisons" && (
          <SavedComparisons
            budgetId={budgetId}
            onOpenComparison={handleOpenSavedComparison}
            onOpenInTab={handleOpenComparisonInTab}
            onNewComparison={handleNewComparison}
          />
        )}

        {view.type === "import" && (
          <ImportPanel
            budgetId={budgetId}
            onClose={() => setView({ type: "versions" })}
            onImported={handleImported}
          />
        )}
      </div>
    </div>
  );
}
