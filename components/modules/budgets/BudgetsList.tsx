"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Search, X } from "lucide-react";
import { getBudgets } from "@/server/actions/budgets";
import { useTabStore } from "@/stores/tab-store";
import { useProjectStore } from "@/stores/project-store";

type Budget = Awaited<ReturnType<typeof getBudgets>>[number];

function toDateStr(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function BudgetsList() {
  const [rows, setRows] = useState<Budget[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
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
    const projectFilterStr = projectFilter !== null ? String(projectFilter) : undefined;
    const data = await getBudgets(search || undefined, projectFilterStr);
    setRows(data);
    setLoading(false);
  }, [search, projectFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const openView = (budgetId: number, name: string) => {
    openTab({
      moduleKey: "budgets-detail",
      title: name,
      color: "#f59e0b",
      tabType: "view",
      params: { budgetId },
    });
  };

  const openNew = () => {
    openTab({
      moduleKey: "budgets-form",
      title: "Új költségvetés",
      color: "#f59e0b",
    });
  };

  const hasActiveFilters = createdFrom || createdTo || projectFilter !== null;

  const filtered = rows.filter((row) => {
    const ds = toDateStr(row.createdAt);
    if (createdFrom && ds && ds < createdFrom) return false;
    if (createdTo && ds && ds > createdTo) return false;
    return true;
  });

  return (
    <div className="flex flex-1 min-h-0">
      {/* Sidebar */}
      <aside className="w-[196px] shrink-0 bg-white border-r border-[var(--slate-200)] flex flex-col overflow-y-auto">
        <div className="p-3">
          <button
            onClick={openNew}
            className="w-full flex items-center justify-center gap-[5px] px-3 py-[7px] rounded-[6px] text-xs bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] cursor-pointer transition-colors"
          >
            <Plus size={13} />
            Új költségvetés
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

          <div>
            <div className="text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-1.5">Létrehozva</div>
            <div className="flex flex-col gap-1">
              <input
                type="date"
                value={createdFrom}
                onChange={(e) => setCreatedFrom(e.target.value)}
                className="h-7 w-full bg-[var(--slate-50)] border border-[var(--slate-200)] rounded-[6px] px-2 text-xs text-[var(--slate-700)] outline-none focus:border-[var(--indigo-600)] transition-colors"
              />
              <input
                type="date"
                value={createdTo}
                onChange={(e) => setCreatedTo(e.target.value)}
                className="h-7 w-full bg-[var(--slate-50)] border border-[var(--slate-200)] rounded-[6px] px-2 text-xs text-[var(--slate-700)] outline-none focus:border-[var(--indigo-600)] transition-colors"
              />
            </div>
          </div>

          {hasActiveFilters && (
            <button
              onClick={() => { setCreatedFrom(""); setCreatedTo(""); setProjectFilter(null); }}
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
          <span className="text-sm font-semibold text-[var(--slate-800)]">Költségvetések</span>
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
                {["#", "Név", "Projekt", "Létrehozva"].map((h) => (
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
              {filtered.map((row) => (
                <tr key={row.id} className="hover:[&_td]:bg-[#fafbff]">
                  <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)] text-[#6366f1] font-medium font-mono text-xs">
                    {row.id}
                  </td>
                  <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)] font-medium">
                    <button
                      onClick={() => openView(row.id, row.name)}
                      className="bg-transparent border-none p-0 text-left text-[12.5px] font-medium text-[var(--foreground)] cursor-pointer transition-colors hover:text-[var(--indigo-600)] border-b border-dotted border-transparent hover:border-b hover:border-dotted hover:border-[var(--indigo-600)]"
                    >
                      {row.name}
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
                    {row.createdAt ? new Date(row.createdAt).toLocaleDateString("hu-HU") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

        {/* Footer */}
        <div className="flex items-center px-4 py-[10px] bg-white border-t border-[var(--slate-200)] shrink-0">
          <span className="text-xs text-[var(--slate-400)]">
            {filtered.length === rows.length
              ? `${rows.length} költségvetés`
              : `${filtered.length} / ${rows.length} költségvetés`}
          </span>
        </div>
      </div>
    </div>
  );
}
