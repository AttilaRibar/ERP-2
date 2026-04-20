"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Trophy, ChevronDown, ChevronRight, ChevronUp, BarChart3, Layers, AlertTriangle, ArrowUpDown, MessageSquare, EyeOff, X, GripVertical, Pin, Save } from "lucide-react";
import {
  compareMultipleVersions,
  type MultiComparisonResult,
  type MultiVersionEntry,
  type MultiVersionItemEntry,
  type SectionTotals,
} from "@/server/actions/versions";
import { createSavedComparison, type MultiCompareState } from "@/server/actions/comparisons";

interface MultiVersionComparisonProps {
  versionIds: number[];
  versionNames: string[];
  onBack: () => void;
  budgetId?: number;
  initialState?: MultiCompareState;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0 }).format(n);
}

function fmtDetailed(n: number): string {
  return new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 2 }).format(n);
}

type ViewMode = "overview" | "sections" | "variance";

interface VersionEntry {
  version: MultiVersionEntry;
  originalIdx: number;
}

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

function OverviewView({
  result,
  skipZero,
  hiddenVersionIdxs,
  orderedVersions,
  referenceVersionIdx,
}: {
  result: MultiComparisonResult;
  skipZero: boolean;
  hiddenVersionIdxs: Set<number>;
  orderedVersions: VersionEntry[];
  referenceVersionIdx: number | null;
}) {
  void result;
  const visible = orderedVersions.filter((x) => !hiddenVersionIdxs.has(x.originalIdx));
  const versions = visible.map((x) => x.version);
  const cheapestCombinedPos = findCheapestIdx(versions.map((v) => v.totalCombined), skipZero);
  const cheapestMaterialPos = findCheapestIdx(versions.map((v) => v.totalMaterial), skipZero);
  const cheapestFeePos = findCheapestIdx(versions.map((v) => v.totalFee), skipZero);
  const refEntry = referenceVersionIdx !== null ? visible.find((x) => x.originalIdx === referenceVersionIdx) ?? null : null;

  // Percentage bars relative to max
  const maxCombined = Math.max(...versions.map((v) => v.totalCombined), 1);

  return (
    <div className="p-4 space-y-6">
      {/* Summary cards */}
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(visible.length, 4)}, minmax(0, 1fr))` }}>
        {visible.map(({ version: v, originalIdx }, displayPos) => {
          const color = getColor(originalIdx);
          const isCheapest = displayPos === cheapestCombinedPos;
          const isRef = originalIdx === referenceVersionIdx;
          return (
            <div
              key={v.versionId}
              className={`rounded-lg border-2 p-4 relative ${color.border} ${color.bg} ${isRef ? "ring-2 ring-amber-400" : isCheapest ? `ring-2 ${color.ring}` : ""}`}
            >
              {isRef && (
                <div className="absolute -top-3 left-3 flex items-center gap-1 px-2 py-0.5 bg-amber-500 text-white text-[10px] font-bold rounded-full shadow">
                  <Pin size={10} />
                  Referencia
                </div>
              )}
              {isCheapest && !isRef && (
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
                    <div className={`text-sm font-semibold ${displayPos === cheapestMaterialPos ? "text-green-700" : "text-[var(--slate-700)]"}`}>
                      {fmt(v.totalMaterial)}
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="text-[10px] text-[var(--slate-400)]">Díj</div>
                    <div className={`text-sm font-semibold ${displayPos === cheapestFeePos ? "text-green-700" : "text-[var(--slate-700)]"}`}>
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
          {visible.map(({ version: v, originalIdx }, displayPos) => {
            const color = getColor(originalIdx);
            const pct = (v.totalCombined / maxCombined) * 100;
            const isCheapest = displayPos === cheapestCombinedPos;
            const isRef = originalIdx === referenceVersionIdx;
            return (
              <div key={v.versionId}>
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-medium flex items-center gap-1 ${color.text}`}>
                    {isRef && <Pin size={9} className="text-amber-500 shrink-0" />}
                    {v.versionName}
                  </span>
                  <span className={`text-xs font-bold ${isCheapest ? "text-green-700" : "text-[var(--slate-700)]"}`}>
                    {fmt(v.totalCombined)}
                    {isCheapest && !isRef && <Trophy size={10} className="inline ml-1 text-green-600" />}
                  </span>
                </div>
                <div className="h-5 bg-[var(--slate-100)] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${isRef ? "bg-amber-400" : isCheapest ? "bg-green-500" : "bg-[var(--slate-400)]"}`}
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
              <th className="text-right px-3 py-2 text-[var(--slate-500)] font-medium">
                {refEntry ? "Eltérés a referenciától" : "Eltérés a legolcsóbbtól"}
              </th>
              <th className="text-right px-3 py-2 text-[var(--slate-500)] font-medium">Tételszám</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ version: v, originalIdx }, displayPos) => {
              const isCheapest = displayPos === cheapestCombinedPos;
              const isRef = originalIdx === referenceVersionIdx;
              let diffCell: React.ReactNode;
              if (refEntry) {
                if (isRef) {
                  diffCell = (
                    <span className="flex items-center gap-1 justify-end text-amber-700 font-semibold">
                      <Pin size={9} />
                      Referencia
                    </span>
                  );
                } else {
                  const diff = v.totalCombined - refEntry.version.totalCombined;
                  const diffPct = refEntry.version.totalCombined > 0 ? (diff / refEntry.version.totalCombined) * 100 : 0;
                  const sign = diff >= 0 ? "+" : "";
                  const cls = diff > 0 ? "text-red-600" : diff < 0 ? "text-green-700" : "text-[var(--slate-500)]";
                  diffCell = (
                    <span className={`font-medium ${cls}`}>
                      {sign}{fmtDetailed(diff)} ({sign}{diffPct.toFixed(1)}%)
                    </span>
                  );
                }
              } else {
                const cheapestTotal = versions[cheapestCombinedPos]?.totalCombined ?? 0;
                const diff = v.totalCombined - cheapestTotal;
                const diffPct = cheapestTotal > 0 ? (diff / cheapestTotal) * 100 : 0;
                diffCell = isCheapest ? (
                  <span className="text-green-700 font-semibold">—</span>
                ) : (
                  <span className="text-red-600 font-medium">
                    +{fmtDetailed(diff)} ({diffPct.toFixed(1)}%)
                  </span>
                );
              }
              return (
                <tr key={v.versionId} className={isRef ? "bg-amber-50" : isCheapest ? "bg-green-50" : ""}>
                  <td className="px-3 py-2 font-medium text-[var(--slate-800)]">
                    <span className="flex items-center gap-1.5">
                      {isRef && <Pin size={10} className="text-amber-500" />}
                      {v.versionName}
                      {isCheapest && !isRef && <Trophy size={10} className="text-green-600" />}
                    </span>
                    {v.partnerName && (
                      <span className="text-[10px] text-[var(--slate-400)]">{v.partnerName}</span>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right font-medium ${displayPos === cheapestMaterialPos ? "text-green-700" : ""}`}>
                    {fmtDetailed(v.totalMaterial)}
                  </td>
                  <td className={`px-3 py-2 text-right font-medium ${displayPos === cheapestFeePos ? "text-green-700" : ""}`}>
                    {fmtDetailed(v.totalFee)}
                  </td>
                  <td className={`px-3 py-2 text-right font-bold ${isRef ? "text-amber-700" : isCheapest ? "text-green-700" : ""}`}>
                    {fmtDetailed(v.totalCombined)}
                  </td>
                  <td className="px-3 py-2 text-right">{diffCell}</td>
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
  perVersionTotals: (SectionTotals | null)[];
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
      const childTotals: SectionTotals[][] = allTotals.map(() => []);
      const pvTotals: (SectionTotals | null)[] = allTotals.map(() => null);
      for (let vi = 0; vi < perVersion.length; vi++) {
        for (const t of perVersion[vi]) {
          if (!code) code = t.sectionCode;
          childTotals[vi].push(...t.children);
          if (!pvTotals[vi]) pvTotals[vi] = t;
        }
      }
      result.push({
        sectionCode: code,
        sectionName: name,
        depth,
        children: mergeLevel(childTotals, depth + 1),
        perVersionTotals: pvTotals,
      });
    }
    return result;
  }

  return mergeLevel(
    versions.map((v) => v.sectionTotals),
    0
  );
}



function SectionRow({
  section,
  visibleEntries,
  cheapestMap,
  skipZero,
  referenceVersionIdx,
}: {
  section: UnifiedSection;
  visibleEntries: VersionEntry[];
  cheapestMap: Map<string, number>;
  skipZero: boolean;
  referenceVersionIdx: number | null;
}) {
  void cheapestMap;
  const [collapsed, setCollapsed] = useState(false);
  const indent = section.depth * 16;
  const hasChildren = section.children.length > 0;

  // Get totals for this section from each version (embedded during tree build)
  const sectionValues = visibleEntries.map((_, displayPos) => {
    const st = section.perVersionTotals[displayPos];
    return {
      material: st?.materialTotal ?? 0,
      fee: st?.feeTotal ?? 0,
      combined: (st?.materialTotal ?? 0) + (st?.feeTotal ?? 0),
      count: st?.itemCount ?? 0,
      exists: !!st,
    };
  });

  // Only compare versions that actually have this section
  const existingValues = sectionValues
    .map((sv, i) => ({ val: sv.combined, idx: i, exists: sv.exists }))
    .filter((x) => x.exists && (!skipZero || x.val !== 0));
  const cheapestDisplayPos = existingValues.length > 0
    ? existingValues.reduce((min, cur) => (cur.val < min.val ? cur : min)).idx
    : -1;

  // Reference entry in visible list (display position)
  const refDisplayPos = referenceVersionIdx !== null
    ? visibleEntries.findIndex((x) => x.originalIdx === referenceVersionIdx)
    : -1;
  const refSv = refDisplayPos >= 0 ? sectionValues[refDisplayPos] : null;

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
        {visibleEntries.map(({ originalIdx }, displayPos) => {
          const sv = sectionValues[displayPos];
          const isCheapest = displayPos === cheapestDisplayPos && existingValues.length > 1;
          const isRef = originalIdx === referenceVersionIdx;
          const delta = refSv && sv.exists && !isRef && refSv.exists ? sv.combined - refSv.combined : null;
          const deltaPct = delta !== null && refSv && refSv.combined > 0 ? (delta / refSv.combined) * 100 : null;
          return (
            <td
              key={originalIdx}
              className={`px-3 py-2 border-b border-amber-100 text-right ${isRef ? "bg-amber-50/60" : isCheapest ? "bg-green-50" : ""}`}
            >
              {sv.exists ? (
                <div>
                  <div className={`text-xs font-semibold ${isRef ? "text-amber-700" : isCheapest ? "text-green-700" : "text-[var(--slate-800)]"}`}>
                    {fmt(sv.combined)}
                    {isCheapest && !isRef && <Trophy size={8} className="inline ml-0.5 text-green-600" />}
                    {isRef && <Pin size={8} className="inline ml-0.5 text-amber-500" />}
                  </div>
                  <div className="text-[10px] text-[var(--slate-400)]">
                    A: {fmt(sv.material)} | D: {fmt(sv.fee)}
                  </div>
                  {delta !== null && deltaPct !== null && (
                    <div className={`text-[9px] font-medium mt-0.5 ${delta > 0 ? "text-red-500" : delta < 0 ? "text-green-600" : "text-[var(--slate-400)]"}`}>
                      {delta >= 0 ? "+" : ""}{fmt(delta)} ({delta >= 0 ? "+" : ""}{deltaPct.toFixed(1)}%)
                    </div>
                  )}
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
            visibleEntries={visibleEntries}
            cheapestMap={new Map()}
            skipZero={skipZero}
            referenceVersionIdx={referenceVersionIdx}
          />
        ))}
    </>
  );
}

function SectionsView({
  result,
  skipZero,
  hiddenVersionIdxs,
  orderedVersions,
  referenceVersionIdx,
}: {
  result: MultiComparisonResult;
  skipZero: boolean;
  hiddenVersionIdxs: Set<number>;
  orderedVersions: VersionEntry[];
  referenceVersionIdx: number | null;
}) {
  void result;
  const visibleEntries = orderedVersions.filter((x) => !hiddenVersionIdxs.has(x.originalIdx));
  const versions = visibleEntries.map((x) => x.version);
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
          const hasNonZero = s.perVersionTotals.some((st) => {
            return st && (st.materialTotal + st.feeTotal) > 0;
          });
          // Also keep if it has children that survived filtering
          return hasNonZero || s.children.length > 0;
        });
    }
    return filterSections(unifiedTree);
  }, [unifiedTree, skipZero]);

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
                {visibleEntries.map(({ version: v, originalIdx }) => {
                  const color = getColor(originalIdx);
                  const isRef = originalIdx === referenceVersionIdx;
                  return (
                    <th
                      key={v.versionId}
                      className={`text-right px-3 py-2 font-medium min-w-[140px] ${isRef ? "bg-amber-100 text-amber-800" : `${color.text} ${color.header}`}`}
                    >
                      <div className="flex flex-col items-end gap-0.5">
                        {isRef && (
                          <span className="flex items-center gap-0.5 text-[9px] text-amber-600 font-bold">
                            <Pin size={8} />
                            REF
                          </span>
                        )}
                        <div className="truncate">{v.versionName}</div>
                        {v.partnerName && (
                          <div className="text-[9px] font-normal opacity-70 truncate">{v.partnerName}</div>
                        )}
                      </div>
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
                  visibleEntries={visibleEntries}
                  cheapestMap={new Map()}
                  skipZero={skipZero}
                  referenceVersionIdx={referenceVersionIdx}
                />
              ))}
              {/* Grand total row */}
              {(() => {
                const cheapestPos = findCheapestIdx(versions.map((x) => x.totalCombined), skipZero);
                const refEntry = referenceVersionIdx !== null ? visibleEntries.find((x) => x.originalIdx === referenceVersionIdx) ?? null : null;
                return (
                  <tr className="bg-[var(--slate-100)] font-bold border-t-2 border-[var(--slate-300)]">
                    <td className="px-3 py-2.5 text-[var(--slate-800)] sticky left-0 bg-[var(--slate-100)] z-10">
                      Mindösszesen
                    </td>
                    {visibleEntries.map(({ version: v, originalIdx }, displayPos) => {
                      const isCheapest = displayPos === cheapestPos;
                      const isRef = originalIdx === referenceVersionIdx;
                      const delta = refEntry && !isRef ? v.totalCombined - refEntry.version.totalCombined : null;
                      const deltaPct = delta !== null && refEntry && refEntry.version.totalCombined > 0
                        ? (delta / refEntry.version.totalCombined) * 100 : null;
                      return (
                        <td
                          key={originalIdx}
                          className={`px-3 py-2.5 text-right ${isRef ? "bg-amber-50" : isCheapest ? "bg-green-100" : ""}`}
                        >
                          <div className={`text-sm font-bold ${isRef ? "text-amber-700" : isCheapest ? "text-green-700" : "text-[var(--slate-800)]"}`}>
                            {fmt(v.totalCombined)}
                            {isCheapest && !isRef && <Trophy size={10} className="inline ml-1 text-green-600" />}
                            {isRef && <Pin size={9} className="inline ml-1 text-amber-500" />}
                          </div>
                          <div className="text-[10px] text-[var(--slate-400)] font-normal">
                            A: {fmt(v.totalMaterial)} | D: {fmt(v.totalFee)}
                          </div>
                          {delta !== null && deltaPct !== null && (
                            <div className={`text-[9px] font-medium mt-0.5 ${delta > 0 ? "text-red-500" : delta < 0 ? "text-green-600" : "text-[var(--slate-400)]"}`}>
                              {delta >= 0 ? "+" : ""}{fmt(delta)} ({delta >= 0 ? "+" : ""}{deltaPct.toFixed(1)}%)
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---- Item Detail Tooltip ----

interface ItemTooltipState {
  variance: ItemVariance;
  x: number;
  y: number;
}

function ItemDetailTooltip({
  state,
  versions,
  hiddenVersionIdxs,
  skipZero,
  onEnter,
  onLeave,
}: {
  state: ItemTooltipState;
  versions: MultiVersionEntry[];
  hiddenVersionIdxs: Set<number>;
  skipZero: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { variance: v } = state;

  const entries = v.item.perVersion
    .map((pv, idx) => ({ pv, idx, version: versions[idx] }))
    .filter(({ pv, idx }) => !hiddenVersionIdxs.has(idx) && pv !== null && (!skipZero || pv.combinedUnitPrice !== 0));

  if (entries.length === 0) return null;

  const combinedTotals = entries.map((e) => e.pv!.combinedTotal);
  const combinedUnits = entries.map((e) => e.pv!.combinedUnitPrice);
  const minTotal = Math.min(...combinedTotals);
  const maxTotal = Math.max(...combinedTotals);
  const minUnit = Math.min(...combinedUnits);
  const maxUnit = Math.max(...combinedUnits);
  const hasVariance = entries.length > 1;

  const diffUnit = maxUnit - minUnit;
  const avgUnit = combinedUnits.reduce((s, v) => s + v, 0) / combinedUnits.length;
  const diffUnitPct = avgUnit > 0 ? (diffUnit / avgUnit) * 100 : 0;
  const diffTotal = maxTotal - minTotal;
  const avgTotal = combinedTotals.reduce((s, v) => s + v, 0) / combinedTotals.length;
  const diffTotalPct = avgTotal > 0 ? (diffTotal / avgTotal) * 100 : 0;

  // Clamp position within viewport — let width grow with content, cap at viewport
  const vpW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vpH = typeof window !== "undefined" ? window.innerHeight : 800;
  const maxW = vpW - 24;
  const x = Math.max(8, Math.min(state.x, vpW - 400));
  const y = state.y + 240 > vpH ? Math.max(8, state.y - 300) : state.y;

  return (
    <div
      className="fixed z-[200] bg-white rounded-xl shadow-2xl border border-[var(--slate-200)] overflow-hidden text-xs"
      style={{ left: x, top: y, maxWidth: maxW, width: "max-content", maxHeight: "70vh", overflowY: "auto" }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {/* Header */}
      <div className="bg-[var(--slate-700)] text-white px-4 py-2.5 sticky top-0 z-10">
        <div className="font-bold text-[13px] leading-snug whitespace-normal break-words max-w-[600px]">{v.item.name}</div>
        <div className="text-[10px] text-[var(--slate-300)] mt-0.5 flex items-center gap-2">
          {v.item.itemNumber && <span className="font-mono">#{v.item.itemNumber}</span>}
          {v.item.sectionName && <span>{v.item.sectionName}</span>}
          <span className="text-[var(--slate-400)]">·</span>
          <span>{entries.length} ajánlat összehasonlítva</span>
        </div>
      </div>

      {/* Table */}
      <table className="border-collapse" style={{ width: "max-content" }}>
        <colgroup>
          <col />{/* Alvállalkozó */}
          <col />{/* Menny. */}
          <col />{/* Anyag e.ár */}
          <col />{/* Díj e.ár */}
          <col />{/* A+D e.ár */}
          <col style={{ width: "56px" }} />{/* % eltérés e.ár */}
          <col style={{ width: "8px" }} />{/* spacer */}
          <col />{/* Anyag sum. */}
          <col />{/* Díj sum. */}
          <col />{/* A+D sum. */}
          <col style={{ width: "56px" }} />{/* % eltérés sum. */}
        </colgroup>
        <thead>
          <tr className="bg-[var(--slate-50)] border-b border-[var(--slate-200)]">
            <th className="text-left px-3 py-1.5 text-[var(--slate-500)] font-medium">Alvállalkozó</th>
            <th className="text-right px-3 py-1.5 text-[var(--slate-500)] font-medium whitespace-nowrap">Menny.</th>
            <th className="text-right px-3 py-1.5 text-[var(--slate-500)] font-medium whitespace-nowrap">Anyag e.ár</th>
            <th className="text-right px-3 py-1.5 text-[var(--slate-500)] font-medium whitespace-nowrap">Díj e.ár</th>
            <th className="text-right px-3 py-1.5 text-[var(--slate-500)] font-medium whitespace-nowrap">A+D e.ár</th>
            <th className="px-1 py-1.5" />{/* % e.ár */}
            <th className="px-0 py-1.5 bg-[var(--slate-200)]" />{/* spacer */}
            <th className="text-right px-3 py-1.5 text-[var(--slate-500)] font-medium whitespace-nowrap">Anyag sum.</th>
            <th className="text-right px-3 py-1.5 text-[var(--slate-500)] font-medium whitespace-nowrap">Díj sum.</th>
            <th className="text-right px-3 py-1.5 text-[var(--slate-500)] font-medium whitespace-nowrap">A+D sum.</th>
            <th className="px-1 py-1.5" />{/* % sum. */}
          </tr>
        </thead>
        <tbody>
          {entries.map(({ pv, idx, version }) => {
            const isMinTotal = hasVariance && pv!.combinedTotal === minTotal;
            const isMaxTotal = hasVariance && pv!.combinedTotal === maxTotal;
            const isMinUnit = hasVariance && pv!.combinedUnitPrice === minUnit;
            const isMaxUnit = hasVariance && pv!.combinedUnitPrice === maxUnit;
            const color = getColor(idx);
            const deviationFromMin = minUnit > 0 ? ((pv!.combinedUnitPrice - minUnit) / minUnit) * 100 : 0;
            const totalDeviationFromMin = minTotal > 0 ? ((pv!.combinedTotal - minTotal) / minTotal) * 100 : 0;
            return (
              <tr
                key={idx}
                className={`border-b border-[var(--slate-100)] ${
                  isMinTotal ? "bg-green-50" : isMaxTotal ? "bg-red-50/40" : ""
                }`}
              >
                {/* Alvállalkozó */}
                <td className="px-3 py-1.5 font-medium">
                  <div className={`flex items-center gap-1.5 ${color.text}`}>
                    {isMinTotal && hasVariance && (
                      <span className="shrink-0 text-green-600 text-[12px] leading-none">▼</span>
                    )}
                    {isMaxTotal && hasVariance && (
                      <span className="shrink-0 text-red-600 text-[12px] leading-none">▲</span>
                    )}
                    {!isMinTotal && !isMaxTotal && hasVariance && (
                      <span className="shrink-0 w-[12px]" />
                    )}
                    <span className="truncate max-w-[140px]" title={version.partnerName ?? version.versionName}>
                      {version.partnerName ?? version.versionName}
                    </span>
                  </div>
                </td>
                {/* Menny. */}
                <td className="px-3 py-1.5 text-right text-[var(--slate-600)] whitespace-nowrap">
                  {fmtDetailed(pv!.quantity)} {v.item.unit}
                </td>
                {/* Anyag e.ár */}
                <td className="px-3 py-1.5 text-right text-[var(--slate-700)] whitespace-nowrap">
                  {fmtDetailed(pv!.materialUnitPrice)}
                </td>
                {/* Díj e.ár */}
                <td className="px-3 py-1.5 text-right text-[var(--slate-700)] whitespace-nowrap">
                  {fmtDetailed(pv!.feeUnitPrice)}
                </td>
                {/* A+D e.ár */}
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  <span className={`font-semibold ${isMinUnit ? "text-green-700" : isMaxUnit ? "text-red-700" : "text-[var(--slate-800)]"}`}>
                    {fmtDetailed(pv!.combinedUnitPrice)}
                    {isMinUnit && hasVariance && <span className="ml-0.5 text-[9px] text-green-600">▼</span>}
                    {isMaxUnit && hasVariance && <span className="ml-0.5 text-[9px] text-red-600">▲</span>}
                  </span>
                </td>
                {/* % eltérés e.ár */}
                <td className="pl-1 pr-2 py-1.5 text-left whitespace-nowrap">
                  {!isMinUnit && hasVariance && deviationFromMin > 0 ? (
                    <span className="text-[10px] text-[var(--slate-400)]">(+{deviationFromMin.toFixed(1)}%)</span>
                  ) : <span />}
                </td>
                {/* spacer */}
                <td className="p-0 bg-[var(--slate-100)]" />
                {/* Anyag sum. */}
                <td className="px-3 py-1.5 text-right text-[var(--slate-700)] whitespace-nowrap">
                  {fmt(pv!.materialTotal)}
                </td>
                {/* Díj sum. */}
                <td className="px-3 py-1.5 text-right text-[var(--slate-700)] whitespace-nowrap">
                  {fmt(pv!.feeTotal)}
                </td>
                {/* A+D sum. */}
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  <span className={`font-semibold ${isMinTotal ? "text-green-700" : isMaxTotal ? "text-red-700" : "text-[var(--slate-800)]"}`}>
                    {fmt(pv!.combinedTotal)}
                    {isMinTotal && hasVariance && <span className="ml-0.5 text-[9px] text-green-600">▼</span>}
                    {isMaxTotal && hasVariance && <span className="ml-0.5 text-[9px] text-red-600">▲</span>}
                  </span>
                </td>
                {/* % eltérés sum. */}
                <td className="pl-1 pr-2 py-1.5 text-left whitespace-nowrap">
                  {!isMinTotal && hasVariance && totalDeviationFromMin > 0 ? (
                    <span className="text-[10px] text-[var(--slate-400)]">(+{totalDeviationFromMin.toFixed(1)}%)</span>
                  ) : <span />}
                </td>
              </tr>
            );
          })}
        </tbody>
        {hasVariance && (
          <tfoot>
            <tr className="bg-[var(--slate-100)] border-t-2 border-[var(--slate-300)]">
              <td colSpan={4} className="px-3 py-1.5 text-[var(--slate-500)] font-semibold whitespace-nowrap">
                Eltérés (max − min)
              </td>
              {/* A+D e.ár eltérés */}
              <td className="px-3 py-1.5 text-right font-bold text-red-700 whitespace-nowrap">
                +{fmtDetailed(diffUnit)}
              </td>
              <td className="pl-1 pr-2 py-1.5 text-left whitespace-nowrap">
                <span className="text-[10px] font-normal text-red-500">({diffUnitPct.toFixed(1)}%)</span>
              </td>
              {/* spacer */}
              <td className="p-0 bg-[var(--slate-200)]" />
              {/* Anyag / Díj sum. — nincs */}
              <td className="px-3 py-1.5 text-right text-[var(--slate-400)]">—</td>
              <td className="px-3 py-1.5 text-right text-[var(--slate-400)]">—</td>
              {/* A+D sum. eltérés */}
              <td className="px-3 py-1.5 text-right font-bold text-red-700 whitespace-nowrap">
                +{fmt(diffTotal)}
              </td>
              <td className="pl-1 pr-2 py-1.5 text-left whitespace-nowrap">
                <span className="text-[10px] font-normal text-red-500">({diffTotalPct.toFixed(1)}%)</span>
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

// ---- Variance Analysis View (price outlier detection) ----

type VarianceMode = "percentage" | "absolute" | "total";
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
  /** Max - Min spread (unit prices) */
  spreadCombined: number;
  spreadMaterial: number;
  spreadFee: number;
  /** Percentage spread: (max-min)/avg * 100 */
  spreadPctCombined: number;
  spreadPctMaterial: number;
  spreadPctFee: number;
  /** Volume-weighted total spread: max(qty×price) - min(qty×price) */
  spreadCombinedTotal: number;
  spreadMaterialTotal: number;
  spreadFeeTotal: number;
  /** Min/max indices */
  minCombinedIdx: number;
  maxCombinedIdx: number;
  minCombinedTotalIdx: number;
  maxCombinedTotalIdx: number;
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

      const combinedTotalVals = prices.map((p) => p.combinedTotal);
      const materialTotalVals = prices.map((p) => p.materialTotal);
      const feeTotalVals = prices.map((p) => p.feeTotal);

      const minCT = Math.min(...combinedTotalVals);
      const maxCT = Math.max(...combinedTotalVals);
      const minCTIdx = prices[combinedTotalVals.indexOf(minCT)].idx;
      const maxCTIdx = prices[combinedTotalVals.indexOf(maxCT)].idx;

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
        spreadCombinedTotal: maxCT - minCT,
        spreadMaterialTotal: Math.max(...materialTotalVals) - Math.min(...materialTotalVals),
        spreadFeeTotal: Math.max(...feeTotalVals) - Math.min(...feeTotalVals),
        minCombinedIdx: minCIdx,
        maxCombinedIdx: maxCIdx,
        minCombinedTotalIdx: minCTIdx,
        maxCombinedTotalIdx: maxCTIdx,
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

function VarianceView({
  result,
  skipZero,
  hiddenVersionIdxs,
  orderedVersions,
  referenceVersionIdx,
}: {
  result: MultiComparisonResult;
  skipZero: boolean;
  hiddenVersionIdxs: Set<number>;
  orderedVersions: VersionEntry[];
  referenceVersionIdx: number | null;
}) {
  const [mode, setMode] = useState<VarianceMode>("percentage");
  const [priceField, setPriceField] = useState<PriceField>("combined");
  const [minSpreadPct, setMinSpreadPct] = useState(10);
  const [minSpreadTotal, setMinSpreadTotal] = useState(0);
  const [showAll, setShowAll] = useState(false);
  // Sort by a specific version column: null = sort by spread (default)
  const [sortByVersion, setSortByVersion] = useState<{ idx: number; dir: "asc" | "desc" } | null>(null);
  // Checked rows (by itemCode)
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  // Tooltip state
  const [tooltip, setTooltip] = useState<ItemTooltipState | null>(null);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset sort when the sorted column becomes hidden
  useEffect(() => {
    if (sortByVersion && hiddenVersionIdxs.has(sortByVersion.idx)) {
      setSortByVersion(null);
    }
  }, [hiddenVersionIdxs, sortByVersion]);

  const handleVersionHeaderClick = useCallback((idx: number) => {
    setSortByVersion((prev) => {
      if (!prev || prev.idx !== idx) return { idx, dir: "asc" };
      if (prev.dir === "asc") return { idx, dir: "desc" };
      return null; // third click → back to spread sort
    });
  }, []);

  const handleItemNameEnter = useCallback(
    (e: React.MouseEvent<HTMLTableCellElement>, variance: ItemVariance) => {
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
      const rect = e.currentTarget.getBoundingClientRect();
      const vpH = window.innerHeight;
      const estH = 280;
      const y = rect.bottom + estH > vpH ? rect.top - estH - 4 : rect.bottom + 4;
      setTooltip({ variance, x: rect.left, y });
    },
    [],
  );

  const handleItemNameLeave = useCallback(() => {
    tooltipTimerRef.current = setTimeout(() => setTooltip(null), 160);
  }, []);

  const handleTooltipEnter = useCallback(() => {
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
  }, []);

  const handleTooltipLeave = useCallback(() => {
    tooltipTimerRef.current = setTimeout(() => setTooltip(null), 160);
  }, []);

  const getFieldVal = useCallback(
    (pv: { combinedUnitPrice: number; materialUnitPrice: number; feeUnitPrice: number }) =>
      priceField === "combined" ? pv.combinedUnitPrice
      : priceField === "material" ? pv.materialUnitPrice
      : pv.feeUnitPrice,
    [priceField],
  );

  const getTotalFieldVal = useCallback(
    (pv: { combinedTotal: number; materialTotal: number; feeTotal: number }) =>
      priceField === "combined" ? pv.combinedTotal
      : priceField === "material" ? pv.materialTotal
      : pv.feeTotal,
    [priceField],
  );

  const allVariances = useMemo(() => computeVariances(result.items, skipZero), [result.items, skipZero]);

  const sortedVariances = useMemo(() => {
    let filtered = allVariances;
    if (!showAll) {
      // recalculate spread using only visible versions so the filter is accurate
      filtered = allVariances.filter((v) => {
        if (mode === "total") {
          // Filter by minimum total spread (Ft)
          const totalVals = v.item.perVersion
            .map((pv, i) => (hiddenVersionIdxs.has(i) || !pv ? null : getTotalFieldVal(pv)))
            .filter((p): p is number => p !== null && (!skipZero || p !== 0));
          if (totalVals.length < 2) return false;
          const spread = Math.max(...totalVals) - Math.min(...totalVals);
          return spread >= minSpreadTotal;
        }
        const vals = v.item.perVersion
          .map((pv, i) => (hiddenVersionIdxs.has(i) || !pv ? null : getFieldVal(pv)))
          .filter((p): p is number => p !== null && (!skipZero || p !== 0));
        if (vals.length < 2) return false;
        const avg = vals.reduce((s, x) => s + x, 0) / vals.length;
        const spread = Math.max(...vals) - Math.min(...vals);
        return avg > 0 ? (spread / avg) * 100 >= minSpreadPct : false;
      });
    }

    if (sortByVersion) {
      const { idx, dir } = sortByVersion;
      return [...filtered].sort((a, b) => {
        const aPv = a.item.perVersion[idx];
        const bPv = b.item.perVersion[idx];
        // Use total or unit price depending on current mode
        const aPrice = mode === "total"
          ? (aPv ? getTotalFieldVal(aPv) : null)
          : (aPv ? getFieldVal(aPv) : null);
        const bPrice = mode === "total"
          ? (bPv ? getTotalFieldVal(bPv) : null)
          : (bPv ? getFieldVal(bPv) : null);
        // Items without a price for this vendor go to the end
        if (aPrice === null && bPrice === null) return 0;
        if (aPrice === null) return 1;
        if (bPrice === null) return -1;

        // Helper: visible prices for a given variance row (excluding hidden versions)
        const visiblePrices = (variance: ItemVariance): number[] =>
          variance.item.perVersion
            .map((pv, i) => (hiddenVersionIdxs.has(i) || !pv ? null : mode === "total" ? getTotalFieldVal(pv) : getFieldVal(pv)))
            .filter((p): p is number => p !== null && (!skipZero || p !== 0));

        if (dir === "asc") {
          // Legdrágább elöl: sort by relative surplus over cheapest visible competitor
          const aMin = Math.min(...visiblePrices(a));
          const bMin = Math.min(...visiblePrices(b));
          const aDev = aMin > 0 ? (aPrice - aMin) / aMin : aPrice - aMin;
          const bDev = bMin > 0 ? (bPrice - bMin) / bMin : bPrice - bMin;
          return bDev - aDev;
        } else {
          // Legolcsóbb elöl: sort by relative discount vs most expensive visible competitor
          const aMax = Math.max(...visiblePrices(a));
          const bMax = Math.max(...visiblePrices(b));
          const aDev = aMax > 0 ? (aPrice - aMax) / aMax : aPrice - aMax;
          const bDev = bMax > 0 ? (bPrice - bMax) / bMax : bPrice - bMax;
          return aDev - bDev;
        }
      });
    }

    return [...filtered].sort((a, b) => {
      if (mode === "percentage") {
        const aVal = priceField === "combined" ? a.spreadPctCombined
          : priceField === "material" ? a.spreadPctMaterial : a.spreadPctFee;
        const bVal = priceField === "combined" ? b.spreadPctCombined
          : priceField === "material" ? b.spreadPctMaterial : b.spreadPctFee;
        return bVal - aVal;
      } else if (mode === "total") {
        const aVal = priceField === "combined" ? a.spreadCombinedTotal
          : priceField === "material" ? a.spreadMaterialTotal : a.spreadFeeTotal;
        const bVal = priceField === "combined" ? b.spreadCombinedTotal
          : priceField === "material" ? b.spreadMaterialTotal : b.spreadFeeTotal;
        return bVal - aVal;
      } else {
        const aVal = priceField === "combined" ? a.spreadCombined
          : priceField === "material" ? a.spreadMaterial : a.spreadFee;
        const bVal = priceField === "combined" ? b.spreadCombined
          : priceField === "material" ? b.spreadMaterial : b.spreadFee;
        return bVal - aVal;
      }
    });
  }, [allVariances, mode, priceField, minSpreadPct, minSpreadTotal, showAll, sortByVersion, hiddenVersionIdxs, skipZero, getFieldVal, getTotalFieldVal]);

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
            Szórás %
          </button>
          <button
            onClick={() => setMode("absolute")}
            className={`px-2.5 py-[4px] text-xs cursor-pointer transition-colors ${
              mode === "absolute"
                ? "bg-[var(--indigo-600)] text-white"
                : "text-[var(--slate-600)] hover:bg-[var(--slate-50)]"
            }`}
          >
            E.ár Ft
          </button>
          <button
            onClick={() => setMode("total")}
            title="Szumma szórás: (max − min) egységár × mennyiség — a volumen miatt nagy pénzügyi hatású tételek"
            className={`px-2.5 py-[4px] text-xs cursor-pointer transition-colors ${
              mode === "total"
                ? "bg-[var(--indigo-600)] text-white"
                : "text-[var(--slate-600)] hover:bg-[var(--slate-50)]"
            }`}
          >
            Szumma Ft
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
            A+D
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
        {!showAll && mode !== "total" && (
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
        {!showAll && mode === "total" && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--slate-400)]">Min. szumma szórás:</span>
            <select
              value={minSpreadTotal}
              onChange={(e) => setMinSpreadTotal(Number(e.target.value))}
              className="h-6 px-1.5 border border-[var(--slate-200)] rounded text-xs outline-none bg-white"
            >
              <option value={0}>Összes</option>
              <option value={1000}>1 000 Ft</option>
              <option value={5000}>5 000 Ft</option>
              <option value={10000}>10 000 Ft</option>
              <option value={50000}>50 000 Ft</option>
              <option value={100000}>100 000 Ft</option>
              <option value={500000}>500 000 Ft</option>
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
                <th className="text-center px-1 py-2 text-[var(--slate-500)] font-medium sticky left-0 bg-[var(--slate-50)] z-10 w-[32px]">
                  <input
                    type="checkbox"
                    checked={sortedVariances.length > 0 && sortedVariances.every((v) => checkedItems.has(v.item.itemCode))}
                    onChange={(e) => {
                      setCheckedItems((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) {
                          sortedVariances.forEach((v) => next.add(v.item.itemCode));
                        } else {
                          sortedVariances.forEach((v) => next.delete(v.item.itemCode));
                        }
                        return next;
                      });
                    }}
                    className="rounded border-[var(--slate-300)] cursor-pointer"
                  />
                </th>
                <th className="text-left px-3 py-2 text-[var(--slate-500)] font-medium min-w-[60px]">
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
                {orderedVersions.map(({ version: v, originalIdx }) => {
                  if (hiddenVersionIdxs.has(originalIdx)) return null;
                  const color = getColor(originalIdx);
                  const isRef = originalIdx === referenceVersionIdx;
                  const isSorted = sortByVersion?.idx === originalIdx;
                  return (
                    <th
                      key={v.versionId}
                      className={`text-right px-3 py-2 font-medium min-w-[100px] ${isRef ? "bg-amber-100 text-amber-800" : `${color.text} ${color.header}`}`}
                    >
                      <button
                        onClick={() => handleVersionHeaderClick(originalIdx)}
                        className="w-full text-right cursor-pointer hover:underline flex items-center justify-end gap-0.5"
                        title={isSorted ? (sortByVersion!.dir === "asc" ? "Legdrágább elöl (hol volt ez az alvállalkozó a legdrágább) — kattints a fordításhoz" : "Legolcsóbb elöl (hol volt ez az alvállalkozó a legolcsóbb) — kattints az alapértelmezetthez") : `Rendezés szórás szerint: ${v.partnerName ?? v.versionName}`}
                      >
                        {isRef && <Pin size={8} className="shrink-0 text-amber-500" />}
                        <span className="truncate text-[10px]">{v.partnerName ?? v.versionName}</span>
                        {isSorted ? (
                          sortByVersion!.dir === "asc"
                            ? <ChevronUp size={10} className="shrink-0 text-red-500" />
                            : <ChevronDown size={10} className="shrink-0 text-green-600" />
                        ) : (
                          <ArrowUpDown size={9} className="opacity-30 shrink-0" />
                        )}
                      </button>
                    </th>
                  );
                })}
                <th className="text-right px-3 py-2 text-[var(--slate-500)] font-medium min-w-[90px] whitespace-nowrap">
                  <span className="flex items-center justify-end gap-0.5">
                    <ArrowUpDown size={10} />
                    {mode === "percentage" ? "Szórás %" : mode === "total" ? "Szumma szórás" : "Szórás Ft"}
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
                  <td colSpan={7 + orderedVersions.length - hiddenVersionIdxs.size} className="px-3 py-8 text-center text-[var(--slate-400)]">
                    Nincs a szűrési feltételeknek megfelelő tétel.
                  </td>
                </tr>
              )}
              {sortedVariances.map((v, rowIdx) => {
                const spreadPct = priceField === "combined" ? v.spreadPctCombined
                  : priceField === "material" ? v.spreadPctMaterial : v.spreadPctFee;
                const spreadAbs = priceField === "combined" ? v.spreadCombined
                  : priceField === "material" ? v.spreadMaterial : v.spreadFee;
                const spreadTotal = priceField === "combined" ? v.spreadCombinedTotal
                  : priceField === "material" ? v.spreadMaterialTotal : v.spreadFeeTotal;
                const severity = getSeverity(spreadPct);

                // Per-version display values: unit price or total depending on mode
                const displayPrices = v.item.perVersion.map((pv, i) => {
                  if (hiddenVersionIdxs.has(i)) return "hidden" as const;
                  if (!pv) return null;
                  return mode === "total" ? getTotalFieldVal(pv) : getFieldVal(pv);
                });

                // Min/max only among visible, non-zero prices
                const visibleDisplayPrices = displayPrices.filter(
                  (p): p is number => typeof p === "number" && (!skipZero || p !== 0),
                );
                const minPrice = visibleDisplayPrices.length > 1 ? Math.min(...visibleDisplayPrices) : -Infinity;
                const maxPrice = visibleDisplayPrices.length > 1 ? Math.max(...visibleDisplayPrices) : Infinity;

                return (
                  <tr
                    key={v.item.itemCode}
                    className={`border-b border-[var(--slate-100)] hover:bg-[var(--slate-50)] ${
                      spreadPct >= 100 ? "bg-red-50/50" : spreadPct >= 50 ? "bg-orange-50/30" : ""
                    }`}
                  >
                    <td className="px-1 py-2 text-center sticky left-0 bg-inherit z-10">
                      <input
                        type="checkbox"
                        checked={checkedItems.has(v.item.itemCode)}
                        onChange={() => {
                          setCheckedItems((prev) => {
                            const next = new Set(prev);
                            if (next.has(v.item.itemCode)) next.delete(v.item.itemCode);
                            else next.add(v.item.itemCode);
                            return next;
                          });
                        }}
                        className="rounded border-[var(--slate-300)] cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-2 text-[var(--slate-400)]">
                      {rowIdx + 1}
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-[var(--slate-500)]">
                      {v.item.itemNumber || "—"}
                    </td>
                    <td
                      className="px-3 py-2 text-[var(--slate-800)] cursor-help"
                      onMouseEnter={(e) => handleItemNameEnter(e, v)}
                      onMouseLeave={handleItemNameLeave}
                    >
                      <div
                        className="truncate max-w-[250px] underline decoration-dotted decoration-[var(--slate-300)] underline-offset-2"
                        title="Húzza fölé a részletes árak megjelenítéséhez"
                      >
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
                    {orderedVersions.map(({ originalIdx }) => {
                      const price = displayPrices[originalIdx];
                      if (price === "hidden" || price === undefined) return null;
                      const isRef = originalIdx === referenceVersionIdx;
                      if (price === null) {
                        return (
                          <td key={originalIdx} className={`px-3 py-2 text-right text-[var(--slate-300)] ${isRef ? "bg-amber-50/40" : ""}`}>
                            —
                          </td>
                        );
                      }
                      const isMin = price === minPrice && visibleDisplayPrices.length > 1;
                      const isMax = price === maxPrice && visibleDisplayPrices.length > 1;
                      // Deviation from reference
                      const refRawPrice = referenceVersionIdx !== null ? displayPrices[referenceVersionIdx] : null;
                      const refPrice = typeof refRawPrice === "number" ? refRawPrice : null;
                      const refDiff = !isRef && refPrice !== null ? price - refPrice : null;
                      const refDiffPct = refDiff !== null && refPrice !== null && refPrice > 0
                        ? (refDiff / refPrice) * 100 : null;
                      return (
                        <td key={originalIdx} className={`px-3 py-2 text-right ${isRef ? "bg-amber-50/40" : ""}`}>
                          <span
                            className={`font-medium ${
                              isRef ? "text-amber-700" : isMin ? "text-green-700" : isMax ? "text-red-700" : "text-[var(--slate-700)]"
                            }`}
                          >
                            {mode === "total" ? fmt(price) : fmtDetailed(price)}
                          </span>
                          {isRef && <span className="ml-0.5 text-[9px] text-amber-500">◆</span>}
                          {!isRef && isMin && <span className="ml-0.5 text-[9px] text-green-600">▼</span>}
                          {!isRef && isMax && <span className="ml-0.5 text-[9px] text-red-600">▲</span>}
                          {refDiff !== null && refDiffPct !== null && (
                            <div className={`text-[9px] leading-tight ${refDiff > 0 ? "text-red-500" : refDiff < 0 ? "text-green-600" : "text-[var(--slate-400)]"}`}>
                              {refDiff >= 0 ? "+" : ""}{refDiffPct.toFixed(1)}%
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right font-bold whitespace-nowrap">
                      {mode === "percentage" ? (
                        <span className={severity.cls}>{spreadPct.toFixed(1)}%</span>
                      ) : mode === "total" ? (
                        <span className={severity.cls}>{fmt(spreadTotal)}</span>
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

      {/* Item detail tooltip rendered in a portal to avoid overflow clipping */}
      {typeof document !== "undefined" && tooltip &&
        createPortal(
          <ItemDetailTooltip
            state={tooltip}
            versions={versions}
            hiddenVersionIdxs={hiddenVersionIdxs}
            skipZero={skipZero}
            onEnter={handleTooltipEnter}
            onLeave={handleTooltipLeave}
          />,
          document.body,
        )}
    </div>
  );
}

// ---- Main Component ----

export function MultiVersionComparison({
  versionIds,
  versionNames,
  onBack,
  budgetId,
  initialState,
}: MultiVersionComparisonProps) {
  void versionNames;
  const [result, setResult] = useState<MultiComparisonResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>(initialState?.viewMode ?? "overview");
  const [skipZero, setSkipZero] = useState(initialState?.skipZero ?? false);
  const [saveName, setSaveName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  // Version indices hidden from ALL comparison views (uses originalIdx)
  const [hiddenVersionIdxs, setHiddenVersionIdxs] = useState<Set<number>>(
    new Set(initialState?.hiddenVersionIdxs ?? [])
  );
  // Display order (array of originalIdx values)
  const [versionOrder, setVersionOrder] = useState<number[]>(initialState?.versionOrder ?? []);
  // Reference version (originalIdx), null = none
  const [referenceVersionIdx, setReferenceVersionIdx] = useState<number | null>(
    initialState?.referenceVersionIdx ?? null
  );
  // DnD state
  const dragSourceRef = useRef<number | null>(null);
  const [dragOverSeq, setDragOverSeq] = useState<number | null>(null);
  const [dragOverRef, setDragOverRef] = useState(false);

  const toggleVersionHide = useCallback((idx: number) => {
    setHiddenVersionIdxs((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent, originalIdx: number) => {
    dragSourceRef.current = originalIdx;
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDropOnPill = useCallback((e: React.DragEvent, targetOriginalIdx: number) => {
    e.preventDefault();
    const src = dragSourceRef.current;
    if (src === null || src === targetOriginalIdx) {
      dragSourceRef.current = null;
      setDragOverSeq(null);
      return;
    }
    setVersionOrder((prev) => {
      const next = [...prev];
      const fromPos = next.indexOf(src);
      const toPos = next.indexOf(targetOriginalIdx);
      next.splice(fromPos, 1);
      next.splice(toPos, 0, src);
      return next;
    });
    dragSourceRef.current = null;
    setDragOverSeq(null);
  }, []);

  const handleDropOnReference = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const src = dragSourceRef.current;
    if (src !== null) {
      setReferenceVersionIdx((prev) => (prev === src ? null : src));
    }
    dragSourceRef.current = null;
    setDragOverRef(false);
  }, []);

  // Ordered version entries derived from versionOrder
  const orderedVersions = useMemo<VersionEntry[]>(
    () => (result && versionOrder.length > 0 ? versionOrder.map((i) => ({ version: result.versions[i], originalIdx: i })) : []),
    [result, versionOrder],
  );

  useEffect(() => {
    setLoading(true);
    compareMultipleVersions(versionIds).then((data) => {
      setResult(data);
      // Only reset order/reference if no saved state was provided
      if (!initialState?.versionOrder?.length) {
        setVersionOrder(data.versions.map((_, i) => i));
      }
      if (initialState?.referenceVersionIdx === undefined) {
        setReferenceVersionIdx(null);
      }
      setLoading(false);
    });
  }, [versionIds]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <div className="flex items-center gap-1 ml-2 flex-wrap">
          {/* Reference drop slot */}
          <div
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full border-2 border-dashed transition-all cursor-default ${
              dragOverRef
                ? "border-amber-400 bg-amber-100 text-amber-700 scale-105"
                : referenceVersionIdx !== null
                ? "border-amber-400 bg-amber-50 text-amber-700"
                : "border-[var(--slate-300)] text-[var(--slate-400)] hover:border-amber-300 hover:text-amber-500"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOverRef(true); }}
            onDragLeave={() => setDragOverRef(false)}
            onDrop={handleDropOnReference}
            title="Húzzon ide egy verziót referenciának, vagy kattintson a gombostű ikonra"
          >
            <Pin size={9} className="shrink-0" />
            {referenceVersionIdx !== null ? (
              <>
                <span className="max-w-[120px] truncate">{result.versions[referenceVersionIdx].versionName}</span>
                <button
                  className="ml-0.5 hover:text-red-500 cursor-pointer leading-none"
                  onClick={() => setReferenceVersionIdx(null)}
                  title="Referencia törlése"
                >
                  <X size={9} />
                </button>
              </>
            ) : (
              <span>Referencia</span>
            )}
          </div>
          {/* Version pills — draggable + pin + hide */}
          {orderedVersions.map(({ version: v, originalIdx }) => {
            const color = getColor(originalIdx);
            const isHidden = hiddenVersionIdxs.has(originalIdx);
            const isRef = originalIdx === referenceVersionIdx;
            const isDragOver = dragOverSeq === originalIdx;
            return (
              <div
                key={v.versionId}
                draggable
                onDragStart={(e) => handleDragStart(e, originalIdx)}
                onDragOver={(e) => { e.preventDefault(); setDragOverSeq(originalIdx); }}
                onDragLeave={() => setDragOverSeq(null)}
                onDrop={(e) => handleDropOnPill(e, originalIdx)}
                onDragEnd={() => { setDragOverSeq(null); setDragOverRef(false); dragSourceRef.current = null; }}
                onClick={() => toggleVersionHide(originalIdx)}
                className={`group/pill relative inline-flex items-center gap-0.5 pl-1 pr-1.5 py-0.5 text-[10px] font-medium rounded-full border cursor-grab active:cursor-grabbing transition-all select-none ${
                  isDragOver ? "ring-2 ring-[var(--indigo-400)] scale-105" : ""
                } ${
                  isHidden
                    ? "opacity-35 grayscale bg-[var(--slate-100)] text-[var(--slate-400)] border-[var(--slate-200)] line-through"
                    : isRef
                    ? "bg-amber-50 text-amber-700 border-amber-400 ring-1 ring-amber-300"
                    : `${color.bg} ${color.text} ${color.border} hover:opacity-80`
                }`}
                title={isHidden ? "Kattints a visszavételhez" : "Kattints a kizáráshoz / húzd a sorrendezéshez"}
              >
                <GripVertical size={9} className="text-[var(--slate-300)] shrink-0" />
                {v.versionName}
                {!isHidden && v.notes && (
                  <>
                    <MessageSquare size={9} className="text-[var(--amber-500)] shrink-0" />
                    <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 hidden group-hover/pill:block z-50 w-max max-w-[260px] px-2.5 py-1.5 rounded-md bg-[var(--slate-800)] text-[10px] text-white shadow-lg whitespace-pre-wrap pointer-events-none font-normal">
                      {v.notes}
                    </span>
                  </>
                )}
                {/* Pin/unpin reference */}
                {!isHidden && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setReferenceVersionIdx((prev) => (prev === originalIdx ? null : originalIdx));
                    }}
                    className={`shrink-0 cursor-pointer transition-opacity ${isRef ? "opacity-100 text-amber-500" : "opacity-0 group-hover/pill:opacity-40 hover:!opacity-100"}`}
                    title={isRef ? "Referencia megszüntetése" : "Beállítás referenciának"}
                  >
                    <Pin size={8} />
                  </button>
                )}
              </div>
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
        {/* Save comparison */}
        {budgetId && (
          <div className="relative mr-2">
            {showSaveDialog ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && saveName.trim()) {
                      setSaving(true);
                      const names = result!.versions.map((v) => v.versionName);
                      const state: MultiCompareState = {
                        viewMode,
                        skipZero,
                        hiddenVersionIdxs: Array.from(hiddenVersionIdxs),
                        versionOrder,
                        referenceVersionIdx,
                      };
                      createSavedComparison(budgetId, saveName.trim(), versionIds, names, "multi", state).then(() => {
                        setSaving(false);
                        setShowSaveDialog(false);
                        setSaveName("");
                      });
                    }
                    if (e.key === "Escape") setShowSaveDialog(false);
                  }}
                  placeholder="Összehasonlítás neve…"
                  className="text-xs border border-[var(--indigo-300)] rounded px-2 py-[3px] w-48 focus:outline-none focus:ring-1 focus:ring-[var(--indigo-400)]"
                />
                <button
                  disabled={!saveName.trim() || saving}
                  onClick={() => {
                    if (!saveName.trim()) return;
                    setSaving(true);
                    const names = result!.versions.map((v) => v.versionName);
                    const state: MultiCompareState = {
                      viewMode,
                      skipZero,
                      hiddenVersionIdxs: Array.from(hiddenVersionIdxs),
                      versionOrder,
                      referenceVersionIdx,
                    };
                    createSavedComparison(budgetId, saveName.trim(), versionIds, names, "multi", state).then(() => {
                      setSaving(false);
                      setShowSaveDialog(false);
                      setSaveName("");
                    });
                  }}
                  className="px-2 py-[3px] rounded text-xs bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] cursor-pointer transition-colors disabled:opacity-40"
                >
                  {saving ? "…" : "Mentés"}
                </button>
                <button
                  onClick={() => setShowSaveDialog(false)}
                  className="px-1.5 py-[3px] rounded text-xs text-[var(--slate-400)] hover:bg-[var(--slate-100)] cursor-pointer"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  const defaultName = result!.versions.map((v) => v.versionName).join(" vs ");
                  setSaveName(defaultName);
                  setShowSaveDialog(true);
                }}
                className="flex items-center gap-1 px-2.5 py-[4px] text-xs border border-[var(--slate-200)] rounded-[6px] text-[var(--slate-600)] hover:bg-[var(--indigo-50)] hover:text-[var(--indigo-600)] hover:border-[var(--indigo-200)] cursor-pointer transition-colors"
                title="Összehasonlítás mentése"
              >
                <Save size={12} />
                Mentés
              </button>
            )}
          </div>
        )}
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
        {viewMode === "overview" && <OverviewView result={result} skipZero={skipZero} hiddenVersionIdxs={hiddenVersionIdxs} orderedVersions={orderedVersions} referenceVersionIdx={referenceVersionIdx} />}
        {viewMode === "sections" && <SectionsView result={result} skipZero={skipZero} hiddenVersionIdxs={hiddenVersionIdxs} orderedVersions={orderedVersions} referenceVersionIdx={referenceVersionIdx} />}
        {viewMode === "variance" && <VarianceView result={result} skipZero={skipZero} hiddenVersionIdxs={hiddenVersionIdxs} orderedVersions={orderedVersions} referenceVersionIdx={referenceVersionIdx} />}
      </div>
    </div>
  );
}
