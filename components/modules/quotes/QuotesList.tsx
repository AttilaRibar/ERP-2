"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Search, X } from "lucide-react";
import { getQuotes } from "@/server/actions/quotes";
import { useTabStore } from "@/stores/tab-store";
import { useProjectStore } from "@/stores/project-store";
import { MultiSelect } from "@/components/ui/MultiSelect";

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: "Függőben", color: "#f59e0b" },
  accepted: { label: "Elfogadva", color: "#22c55e" },
  rejected: { label: "Elutasítva", color: "#ef4444" },
  expired: { label: "Lejárt", color: "#94a3b8" },
};

const STATUS_OPTIONS = Object.entries(STATUS_MAP).map(([value, { label, color }]) => ({ value, label, color }));

type Quote = Awaited<ReturnType<typeof getQuotes>>[number];

function formatPrice(price: string | null, currency: string) {
  if (!price) return "—";
  const num = Number(price);
  if (currency === "HUF") return `${num.toLocaleString("hu-HU")} Ft`;
  return `€${num.toLocaleString("hu-HU")}`;
}

export function QuotesList() {
  const [rows, setRows] = useState<Quote[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusSelected, setStatusSelected] = useState<string[]>([]);
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [loading, setLoading] = useState(true);
  const openTab = useTabStore((s) => s.openTab);
  const globalProjectId = useProjectStore((s) => s.selectedProject?.id ?? null);
  const availableProjects = useProjectStore((s) => s.projects);
  const [projectFilter, setProjectFilter] = useState<number | null>(globalProjectId);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setProjectFilter(globalProjectId);
  }, [globalProjectId]);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getQuotes(
      search || undefined,
      undefined,
      projectFilter ?? undefined,
    );
    setRows(data);
    setLoading(false);
  }, [search, projectFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const openView = (quoteId: number, subject: string) => {
    openTab({
      moduleKey: "quotes-form",
      title: `${subject}`,
      color: "#22c55e",
      params: { quoteId },
    });
  };

  const openNew = () => {
    openTab({
      moduleKey: "quotes-form",
      title: "Új ajánlat",
      color: "#22c55e",
    });
  };

  const clearFilters = () => {
    setStatusSelected([]);
    setValidFrom("");
    setValidTo("");
    setProjectFilter(null);
  };

  const hasActiveFilters = statusSelected.length > 0 || validFrom || validTo || projectFilter !== null;

  const filtered = rows.filter((row) => {
    if (statusSelected.length > 0 && !statusSelected.includes(row.status)) return false;
    if (validFrom && row.validUntil && row.validUntil < validFrom) return false;
    if (validTo && row.validUntil && row.validUntil > validTo) return false;
    return true;
  });

  return (
    <div className="flex flex-1 min-h-0">
      {/* Sidebar */}
      <aside className="w-[220px] shrink-0 bg-white border-r border-[var(--slate-200)] flex flex-col overflow-y-auto">
        <div className="p-3">
          <button
            onClick={openNew}
            className="w-full flex items-center justify-center gap-[5px] px-3 py-[7px] rounded-[6px] text-xs bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] cursor-pointer transition-colors"
          >
            <Plus size={13} />
            Új ajánlat
          </button>
        </div>

        <div className="px-3 flex flex-col gap-4 pb-4">
          {/* Projekt */}
          <div>
            <div className="text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-2">Projekt</div>
            <select
              value={projectFilter ?? ""}
              onChange={(e) => setProjectFilter(e.target.value ? Number(e.target.value) : null)}
              className="h-7 w-full bg-[var(--slate-50)] border border-[var(--slate-200)] rounded-[6px] px-2 text-xs text-[var(--slate-700)] outline-none focus:border-[var(--indigo-600)] transition-colors"
            >
              <option value="">Összes projekt</option>
              {availableProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.projectCode ? `${p.projectCode} ` : ""}{p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Státusz */}
          <div>
            <div className="text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-2">Státusz</div>
            <MultiSelect label="Státusz" options={STATUS_OPTIONS} selected={statusSelected} onChange={setStatusSelected} />
          </div>

          {/* Érvényes ig */}
          <div>
            <div className="text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-1.5">Érvényes ig</div>
            <div className="flex flex-col gap-1">
              <input
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
                className="h-7 w-full bg-[var(--slate-50)] border border-[var(--slate-200)] rounded-[6px] px-2 text-xs text-[var(--slate-700)] outline-none focus:border-[var(--indigo-600)] transition-colors"
              />
              <input
                type="date"
                value={validTo}
                onChange={(e) => setValidTo(e.target.value)}
                className="h-7 w-full bg-[var(--slate-50)] border border-[var(--slate-200)] rounded-[6px] px-2 text-xs text-[var(--slate-700)] outline-none focus:border-[var(--indigo-600)] transition-colors"
              />
            </div>
          </div>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center justify-center gap-1 w-full py-[6px] rounded-[6px] text-xs text-[var(--slate-400)] hover:text-[var(--slate-700)] hover:bg-[var(--slate-100)] transition-colors"
            >
              <X size={11} />
              Szűrők törlése
            </button>
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-[10px] bg-white border-b border-[var(--slate-200)] shrink-0">
          <span className="text-sm font-semibold text-[var(--slate-800)]">Ajánlatok</span>
          <div className="relative ml-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--slate-400)]" size={12} />
            <input
              type="text"
              placeholder="Keresés…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="h-7 bg-[var(--slate-50)] border border-[var(--slate-200)] rounded-[6px] pl-7 pr-3 text-xs text-[var(--slate-700)] outline-none focus:border-[var(--indigo-600)] transition-colors w-[200px]"
            />
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-sm text-[var(--slate-400)]">Betöltés…</div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-[var(--slate-400)]">Nincs találat</div>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead className="sticky top-0 bg-[var(--slate-50)] z-[1]">
              <tr>
                {["Kód", "Tárgy", "Projekt", "Ajánlattevő", "Összeg", "Érvényes", "Státusz"].map((h) => (
                  <th
                    key={h}
                    className="px-[14px] py-[9px] text-left text-[11px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const st = STATUS_MAP[row.status];
                return (
                  <tr key={row.id} className="hover:[&_td]:bg-[#fafbff]">
                    <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)] text-[#6366f1] font-medium font-mono text-xs">
                      {row.quoteCode}
                    </td>
                    <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)] font-medium">
                      <button
                        onClick={() => openView(row.id, row.subject)}
                        className="bg-transparent border-none p-0 text-left text-[12.5px] font-medium text-[var(--foreground)] cursor-pointer transition-colors hover:text-[var(--indigo-600)] border-b border-dotted border-transparent hover:border-b hover:border-dotted hover:border-[var(--indigo-600)]"
                      >
                        {row.subject}
                      </button>
                    </td>
                    <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)] text-[var(--foreground)]">
                      {row.projectId ? (
                        <button
                          onClick={() => openTab({
                            moduleKey: "projects-form",
                            title: `${row.projectName}`,
                            color: "#06b6d4",
                            params: { projectId: row.projectId },
                          })}
                          className="text-left bg-transparent border-none p-0 cursor-pointer hover:underline text-[12.5px]"
                          title="Projekt megnyitása"
                        >
                          <span className="text-[#6366f1] font-mono text-xs">{row.projectCode}</span>{" "}
                          <span className="text-[#06b6d4]">{row.projectName}</span>
                        </button>
                      ) : "—"}
                    </td>
                    <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)] text-[var(--foreground)]">
                      {row.offererId && row.offererName ? (
                        <button
                          onClick={() => openTab({
                            moduleKey: "partners-form",
                            title: `${row.offererName}`,
                            color: "#8b5cf6",
                            params: { partnerId: row.offererId },
                          })}
                          className="text-[#8b5cf6] hover:underline cursor-pointer bg-transparent border-none p-0 text-left text-[12.5px]"
                          title="Partner megnyitása"
                        >
                          {row.offererName}
                        </button>
                      ) : "—"}
                    </td>
                    <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)] font-semibold text-[var(--slate-800)]">
                      {formatPrice(row.price, row.currency)}
                    </td>
                    <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)] text-[var(--foreground)]">
                      {row.validUntil ?? "—"}
                    </td>
                    <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)]">
                      <span
                        className="px-[9px] py-[3px] rounded-[20px] text-[11px] font-medium"
                        style={{
                          backgroundColor: `${st?.color}20`,
                          color: st?.color,
                        }}
                      >
                        {st?.label ?? row.status}
                      </span>
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
            {filtered.length === rows.length
              ? `${rows.length} ajánlat`
              : `${filtered.length} / ${rows.length} ajánlat`}
          </span>
        </div>
      </div>
    </div>
  );
}
