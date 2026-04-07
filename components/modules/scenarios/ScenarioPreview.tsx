"use client";

import { useState, useEffect, useMemo } from "react";
import {
  ArrowLeft,
  Layers,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  Search,
  AlertTriangle,
  Info,
  Zap,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import {
  resolveScenario,
  deleteScenario,
  type ResolvedScenarioResult,
  type ResolvedScenarioItem,
  type ScenarioLayerInfo,
  type OptimizationStrategy,
  type OptimizationOptions,
} from "@/server/actions/scenarios";
import { type ReconstructedSection } from "@/server/actions/versions";
import { useTabStore } from "@/stores/tab-store";

interface ScenarioPreviewProps {
  scenarioId: number;
  tabId: string;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 2 }).format(n);
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("hu-HU", {
    maximumFractionDigits: 0,
  }).format(n);
}

// Assign a consistent color to each layer
const LAYER_COLORS = [
  { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", dot: "bg-blue-500" },
  { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-500" },
  { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", dot: "bg-amber-500" },
  { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", dot: "bg-purple-500" },
  { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", dot: "bg-rose-500" },
  { bg: "bg-cyan-50", text: "text-cyan-700", border: "border-cyan-200", dot: "bg-cyan-500" },
  { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", dot: "bg-orange-500" },
  { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200", dot: "bg-indigo-500" },
];

function getLayerColor(layerOrder: number) {
  return LAYER_COLORS[layerOrder % LAYER_COLORS.length];
}

// ---- Section grouping ----

interface SectionGroup {
  sectionCode: string | null;
  sectionName: string;
  depth: number;
  items: ResolvedScenarioItem[];
  children: SectionGroup[];
}

function buildSectionGroups(
  sections: ReconstructedSection[],
  items: ResolvedScenarioItem[],
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
      items: items.filter((i) => i.sectionCode === sec.sectionCode),
      children: buildSectionGroups(sections, items, sec.sectionCode, depth + 1),
    }));
}

function countGroupItems(group: SectionGroup): number {
  return (
    group.items.length +
    group.children.reduce((s, c) => s + countGroupItems(c), 0)
  );
}

interface GroupTotals {
  materialTotal: number;
  feeTotal: number;
}

function computeGroupTotals(group: SectionGroup): GroupTotals {
  const childTotals = group.children.map(computeGroupTotals);
  return {
    materialTotal:
      group.items.reduce((s, i) => s + i.quantity * i.materialUnitPrice, 0) +
      childTotals.reduce((s, t) => s + t.materialTotal, 0),
    feeTotal:
      group.items.reduce((s, i) => s + i.quantity * i.feeUnitPrice, 0) +
      childTotals.reduce((s, t) => s + t.feeTotal, 0),
  };
}

// ---- Layer legend badge ----

function LayerBadge({ layerOrder, label }: { layerOrder: number; label: string }) {
  const color = getLayerColor(layerOrder);
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${color.bg} ${color.text} border ${color.border}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${color.dot}`} />
      {label || `Réteg ${layerOrder}`}
    </span>
  );
}

// ---- Source cell: single or dual (material vs fee) with tooltip ----

function SourceCell({ item }: { item: ResolvedScenarioItem }) {
  if (item.hasSingleSource) {
    return (
      <LayerBadge
        layerOrder={item.materialSourceLayerOrder}
        label={item.materialSourceLayerLabel}
      />
    );
  }

  // Dual source — show compact + tooltip
  const matColor = getLayerColor(item.materialSourceLayerOrder);
  const feeColor = getLayerColor(item.feeSourceLayerOrder);

  return (
    <div className="group relative inline-block">
      <span className="flex items-center gap-0.5 cursor-help">
        <span
          className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium ${matColor.bg} ${matColor.text} border ${matColor.border}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${matColor.dot}`} />A
        </span>
        <span
          className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium ${feeColor.bg} ${feeColor.text} border ${feeColor.border}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${feeColor.dot}`} />D
        </span>
      </span>
      {/* Tooltip */}
      <div className="absolute left-0 top-full mt-1 z-50 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none">
        <div className="bg-[var(--slate-800)] text-white rounded-[6px] shadow-lg p-2.5 text-[10px] leading-4 whitespace-nowrap min-w-[180px]">
          <div className="font-semibold mb-1.5 text-[var(--slate-200)]">Kettős forrás</div>
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`w-2 h-2 rounded-full shrink-0 ${matColor.dot}`} />
            <span className="text-[var(--slate-300)]">Anyag:</span>
            <span className="font-medium">{item.materialSourceLayerLabel}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full shrink-0 ${feeColor.dot}`} />
            <span className="text-[var(--slate-300)]">Díj:</span>
            <span className="font-medium">{item.feeSourceLayerLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Alternative indicator with tooltip ----

function AltIndicator({
  materialAltName,
  feeAltName,
}: {
  materialAltName: string | null;
  feeAltName: string | null;
}) {
  const sameAlt = materialAltName && feeAltName && materialAltName === feeAltName;

  return (
    <span className="group/alt relative ml-1.5 inline-flex items-center">
      <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-violet-50 border border-violet-200 text-[9px] font-semibold text-violet-700 cursor-help">
        ALT
      </span>
      {/* Tooltip */}
      <span className="absolute left-0 top-full mt-1 z-50 invisible group-hover/alt:visible opacity-0 group-hover/alt:opacity-100 transition-opacity duration-150 pointer-events-none">
        <span className="block bg-[var(--slate-800)] text-white rounded-[6px] shadow-lg p-2.5 text-[10px] leading-4 whitespace-nowrap min-w-[180px]">
          <span className="block font-semibold mb-1 text-[var(--slate-200)]">Alternatíva használva</span>
          {sameAlt ? (
            <span className="block text-[var(--slate-100)]">{materialAltName}</span>
          ) : (
            <>
              {materialAltName && (
                <span className="block mb-0.5">
                  <span className="text-[var(--slate-300)]">Anyag: </span>
                  <span className="font-medium">{materialAltName}</span>
                </span>
              )}
              {feeAltName && (
                <span className="block">
                  <span className="text-[var(--slate-300)]">Díj: </span>
                  <span className="font-medium">{feeAltName}</span>
                </span>
              )}
            </>
          )}
        </span>
      </span>
    </span>
  );
}

// ---- Item row ----

function ItemRow({ item }: { item: ResolvedScenarioItem }) {
  const matTotal = item.quantity * item.materialUnitPrice;
  const feeTotal = item.quantity * item.feeUnitPrice;
  const matColor = getLayerColor(item.materialSourceLayerOrder);
  const feeColor = getLayerColor(item.feeSourceLayerOrder);
  const hasAnyAlt = item.materialAlternativeName || item.feeAlternativeName;

  return (
    <tr className={`${item.isUnpriced ? "bg-amber-50/40" : ""}`}>
      <td className="px-3 py-2 border-b border-[var(--slate-100)]">
        <SourceCell item={item} />
      </td>
      <td className="px-3 py-2 border-b border-[var(--slate-100)] font-mono text-[11px] text-[var(--slate-500)]">
        {item.itemNumber || "—"}
      </td>
      <td className="px-3 py-2 border-b border-[var(--slate-100)] text-[var(--slate-800)]">
        <span>{item.name}</span>
        {item.isUnpriced && (
          <span className="ml-1.5 text-[10px] text-amber-600 font-medium">
            (árazatlan)
          </span>
        )}
        {hasAnyAlt && (
          <AltIndicator
            materialAltName={item.materialAlternativeName}
            feeAltName={item.feeAlternativeName}
          />
        )}
      </td>
      <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right text-[var(--slate-600)]">
        {fmt(item.quantity)}
      </td>
      <td className="px-3 py-2 border-b border-[var(--slate-100)] text-[var(--slate-500)]">
        {item.unit}
      </td>
      <td className={`px-3 py-2 border-b border-[var(--slate-100)] text-right font-medium ${matColor.text}`}>
        {fmt(item.materialUnitPrice)}
      </td>
      <td className={`px-3 py-2 border-b border-[var(--slate-100)] text-right font-medium ${feeColor.text}`}>
        {fmt(item.feeUnitPrice)}
      </td>
      <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right font-medium text-[var(--slate-800)]">
        {fmtCurrency(matTotal)}
      </td>
      <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right font-medium text-[var(--slate-800)]">
        {fmtCurrency(feeTotal)}
      </td>
    </tr>
  );
}

// ---- Section group ----

function SectionGroupView({ group }: { group: SectionGroup }) {
  const [collapsed, setCollapsed] = useState(false);
  const total = countGroupItems(group);
  if (total === 0) return null;

  const indent = group.depth * 16;
  const totals = computeGroupTotals(group);

  return (
    <>
      <tr
        className={`cursor-pointer select-none ${
          group.depth === 0
            ? "bg-pink-50 border-l-2 border-pink-400"
            : "bg-[var(--slate-100)]"
        }`}
        onClick={() => setCollapsed((c) => !c)}
      >
        <td
          className="px-3 py-1.5 border-b border-[var(--slate-200)]"
          colSpan={7}
          style={{ paddingLeft: 12 + indent }}
        >
          <span className="flex items-center gap-1">
            {collapsed ? (
              <ChevronRight
                size={12}
                className="text-[var(--slate-500)] shrink-0"
              />
            ) : (
              <ChevronDown
                size={12}
                className="text-[var(--slate-500)] shrink-0"
              />
            )}
            <span
              className={`text-xs font-semibold ${
                group.depth === 0
                  ? "text-pink-800"
                  : "text-[var(--slate-700)]"
              }`}
            >
              {group.sectionName}
            </span>
            <span className="ml-1.5 text-[10px] text-[var(--slate-400)]">
              {total} tétel
            </span>
          </span>
        </td>
        <td className="px-3 py-1.5 border-b border-[var(--slate-200)] text-right">
          <span
            className={`text-[11px] font-semibold ${
              group.depth === 0
                ? "text-pink-800"
                : "text-[var(--slate-700)]"
            }`}
          >
            {fmtCurrency(totals.materialTotal)}
          </span>
        </td>
        <td className="px-3 py-1.5 border-b border-[var(--slate-200)] text-right">
          <span
            className={`text-[11px] font-semibold ${
              group.depth === 0
                ? "text-pink-800"
                : "text-[var(--slate-700)]"
            }`}
          >
            {fmtCurrency(totals.feeTotal)}
          </span>
        </td>
      </tr>
      {!collapsed && (
        <>
          {group.children.map((child) => (
            <SectionGroupView
              key={child.sectionCode ?? "__null__"}
              group={child}
            />
          ))}
          {group.items.map((item) => (
            <ItemRow key={item.itemCode} item={item} />
          ))}
        </>
      )}
    </>
  );
}

// ---- Layer summary sidebar ----

function LayerSummary({
  layers,
  items,
}: {
  layers: ScenarioLayerInfo[];
  items: ResolvedScenarioItem[];
}) {
  const sortedLayers = [...layers].sort((a, b) => b.layerOrder - a.layerOrder);

  return (
    <div className="space-y-2">
      {sortedLayers.map((layer) => {
        const color = getLayerColor(layer.layerOrder);
        // Count items where this layer provided material OR fee
        const matItems = items.filter(
          (i) => i.materialSourceLayerOrder === layer.layerOrder
        );
        const feeItems = items.filter(
          (i) => i.feeSourceLayerOrder === layer.layerOrder
        );
        // Unique items contributed by this layer
        const uniqueItemCodes = new Set([
          ...matItems.map((i) => i.itemCode),
          ...feeItems.map((i) => i.itemCode),
        ]);
        const matTotal = matItems.reduce(
          (s, i) => s + i.quantity * i.materialUnitPrice,
          0
        );
        const feeTotal = feeItems.reduce(
          (s, i) => s + i.quantity * i.feeUnitPrice,
          0
        );

        const PRICE_COMPONENT_LABELS: Record<string, string> = {
          both: "Anyag + Díj",
          material: "Csak anyag",
          fee: "Csak díj",
        };

        return (
          <div
            key={layer.id}
            className={`rounded-[8px] border p-3 ${color.bg} ${color.border}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2 h-2 rounded-full ${color.dot}`} />
              <span className={`text-xs font-semibold ${color.text}`}>
                Réteg {layer.layerOrder}
              </span>
              <span className={`ml-auto text-[9px] font-medium px-1 py-0.5 rounded ${color.bg} ${color.text} border ${color.border}`}>
                {PRICE_COMPONENT_LABELS[layer.priceComponent] ?? layer.priceComponent}
              </span>
            </div>
            <div className={`text-[11px] font-medium ${color.text} mb-1 truncate`}>
              {layer.label || layer.versionName}
            </div>
            <div className="text-[10px] text-[var(--slate-500)] space-y-0.5">
              <div>
                {layer.budgetName} → {layer.versionName}
              </div>
              {layer.partnerName && (
                <div className="italic">{layer.partnerName}</div>
              )}
              {layer.useCheapestAlternative && (
                <div className="text-pink-600 font-medium">✓ Legolcsóbb alternatíva</div>
              )}
              <div className="pt-1 border-t border-[var(--slate-200)] mt-1">
                <span className="font-medium">{uniqueItemCodes.size}</span> tétel
                ebből a rétegből
              </div>
              <div>
                Anyag: <span className="font-medium">{fmtCurrency(matTotal)}</span>
              </div>
              <div>
                Díj: <span className="font-medium">{fmtCurrency(feeTotal)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Main component ----

export function ScenarioPreview({ scenarioId, tabId }: ScenarioPreviewProps) {
  const [result, setResult] = useState<ResolvedScenarioResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [optimizationStrategy, setOptimizationStrategy] = useState<OptimizationStrategy>("none");
  const [skipZeroItems, setSkipZeroItems] = useState(false);

  const closeTab = useTabStore((s) => s.closeTab);
  const openTab = useTabStore((s) => s.openTab);

  useEffect(() => {
    setLoading(true);
    const opts: OptimizationOptions = { strategy: optimizationStrategy, skipZeroItems };
    resolveScenario(scenarioId, opts).then((data) => {
      setResult(data);
      setLoading(false);
    });
  }, [scenarioId, optimizationStrategy, skipZeroItems]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const goBack = () => {
    closeTab(tabId);
    openTab({ moduleKey: "scenarios", title: "Szcenáriók", color: "#ec4899" });
  };

  const openEditor = () => {
    openTab({
      moduleKey: "scenarios-editor",
      title: `Szcenárió szerkesztése`,
      color: "#ec4899",
      tabType: "edit",
      params: { scenarioId },
    });
  };

  const handleDelete = async () => {
    if (!confirm("Biztosan törölni szeretné ezt a szcenáriót?")) return;
    await deleteScenario(scenarioId);
    goBack();
  };

  // Filter items by search
  const filteredItems = useMemo(() => {
    if (!result) return [];
    if (!search) return result.items;
    const q = search.toLowerCase();
    return result.items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.itemNumber.toLowerCase().includes(q) ||
        i.materialSourceLayerLabel.toLowerCase().includes(q) ||
        i.feeSourceLayerLabel.toLowerCase().includes(q)
    );
  }, [result, search]);

  // Build section groups for filtered items
  const sectionGroups = useMemo(() => {
    if (!result) return [];
    return buildSectionGroups(result.sections, filteredItems, null, 0);
  }, [result, filteredItems]);

  // Unsectioned items
  const unsectionedItems = useMemo(
    () => filteredItems.filter((i) => !i.sectionCode),
    [filteredItems]
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-[var(--slate-400)]">
        Betöltés…
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <AlertTriangle size={32} className="text-amber-400" />
        <p className="text-sm text-[var(--slate-500)]">
          A szcenárió nem található vagy nincs rétege
        </p>
        <button
          onClick={goBack}
          className="text-xs text-[var(--indigo-600)] hover:underline cursor-pointer"
        >
          Vissza a listához
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0">
      {/* Sidebar — layer legend + summary */}
      <aside className="w-[220px] shrink-0 bg-white border-r border-[var(--slate-200)] flex flex-col overflow-y-auto">
        <div className="p-3 pb-2">
          <button
            onClick={goBack}
            className="flex items-center gap-1.5 text-xs text-[var(--slate-500)] hover:text-[var(--slate-800)] transition-colors mb-3 cursor-pointer"
          >
            <ArrowLeft size={12} />
            Vissza a listához
          </button>

          <div className="flex items-center gap-2 mb-1">
            <Layers size={14} className="text-pink-500" />
            <span className="text-sm font-semibold text-[var(--slate-800)] truncate">
              Előnézet
            </span>
          </div>
        </div>

        <div className="h-px bg-[var(--slate-100)] mx-3" />

        {/* Summary totals */}
        <div className="px-3 py-3 space-y-2">
          <div className="bg-[var(--slate-50)] rounded-[8px] p-3">
            <div className="text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-wide mb-2">
              Összesítés
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--slate-500)]">Tételek</span>
                <span className="font-semibold text-[var(--slate-800)]">
                  {result.items.length} db
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--slate-500)]">Anyag összesen</span>
                <span className="font-semibold text-[var(--slate-800)]">
                  {fmtCurrency(result.totalMaterial)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--slate-500)]">Díj összesen</span>
                <span className="font-semibold text-[var(--slate-800)]">
                  {fmtCurrency(result.totalFee)}
                </span>
              </div>
              <div className="h-px bg-[var(--slate-200)] my-1" />
              <div className="flex justify-between">
                <span className="text-[var(--slate-600)] font-medium">
                  Mindösszesen
                </span>
                <span className="font-bold text-[var(--slate-900)]">
                  {fmtCurrency(result.totalMaterial + result.totalFee)}
                </span>
              </div>
              {result.unpricedCount > 0 && (
                <div className="flex items-center gap-1 mt-1 text-amber-600">
                  <AlertTriangle size={10} />
                  <span className="text-[10px]">
                    {result.unpricedCount} árazatlan tétel
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="h-px bg-[var(--slate-100)] mx-3" />

        {/* Layer legend */}
        <div className="px-3 py-3 flex-1 overflow-y-auto">
          <div className="text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-wide mb-2">
            Rétegek
          </div>
          <LayerSummary layers={result.layers} items={result.items} />
        </div>

        {/* Actions */}
        <div className="p-3 border-t border-[var(--slate-100)] space-y-1.5">
          <button
            onClick={openEditor}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-[7px] rounded-[6px] text-xs bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] cursor-pointer transition-colors"
          >
            <Pencil size={12} />
            Szerkesztés
          </button>
          <button
            onClick={handleDelete}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-[7px] rounded-[6px] text-xs border border-red-200 text-red-600 hover:bg-red-50 cursor-pointer transition-colors"
          >
            <Trash2 size={12} />
            Törlés
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-4 py-[10px] bg-white border-b border-[var(--slate-200)] shrink-0">
          <div className="flex items-center gap-2">
            <Info size={13} className="text-[var(--slate-400)]" />
            <span className="text-[11px] text-[var(--slate-400)]">
              A színek jelzik, melyik rétegből származik az ár
            </span>
          </div>
          <div className="flex-1" />
          <div className="relative">
            <Search
              className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--slate-400)]"
              size={12}
            />
            <input
              type="text"
              placeholder="Keresés…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="h-7 bg-[var(--slate-50)] border border-[var(--slate-200)] rounded-[6px] pl-7 pr-3 text-xs text-[var(--slate-700)] outline-none focus:border-[var(--indigo-600)] transition-colors w-[200px]"
            />
          </div>
        </div>

        {/* Optimization toolbar */}
        <div className="flex items-center gap-4 px-4 py-[8px] bg-[var(--slate-50)] border-b border-[var(--slate-200)] shrink-0">
          <div className="flex items-center gap-2">
            <Zap size={13} className="text-pink-500" />
            <span className="text-[11px] font-semibold text-[var(--slate-600)]">
              Optimalizálás:
            </span>
          </div>

          <div className="flex items-center bg-white rounded-[6px] border border-[var(--slate-200)] overflow-hidden">
            {([
              { key: "none", label: "Nincs" },
              { key: "component", label: "Anyag+Díj külön" },
              { key: "item", label: "Tételenként" },
              { key: "category", label: "Főkategóriánként" },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setOptimizationStrategy(key)}
                className={`px-2.5 py-[5px] text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  optimizationStrategy === key
                    ? "bg-pink-500 text-white"
                    : "text-[var(--slate-600)] hover:bg-[var(--slate-100)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-[var(--slate-200)]" />

          <button
            onClick={() => setSkipZeroItems((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] cursor-pointer group"
          >
            {skipZeroItems ? (
              <ToggleRight size={16} className="text-pink-500" />
            ) : (
              <ToggleLeft size={16} className="text-[var(--slate-400)] group-hover:text-[var(--slate-600)]" />
            )}
            <span
              className={`font-medium ${
                skipZeroItems ? "text-pink-700" : "text-[var(--slate-500)] group-hover:text-[var(--slate-700)]"
              }`}
            >
              0 Ft-os tételek kihagyása
            </span>
          </button>

          {optimizationStrategy !== "none" && (
            <div className="ml-auto flex items-center gap-1.5 text-[10px] text-pink-600 bg-pink-50 border border-pink-200 rounded-[5px] px-2 py-1">
              <Zap size={10} />
              <span className="font-medium">
                {optimizationStrategy === "component"
                  ? "Anyag és díj komponensenként a legolcsóbb rétegből"
                  : optimizationStrategy === "item"
                    ? "Tételenként a legolcsóbb összegű rétegből"
                    : "Főkategóriánként a legolcsóbb rétegből"}
              </span>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-[var(--slate-50)] z-[1]">
              <tr>
                {[
                  "Forrás",
                  "Tételszám",
                  "Megnevezés",
                  "Mennyiség",
                  "Egység",
                  "Anyag Eár",
                  "Díj Eár",
                  "Anyag össz.",
                  "Díj össz.",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-[9px] text-left text-[11px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sectionGroups.map((group) => (
                <SectionGroupView
                  key={group.sectionCode ?? "__root__"}
                  group={group}
                />
              ))}
              {unsectionedItems.length > 0 && (
                <>
                  {sectionGroups.length > 0 && (
                    <tr className="bg-[var(--slate-100)]">
                      <td
                        className="px-3 py-1.5 border-b border-[var(--slate-200)] text-xs font-semibold text-[var(--slate-600)]"
                        colSpan={9}
                      >
                        Besorolatlan tételek
                      </td>
                    </tr>
                  )}
                  {unsectionedItems.map((item) => (
                    <ItemRow key={item.itemCode} item={item} />
                  ))}
                </>
              )}
            </tbody>
          </table>

          {filteredItems.length === 0 && (
            <div className="flex items-center justify-center h-32 text-sm text-[var(--slate-400)]">
              {search ? "Nincs találat" : "Nincsenek tételek"}
            </div>
          )}
        </div>

        {/* Footer totals */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--slate-50)] border-t border-[var(--slate-200)] shrink-0">
          <div className="flex items-center gap-4 text-xs">
            <span className="text-[var(--slate-500)]">
              {filteredItems.length} tétel
              {search ? ` (szűrt)` : ""}
            </span>
            {result.unpricedCount > 0 && (
              <span className="flex items-center gap-1 text-amber-600">
                <AlertTriangle size={10} />
                {result.unpricedCount} árazatlan
              </span>
            )}
          </div>
          <div className="flex items-center gap-6 text-xs">
            <div>
              <span className="text-[var(--slate-500)]">Anyag: </span>
              <span className="font-semibold text-[var(--slate-800)]">
                {fmtCurrency(result.totalMaterial)} Ft
              </span>
            </div>
            <div>
              <span className="text-[var(--slate-500)]">Díj: </span>
              <span className="font-semibold text-[var(--slate-800)]">
                {fmtCurrency(result.totalFee)} Ft
              </span>
            </div>
            <div className="pl-3 border-l border-[var(--slate-300)]">
              <span className="text-[var(--slate-600)] font-medium">Összesen: </span>
              <span className="font-bold text-[var(--slate-900)]">
                {fmtCurrency(result.totalMaterial + result.totalFee)} Ft
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
