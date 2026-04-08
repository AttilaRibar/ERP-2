"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, RefreshCw, ClipboardCopy, Eye, Settings2 } from "lucide-react";
import { useTabStore } from "@/stores/tab-store";
import {
  listSettlementContracts,
} from "@/server/actions/settlements";
import type { SettlementContractRow } from "@/types/settlements";

const STATUS_LABELS: Record<string, string> = {
  active: "Aktív",
  completed: "Lezárt",
  cancelled: "Visszavont",
};
const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  completed: "bg-blue-100 text-blue-700",
  cancelled: "bg-gray-100 text-gray-500",
};

export function SettlementsList() {
  const openTab = useTabStore((s) => s.openTab);
  const [contracts, setContracts] = useState<SettlementContractRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("active");
  const [copied, setCopied] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await listSettlementContracts();
    setContracts(data);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = filter === "all"
    ? contracts
    : contracts.filter((c) => c.status === filter);

  const handleCopyLink = async (c: SettlementContractRow) => {
    const url = `${window.location.origin}/settle/${c.accessToken}`;
    await navigator.clipboard.writeText(url);
    setCopied(c.id);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleCreate = () => {
    openTab({
      moduleKey: "settlements-setup",
      title: "Új elszámolás",
      color: "#0ea5e9",
    });
  };

  const handleManage = (c: SettlementContractRow) => {
    openTab({
      moduleKey: "settlements-manage",
      title: `Elszámolás: ${c.label}`,
      color: "#0ea5e9",
      params: { contractId: c.id },
    });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-[var(--slate-800)]">
          Alvállalkozói elszámolások
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="p-1.5 rounded-[6px] hover:bg-[var(--slate-100)] text-[var(--slate-500)] disabled:opacity-50 transition-colors"
            title="Frissítés"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={handleCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--indigo-600)] text-white text-xs font-medium rounded-[6px] hover:bg-[var(--indigo-700)] transition-colors"
          >
            <Plus size={14} /> Új elszámolás
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[
          { value: "all", label: "Összes" },
          { value: "active", label: "Aktív" },
          { value: "completed", label: "Lezárt" },
          { value: "cancelled", label: "Visszavont" },
        ].map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={`px-3 py-1.5 rounded-[6px] text-xs font-medium transition-colors ${
              filter === opt.value
                ? "bg-[var(--indigo-600)] text-white"
                : "border border-[var(--slate-200)] text-[var(--slate-600)] hover:bg-[var(--slate-50)]"
            }`}
          >
            {opt.label}
            {opt.value !== "all" && (
              <span className="ml-1 opacity-70">
                ({contracts.filter((c) => c.status === opt.value).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-sm text-[var(--slate-400)] py-8 text-center">Betöltés…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-[var(--slate-400)] py-8 text-center italic">
          Nincs találat.
        </div>
      ) : (
        <div className="border border-[var(--slate-200)] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--slate-50)] text-[var(--slate-500)] text-xs">
                <th className="text-left px-4 py-2.5 font-medium">Megnevezés</th>
                <th className="text-left px-4 py-2.5 font-medium">Projekt</th>
                <th className="text-left px-4 py-2.5 font-medium">Alvállalkozó</th>
                <th className="text-left px-4 py-2.5 font-medium">Verzió</th>
                <th className="text-right px-4 py-2.5 font-medium">Összeg</th>
                <th className="text-center px-4 py-2.5 font-medium">Állapot</th>
                <th className="text-center px-4 py-2.5 font-medium">Műveletek</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t border-[var(--slate-100)] hover:bg-[var(--slate-50)]/50">
                  <td className="px-4 py-2.5 font-medium text-[var(--slate-800)]">{c.label}</td>
                  <td className="px-4 py-2.5 text-[var(--slate-600)]">{c.projectName}</td>
                  <td className="px-4 py-2.5 text-[var(--slate-600)]">{c.partnerName}</td>
                  <td className="px-4 py-2.5 text-[var(--slate-600)]">{c.versionName}</td>
                  <td className="px-4 py-2.5 text-right text-[var(--slate-700)] font-mono">
                    {Number(c.totalNetAmount).toLocaleString("hu")} Ft
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[c.status] ?? "bg-gray-100"}`}>
                      {STATUS_LABELS[c.status] ?? c.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => handleCopyLink(c)}
                        className="p-1 rounded hover:bg-[var(--slate-100)] text-[var(--slate-500)] transition-colors"
                        title={copied === c.id ? "Másolva!" : "Link másolása"}
                      >
                        <ClipboardCopy size={14} className={copied === c.id ? "text-green-600" : ""} />
                      </button>
                      <button
                        onClick={() => handleManage(c)}
                        className="p-1 rounded hover:bg-[var(--slate-100)] text-[var(--slate-500)] transition-colors"
                        title="Kezelés"
                      >
                        <Settings2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
