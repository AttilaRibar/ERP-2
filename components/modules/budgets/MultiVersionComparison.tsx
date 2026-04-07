"use client";

import { useState, useEffect, useMemo } from "react";
import { ArrowLeft, Trophy, ChevronDown, ChevronRight, BarChart3, Layers, AlertTriangle, ArrowUpDown, MessageSquare, EyeOff } from "lucide-react";
import {
  compareMultipleVersions,
  type MultiComparisonResult,
  type MultiVersionEntry,
  type MultiVersionItemEntry,
  type SectionTotals,
} from "@/server/actions/versions";

interface MultiVersionComparisonProps {
  versionIds: number[];
  versionNames: string[];
  onBack: () => void;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0 }).format(n);
}

function fmtDetailed(n: number): string {
  return new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 2 }).format(n);
}

type ViewMode = "overview" | "sections" | "variance";

// Color palette for version columns
const VERSION_COLORS = [
  { bg: "bg-blue-50", border: "border-blue-200", header: "bg-blue-100", text: "text-blue-800", ring: "ring-blue-300" },
  { bg: "bg-amber-50", border: "border-amber-200", header: "bg-amber-100", text: "text-amber-800", ring: "ring-amber-300" },
  { bg: "bg-emerald-50", border: "border-emerald-200", header: "bg-emerald-100", text: "text-emerald-800", ring: "ring-emerald-300" },
  { bg: "bg-purple-50", border: "border-purple-200", header: "bg-purple-100", text: "text-purple-800", ring: "ring-purple-300" },
  { bg: "bg-rose-50", border: "border-rose-200", header: "bg-rose-100", text: "text-rose-800", ring: "ring-rose-300" },
  { bg: "bg-cyan-50", border: "border-cyan-200", header: "bg-cyan-100", text: "text-cyan-800", ring: "ring-cyan-300" },
];

function getColor(idx: number) {
  return VERSION_COLORS[idx % VERSION_COLORS.length];
}

// Find which version index has the minimum value (cheapest)
// When skipZero=true, 0 values are excluded from the comparison
function findCheapestIdx(values: number[], skipZero = false): number {
  let minIdx = -1;
  for (let i = 0; i < values.length; i++) {
    if (skipZero && values[i] === 0) continue;
    if (minIdx === -1 || values[i] < values[minIdx]) minIdx = i;
  }
  return minIdx === -1 ? 0 : minIdx;
}

// ---- Overview Cards ----

function OverviewView({ result, skipZero }: { result: MultiComparisonResult; skipZero: boolean }) {
  const versions = result.versions;
  const cheapestCombinedIdx = findCheapestIdx(versions.map((v) => v.totalCombined), skipZero);
  const cheapestMaterialIdx = findCheapestIdx(versions.map((v) => v.totalMaterial), skipZero);
  const cheapestFeeIdx = findCheapestIdx(versions.map((v) => v.totalFee), skipZero);

  // Percentage bars relative to max
  const maxCombined = Math.max(...versions.map((v) => v.totalCombined), 1);

  return (
    <div className="p-4 space-y-6">
      {/* Summary cards */}
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(versions.length, 4)}, minmax(0, 1fr))` }}>
        {versions.map((v, idx) => {
          const color = getColor(idx);
          const isCheapest = idx === cheapestCombinedIdx;
          return (
            <div
              key={v.versionId}
              className={`rounded-lg border-2 p-4 relative ${color.border} ${color.bg} ${isCheapest ? `ring-2 ${color.ring}` : ""}`}
            >
              {isCheapest && (
                <div className="absolute -top-3 left-3 flex items-center gap-1 px-2 py-0.5 bg-green-600 text-white text-[10px] font-bold rounded-full shadow">
                  <Trophy size={10} />
                  Legolcsóbb
                </div>
              )}
              <div className={`text-xs font-semibold ${color.text} mb-1 truncate group/ovnote relative`} title={v.versionName}>
                {v.versionName}
                {v.notes && (
                  <>
                    {" "}
                    <MessageSquare size={10} className="text-[var(--amber-500)] inline" />
                    <span className="absolute left-0 top-full mt-1 hidden group-hover/ovnote:block z-50 w-max max-w-[220px] px-2.5 py-1.5 rounded-md bg-[var(--slate-800)] text-[10px] text-white shadow-lg whitespace-pre-wrap pointer-events-none font-normal">
                      {v.notes}
                    </span>
                  </>
                )}
              </div>
              {v.partnerName && (
                <div className="text-[10px] text-[var(--slate-500)] mb-2 truncate" title={v.partnerName}>
                  {v.partnerName}
                </div>
              )}
              <div className="space-y-2 mt-3">
                <div>
                  <div className="text-[10px] text-[var(--slate-400)] uppercase tracking-wide">Összesen</div>
                  <div className="text-lg font-bold text-[var(--slate-800)]">{fmt(v.totalCombined)}</div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <div className="text-[10px] text-[var(--slate-400)]">Anyag</div>
                    <div className={`text-sm font-semibold ${idx === cheapestMaterialIdx ? "text-green-700" : "text-[var(--slate-700)]"}`}>
                      {fmt(v.totalMaterial)}
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="text-[10px] text-[var(--slate-400)]">Díj</div>
                    <div className={`text-sm font-semibold ${idx === cheapestFeeIdx ? "text-green-700" : "text-[var(--slate-700)]"}`}>
                      {fmt(v.totalFee)}
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-[var(--slate-400)]">{v.itemCount} tétel</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bar chart comparison */}
      <div className="bg-white rounded-lg border border-[var(--slate-200)] p-4">
        <div className="text-xs font-semibold text-[var(--slate-700)] mb-3">Összesített összehasonlítás</div>
        <div className="space-y-3">
          {versions.map((v, idx) => {
            const color = getColor(idx);
            const pct = (v.totalCombined / maxCombined) * 100;
            const isCheapest = idx === cheapestCombinedIdx;
            return (
              <div key={v.versionId}>
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-medium ${color.text}`}>{v.versionName}</span>
                  <span className={`text-xs font-bold ${isCheapest ? "text-green-700" : "text-[var(--slate-700)]"}`}>
                    {fmt(v.totalCombined)}
                    {isCheapest && <Trophy size={10} className="inline ml-1 text-green-600" />}
                  </span>
                </div>
                <div className="h-5 bg-[var(--slate-100)] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${isCheapest ? "bg-green-500" : "bg-[var(--slate-400)]"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Difference table */}
      <div className="bg-white rounded-lg border border-[var(--slate-200)] overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[var(--slate-50)]">
              <th className="text-left px-3 py-2 text-[var(--slate-500)] font-medium">Verzió</th>
              <th className="text-right px-3 py-2 text-[var(--slate-500)] font-medium">Anyag összesen</th>
              <th className="text-right px-3 py-2 text-[var(--slate-500)] font-medium">Díj összesen</th>
              <th className="text-right px-3 py-2 text-[var(--slate-500)] font-medium">Összesen</th>
              <th className="text-right px-3 py-2 text-[var(--slate-500)] font-medium">Eltérés a legolcsóbbtól</th>
              <th className="text-right px-3 py-2 text-[var(--slate-500)] font-medium">Tételszám</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v, idx) => {
              const isCheapest = idx === cheapestCombinedIdx;
              const cheapest = versions[cheapestCombinedIdx].totalCombined;
              const diff = v.totalCombined - cheapest;
              const diffPct = cheapest > 0 ? (diff / cheapest) * 100 : 0;
              return (
                <tr key={v.versionId} className={isCheapest ? "bg-green-50" : ""}>
                  <td className="px-3 py-2 font-medium text-[var(--slate-800)]">
                    <span className="flex items-center gap-1.5">
                      {v.versionName}
                      {isCheapest && <Trophy size={10} className="text-green-600" />}
                    </span>
                    {v.partnerName && (
                      <span className="text-[10px] text-[var(--slate-400)]">{v.partnerName}</span>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right font-medium ${idx === cheapestMaterialIdx ? "text-green-700" : ""}`}>
                    {fmtDetailed(v.totalMaterial)}
                  </td>
                  <td className={`px-3 py-2 text-right font-medium ${idx === cheapestFeeIdx ? "text-green-700" : ""}`}>
                    {fmtDetailed(v.totalFee)}
                  </td>
                  <td className={`px-3 py-2 text-right font-bold ${isCheapest ? "text-green-700" : ""}`}>
                    {fmtDetailed(v.totalCombined)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {isCheapest ? (
                      <span className="text-green-700 font-semibold">—</span>
                    ) : (
                      <span className="text-red-600 font-medium">
                        +{fmtDetailed(diff)} ({diffPct.toFixed(1)}%)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--slate-600)]">{v.itemCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Sections View (category-level comparison) ----

function flattenSections(
  totals: SectionTotals[],
  depth: number = 0
): { section: SectionTotals; depth: number }[] {
  const result: { section: SectionTotals; depth: number }[] = [];
  for (const t of totals) {
    result.push({ section: t, depth });
    result.push(...flattenSections(t.children, depth + 1));
  }
  return result;
}

interface UnifiedSection {
  sectionCode: string | null;
  sectionName: string;
  depth: number;
  children: UnifiedSection[];
}

function buildUnifiedSectionTree(versions: MultiVersionEntry[]): UnifiedSection[] {
  // Merge section hierarchies across all versions
  function mergeLevel(
    allTotals: SectionTotals[][],
    depth: number
  ): UnifiedSection[] {
    const nameSet = new Map<string, SectionTotals[][]>();
    for (const totals of allTotals) {
      for (const t of totals) {
        if (!nameSet.has(t.sectionName)) {
          nameSet.set(t.sectionName, allTotals.map(() => []));
        }
        const arr = nameSet.get(t.sectionName)!;
        const idx = allTotals.indexOf(totals);
        arr[idx].push(t);
      }
    }

    const result: UnifiedSection[] = [];
    for (const [name, perVersion] of nameSet) {
      // Grab first available section code
      let code: string | null = null;
      const childTotals: SectionTotals[][] = versions.map(() => []);
      for (let vi = 0; vi < perVersion.length; vi++) {
        for (const t of perVersion[vi]) {
          if (!code) code = t.sectionCode;
          childTotals[vi].push(...t.children);
        }
      }
      result.push({
        sectionCode: code,
        sectionName: name,
        depth,
        children: mergeLevel(childTotals, depth + 1),
      });
    }
    return result;
  }

  return mergeLevel(
    versions.map((v) => v.sectionTotals),
    0
  );
}

function findSectionTotals(
  totals: SectionTotals[],
  sectionName: string
): SectionTotals | undefined {
  for (const t of totals) {
    if (t.sectionName === sectionName) return t;
    const child = findSectionTotals(t.children, sectionName);
    if (child) return child;
  }
  return undefined;
}

function SectionRow({
  section,
  versions,
  cheapestMap,
  skipZero,
}: {
  section: UnifiedSection;
  versions: MultiVersionEntry[];
  cheapestMap: Map<string, number>;
  skipZero: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const indent = section.depth * 16;
  const hasChildren = section.children.length > 0;

  // Get totals for this section from each version
  const sectionValues = versions.map((v) => {
    const st = findSectionTotals(v.sectionTotals, section.sectionName);
    return {
      material: st?.materialTotal ?? 0,
      fee: st?.feeTotal ?? 0,
      combined: (st?.materialTotal ?? 0) + (st?.feeTotal ?? 0),
      count: st?.itemCount ?? 0,
      exists: !!st,
    };
  });

  const combinedValues = sectionValues.map((sv) => sv.combined);
  // Only compare versions that actually have this section
  // When skipZero=true, also exclude 0 values from cheapest detection
  const existingValues = sectionValues
    .map((sv, i) => ({ val: sv.combined, idx: i, exists: sv.exists }))
    .filter((x) => x.exists && (!skipZero || x.val !== 0));
  const cheapestIdx = existingValues.length > 0
    ? existingValues.reduce((min, cur) => (cur.val < min.val ? cur : min)).idx
    : -1;

  return (
    <>
      <tr
        className={`${hasChildren ? "cursor-pointer select-none" : ""} ${
          section.depth === 0 ? "bg-amber-50 font-semibold" : "bg-[#fffbf0] hover:bg-amber-50/50"
        }`}
        onClick={hasChildren ? () => setCollapsed((c) => !c) : undefined}
      >
        <td
          className="px-3 py-2 border-b border-amber-100"
          style={{ paddingLeft: 12 + indent }}
        >
          <span className="flex items-center gap-1">
            {hasChildren && (
              collapsed
                ? <ChevronRight size={12} className="text-[var(--slate-400)]" />
                : <ChevronDown size={12} className="text-[var(--slate-400)]" />
            )}
            <span className={`text-xs ${section.depth === 0 ? "text-amber-900" : "text-[var(--slate-700)]"}`}>
              {section.sectionName}
            </span>
          </span>
        </td>
        {versions.map((_, idx) => {
          const sv = sectionValues[idx];
          const isCheapest = idx === cheapestIdx && existingValues.length > 1;
          return (
            <td
              key={idx}
              className={`px-3 py-2 border-b border-amber-100 text-right ${isCheapest ? "bg-green-50" : ""}`}
            >
              {sv.exists ? (
                <div>
                  <div className={`text-xs font-semibold ${isCheapest ? "text-green-700" : "text-[var(--slate-800)]"}`}>
                    {fmt(sv.combined)}
                    {isCheapest && <Trophy size={8} className="inline ml-0.5 text-green-600" />}
                  </div>
                  <div className="text-[10px] text-[var(--slate-400)]">
                    A: {fmt(sv.material)} | D: {fmt(sv.fee)}
                  </div>
                </div>
              ) : (
                <span className="text-[10px] text-[var(--slate-300)]">—</span>
              )}
            </td>
          );
        })}
      </tr>
      {!collapsed &&
        section.children.map((child) => (
          <SectionRow
            key={child.sectionName}
            section={child}
            versions={versions}
            cheapestMap={cheapestMap}
            skipZero={skipZero}
          />
        ))}
    </>
  );
}

function SectionsView({ result, skipZero }: { result: MultiComparisonResult; skipZero: boolean }) {
  const versions = result.versions;
  const unifiedTree = useMemo(() => buildUnifiedSectionTree(versions), [versions]);

  // When skipZero, filter out sections where ALL versions have 0 total
  const filteredTree = useMemo(() => {
    if (!skipZero) return unifiedTree;
    function filterSections(sections: UnifiedSection[]): UnifiedSection[] {
      return sections
        .map((s) => ({
          ...s,
          children: filterSections(s.children),
        }))
        .filter((s) => {
          // Keep if at least one version has non-zero combined for this section
          const hasNonZero = versions.some((v) => {
            const st = findSectionTotals(v.sectionTotals, s.sectionName);
            return st && (st.materialTotal + st.feeTotal) > 0;
          });
          // Also keep if it has children that survived filtering
          return hasNonZero || s.children.length > 0;
        });
    }
    return filterSections(unifiedTree);
  }, [unifiedTree, skipZero, versions]);

  return (
    <div className="p-4">
      <div className="bg-white rounded-lg border border-[var(--slate-200)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-[var(--slate-50)]">
                <th className="text-left px-3 py-2 text-[var(--slate-500)] font-medium min-w-[200px] sticky left-0 bg-[var(--slate-50)] z-10">
                  Kategória
                </th>
                {versions.map((v, idx) => {
                  const color = getColor(idx);
                  return (
                    <th
                      key={v.versionId}
                      className={`text-right px-3 py-2 font-medium min-w-[140px] ${color.text} ${color.header}`}
                    >
                      <div className="truncate">{v.versionName}</div>
                      {v.partnerName && (
                        <div className="text-[9px] font-normal opacity-70 truncate">{v.partnerName}</div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filteredTree.map((section) => (
                <SectionRow
                  key={section.sectionName}
                  section={section}
                  versions={versions}
                  cheapestMap={new Map()}
                  skipZero={skipZero}
                />
              ))}
              {/* Grand total row */}
              <tr className="bg-[var(--slate-100)] font-bold border-t-2 border-[var(--slate-300)]">
                <td className="px-3 py-2.5 text-[var(--slate-800)] sticky left-0 bg-[var(--slate-100)] z-10">
                  Mindösszesen
                </td>
                {versions.map((v, idx) => {
                  const cheapestIdx = findCheapestIdx(versions.map((x) => x.totalCombined), skipZero);
                  const isCheapest = idx === cheapestIdx;
                  return (
                    <td
                      key={v.versionId}
                      className={`px-3 py-2.5 text-right ${isCheapest ? "bg-green-100" : ""}`}
                    >
                      <div className={`text-sm font-bold ${isCheapest ? "text-green-700" : "text-[var(--slate-800)]"}`}>
                        {fmt(v.totalCombined)}
                        {isCheapest && <Trophy size={10} className="inline ml-1 text-green-600" />}
                      </div>
                      <div className="text-[10px] text-[var(--slate-400)] font-normal">
                        A: {fmt(v.totalMaterial)} | D: {fmt(v.totalFee)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---- Variance Analysis View (price outlier detection) ----

type VarianceMode = "percentage" | "absolute";
type PriceField = "combined" | "material" | "fee";

interface ItemVariance {
  item: MultiVersionItemEntry;
  /** Number of versions that have this item */
  presentCount: number;
  /** Average combined unit price across versions that have it */
  avgCombined: number;
  avgMaterial: number;
  avgFee: number;
  /** Standard deviation */
  stdCombined: number;
  stdMaterial: number;
  stdFee: number;
  /** Max - Min spread */
  spreadCombined: number;
  spreadMaterial: number;
  spreadFee: number;
  /** Percentage spread: (max-min)/avg * 100 */
  spreadPctCombined: number;
  spreadPctMaterial: number;
  spreadPctFee: number;
  /** Min/max indices */
  minCombinedIdx: number;
  maxCombinedIdx: number;
}

function computeVariances(items: MultiVersionItemEntry[], skipZero = false): ItemVariance[] {
  return items
    .map((item) => {
      const prices = item.perVersion
        .map((pv, idx) => (pv ? { ...pv, idx } : null))
        .filter((x): x is NonNullable<typeof x> => x !== null && (!skipZero || x.combinedUnitPrice !== 0));

      if (prices.length < 2) return null;

      const combinedVals = prices.map((p) => p.combinedUnitPrice);
      const materialVals = prices.map((p) => p.materialUnitPrice);
      const feeVals = prices.map((p) => p.feeUnitPrice);

      const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
      const std = (arr: number[], mean: number) =>
        Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);

      const avgC = avg(combinedVals);
      const avgM = avg(materialVals);
      const avgF = avg(feeVals);

      const minC = Math.min(...combinedVals);
      const maxC = Math.max(...combinedVals);

      const minCIdx = prices[combinedVals.indexOf(minC)].idx;
      const maxCIdx = prices[combinedVals.indexOf(maxC)].idx;

      return {
        item,
        presentCount: prices.length,
        avgCombined: avgC,
        avgMaterial: avgM,
        avgFee: avgF,
        stdCombined: std(combinedVals, avgC),
        stdMaterial: std(materialVals, avgM),
        stdFee: std(feeVals, avgF),
        spreadCombined: maxC - minC,
        spreadMaterial: Math.max(...materialVals) - Math.min(...materialVals),
        spreadFee: Math.max(...feeVals) - Math.min(...feeVals),
        spreadPctCombined: avgC > 0 ? ((maxC - minC) / avgC) * 100 : 0,
        spreadPctMaterial: avgM > 0 ? ((Math.max(...materialVals) - Math.min(...materialVals)) / avgM) * 100 : 0,
        spreadPctFee: avgF > 0 ? ((Math.max(...feeVals) - Math.min(...feeVals)) / avgF) * 100 : 0,
        minCombinedIdx: minCIdx,
        maxCombinedIdx: maxCIdx,
      } satisfies ItemVariance;
    })
    .filter((x): x is ItemVariance => x !== null);
}

function getSeverity(pct: number): { label: string; cls: string; bg: string } {
  if (pct >= 100) return { label: "Kritikus", cls: "text-red-700", bg: "bg-red-100" };
  if (pct >= 50)  return { label: "Magas",    cls: "text-orange-700", bg: "bg-orange-100" };
  if (pct >= 20)  return { label: "Közepes",  cls: "text-amber-700", bg: "bg-amber-100" };
  return { label: "Alacsony", cls: "text-[var(--slate-500)]", bg: "bg-[var(--slate-100)]" };
}

function VarianceView({ result, skipZero }: { result: MultiComparisonResult; skipZero: boolean }) {
  const [mode, setMode] = useState<VarianceMode>("percentage");
  const [priceField, setPriceField] = useState<PriceField>("combined");
  const [minSpreadPct, setMinSpreadPct] = useState(10);
  const [showAll, setShowAll] = useState(false);

  const allVariances = useMemo(() => computeVariances(result.items, skipZero), [result.items, skipZero]);

  const sortedVariances = useMemo(() => {
    let filtered = allVariances;
    if (!showAll) {
      filtered = allVariances.filter((v) => {
        const pct = priceField === "combined" ? v.spreadPctCombined
          : priceField === "material" ? v.spreadPctMaterial
          : v.spreadPctFee;
        return pct >= minSpreadPct;
      });
    }

    return [...filtered].sort((a, b) => {
      if (mode === "percentage") {
        const aVal = priceField === "combined" ? a.spreadPctCombined
          : priceField === "material" ? a.spreadPctMaterial : a.spreadPctFee;
        const bVal = priceField === "combined" ? b.spreadPctCombined
          : priceField === "material" ? b.spreadPctMaterial : b.spreadPctFee;
        return bVal - aVal;
      } else {
        const aVal = priceField === "combined" ? a.spreadCombined
          : priceField === "material" ? a.spreadMaterial : a.spreadFee;
        const bVal = priceField === "combined" ? b.spreadCombined
          : priceField === "material" ? b.spreadMaterial : b.spreadFee;
        return bVal - aVal;
      }
    });
  }, [allVariances, mode, priceField, minSpreadPct, showAll]);

  const versions = result.versions;
  const suspiciousCount = allVariances.filter((v) => v.spreadPctCombined >= 50).length;
  const criticalCount = allVariances.filter((v) => v.spreadPctCombined >= 100).length;

  return (
    <div className="p-4 space-y-4">
      {/* Summary strip */}
      <div className="flex items-center gap-4 bg-white rounded-lg border border-[var(--slate-200)] px-4 py-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-500" />
          <span className="text-xs font-semibold text-[var(--slate-700)]">Ár szórás elemzés</span>
        </div>
        <div className="h-4 w-px bg-[var(--slate-200)]" />
        <div className="text-xs text-[var(--slate-500)]">
          <span className="font-medium">{allVariances.length}</span> összehasonlítható tétel
        </div>
        {criticalCount > 0 && (
          <>
            <div className="h-4 w-px bg-[var(--slate-200)]" />
            <div className="flex items-center gap-1 text-xs text-red-700 font-medium">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              {criticalCount} kritikus (100%+)
            </div>
          </>
        )}
        {suspiciousCount > 0 && (
          <>
            <div className="h-4 w-px bg-[var(--slate-200)]" />
            <div className="flex items-center gap-1 text-xs text-orange-700 font-medium">
              <span className="w-2 h-2 rounded-full bg-orange-500" />
              {suspiciousCount} gyanús (50%+)
            </div>
          </>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Mode toggle */}
        <div className="flex items-center border border-[var(--slate-200)] rounded-[6px] overflow-hidden">
          <button
            onClick={() => setMode("percentage")}
            className={`px-2.5 py-[4px] text-xs cursor-pointer transition-colors ${
              mode === "percentage"
                ? "bg-[var(--indigo-600)] text-white"
                : "text-[var(--slate-600)] hover:bg-[var(--slate-50)]"
            }`}
          >
            Százalékos
          </button>
          <button
            onClick={() => setMode("absolute")}
            className={`px-2.5 py-[4px] text-xs cursor-pointer transition-colors ${
              mode === "absolute"
                ? "bg-[var(--indigo-600)] text-white"
                : "text-[var(--slate-600)] hover:bg-[var(--slate-50)]"
            }`}
          >
            Összeg
          </button>
        </div>

        {/* Price field */}
        <div className="flex items-center border border-[var(--slate-200)] rounded-[6px] overflow-hidden">
          <button
            onClick={() => setPriceField("combined")}
            className={`px-2.5 py-[4px] text-xs cursor-pointer transition-colors ${
              priceField === "combined"
                ? "bg-[var(--indigo-600)] text-white"
                : "text-[var(--slate-600)] hover:bg-[var(--slate-50)]"
            }`}
          >
            Anyag+Díj
          </button>
          <button
            onClick={() => setPriceField("material")}
            className={`px-2.5 py-[4px] text-xs cursor-pointer transition-colors ${
              priceField === "material"
                ? "bg-[var(--indigo-600)] text-white"
                : "text-[var(--slate-600)] hover:bg-[var(--slate-50)]"
            }`}
          >
            Anyag
          </button>
          <button
            onClick={() => setPriceField("fee")}
            className={`px-2.5 py-[4px] text-xs cursor-pointer transition-colors ${
              priceField === "fee"
                ? "bg-[var(--indigo-600)] text-white"
                : "text-[var(--slate-600)] hover:bg-[var(--slate-50)]"
            }`}
          >
            Díj
          </button>
        </div>

        {/* Min threshold */}
        {!showAll && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--slate-400)]">Min. szórás:</span>
            <select
              value={minSpreadPct}
              onChange={(e) => setMinSpreadPct(Number(e.target.value))}
              className="h-6 px-1.5 border border-[var(--slate-200)] rounded text-xs outline-none bg-white"
            >
              <option value={5}>5%</option>
              <option value={10}>10%</option>
              <option value={20}>20%</option>
              <option value={50}>50%</option>
              <option value={100}>100%</option>
            </select>
          </div>
        )}

        <label className="flex items-center gap-1.5 text-xs text-[var(--slate-500)] cursor-pointer">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
            className="rounded border-[var(--slate-300)]"
          />
          Összes tétel
        </label>

        <div className="flex-1" />
        <span className="text-[10px] text-[var(--slate-400)]">
          {sortedVariances.length} / {allVariances.length} tétel
        </span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-[var(--slate-200)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-[var(--slate-50)]">
                <th className="text-left px-3 py-2 text-[var(--slate-500)] font-medium sticky left-0 bg-[var(--slate-50)] z-10 min-w-[60px]">
                  #
                </th>
                <th className="text-left px-3 py-2 text-[var(--slate-500)] font-medium min-w-[50px]">
                  Tsz.
                </th>
                <th className="text-left px-3 py-2 text-[var(--slate-500)] font-medium min-w-[200px]">
                  Tétel
                </th>
                <th className="text-left px-3 py-2 text-[var(--slate-500)] font-medium min-w-[100px]">
                  Kategória
                </th>
                <th className="text-center px-3 py-2 text-[var(--slate-500)] font-medium min-w-[30px]">
                  Me.
                </th>
                {/* Per-version unit price columns */}
                {versions.map((v, idx) => {
                  const color = getColor(idx);
                  return (
                    <th
                      key={v.versionId}
                      className={`text-right px-3 py-2 font-medium min-w-[100px] ${color.text} ${color.header}`}
                    >
                      <div className="truncate text-[10px]">{v.versionName}</div>
                    </th>
                  );
                })}
                <th className="text-right px-3 py-2 text-[var(--slate-500)] font-medium min-w-[80px]">
                  <span className="flex items-center justify-end gap-0.5">
                    <ArrowUpDown size={10} />
                    {mode === "percentage" ? "Szórás %" : "Szórás Ft"}
                  </span>
                </th>
                <th className="text-center px-3 py-2 text-[var(--slate-500)] font-medium min-w-[70px]">
                  Jelzés
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedVariances.length === 0 && (
                <tr>
                  <td colSpan={6 + versions.length} className="px-3 py-8 text-center text-[var(--slate-400)]">
                    Nincs a szűrési feltételeknek megfelelő tétel.
                  </td>
                </tr>
              )}
              {sortedVariances.map((v, rowIdx) => {
                const spreadPct = priceField === "combined" ? v.spreadPctCombined
                  : priceField === "material" ? v.spreadPctMaterial : v.spreadPctFee;
                const spreadAbs = priceField === "combined" ? v.spreadCombined
                  : priceField === "material" ? v.spreadMaterial : v.spreadFee;
                const severity = getSeverity(spreadPct);

                // Per-version unit prices for selected field
                const unitPrices = v.item.perVersion.map((pv) => {
                  if (!pv) return null;
                  return priceField === "combined" ? pv.combinedUnitPrice
                    : priceField === "material" ? pv.materialUnitPrice
                    : pv.feeUnitPrice;
                });

                const existingPrices = unitPrices.filter((p): p is number => p !== null && (!skipZero || p !== 0));
                const minPrice = existingPrices.length > 0 ? Math.min(...existingPrices) : 0;
                const maxPrice = existingPrices.length > 0 ? Math.max(...existingPrices) : 0;

                return (
                  <tr
                    key={v.item.itemCode}
                    className={`border-b border-[var(--slate-100)] hover:bg-[var(--slate-50)] ${
                      spreadPct >= 100 ? "bg-red-50/50" : spreadPct >= 50 ? "bg-orange-50/30" : ""
                    }`}
                  >
                    <td className="px-3 py-2 text-[var(--slate-400)] sticky left-0 bg-inherit z-10">
                      {rowIdx + 1}
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-[var(--slate-500)]">
                      {v.item.itemNumber || "—"}
                    </td>
                    <td className="px-3 py-2 text-[var(--slate-800)]">
                      <div className="truncate max-w-[250px]" title={v.item.name}>
                        {v.item.name}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[var(--slate-500)]">
                      <div className="truncate max-w-[120px]" title={v.item.sectionName ?? ""}>
                        {v.item.sectionName ?? "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center text-[var(--slate-500)]">
                      {v.item.unit}
                    </td>
                    {unitPrices.map((price, idx) => {
                      if (price === null) {
                        return (
                          <td key={idx} className="px-3 py-2 text-right text-[var(--slate-300)]">
                            —
                          </td>
                        );
                      }
                      const isMin = price === minPrice && existingPrices.length > 1;
                      const isMax = price === maxPrice && existingPrices.length > 1;
                      return (
                        <td key={idx} className="px-3 py-2 text-right">
                          <span
                            className={`font-medium ${
                              isMin ? "text-green-700" : isMax ? "text-red-700" : "text-[var(--slate-700)]"
                            }`}
                          >
                            {fmtDetailed(price)}
                          </span>
                          {isMin && <span className="ml-0.5 text-[9px] text-green-600">▼</span>}
                          {isMax && <span className="ml-0.5 text-[9px] text-red-600">▲</span>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right font-bold">
                      {mode === "percentage" ? (
                        <span className={severity.cls}>{spreadPct.toFixed(1)}%</span>
                      ) : (
                        <span className={severity.cls}>{fmtDetailed(spreadAbs)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-semibold rounded-full ${severity.bg} ${severity.cls}`}>
                        {severity.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---- Main Component ----

export function MultiVersionComparison({
  versionIds,
  versionNames,
  onBack,
}: MultiVersionComparisonProps) {
  const [result, setResult] = useState<MultiComparisonResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [skipZero, setSkipZero] = useState(false);

  useEffect(() => {
    setLoading(true);
    compareMultipleVersions(versionIds).then((data) => {
      setResult(data);
      setLoading(false);
    });
  }, [versionIds]);

  if (loading || !result) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-[var(--slate-400)]">
        Többes összehasonlítás betöltése…
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-[10px] bg-white border-b border-[var(--slate-200)] shrink-0 flex-wrap">
        <button onClick={onBack} className="p-1 text-[var(--slate-500)] hover:text-[var(--slate-800)] cursor-pointer">
          <ArrowLeft size={14} />
        </button>
        <span className="text-sm font-semibold text-[var(--slate-800)]">
          Összehasonlítás ({result.versions.length} verzió)
        </span>
        <div className="flex items-center gap-1 ml-2">
          {result.versions.map((v, idx) => {
            const color = getColor(idx);
            return (
              <span
                key={v.versionId}
                className={`group/note relative inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full ${color.bg} ${color.text} ${color.border} border`}
              >
                {v.versionName}
                {v.notes && (
                  <>
                    <MessageSquare size={9} className="text-[var(--amber-500)]" />
                    <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 hidden group-hover/note:block z-50 w-max max-w-[260px] px-2.5 py-1.5 rounded-md bg-[var(--slate-800)] text-[10px] text-white shadow-lg whitespace-pre-wrap pointer-events-none font-normal">
                      {v.notes}
                    </span>
                  </>
                )}
              </span>
            );
          })}
        </div>
        <div className="flex-1" />
        {/* Skip zero toggle */}
        <label className="flex items-center gap-1.5 text-xs text-[var(--slate-500)] cursor-pointer mr-2" title="0 Ft értékű kategóriák és tételek kihagyása az összehasonlításból">
          <input
            type="checkbox"
            checked={skipZero}
            onChange={(e) => setSkipZero(e.target.checked)}
            className="rounded border-[var(--slate-300)]"
          />
          <EyeOff size={12} />
          0 Ft kihagyása
        </label>
        {/* View mode toggle */}
        <div className="flex items-center border border-[var(--slate-200)] rounded-[6px] overflow-hidden">
          <button
            onClick={() => setViewMode("overview")}
            className={`flex items-center gap-1 px-2.5 py-[4px] text-xs cursor-pointer transition-colors ${
              viewMode === "overview"
                ? "bg-[var(--indigo-600)] text-white"
                : "text-[var(--slate-600)] hover:bg-[var(--slate-50)]"
            }`}
          >
            <BarChart3 size={12} />
            Áttekintés
          </button>
          <button
            onClick={() => setViewMode("sections")}
            className={`flex items-center gap-1 px-2.5 py-[4px] text-xs cursor-pointer transition-colors ${
              viewMode === "sections"
                ? "bg-[var(--indigo-600)] text-white"
                : "text-[var(--slate-600)] hover:bg-[var(--slate-50)]"
            }`}
          >
            <Layers size={12} />
            Kategóriák
          </button>
          <button
            onClick={() => setViewMode("variance")}
            className={`flex items-center gap-1 px-2.5 py-[4px] text-xs cursor-pointer transition-colors ${
              viewMode === "variance"
                ? "bg-[var(--indigo-600)] text-white"
                : "text-[var(--slate-600)] hover:bg-[var(--slate-50)]"
            }`}
          >
            <AlertTriangle size={12} />
            Ár szórás
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-[var(--slate-50)]">
        {viewMode === "overview" && <OverviewView result={result} skipZero={skipZero} />}
        {viewMode === "sections" && <SectionsView result={result} skipZero={skipZero} />}
        {viewMode === "variance" && <VarianceView result={result} skipZero={skipZero} />}
      </div>
    </div>
  );
}
