"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Search, X } from "lucide-react";
import { getPartners } from "@/server/actions/partners";
import { useTabStore } from "@/stores/tab-store";
import { MultiSelect } from "@/components/ui/MultiSelect";

const PARTNER_TYPES: Record<string, { label: string; color: string }> = {
  client: { label: "Megrendelő", color: "#22c55e" },
  subcontractor: { label: "Alvállalkozó", color: "#f59e0b" },
  supplier: { label: "Szállító", color: "#3b82f6" },
};

const TYPE_OPTIONS = Object.entries(PARTNER_TYPES).map(([value, { label, color }]) => ({ value, label, color }));

type Partner = Awaited<ReturnType<typeof getPartners>>[number];

export function PartnersList() {
  const [rows, setRows] = useState<Partner[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [typeSelected, setTypeSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const openTab = useTabStore((s) => s.openTab);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getPartners(search || undefined);
    setRows(data);
    setLoading(false);
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  const openView = (partnerId: number, name: string) => {
    openTab({
      moduleKey: "partners-form",
      title: `${name}`,
      color: "#8b5cf6",
      params: { partnerId },
    });
  };

  const openNew = () => {
    openTab({
      moduleKey: "partners-form",
      title: "Új partner",
      color: "#8b5cf6",
    });
  };

  const hasActiveFilters = typeSelected.length > 0;

  const filtered = rows.filter((row) => {
    if (typeSelected.length > 0 && !typeSelected.includes(row.partnerType)) return false;
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
            Új partner
          </button>
        </div>

        <div className="px-3 flex flex-col gap-4 pb-4">
          <div>
            <div className="text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-2">Típus</div>
            <MultiSelect label="Típus" options={TYPE_OPTIONS} selected={typeSelected} onChange={setTypeSelected} />
          </div>

          {hasActiveFilters && (
            <button
              onClick={() => setTypeSelected([])}
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
          <span className="text-sm font-semibold text-[var(--slate-800)]">Partnerek</span>
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
                {["#", "Név", "Típus", "E-mail", "Telefon", "Adószám"].map((h) => (
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
                const pt = PARTNER_TYPES[row.partnerType];
                return (
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
                    <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)]">
                      <span
                        className="px-[9px] py-[3px] rounded-[20px] text-[11px] font-medium"
                        style={{
                          backgroundColor: `${pt?.color}20`,
                          color: pt?.color,
                        }}
                      >
                        {pt?.label ?? row.partnerType}
                      </span>
                    </td>
                    <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)] text-[var(--foreground)]">
                      {row.email ?? "—"}
                    </td>
                    <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)] text-[var(--foreground)]">
                      {row.phone ?? "—"}
                    </td>
                    <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)] text-[var(--foreground)] font-mono text-xs">
                      {row.taxNumber ?? "—"}
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
              ? `${rows.length} partner`
              : `${filtered.length} / ${rows.length} partner`}
          </span>
        </div>
      </div>
    </div>
  );
}
