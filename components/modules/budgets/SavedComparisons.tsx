"use client";

import { useState, useEffect, useCallback } from "react";
import { GitCompareArrows, Trash2, Pencil, Check, X, ExternalLink, Plus, ArrowLeftRight, Layers } from "lucide-react";
import {
  getSavedComparisons,
  deleteSavedComparison,
  renameSavedComparison,
  type SavedComparison,
  type CompareType,
  type CompareState,
} from "@/server/actions/comparisons";

interface SavedComparisonsProps {
  budgetId: number;
  onOpenComparison: (compareType: CompareType, versionIds: number[], versionNames: string[], state: CompareState) => void;
  onOpenInTab: (comparisonId: number, name: string, compareType: CompareType, versionIds: number[], versionNames: string[], state: CompareState) => void;
  onNewComparison: () => void;
}

export function SavedComparisons({
  budgetId,
  onOpenComparison,
  onOpenInTab,
  onNewComparison,
}: SavedComparisonsProps) {
  const [comparisons, setComparisons] = useState<SavedComparison[]>([]);
  const [loading, setLoading] = useState(true);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getSavedComparisons(budgetId);
    setComparisons(data);
    setLoading(false);
  }, [budgetId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (id: number) => {
    if (!confirm("Biztosan törölni szeretné ezt az összehasonlítást?")) return;
    await deleteSavedComparison(id);
    await load();
  };

  const handleRename = async (id: number) => {
    if (!renameValue.trim()) return;
    await renameSavedComparison(id, renameValue.trim());
    setRenamingId(null);
    await load();
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-[var(--slate-400)]">
        Betöltés…
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-[10px] bg-white border-b border-[var(--slate-200)] shrink-0">
        <GitCompareArrows size={14} className="text-[var(--slate-500)]" />
        <span className="text-sm font-semibold text-[var(--slate-800)]">
          Mentett összehasonlítások
        </span>
        <div className="flex-1" />
        <button
          onClick={onNewComparison}
          className="flex items-center gap-1.5 px-3 py-[5px] rounded-[6px] text-xs bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] cursor-pointer transition-colors"
        >
          <Plus size={12} />
          Új összehasonlítás
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4">
        {comparisons.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <GitCompareArrows size={32} className="text-[var(--slate-300)] mb-3" />
            <p className="text-sm text-[var(--slate-500)] mb-1">
              Még nincsenek mentett összehasonlítások
            </p>
            <p className="text-xs text-[var(--slate-400)] mb-4 max-w-xs">
              A Verziók nézetben válasszon ki verziókat összehasonlításra, majd mentse el a későbbi használathoz.
            </p>
            <button
              onClick={onNewComparison}
              className="flex items-center gap-1.5 px-3 py-[5px] rounded-[6px] text-xs bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] cursor-pointer transition-colors"
            >
              <Plus size={12} />
              Új összehasonlítás
            </button>
          </div>
        ) : (
          <div className="space-y-2 max-w-2xl">
            {comparisons.map((c) => (
              <div
                key={c.id}
                className="border border-[var(--slate-200)] rounded-lg p-3 bg-white hover:border-[var(--indigo-200)] transition-colors group"
              >
                <div className="flex items-start gap-3">
                  <GitCompareArrows size={16} className="text-[var(--indigo-500)] mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    {renamingId === c.id ? (
                      <div className="flex items-center gap-1.5 mb-1">
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(c.id);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          className="text-sm font-medium text-[var(--slate-800)] border border-[var(--indigo-300)] rounded px-1.5 py-0.5 flex-1"
                        />
                        <button
                          onClick={() => handleRename(c.id)}
                          className="p-1 rounded hover:bg-[var(--emerald-50)] text-[var(--emerald-600)] cursor-pointer"
                        >
                          <Check size={12} />
                        </button>
                        <button
                          onClick={() => setRenamingId(null)}
                          className="p-1 rounded hover:bg-[var(--slate-100)] text-[var(--slate-400)] cursor-pointer"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <div className="text-sm font-medium text-[var(--slate-800)] mb-1 flex items-center gap-2">
                        {c.name}
                        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide ${
                          c.compareType === "simple"
                            ? "bg-[var(--blue-50)] text-[var(--blue-700)]"
                            : "bg-[var(--indigo-50)] text-[var(--indigo-700)]"
                        }`}>
                          {c.compareType === "simple" ? <><ArrowLeftRight size={8} /> Egyszerű</> : <><Layers size={8} /> Többes</>}
                        </span>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-1 mb-2">
                      {c.versionNames.map((name, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--slate-100)] text-[var(--slate-600)]"
                        >
                          {name}
                        </span>
                      ))}
                    </div>

                    <div className="text-[10px] text-[var(--slate-400)]">
                      {c.createdAt
                        ? new Date(c.createdAt).toLocaleDateString("hu-HU", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => onOpenComparison(c.compareType, c.versionIds, c.versionNames, c.state)}
                      title="Megnyitás itt"
                      className="p-1.5 rounded hover:bg-[var(--indigo-50)] text-[var(--indigo-500)] cursor-pointer transition-colors"
                    >
                      <GitCompareArrows size={14} />
                    </button>
                    <button
                      onClick={() => onOpenInTab(c.id, c.name, c.compareType, c.versionIds, c.versionNames, c.state)}
                      title="Megnyitás új lapon"
                      className="p-1.5 rounded hover:bg-[var(--indigo-50)] text-[var(--indigo-500)] cursor-pointer transition-colors"
                    >
                      <ExternalLink size={14} />
                    </button>
                    <button
                      onClick={() => {
                        setRenamingId(c.id);
                        setRenameValue(c.name);
                      }}
                      title="Átnevezés"
                      className="p-1.5 rounded hover:bg-[var(--slate-100)] text-[var(--slate-400)] cursor-pointer transition-colors"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => handleDelete(c.id)}
                      title="Törlés"
                      className="p-1.5 rounded hover:bg-red-50 text-red-400 cursor-pointer transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
