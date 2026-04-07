"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Search, X, Layers, Pencil, Trash2, Eye } from "lucide-react";
import {
  getScenarios,
  deleteScenario,
  type ScenarioInfo,
} from "@/server/actions/scenarios";
import { useTabStore } from "@/stores/tab-store";
import { useProjectStore } from "@/stores/project-store";

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("hu-HU");
}

function toDateStr(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ScenariosList() {
  const [rows, setRows] = useState<ScenarioInfo[]>([]);
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
    const data = await getScenarios(
      search || undefined,
      projectFilter ?? undefined
    );
    setRows(data);
    setLoading(false);
  }, [search, projectFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const openEditor = (scenarioId?: number, name?: string) => {
    if (scenarioId) {
      openTab({
        moduleKey: "scenarios-editor",
        title: name ?? `Szcenárió #${scenarioId}`,
        color: "#ec4899",
        tabType: "edit",
        params: { scenarioId },
      });
    } else {
      openTab({
        moduleKey: "scenarios-editor",
        title: "Új szcenárió",
        color: "#ec4899",
        tabType: "create",
      });
    }
  };

  const openPreview = (scenarioId: number, name: string) => {
    openTab({
      moduleKey: "scenarios-preview",
      title: `${name} — Előnézet`,
      color: "#ec4899",
      tabType: "view",
      params: { scenarioId },
    });
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Biztosan törölni szeretné ezt a szcenáriót?")) return;
    await deleteScenario(id);
    load();
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
            onClick={() => openEditor()}
            className="w-full flex items-center justify-center gap-[5px] px-3 py-[7px] rounded-[6px] text-xs bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] cursor-pointer transition-colors"
          >
            <Plus size={13} />
            Új szcenárió
          </button>
        </div>

        <div className="px-3 flex flex-col gap-4 pb-4">
          {/* Projekt */}
          <div>
            <div className="text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-2">
              Projekt
            </div>
            <select
              value={projectFilter ?? ""}
              onChange={(e) =>
                setProjectFilter(e.target.value ? Number(e.target.value) : null)
              }
              className="h-7 w-full bg-[var(--slate-50)] border border-[var(--slate-200)] rounded-[6px] px-2 text-xs text-[var(--slate-700)] outline-none focus:border-[var(--indigo-600)] transition-colors"
            >
              <option value="">Összes projekt</option>
              {availableProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.projectCode ? `${p.projectCode} ` : ""}
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-1.5">
              Létrehozva
            </div>
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
              onClick={() => {
                setCreatedFrom("");
                setCreatedTo("");
                setProjectFilter(null);
              }}
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
          <Layers size={15} className="text-pink-500" />
          <span className="text-sm font-semibold text-[var(--slate-800)]">
            Szcenáriók
          </span>
          <div className="relative ml-2">
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

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-sm text-[var(--slate-400)]">
              Betöltés…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <Layers size={36} className="text-[var(--slate-300)]" />
              <p className="text-sm text-[var(--slate-400)]">
                {search || projectFilter
                  ? "Nincs találat a megadott szűrőkkel"
                  : "Még nincs szcenárió — hozzon létre egyet!"}
              </p>
              {!search && !projectFilter && (
                <button
                  onClick={() => openEditor()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-xs bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] cursor-pointer transition-colors"
                >
                  <Plus size={12} />
                  Új szcenárió
                </button>
              )}
            </div>
          ) : (
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="sticky top-0 bg-[var(--slate-50)] z-[1]">
                <tr>
                  {["#", "Név", "Projekt", "Rétegek", "Módosítva", ""].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-[14px] py-[9px] text-left text-[11px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} className="hover:[&_td]:bg-[#fafbff]">
                    <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)] text-pink-600 font-medium font-mono text-xs">
                      {row.id}
                    </td>
                    <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)]">
                      <button
                        onClick={() => openPreview(row.id, row.name)}
                        className="bg-transparent border-none p-0 text-left text-[12.5px] font-medium text-[var(--foreground)] cursor-pointer transition-colors hover:text-pink-600 border-b border-dotted border-transparent hover:border-b hover:border-dotted hover:border-pink-600"
                      >
                        {row.name}
                      </button>
                      {row.description && (
                        <div className="text-[11px] text-[var(--slate-400)] mt-0.5 truncate max-w-[300px]">
                          {row.description}
                        </div>
                      )}
                    </td>
                    <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)]">
                      {row.projectCode && (
                        <span className="text-[var(--indigo-600)] font-mono text-[11px]">
                          {row.projectCode}
                        </span>
                      )}{" "}
                      <span className="text-[var(--slate-600)]">
                        {row.projectName}
                      </span>
                    </td>
                    <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)]">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-pink-50 text-pink-700 text-[11px] font-medium">
                        <Layers size={10} />
                        {row.layerCount}
                      </span>
                    </td>
                    <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)] text-[var(--slate-500)] text-xs">
                      {fmtDate(row.updatedAt)}
                    </td>
                    <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)]">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openPreview(row.id, row.name)}
                          title="Előnézet"
                          className="p-1 rounded hover:bg-[var(--slate-100)] text-[var(--slate-400)] hover:text-[var(--slate-700)] transition-colors cursor-pointer"
                        >
                          <Eye size={13} />
                        </button>
                        <button
                          onClick={() => openEditor(row.id, row.name)}
                          title="Szerkesztés"
                          className="p-1 rounded hover:bg-[var(--slate-100)] text-[var(--slate-400)] hover:text-[var(--slate-700)] transition-colors cursor-pointer"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(row.id)}
                          title="Törlés"
                          className="p-1 rounded hover:bg-red-50 text-[var(--slate-400)] hover:text-red-600 transition-colors cursor-pointer"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
