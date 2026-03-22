"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Plus, Minus, RefreshCw } from "lucide-react";
import {
  compareVersions,
  type ComparisonResult,
  type ComparisonItem,
} from "@/server/actions/versions";

interface VersionComparisonProps {
  versionAId: number;
  versionBId: number;
  nameA: string;
  nameB: string;
  onBack: () => void;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 2 }).format(n);
}

const STATUS_LABELS: Record<
  ComparisonItem["status"],
  { label: string; cls: string; bg: string }
> = {
  added: { label: "Új", cls: "text-green-700", bg: "bg-green-50" },
  removed: { label: "Törölt", cls: "text-red-700", bg: "bg-red-50" },
  changed: { label: "Módosult", cls: "text-amber-700", bg: "bg-amber-50" },
  unchanged: { label: "Változatlan", cls: "text-[var(--slate-500)]", bg: "" },
};

export function VersionComparison({
  versionAId,
  versionBId,
  nameA,
  nameB,
  onBack,
}: VersionComparisonProps) {
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [showUnchanged, setShowUnchanged] = useState(false);

  useEffect(() => {
    setLoading(true);
    compareVersions(versionAId, versionBId).then((data) => {
      setResult(data);
      setLoading(false);
    });
  }, [versionAId, versionBId]);

  if (loading || !result) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-[var(--slate-400)]">
        Összehasonlítás betöltése…
      </div>
    );
  }

  const addedCount = result.items.filter((i) => i.status === "added").length;
  const removedCount = result.items.filter((i) => i.status === "removed").length;
  const changedCount = result.items.filter((i) => i.status === "changed").length;
  const unchangedCount = result.items.filter(
    (i) => i.status === "unchanged"
  ).length;
  const visibleItems = showUnchanged
    ? result.items
    : result.items.filter((i) => i.status !== "unchanged");

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-[10px] bg-white border-b border-[var(--slate-200)] shrink-0">
        <button
          onClick={onBack}
          className="p-1 text-[var(--slate-500)] hover:text-[var(--slate-800)] cursor-pointer"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="text-sm font-semibold text-[var(--slate-800)]">
          Összehasonlítás:{" "}
          <span className="text-[var(--indigo-600)]">{nameA}</span> ↔{" "}
          <span className="text-[var(--indigo-600)]">{nameB}</span>
        </span>
      </div>

      {/* Summary */}
      <div className="flex items-center gap-4 px-4 py-3 bg-white border-b border-[var(--slate-200)] shrink-0">
        <div className="flex items-center gap-1.5 text-xs">
          <Plus size={12} className="text-green-600" />
          <span className="text-green-700 font-medium">{addedCount} új</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <Minus size={12} className="text-red-600" />
          <span className="text-red-700 font-medium">
            {removedCount} törölt
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <RefreshCw size={12} className="text-amber-600" />
          <span className="text-amber-700 font-medium">
            {changedCount} módosult
          </span>
        </div>
        <span className="text-xs text-[var(--slate-400)]">
          {unchangedCount} változatlan
        </span>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-[var(--slate-500)] cursor-pointer">
          <input
            type="checkbox"
            checked={showUnchanged}
            onChange={(e) => setShowUnchanged(e.target.checked)}
            className="accent-[#6366f1]"
          />
          Változatlanok mutatása
        </label>
      </div>

      {/* Totals comparison */}
      <div className="grid grid-cols-2 gap-3 px-4 py-3 bg-white border-b border-[var(--slate-200)] shrink-0">
        <div className="p-2 bg-[var(--slate-50)] rounded-[6px]">
          <div className="text-[10px] text-[var(--slate-400)] font-semibold uppercase mb-1">
            {nameA}
          </div>
          <div className="text-xs text-[var(--slate-700)]">
            {result.totalA.count} tétel · Anyag:{" "}
            {fmt(result.totalA.materialTotal)} · Díj:{" "}
            {fmt(result.totalA.feeTotal)}
          </div>
        </div>
        <div className="p-2 bg-[var(--slate-50)] rounded-[6px]">
          <div className="text-[10px] text-[var(--slate-400)] font-semibold uppercase mb-1">
            {nameB}
          </div>
          <div className="text-xs text-[var(--slate-700)]">
            {result.totalB.count} tétel · Anyag:{" "}
            {fmt(result.totalB.materialTotal)} · Díj:{" "}
            {fmt(result.totalB.feeTotal)}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {visibleItems.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-[var(--slate-400)]">
            Nincs különbség a két verzió között
          </div>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-[var(--slate-50)] z-[1]">
              <tr>
                {[
                  "Státusz",
                  "Tételszám",
                  "Megnevezés",
                  "Menny.",
                  "Egység",
                  "Anyag egysár",
                  "Díj egysár",
                  "Anyag össz.",
                  "Díj össz.",
                  "Δ Anyag",
                  "Δ Díj",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => {
                const st = STATUS_LABELS[item.status];
                const displayItem = item.itemB ?? item.itemA;
                if (!displayItem) return null;
                const matTotal =
                  displayItem.quantity * displayItem.materialUnitPrice;
                const feeTotal =
                  displayItem.quantity * displayItem.feeUnitPrice;
                return (
                  <tr key={item.itemCode} className={st.bg}>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)]">
                      <span className={`text-[11px] font-medium ${st.cls}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] font-mono text-[11px]">
                      {displayItem.itemNumber || "—"}
                    </td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)]">
                      {displayItem.name}
                    </td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right">
                      {fmt(displayItem.quantity)}
                    </td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)]">
                      {displayItem.unit}
                    </td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right">
                      {fmt(displayItem.materialUnitPrice)}
                    </td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right">
                      {fmt(displayItem.feeUnitPrice)}
                    </td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right font-medium">
                      {fmt(matTotal)}
                    </td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right font-medium">
                      {fmt(feeTotal)}
                    </td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right">
                      {item.materialDelta != null &&
                        item.materialDelta !== 0 && (
                          <span
                            className={
                              item.materialDelta > 0
                                ? "text-green-600"
                                : "text-red-600"
                            }
                          >
                            {item.materialDelta > 0 ? "+" : ""}
                            {fmt(item.materialDelta)}
                          </span>
                        )}
                    </td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right">
                      {item.feeDelta != null && item.feeDelta !== 0 && (
                        <span
                          className={
                            item.feeDelta > 0
                              ? "text-green-600"
                              : "text-red-600"
                          }
                        >
                          {item.feeDelta > 0 ? "+" : ""}
                          {fmt(item.feeDelta)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center px-4 py-[10px] bg-white border-t border-[var(--slate-200)] shrink-0">
        <span className="text-xs text-[var(--slate-400)]">
          {visibleItems.length} tétel megjelenítve
        </span>
        <div className="flex-1" />
        <span className="text-xs text-[var(--slate-600)] mr-4">
          Δ Anyag:{" "}
          <strong
            className={
              result.totalB.materialTotal - result.totalA.materialTotal >= 0
                ? "text-green-600"
                : "text-red-600"
            }
          >
            {result.totalB.materialTotal - result.totalA.materialTotal >= 0
              ? "+"
              : ""}
            {fmt(result.totalB.materialTotal - result.totalA.materialTotal)}
          </strong>
        </span>
        <span className="text-xs text-[var(--slate-600)]">
          Δ Díj:{" "}
          <strong
            className={
              result.totalB.feeTotal - result.totalA.feeTotal >= 0
                ? "text-green-600"
                : "text-red-600"
            }
          >
            {result.totalB.feeTotal - result.totalA.feeTotal >= 0 ? "+" : ""}
            {fmt(result.totalB.feeTotal - result.totalA.feeTotal)}
          </strong>
        </span>
      </div>
    </div>
  );
}
