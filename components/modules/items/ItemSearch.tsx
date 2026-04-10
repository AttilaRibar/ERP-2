"use client";

// reason: interactive state, async data loading, event handlers, resizable split panel

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Search,
  X,
  ChevronDown,
  Layers,
  FolderKanban,
  Calculator,
  Info,
} from "lucide-react";
import { searchBudgetItems, type ItemSearchRow } from "@/server/actions/item-search";
import { getBudgets } from "@/server/actions/budgets";
import { getVersionsByBudgetId, type VersionInfo } from "@/server/actions/versions";
import { useProjectStore } from "@/stores/project-store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BudgetOption {
  id: number;
  name: string;
  projectName: string | null;
}

interface GroupedItem {
  /** First/canonical row */
  canonical: ItemSearchRow;
  /** All occurrences across projects/budgets/versions */
  occurrences: ItemSearchRow[];
  /** Client-side relevance score */
  score: number;
}

// ---------------------------------------------------------------------------
// Fuzzy scoring helpers
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  const curr: number[] = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

function scoreText(query: string, text: string): number {
  if (!text || !query) return 0;
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase().trim();
  if (!q || !t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 85;
  if (t.includes(q)) return 60;
  const cap = Math.min(t.length, q.length * 3);
  const sub = t.substring(0, cap);
  const dist = levenshtein(q, sub);
  const maxLen = Math.max(q.length, cap);
  const similarity = maxLen > 0 ? 1 - dist / maxLen : 0;
  if (similarity >= 0.7) return Math.round(similarity * 45);
  return 0;
}

function scoreRow(query: string, row: ItemSearchRow): number {
  const numScore = scoreText(query, row.itemNumber) * 1.15;
  const nameScore = scoreText(query, row.name);
  return Math.max(numScore, nameScore);
}

function groupAndScore(rows: ItemSearchRow[], query: string): GroupedItem[] {
  const scored = rows.map((r) => ({ row: r, score: scoreRow(query, r) }));
  const map = new Map<string, { rows: ItemSearchRow[]; maxScore: number }>();
  for (const { row, score } of scored) {
    const entry = map.get(row.itemCode);
    if (!entry) {
      map.set(row.itemCode, { rows: [row], maxScore: score });
    } else {
      entry.rows.push(row);
      if (score > entry.maxScore) entry.maxScore = score;
    }
  }
  const groups: GroupedItem[] = [];
  for (const { rows: occurrences, maxScore } of map.values()) {
    if (maxScore === 0) continue;
    const withScores = occurrences.map((r) => ({ r, s: scoreRow(query, r) }));
    withScores.sort((a, b) => b.s - a.s || (b.r.itemNumber ? 1 : -1));
    groups.push({ canonical: withScores[0].r, occurrences, score: maxScore });
  }
  groups.sort(
    (a, b) =>
      b.score - a.score ||
      a.canonical.name.localeCompare(b.canonical.name, "hu"),
  );
  return groups;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function fmtPrice(n: number): string {
  return new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 2 }).format(n);
}

const VERSION_TYPE_LABEL: Record<string, string> = {
  offer: "Ajánlat",
  contracted: "Szerződött",
  unpriced: "Áratlan",
};

// ---------------------------------------------------------------------------
// Score badge
// ---------------------------------------------------------------------------

function ScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 85
      ? "bg-green-100 text-green-800"
      : score >= 60
        ? "bg-amber-100 text-amber-800"
        : "bg-[var(--slate-100)] text-[var(--slate-500)]";
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums ${cls}`}
    >
      {Math.round(score)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Query highlight — wraps the first match in a yellow mark
// ---------------------------------------------------------------------------

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 text-yellow-900 rounded-sm">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

// ---------------------------------------------------------------------------
// Price cell with min/max badge
// ---------------------------------------------------------------------------

function PriceCell({
  value,
  isMin,
  isMax,
}: {
  value: number;
  isMin: boolean;
  isMax: boolean;
}) {
  if (value <= 0) return <span className="text-[var(--slate-300)]">—</span>;
  return (
    <span
      className={`font-mono tabular-nums ${
        isMin ? "text-green-700 font-semibold" : isMax ? "text-red-600 font-semibold" : "text-[var(--slate-700)]"
      }`}
    >
      {fmtPrice(value)}
      {isMin && <span className="ml-0.5 text-[9px] text-green-600">▼</span>}
      {isMax && <span className="ml-0.5 text-[9px] text-red-600">▲</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Detail panel — occurrences of a single item
// ---------------------------------------------------------------------------

function ItemDetailPanel({
  group,
  onClose,
}: {
  group: GroupedItem;
  onClose: () => void;
}) {
  const c = group.canonical;

  // Compute min/max for material and fee unit prices (skip 0 / missing values)
  const matPrices = group.occurrences.map((o) => o.materialUnitPrice).filter((v) => v > 0);
  const feePrices = group.occurrences.map((o) => o.feeUnitPrice).filter((v) => v > 0);
  const minMat = matPrices.length > 1 ? Math.min(...matPrices) : null;
  const maxMat = matPrices.length > 1 ? Math.max(...matPrices) : null;
  const minFee = feePrices.length > 1 ? Math.min(...feePrices) : null;
  const maxFee = feePrices.length > 1 ? Math.max(...feePrices) : null;

  return (
    <div className="flex flex-col h-full overflow-hidden border-t-2 border-[var(--indigo-300)] bg-white">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-4 py-2.5 bg-[var(--slate-700)] text-white shrink-0">
        <div className="min-w-0">
          <div className="font-bold text-sm leading-snug break-words">{c.name}</div>
          <div className="text-[10px] text-[var(--slate-300)] mt-0.5 flex items-center gap-2 flex-wrap">
            {c.itemNumber && <span className="font-mono">#{c.itemNumber}</span>}
            <span className="text-[var(--slate-400)]">·</span>
            <span>{group.occurrences.length} előfordulás</span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 mt-0.5 text-[var(--slate-400)] hover:text-white transition-colors"
          aria-label="Bezárás"
        >
          <X size={15} />
        </button>
      </div>

      {/* Scrollable occurrences table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[var(--slate-50)] border-b border-[var(--slate-200)]">
              <th className="text-left px-3 py-2 text-[var(--slate-500)] font-medium whitespace-nowrap">
                Projekt
              </th>
              <th className="text-left px-3 py-2 text-[var(--slate-500)] font-medium whitespace-nowrap">
                Ktgv.
              </th>
              <th className="text-left px-3 py-2 text-[var(--slate-500)] font-medium whitespace-nowrap">
                Verzió
              </th>
              <th className="text-left px-3 py-2 text-[var(--slate-500)] font-medium whitespace-nowrap">
                Alvállalkozó
              </th>
              <th className="text-right px-3 py-2 text-[var(--slate-500)] font-medium whitespace-nowrap">
                Menny.
              </th>
              <th className="text-left px-2 py-2 text-[var(--slate-500)] font-medium">M.e.</th>
              <th className="text-right px-3 py-2 text-[var(--slate-500)] font-medium whitespace-nowrap">
                Anyag e.ár
              </th>
              <th className="text-right px-3 py-2 text-[var(--slate-500)] font-medium whitespace-nowrap">
                Díj e.ár
              </th>
            </tr>
          </thead>
          <tbody>
            {group.occurrences.map((occ) => (
              <tr
                key={occ.id}
                className="border-b border-[var(--slate-100)] hover:bg-[var(--slate-50)]"
              >
                <td className="px-3 py-2">
                  <div className="font-medium text-[11px] text-[var(--slate-700)]">
                    {occ.projectCode ?? ""}
                  </div>
                  <div
                    className="text-[10px] text-[var(--slate-400)] max-w-[130px] truncate"
                    title={occ.projectName}
                  >
                    {occ.projectName}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div
                    className="truncate text-[11px] text-[var(--slate-600)] max-w-[130px]"
                    title={occ.budgetName}
                  >
                    {occ.budgetName}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div
                    className="truncate max-w-[120px] text-[11px] text-[var(--slate-600)]"
                    title={occ.versionName}
                  >
                    {occ.versionName}
                  </div>
                  <div className="text-[10px] text-[var(--slate-400)]">
                    {VERSION_TYPE_LABEL[occ.versionType] ?? occ.versionType}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {occ.partnerName ? (
                    <div
                      className="truncate max-w-[130px] text-[11px] text-[var(--slate-600)]"
                      title={occ.partnerName}
                    >
                      {occ.partnerName}
                    </div>
                  ) : (
                    <span className="text-[var(--slate-300)]">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-[var(--slate-600)] tabular-nums whitespace-nowrap text-[11px]">
                  {fmtPrice(occ.quantity)}
                </td>
                <td className="px-2 py-2 text-[var(--slate-500)] text-[11px]">{occ.unit}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap text-[11px]">
                  <PriceCell
                    value={occ.materialUnitPrice}
                    isMin={minMat !== null && occ.materialUnitPrice === minMat}
                    isMax={maxMat !== null && occ.materialUnitPrice === maxMat}
                  />
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap text-[11px]">
                  <PriceCell
                    value={occ.feeUnitPrice}
                    isMin={minFee !== null && occ.feeUnitPrice === minFee}
                    isMax={maxFee !== null && occ.feeUnitPrice === maxFee}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilterSelect — reusable sidebar dropdown
// ---------------------------------------------------------------------------

interface FilterOption {
  value: number;
  label: string;
}

interface FilterSelectProps {
  label: string;
  icon: React.ReactNode;
  value: number | null;
  onChange: (v: number | null) => void;
  options: FilterOption[];
  placeholder: string;
  disabled?: boolean;
}

function FilterSelect({
  label,
  icon,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
}: FilterSelectProps) {
  return (
    <div>
      <label className="flex items-center gap-1 text-[10px] text-[var(--slate-500)] font-semibold uppercase tracking-wider mb-1">
        {icon}
        {label}
      </label>
      <div className="relative">
        <select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
          disabled={disabled}
          className="w-full appearance-none px-2.5 py-1.5 pr-6 text-xs border border-[var(--slate-200)] rounded-md bg-white text-[var(--slate-700)] focus:outline-none focus:ring-2 focus:ring-[var(--indigo-500)] focus:border-transparent disabled:opacity-50 disabled:bg-[var(--slate-50)] disabled:cursor-not-allowed cursor-pointer"
        >
          <option value="">{placeholder}</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={11}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--slate-400)] pointer-events-none"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ItemSearch() {
  const storeProjects = useProjectStore((s) => s.projects);
  const storeSelectedProject = useProjectStore((s) => s.selectedProject);

  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");

  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    storeSelectedProject?.id ?? null,
  );
  const [selectedBudgetId, setSelectedBudgetId] = useState<number | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);

  const [budgets, setBudgets] = useState<BudgetOption[]>([]);
  const [versionList, setVersionList] = useState<VersionInfo[]>([]);

  const [rawRows, setRawRows] = useState<ItemSearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const [selectedGroup, setSelectedGroup] = useState<GroupedItem | null>(null);

  // Split panel state
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [topHeightPct, setTopHeightPct] = useState(55);
  const isDragging = useRef(false);

  // Sync project from global store on mount
  useEffect(() => {
    if (storeSelectedProject && !selectedProjectId) {
      setSelectedProjectId(storeSelectedProject.id);
    }
  }, [storeSelectedProject]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load budgets when project changes
  useEffect(() => {
    setSelectedBudgetId(null);
    setSelectedVersionId(null);
    setBudgets([]);
    setVersionList([]);
    if (!selectedProjectId) return;
    getBudgets(undefined, String(selectedProjectId)).then((rows) =>
      setBudgets(
        rows.map((r) => ({ id: r.id, name: r.name, projectName: r.projectName ?? null })),
      ),
    );
  }, [selectedProjectId]);

  // Load versions when budget changes
  useEffect(() => {
    setSelectedVersionId(null);
    setVersionList([]);
    if (!selectedBudgetId) return;
    getVersionsByBudgetId(selectedBudgetId).then(setVersionList);
  }, [selectedBudgetId]);

  // Execute search
  const doSearch = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setCommittedQuery(q);
    setLoading(true);
    setSearched(true);
    setSelectedGroup(null);
    try {
      const rows = await searchBudgetItems(
        q,
        selectedProjectId ?? undefined,
        selectedBudgetId ?? undefined,
        selectedVersionId ?? undefined,
      );
      setRawRows(rows);
    } finally {
      setLoading(false);
    }
  }, [query, selectedProjectId, selectedBudgetId, selectedVersionId]);

  // Re-search when scope filters change (only after first manual search)
  useEffect(() => {
    if (!searched || committedQuery.length < 2) return;
    const t = setTimeout(() => doSearch(), 0);
    return () => clearTimeout(t);
  }, [selectedProjectId, selectedBudgetId, selectedVersionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Client-side fuzzy group + score
  const groups = useMemo(
    () => groupAndScore(rawRows, committedQuery),
    [rawRows, committedQuery],
  );

  const clearSearch = () => {
    setQuery("");
    setCommittedQuery("");
    setRawRows([]);
    setSearched(false);
    setSelectedGroup(null);
  };

  // Drag-to-resize divider handler
  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const pct = ((ev.clientY - rect.top) / rect.height) * 100;
      setTopHeightPct(Math.min(85, Math.max(15, pct)));
    };
    const onUp = () => {
      isDragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const showDetail = !!selectedGroup;

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden bg-[var(--background)]">
      {/* ── LEFT SIDEBAR: search + filters ── */}
      <aside className="w-60 shrink-0 bg-white border-r border-[var(--slate-200)] flex flex-col overflow-y-auto">
        <div className="px-3 py-3 border-b border-[var(--slate-100)]">
          <h2 className="text-xs font-semibold text-[var(--slate-500)] uppercase tracking-wider">
            Tételkereső
          </h2>
          <p className="text-[10px] text-[var(--slate-400)] mt-0.5">Keresés és szűrők</p>
        </div>

        {/* Search input + button */}
        <div className="px-3 pt-3 pb-2 border-b border-[var(--slate-100)]">
          <div className="relative mb-2">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--slate-400)] pointer-events-none"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") doSearch();
              }}
              placeholder="Tételszám vagy megnevezés…"
              className="w-full pl-7 pr-7 py-1.5 text-xs border border-[var(--slate-200)] rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--indigo-500)] focus:border-transparent bg-[var(--slate-50)] placeholder:text-[var(--slate-400)]"
            />
            {query && (
              <button
                onClick={clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--slate-400)] hover:text-[var(--slate-600)]"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <button
            onClick={doSearch}
            disabled={loading || query.trim().length < 2}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[var(--indigo-600)] text-white text-xs rounded-md hover:bg-[var(--indigo-700)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent" />
                Keresés…
              </>
            ) : (
              <>
                <Search size={12} />
                Keresés
              </>
            )}
          </button>
        </div>

        {/* Scope filters */}
        <div className="flex flex-col gap-4 px-3 py-3">
          <FilterSelect
            label="Projekt"
            icon={<FolderKanban size={12} />}
            value={selectedProjectId}
            onChange={(v) => setSelectedProjectId(v)}
            options={storeProjects.map((p) => ({
              value: p.id,
              label: `${p.projectCode ?? ""} ${p.name}`.trim(),
            }))}
            placeholder="Minden projekt"
          />
          <FilterSelect
            label="Költségvetés"
            icon={<Calculator size={12} />}
            value={selectedBudgetId}
            onChange={(v) => setSelectedBudgetId(v)}
            options={budgets.map((b) => ({ value: b.id, label: b.name }))}
            placeholder={selectedProjectId ? "Minden ktgv." : "Először válasszon projektet"}
            disabled={!selectedProjectId}
          />
          <FilterSelect
            label="Verzió"
            icon={<Layers size={12} />}
            value={selectedVersionId}
            onChange={(v) => setSelectedVersionId(v)}
            options={versionList.map((v) => ({
              value: v.id,
              label: v.versionName + (v.partnerName ? ` — ${v.partnerName}` : ""),
            }))}
            placeholder={selectedBudgetId ? "Minden verzió" : "Először válasszon ktgv.-t"}
            disabled={!selectedBudgetId}
          />
        </div>

        {/* Info note */}
        <div className="mt-auto mx-3 mb-3 p-2.5 bg-[var(--indigo-50)] rounded-lg border border-[var(--indigo-100)]">
          <p className="text-[10px] text-[var(--indigo-700)] leading-relaxed">
            A szűrők opcionálisak. Kattintson egy találati sorra a részletek megjelenítéséhez.
          </p>
        </div>
      </aside>

      {/* ── RIGHT: vertical split panel ── */}
      <div
        ref={splitContainerRef}
        className="flex-1 flex flex-col min-w-0 overflow-hidden"
      >
        {/* TOP: Results table */}
        <div
          className="flex flex-col min-h-0 overflow-hidden bg-white"
          style={showDetail ? { height: `${topHeightPct}%` } : { flex: 1 }}
        >
          {/* Results header strip */}
          {searched && !loading && groups.length > 0 && (
            <div className="shrink-0 flex items-center justify-between px-4 py-1.5 border-b border-[var(--slate-200)]">
              <div className="text-xs text-[var(--slate-500)]">
                <span className="font-semibold text-[var(--slate-700)]">{groups.length}</span>{" "}
                egyedi tétel
                {rawRows.length !== groups.length && (
                  <span className="ml-1 text-[var(--slate-400)]">
                    ({rawRows.length} előfordulás)
                  </span>
                )}
                {committedQuery && (
                  <span className="ml-1">
                    —{" "}
                    <span className="font-medium text-[var(--indigo-600)]">
                      „{committedQuery}"
                    </span>
                  </span>
                )}
              </div>
              <div className="text-[10px] text-[var(--slate-400)] flex items-center gap-1">
                <Info size={10} />
                Kattintson a sorra a részletekért
              </div>
            </div>
          )}

          {/* Scrollable results */}
          <div className="flex-1 overflow-y-auto overflow-x-auto">
            {loading && (
              <div className="flex items-center justify-center py-16 text-sm text-[var(--slate-400)]">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-[var(--indigo-500)] border-t-transparent mr-2" />
                Keresés…
              </div>
            )}

            {!loading && searched && groups.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <Search size={32} className="text-[var(--slate-200)]" />
                <p className="text-sm text-[var(--slate-400)]">
                  Nincs találat — „{committedQuery}"
                </p>
                <p className="text-xs text-[var(--slate-300)]">
                  Próbálja kevesebb karakterrel vagy más szóval
                </p>
              </div>
            )}

            {!loading && !searched && (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <Search size={36} className="text-[var(--slate-200)]" />
                <p className="text-sm text-[var(--slate-400)]">
                  Adjon meg keresési kifejezést a bal oldali mezőben
                </p>
              </div>
            )}

            {!loading && groups.length > 0 && (
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[var(--slate-50)] border-b border-[var(--slate-200)]">
                    <th className="text-right px-2 py-2 text-[var(--slate-400)] font-medium w-7">
                      #
                    </th>
                    <th className="text-left px-3 py-2 text-[var(--slate-500)] font-medium whitespace-nowrap w-32">
                      Tételszám
                    </th>
                    <th className="text-left px-3 py-2 text-[var(--slate-500)] font-medium min-w-[220px]">
                      Megnevezés
                    </th>
                    <th className="text-right px-3 py-2 text-[var(--slate-500)] font-medium whitespace-nowrap">
                      Átl. anyag e.ár
                    </th>
                    <th className="text-right px-3 py-2 text-[var(--slate-500)] font-medium whitespace-nowrap">
                      Átl. díj e.ár
                    </th>
                    <th className="text-right px-2 py-2 text-[var(--slate-400)] font-medium w-12">
                      Pont
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group, idx) => {
                    const c = group.canonical;
                    const multiCount = group.occurrences.length;
                    const isSelected =
                      selectedGroup?.canonical.itemCode === group.canonical.itemCode;

                    const matPrices = group.occurrences.filter((o) => o.materialUnitPrice > 0);
                    const avgMat =
                      matPrices.length > 0
                        ? matPrices.reduce((s, o) => s + o.materialUnitPrice, 0) / matPrices.length
                        : 0;
                    const feePrices = group.occurrences.filter((o) => o.feeUnitPrice > 0);
                    const avgFee =
                      feePrices.length > 0
                        ? feePrices.reduce((s, o) => s + o.feeUnitPrice, 0) / feePrices.length
                        : 0;

                    return (
                      <tr
                        key={group.canonical.itemCode}
                        onClick={() => setSelectedGroup(isSelected ? null : group)}
                        className={`border-b border-[var(--slate-100)] cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-[var(--indigo-50)] ring-1 ring-inset ring-[var(--indigo-300)]"
                            : "hover:bg-[var(--slate-50)]"
                        }`}
                      >
                        <td className="px-2 py-2 text-right text-[var(--slate-400)] tabular-nums">
                          {idx + 1}
                        </td>
                        <td className="px-3 py-2 font-mono text-[var(--slate-600)] whitespace-nowrap">
                          {c.itemNumber ? (
                            <Highlight text={c.itemNumber} query={committedQuery} />
                          ) : (
                            <span className="text-[var(--slate-300)]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[var(--slate-800)] font-medium">
                          <span className="flex items-center gap-1.5">
                            <span>
                              <Highlight text={c.name} query={committedQuery} />
                            </span>
                            {multiCount > 1 && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-[var(--indigo-100)] text-[var(--indigo-700)] text-[9px] font-bold shrink-0">
                                ×{multiCount}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-[var(--slate-700)] tabular-nums whitespace-nowrap font-mono">
                          {avgMat > 0 ? (
                            <>
                              {fmtPrice(avgMat)}
                              {matPrices.length > 1 && (
                                <span className="ml-1 text-[9px] text-[var(--slate-400)] font-sans">∅{matPrices.length}</span>
                              )}
                            </>
                          ) : (
                            <span className="text-[var(--slate-300)]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-[var(--slate-700)] tabular-nums whitespace-nowrap font-mono">
                          {avgFee > 0 ? (
                            <>
                              {fmtPrice(avgFee)}
                              {feePrices.length > 1 && (
                                <span className="ml-1 text-[9px] text-[var(--slate-400)] font-sans">∅{feePrices.length}</span>
                              )}
                            </>
                          ) : (
                            <span className="text-[var(--slate-300)]">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <ScoreBadge score={group.score} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* DIVIDER — drag to resize */}
        {showDetail && (
          <div
            onMouseDown={onDividerMouseDown}
            className="shrink-0 h-[5px] bg-[var(--slate-200)] hover:bg-[var(--indigo-300)] cursor-row-resize flex items-center justify-center transition-colors select-none"
            title="Húzza az átméretezéshez"
          >
            <div className="w-10 h-0.5 rounded-full bg-[var(--slate-400)]" />
          </div>
        )}

        {/* BOTTOM: Detail panel */}
        {showDetail && (
          <div
            className="min-h-0 overflow-hidden"
            style={{ height: `${100 - topHeightPct}%` }}
          >
            <ItemDetailPanel
              group={selectedGroup!}
              onClose={() => setSelectedGroup(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
