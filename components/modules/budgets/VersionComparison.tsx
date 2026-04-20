"use client";

import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowLeftRight, Plus, Minus, RefreshCw, MoveRight, Layers, ChevronDown, ChevronRight, Eye, EyeOff, MessageSquare, Save, X } from "lucide-react";
import {
  compareVersions,
  type ComparisonResult,
  type ComparisonItem,
  type SectionTotals,
  type ReconstructedItem,
  type ReconstructedSection,
} from "@/server/actions/versions";
import { createSavedComparison, type SimpleCompareState } from "@/server/actions/comparisons";

interface VersionComparisonProps {
  versionAId: number;
  versionBId: number;
  nameA: string;
  nameB: string;
  onBack: () => void;
  budgetId?: number;
  initialState?: SimpleCompareState;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 2 }).format(n);
}

function delta(n: number) {
  if (n === 0) return null;
  return (
    <span className={n > 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
      {n > 0 ? "+" : ""}{fmt(n)}
    </span>
  );
}

const STATUS_LABELS: Record<"added" | "removed" | "changed" | "unchanged", { label: string; cls: string; rowBg: string }> = {
  added:     { label: "Új",          cls: "text-green-700",          rowBg: "bg-green-50" },
  removed:   { label: "Törölt",      cls: "text-red-700",            rowBg: "bg-red-50" },
  changed:   { label: "Módosult",    cls: "text-amber-700",          rowBg: "bg-amber-50" },
  unchanged: { label: "Változatlan", cls: "text-[var(--slate-500)]", rowBg: "" },
};

type ViewMode = "items" | "sections";

// ---- Display item for the grouped items view ----

interface DisplayItem {
  key: string;
  itemCode: string;
  status: "added" | "removed" | "changed" | "unchanged";
  item: ReconstructedItem;
  itemBefore?: ReconstructedItem;
  materialDelta?: number;
  feeDelta?: number;
  isMoveSource?: boolean;
  isMoveTarget?: boolean;
}

interface SectionGroup {
  sectionCode: string | null;
  sectionName: string;
  depth: number;
  items: DisplayItem[];
  children: SectionGroup[];
}

function buildDisplayItems(items: ComparisonItem[], showUnchanged: boolean): DisplayItem[] {
  const display: DisplayItem[] = [];
  for (const item of items) {
    if (item.status === "unchanged" && !showUnchanged) continue;

    if (item.status === "changed" && item.sectionChanged && item.itemA && item.itemB) {
      // Item moved between sections: show as removed in the original section,
      // and as added in the new section.
      display.push({
        key: `${item.itemCode}-src`,
        itemCode: item.itemCode,
        status: "removed",
        item: item.itemA,
        isMoveSource: true,
      });
      display.push({
        key: `${item.itemCode}-tgt`,
        itemCode: item.itemCode,
        status: "added",
        item: item.itemB,
        isMoveTarget: true,
        materialDelta: item.materialDelta,
        feeDelta: item.feeDelta,
      });
    } else {
      const displayItem = item.itemB ?? item.itemA;
      if (!displayItem) continue;
      display.push({
        key: item.itemCode,
        itemCode: item.itemCode,
        status: item.status,
        item: displayItem,
        itemBefore: item.status === "changed" ? item.itemA : undefined,
        materialDelta: item.materialDelta,
        feeDelta: item.feeDelta,
      });
    }
  }
  return display;
}

function buildSectionGroups(
  sections: ReconstructedSection[],
  displayItems: DisplayItem[],
  parentCode: string | null,
  depth: number
): SectionGroup[] {
  return sections
    .filter((s) => s.parentSectionCode === parentCode)
    .sort((a, b) => a.sequenceNo - b.sequenceNo)
    .map((sec) => ({
      sectionCode: sec.sectionCode,
      sectionName: sec.name,
      depth,
      items: displayItems.filter((d) => d.item.sectionCode === sec.sectionCode),
      children: buildSectionGroups(sections, displayItems, sec.sectionCode, depth + 1),
    }));
}

function countGroupVisible(group: SectionGroup): number {
  return group.items.length + group.children.reduce((s, c) => s + countGroupVisible(c), 0);
}

interface GroupTotals {
  matCurrent: number;
  feeCurrent: number;
  matDelta: number;
  feeDelta: number;
}

function computeGroupTotals(group: SectionGroup): GroupTotals {
  const childTotals = group.children.map(computeGroupTotals);
  const matCurrent = group.items
    .filter((d) => d.status !== "removed")
    .reduce((s, d) => s + d.item.quantity * d.item.materialUnitPrice, 0)
    + childTotals.reduce((s, t) => s + t.matCurrent, 0);
  const feeCurrent = group.items
    .filter((d) => d.status !== "removed")
    .reduce((s, d) => s + d.item.quantity * d.item.feeUnitPrice, 0)
    + childTotals.reduce((s, t) => s + t.feeCurrent, 0);
  const matDelta = group.items
    .reduce((s, d) => s + (d.materialDelta ?? 0), 0)
    + childTotals.reduce((s, t) => s + t.matDelta, 0);
  const feeDelta = group.items
    .reduce((s, d) => s + (d.feeDelta ?? 0), 0)
    + childTotals.reduce((s, t) => s + t.feeDelta, 0);
  return { matCurrent, feeCurrent, matDelta, feeDelta };
}

// ---- Section totals row (Fejezetek tab) ----

function SectionTotalsRow({
  totalsA,
  totalsB,
  depth = 0,
  ignorePrice = false,
}: {
  totalsA: SectionTotals | undefined;
  totalsB: SectionTotals | undefined;
  depth?: number;
  ignorePrice?: boolean;
}) {
  const name = totalsA?.sectionName ?? totalsB?.sectionName ?? "";
  const matA = totalsA?.materialTotal ?? 0;
  const feeA = totalsA?.feeTotal ?? 0;
  const matB = totalsB?.materialTotal ?? 0;
  const feeB = totalsB?.feeTotal ?? 0;
  const cntA = totalsA?.itemCount ?? 0;
  const cntB = totalsB?.itemCount ?? 0;
  const indent = depth * 16;

  const childNames = new Set([
    ...(totalsA?.children.map((c) => c.sectionName) ?? []),
    ...(totalsB?.children.map((c) => c.sectionName) ?? []),
  ]);

  return (
    <>
      <tr className={depth === 0 ? "bg-amber-50 font-semibold" : "bg-[#fffbf0]"}>
        <td className="px-3 py-2 border-b border-amber-100" style={{ paddingLeft: 12 + indent }}>
          <span className="text-xs text-amber-900">{name}</span>
        </td>
        <td className="px-3 py-2 border-b border-amber-100 text-right text-xs">{cntA}</td>
        <td className="px-3 py-2 border-b border-amber-100 text-right text-xs">{fmt(matA)}</td>
        <td className="px-3 py-2 border-b border-amber-100 text-right text-xs">{fmt(feeA)}</td>
        <td className="px-3 py-2 border-b border-amber-100 text-right text-xs">{cntB}</td>
        <td className="px-3 py-2 border-b border-amber-100 text-right text-xs">{fmt(matB)}</td>
        <td className="px-3 py-2 border-b border-amber-100 text-right text-xs">{fmt(feeB)}</td>
        <td className="px-3 py-2 border-b border-amber-100 text-right text-xs">{!ignorePrice && delta(matB - matA)}</td>
        <td className="px-3 py-2 border-b border-amber-100 text-right text-xs">{!ignorePrice && delta(feeB - feeA)}</td>
      </tr>
      {[...childNames].map((childName) => {
        const childA = totalsA?.children.find((c) => c.sectionName === childName);
        const childB = totalsB?.children.find((c) => c.sectionName === childName);
        return (
          <SectionTotalsRow
            key={childName}
            totalsA={childA}
            totalsB={childB}
            depth={depth + 1}
            ignorePrice={ignorePrice}
          />
        );
      })}
    </>
  );
}

// ---- Hover tooltip showing field-level diff for changed items ----

interface ChangeTooltipProps {
  itemBefore: ReconstructedItem;
  itemAfter: ReconstructedItem;
  position: { x: number; y: number };
}

function ChangeTooltip({ itemBefore, itemAfter, position }: ChangeTooltipProps) {
  type FieldDef = { label: string; key: keyof ReconstructedItem; format?: (v: unknown) => string };
  const fields: FieldDef[] = [
    { label: "Megnevezés",  key: "name" },
    { label: "Tételszám",   key: "itemNumber" },
    { label: "Mennyiség",   key: "quantity",          format: (v) => fmt(v as number) },
    { label: "Egység",      key: "unit" },
    { label: "Anyag Eár",   key: "materialUnitPrice", format: (v) => fmt(v as number) },
    { label: "Díj Eár",     key: "feeUnitPrice",      format: (v) => fmt(v as number) },
    { label: "Megjegyzés",  key: "notes" },
  ];

  const changed = fields.filter((f) => itemBefore[f.key] !== itemAfter[f.key]);
  if (changed.length === 0) return null;

  // Keep tooltip inside viewport
  const left = Math.min(position.x + 14, window.innerWidth - 420);
  const top  = Math.min(position.y + 14, window.innerHeight - 40 - changed.length * 28);

  return createPortal(
    <div
      className="fixed z-[9999] bg-white border border-[var(--slate-200)] rounded-[8px] shadow-xl p-3 pointer-events-none"
      style={{ left, top, minWidth: 280, maxWidth: 440 }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--slate-400)] mb-2">Változások</div>
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr>
            <th className="text-left font-medium text-[var(--slate-500)] pr-3 pb-1">Mező</th>
            <th className="text-left font-medium text-red-600 pr-3 pb-1">Volt</th>
            <th className="text-left font-medium text-green-700 pb-1">Lett</th>
          </tr>
        </thead>
        <tbody>
          {changed.map((f) => {
            const before = f.format ? f.format(itemBefore[f.key]) : String(itemBefore[f.key] ?? "—");
            const after  = f.format ? f.format(itemAfter[f.key])  : String(itemAfter[f.key]  ?? "—");
            return (
              <tr key={f.key} className="border-t border-[var(--slate-100)]">
                <td className="py-1 pr-3 text-[var(--slate-500)] whitespace-nowrap">{f.label}</td>
                <td className="py-1 pr-3 text-red-700 line-through opacity-75 whitespace-nowrap">{before || "—"}</td>
                <td className="py-1 text-green-700 font-medium whitespace-nowrap">{after || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>,
    document.body
  );
}

// ---- Item row in the grouped items view ----

function ItemRow({ d, showQtyChange, ignorePrice }: { d: DisplayItem; showQtyChange: boolean; ignorePrice: boolean }) {
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const hasDetail = d.status === "changed" && !!d.itemBefore;

  const st = STATUS_LABELS[d.status];
  const itm = d.item;
  const matTotal = itm.quantity * itm.materialUnitPrice;
  const feeTotal = itm.quantity * itm.feeUnitPrice;

  // Quantity change detection
  const qtyChanged = d.itemBefore && d.itemBefore.quantity !== itm.quantity;

  return (
    <tr
      className={`${st.rowBg}${hasDetail ? " cursor-help" : ""}`}
      onMouseMove={hasDetail ? (e) => setTooltipPos({ x: e.clientX, y: e.clientY }) : undefined}
      onMouseLeave={hasDetail ? () => setTooltipPos(null) : undefined}
    >
      {hasDetail && tooltipPos && d.itemBefore && (
        <ChangeTooltip itemBefore={d.itemBefore} itemAfter={d.item} position={tooltipPos} />
      )}
      <td className="px-3 py-2 border-b border-[var(--slate-100)]">
        <div className="flex items-center gap-1">
          <span className={`text-[11px] font-medium ${st.cls}`}>{st.label}</span>
          {(d.isMoveSource || d.isMoveTarget) && (
            <span title={d.isMoveSource ? "Áthelyezve innen" : "Áthelyezve ide"}>
              <MoveRight size={10} className="text-purple-500" />
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 border-b border-[var(--slate-100)] font-mono text-[11px]">{itm.itemNumber || "—"}</td>
      <td className="px-3 py-2 border-b border-[var(--slate-100)]">{itm.name}</td>
      <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right">{fmt(itm.quantity)}</td>
      <td className="px-3 py-2 border-b border-[var(--slate-100)]">{itm.unit}</td>
      {showQtyChange && (
        <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right">
          {qtyChanged ? (
            <span className="text-[11px]">
              <span className="text-red-600 line-through">{fmt(d.itemBefore!.quantity)}</span>
              <span className="mx-0.5 text-[var(--slate-400)]">→</span>
              <span className="text-green-700 font-medium">{fmt(itm.quantity)}</span>
            </span>
          ) : (
            <span className="text-[var(--slate-300)]">—</span>
          )}
        </td>
      )}
      <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right">{fmt(itm.materialUnitPrice)}</td>
      <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right">{fmt(itm.feeUnitPrice)}</td>
      <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right font-medium">{fmt(matTotal)}</td>
      <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right font-medium">{fmt(feeTotal)}</td>
      <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right">{!ignorePrice && delta(d.materialDelta ?? 0)}</td>
      <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right">{!ignorePrice && delta(d.feeDelta ?? 0)}</td>
    </tr>
  );
}

// ---- Section group header + contents ----

function SectionGroupView({ group, showQtyChange, ignorePrice }: { group: SectionGroup; showQtyChange: boolean; ignorePrice: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const total = countGroupVisible(group);
  if (total === 0) return null;
  const indent = group.depth * 16;
  const totals = computeGroupTotals(group);
  const hasAnyDelta = !ignorePrice && (totals.matDelta !== 0 || totals.feeDelta !== 0);

  return (
    <>
      <tr
        className={`cursor-pointer select-none ${group.depth === 0 ? "bg-indigo-50 border-l-2 border-indigo-400" : "bg-[var(--slate-100)]"}`}
        onClick={() => setCollapsed((c) => !c)}
      >
        {/* col 1-N: label + empty spacers */}
        <td className="px-3 py-1.5 border-b border-[var(--slate-200)]" colSpan={showQtyChange ? 8 : 7} style={{ paddingLeft: 12 + indent }}>
          <span className="flex items-center gap-1">
            {collapsed
              ? <ChevronRight size={12} className="text-[var(--slate-500)] shrink-0" />
              : <ChevronDown size={12} className="text-[var(--slate-500)] shrink-0" />
            }
            <span className={`text-xs font-semibold ${group.depth === 0 ? "text-indigo-800" : "text-[var(--slate-700)]"}`}>
              {group.sectionName}
            </span>
            <span className="ml-1.5 text-[10px] text-[var(--slate-400)]">{total} tétel</span>
          </span>
        </td>
        {/* col 8: Anyag össz. */}
        <td className="px-3 py-1.5 border-b border-[var(--slate-200)] text-right">
          <span className={`text-[11px] font-semibold ${group.depth === 0 ? "text-indigo-800" : "text-[var(--slate-700)]"}`}>
            {fmt(totals.matCurrent)}
          </span>
        </td>
        {/* col 9: Díj össz. */}
        <td className="px-3 py-1.5 border-b border-[var(--slate-200)] text-right">
          <span className={`text-[11px] font-semibold ${group.depth === 0 ? "text-indigo-800" : "text-[var(--slate-700)]"}`}>
            {fmt(totals.feeCurrent)}
          </span>
        </td>
        {/* col 10: Δ Anyag */}
        <td className="px-3 py-1.5 border-b border-[var(--slate-200)] text-right">
          {hasAnyDelta && (
            <span className={`text-[11px] font-semibold ${totals.matDelta > 0 ? "text-green-700" : totals.matDelta < 0 ? "text-red-700" : "text-[var(--slate-500)]"}`}>
              {totals.matDelta > 0 ? "+" : ""}{fmt(totals.matDelta)}
            </span>
          )}
        </td>
        {/* col 11: Δ Díj */}
        <td className="px-3 py-1.5 border-b border-[var(--slate-200)] text-right">
          {hasAnyDelta && (
            <span className={`text-[11px] font-semibold ${totals.feeDelta > 0 ? "text-green-700" : totals.feeDelta < 0 ? "text-red-700" : "text-[var(--slate-500)]"}`}>
              {totals.feeDelta > 0 ? "+" : ""}{fmt(totals.feeDelta)}
            </span>
          )}
        </td>
      </tr>
      {!collapsed && (
        <>
          {group.children.map((child) => (
            <SectionGroupView key={child.sectionCode ?? "__null__"} group={child} showQtyChange={showQtyChange} ignorePrice={ignorePrice} />
          ))}
          {group.items.map((d) => (
            <ItemRow key={d.key} d={d} showQtyChange={showQtyChange} ignorePrice={ignorePrice} />
          ))}
        </>
      )}
    </>
  );
}

export function VersionComparison({
  versionAId,
  versionBId,
  nameA,
  nameB,
  onBack,
  budgetId,
  initialState,
}: VersionComparisonProps) {
  const [swapped, setSwapped] = useState(initialState?.swapped ?? false);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [showUnchanged, setShowUnchanged] = useState(initialState?.showUnchanged ?? false);
  const [viewMode, setViewMode] = useState<ViewMode>(initialState?.viewMode ?? "items");
  const [showQtyChange, setShowQtyChange] = useState(initialState?.showQtyChange ?? false);
  const [saveName, setSaveName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saving, setSaving] = useState(false);

  // Direction-aware IDs and labels
  const effectiveAId   = swapped ? versionBId : versionAId;
  const effectiveBId   = swapped ? versionAId : versionBId;
  const effectiveNameA = swapped ? nameB : nameA;
  const effectiveNameB = swapped ? nameA : nameB;

  const effectiveNotesA = result ? (swapped ? result.notesB : result.notesA) : null;
  const effectiveNotesB = result ? (swapped ? result.notesA : result.notesB) : null;

  useEffect(() => {
    setLoading(true);
    compareVersions(effectiveAId, effectiveBId).then((data) => {
      setResult(data);
      setLoading(false);
    });
  }, [effectiveAId, effectiveBId]);

  // Build display items (moved items become two entries)
  const displayItems = useMemo(
    () => (result ? buildDisplayItems(result.items, showUnchanged) : []),
    [result, showUnchanged]
  );

  // Section tree built from merged sections + display items
  const sectionTree = useMemo(
    () => (result ? buildSectionGroups(result.sections, displayItems, null, 0) : []),
    [result, displayItems]
  );

  const uncategorizedItems = useMemo(
    () => displayItems.filter((d) => !d.item.sectionCode),
    [displayItems]
  );

  if (loading || !result) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-[var(--slate-400)]">
        Összehasonlítás betöltése…
      </div>
    );
  }

  const addedCount     = result.items.filter((i) => i.status === "added").length;
  const removedCount   = result.items.filter((i) => i.status === "removed").length;
  const changedCount   = result.items.filter((i) => i.status === "changed").length;
  const unchangedCount = result.items.filter((i) => i.status === "unchanged").length;
  const movedCount     = result.items.filter((i) => i.sectionChanged).length;

  const hasSections = result.sections.length > 0;

  // Top-level section names for the sections tab
  const topLevelNames = new Set([
    ...result.sectionTotalsA.map((t) => t.sectionName),
    ...result.sectionTotalsB.map((t) => t.sectionName),
  ]);

  const matDelta = result.totalB.materialTotal - result.totalA.materialTotal;
  const feeDelta = result.totalB.feeTotal - result.totalA.feeTotal;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-[10px] bg-white border-b border-[var(--slate-200)] shrink-0">
        <button onClick={onBack} className="p-1 text-[var(--slate-500)] hover:text-[var(--slate-800)] cursor-pointer">
          <ArrowLeft size={14} />
        </button>
        <span className="text-sm font-semibold text-[var(--slate-800)]">
          Összehasonlítás:{" "}
          <span className="group/noteA relative inline-flex items-center gap-1">
            <span className="text-[var(--indigo-600)]">{effectiveNameA}</span>
            {effectiveNotesA && (
              <>
                <MessageSquare size={11} className="text-[var(--amber-500)] inline" />
                <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 hidden group-hover/noteA:block z-50 w-max max-w-[260px] px-2.5 py-1.5 rounded-md bg-[var(--slate-800)] text-[10px] text-white shadow-lg whitespace-pre-wrap pointer-events-none font-normal">
                  {effectiveNotesA}
                </span>
              </>
            )}
          </span>
          <span className="mx-1 text-[var(--slate-400)]">→</span>
          <span className="group/noteB relative inline-flex items-center gap-1">
            <span className="text-[var(--indigo-600)]">{effectiveNameB}</span>
            {effectiveNotesB && (
              <>
                <MessageSquare size={11} className="text-[var(--amber-500)] inline" />
                <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 hidden group-hover/noteB:block z-50 w-max max-w-[260px] px-2.5 py-1.5 rounded-md bg-[var(--slate-800)] text-[10px] text-white shadow-lg whitespace-pre-wrap pointer-events-none font-normal">
                  {effectiveNotesB}
                </span>
              </>
            )}
          </span>
        </span>
        <div className="flex-1" />
        {/* Swap direction button */}
        <button
          onClick={() => setSwapped((s) => !s)}
          title="Összehasonlítás irányának megfordítása"
          className={`flex items-center gap-1 px-2 py-[4px] rounded-[6px] border text-xs cursor-pointer transition-colors ${
            swapped
              ? "border-[var(--indigo-400)] bg-indigo-50 text-indigo-700"
              : "border-[var(--slate-200)] text-[var(--slate-600)] hover:bg-[var(--slate-50)]"
          }`}
        >
          <ArrowLeftRight size={12} />
          Irány váltása
        </button>
        {/* Save comparison */}
        {budgetId && (
          <div className="relative">
            {showSaveDialog ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && saveName.trim()) {
                      setSaving(true);
                      const state: SimpleCompareState = { swapped, showUnchanged, viewMode, showQtyChange };
                      createSavedComparison(budgetId, saveName.trim(), [versionAId, versionBId], [nameA, nameB], "simple", state).then(() => {
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
                    const state: SimpleCompareState = { swapped, showUnchanged, viewMode, showQtyChange };
                    createSavedComparison(budgetId, saveName.trim(), [versionAId, versionBId], [nameA, nameB], "simple", state).then(() => {
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
                  setSaveName(`${effectiveNameA} → ${effectiveNameB}`);
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
        <div className="flex rounded-[6px] border border-[var(--slate-200)] overflow-hidden ml-2">
          <button
            onClick={() => setViewMode("items")}
            className={`px-3 py-[4px] text-xs flex items-center gap-1 cursor-pointer transition-colors ${viewMode === "items" ? "bg-[var(--indigo-600)] text-white" : "text-[var(--slate-600)] hover:bg-[var(--slate-50)]"}`}
          >
            Tételek
          </button>
          <button
            onClick={() => setViewMode("sections")}
            className={`px-3 py-[4px] text-xs flex items-center gap-1 cursor-pointer transition-colors ${viewMode === "sections" ? "bg-[var(--indigo-600)] text-white" : "text-[var(--slate-600)] hover:bg-[var(--slate-50)]"}`}
          >
            <Layers size={11} />
            Fejezetek
          </button>
        </div>
      </div>

      {/* Summary counts */}
      <div className="flex items-center gap-4 px-4 py-3 bg-white border-b border-[var(--slate-200)] shrink-0 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs">
          <Plus size={12} className="text-green-600" />
          <span className="text-green-700 font-medium">{addedCount} új</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <Minus size={12} className="text-red-600" />
          <span className="text-red-700 font-medium">{removedCount} törölt</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <RefreshCw size={12} className="text-amber-600" />
          <span className="text-amber-700 font-medium">{changedCount} módosult</span>
        </div>
        {movedCount > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <MoveRight size={12} className="text-purple-600" />
            <span className="text-purple-700 font-medium">{movedCount} fejezetet váltott</span>
          </div>
        )}
        <span className="text-xs text-[var(--slate-400)]">{unchangedCount} változatlan</span>
        <div className="flex-1" />
        {viewMode === "items" && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-[var(--slate-500)] cursor-pointer">
              <input type="checkbox" checked={showQtyChange} onChange={(e) => setShowQtyChange(e.target.checked)} className="accent-[#6366f1]" />
              Menny. változás
            </label>
            <label className="flex items-center gap-1.5 text-xs text-[var(--slate-500)] cursor-pointer">
              <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} className="accent-[#6366f1]" />
              Változatlanok mutatása
            </label>
          </div>
        )}
      </div>

      {/* Totals comparison strip */}
      <div className="grid grid-cols-2 gap-3 px-4 py-3 bg-white border-b border-[var(--slate-200)] shrink-0">
        <div className="p-2 bg-[var(--slate-50)] rounded-[6px]">
          <div className="text-[10px] text-[var(--slate-400)] font-semibold uppercase mb-1">{effectiveNameA}</div>
          <div className="text-xs text-[var(--slate-700)]">
            {result.totalA.count} tétel{!result.ignorePrice && <> · Anyag: {fmt(result.totalA.materialTotal)} · Díj: {fmt(result.totalA.feeTotal)}</>}
          </div>
        </div>
        <div className="p-2 bg-[var(--slate-50)] rounded-[6px]">
          <div className="text-[10px] text-[var(--slate-400)] font-semibold uppercase mb-1">{effectiveNameB}</div>
          <div className="text-xs text-[var(--slate-700)]">
            {result.totalB.count} tétel{!result.ignorePrice && <> · Anyag: {fmt(result.totalB.materialTotal)} · Díj: {fmt(result.totalB.feeTotal)}</>}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {viewMode === "sections" ? (
          topLevelNames.size === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-[var(--slate-400)]">
              Egyik verzióban sincs fejezet
            </div>
          ) : (
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-[var(--slate-50)] z-[1]">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)]">Fejezet</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">{effectiveNameA} tételek</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">{effectiveNameA} anyag</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">{effectiveNameA} díj</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">{effectiveNameB} tételek</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">{effectiveNameB} anyag</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">{effectiveNameB} díj</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">Δ Anyag</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">Δ Díj</th>
                </tr>
              </thead>
              <tbody>
                {[...topLevelNames].map((name) => {
                  const tA = result.sectionTotalsA.find((t) => t.sectionName === name);
                  const tB = result.sectionTotalsB.find((t) => t.sectionName === name);
                  return <SectionTotalsRow key={name} totalsA={tA} totalsB={tB} depth={0} ignorePrice={result.ignorePrice} />;
                })}
              </tbody>
            </table>
          )
        ) : displayItems.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-[var(--slate-400)]">
            Nincs különbség a két verzió között
          </div>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-[var(--slate-50)] z-[1]">
              <tr>
                {[
                  "Státusz", "Tételszám", "Megnevezés", "Menny.", "Egység",
                  ...(showQtyChange ? ["Δ Menny."] : []),
                  "Anyag Eár", "Díj Eár", "Anyag össz.", "Díj össz.", "Δ Anyag", "Δ Díj",
                ].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hasSections ? (
                <>
                  {sectionTree.map((group) => (
                    <SectionGroupView key={group.sectionCode ?? "__root__"} group={group} showQtyChange={showQtyChange} ignorePrice={result.ignorePrice} />
                  ))}
                  {uncategorizedItems.length > 0 && (
                    <SectionGroupView
                      group={{
                        sectionCode: null,
                        sectionName: "Besorolatlan tételek",
                        depth: 0,
                        items: uncategorizedItems,
                        children: [],
                      }}
                      showQtyChange={showQtyChange}
                      ignorePrice={result.ignorePrice}
                    />
                  )}
                </>
              ) : (
                displayItems.map((d) => <ItemRow key={d.key} d={d} showQtyChange={showQtyChange} ignorePrice={result.ignorePrice} />)
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center px-4 py-[10px] bg-white border-t border-[var(--slate-200)] shrink-0">
        <span className="text-xs text-[var(--slate-400)]">
          {viewMode === "items" ? `${displayItems.length} tétel megjelenítve` : `${topLevelNames.size} fejezet`}
        </span>
        <div className="flex-1" />
        {!result.ignorePrice && (
          <>
            <span className="text-xs text-[var(--slate-600)] mr-4">
              Δ Anyag:{" "}
              <strong className={matDelta >= 0 ? "text-green-600" : "text-red-600"}>
                {matDelta >= 0 ? "+" : ""}{fmt(matDelta)}
              </strong>
            </span>
            <span className="text-xs text-[var(--slate-600)]">
              Δ Díj:{" "}
              <strong className={feeDelta >= 0 ? "text-green-600" : "text-red-600"}>
                {feeDelta >= 0 ? "+" : ""}{fmt(feeDelta)}
              </strong>
            </span>
          </>
        )}
        {result.ignorePrice && (
          <span className="text-xs text-[var(--slate-400)] italic">Árazatlan verzió — ár különbözet nem kimutatott</span>
        )}
      </div>
    </div>
  );
}
