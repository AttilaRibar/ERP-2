"use client";

import { Filter, Download, Plus, MoreHorizontal } from "lucide-react";

interface RowData {
  id: string;
  client: string;
  clientInitials: string;
  clientColor: string;
  date: string;
  items: number;
  amount: string;
  status: "completed" | "in-progress" | "draft";
  selected?: boolean;
}

const STATUS_MAP = {
  completed: { label: "Befejezett", cls: "bg-[var(--green-100)] text-[var(--green-800)]" },
  "in-progress": { label: "Folyamatban", cls: "bg-[var(--amber-100)] text-[var(--amber-900)]" },
  draft: { label: "Tervezet", cls: "bg-[var(--slate-100)] text-[var(--slate-600)]" },
};

const DEMO_ROWS: RowData[] = [
  { id: "#KIV-5512", client: "Acme Kft.", clientInitials: "AK", clientColor: "#6366f1", date: "2025. jan. 14.", items: 12, amount: "€24 800", status: "completed", selected: true },
  { id: "#KIV-5511", client: "Beta Tech", clientInitials: "BT", clientColor: "#8b5cf6", date: "2025. jan. 12.", items: 5, amount: "€9 350", status: "in-progress" },
  { id: "#KIV-5510", client: "Global Systems", clientInitials: "GS", clientColor: "#0ea5e9", date: "2025. jan. 10.", items: 8, amount: "€16 200", status: "completed" },
  { id: "#KIV-5509", client: "Nexus Kft.", clientInitials: "NX", clientColor: "#f59e0b", date: "2025. jan. 8.", items: 3, amount: "€4 100", status: "draft" },
  { id: "#KIV-5508", client: "Vertex AI", clientInitials: "VA", clientColor: "#10b981", date: "2025. jan. 6.", items: 21, amount: "€58 900", status: "completed" },
  { id: "#KIV-5507", client: "Sigma Ret", clientInitials: "SR", clientColor: "#ef4444", date: "2025. jan. 3.", items: 7, amount: "€12 450", status: "in-progress" },
];

export function MainContent() {
  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-[10px] bg-white border-b border-[var(--slate-200)] shrink-0">
        <span className="text-sm font-semibold text-[var(--slate-800)]">
          Kivitelezés — 2025 Q1
        </span>
        <button className="flex items-center gap-[5px] px-3 py-[5px] rounded-[6px] text-xs text-[var(--slate-500)] border border-[var(--slate-200)] hover:bg-[var(--slate-50)] hover:text-[var(--slate-800)] cursor-pointer transition-colors">
          <Filter size={12} />
          Szűrő
        </button>
        <button className="flex items-center gap-[5px] px-3 py-[5px] rounded-[6px] text-xs text-[var(--slate-500)] border border-[var(--slate-200)] hover:bg-[var(--slate-50)] hover:text-[var(--slate-800)] cursor-pointer transition-colors">
          <Download size={12} />
          Export
        </button>
        <div className="flex-1" />
        <button className="flex items-center gap-[5px] px-3 py-[5px] rounded-[6px] text-xs bg-[var(--indigo-600)] text-white border border-[var(--indigo-600)] hover:bg-[var(--indigo-hover)] cursor-pointer transition-colors">
          <Plus size={12} />
          Új tétel
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead className="sticky top-0 bg-[var(--slate-50)] z-[1]">
            <tr>
              <th className="w-8 px-[14px] py-[9px] text-left text-[11px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)]">
                <input type="checkbox" className="accent-[#6366f1]" />
              </th>
              <th className="px-[14px] py-[9px] text-left text-[11px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">Azonosító</th>
              <th className="px-[14px] py-[9px] text-left text-[11px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">Ügyfél</th>
              <th className="px-[14px] py-[9px] text-left text-[11px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">Dátum</th>
              <th className="px-[14px] py-[9px] text-left text-[11px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">Tételek</th>
              <th className="px-[14px] py-[9px] text-left text-[11px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">Összeg</th>
              <th className="px-[14px] py-[9px] text-left text-[11px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">Státusz</th>
              <th className="px-[14px] py-[9px] text-left text-[11px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)]" />
            </tr>
          </thead>
          <tbody>
            {DEMO_ROWS.map((row) => {
              const st = STATUS_MAP[row.status];
              return (
                <tr
                  key={row.id}
                  className={`hover:[&_td]:bg-[#fafbff] ${row.selected ? "[&_td]:bg-[var(--violet-100)]" : ""}`}
                >
                  <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)] align-middle">
                    <input
                      type="checkbox"
                      defaultChecked={row.selected}
                      className="accent-[#6366f1]"
                    />
                  </td>
                  <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)] align-middle text-[#6366f1] font-medium font-mono text-xs">
                    {row.id}
                  </td>
                  <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)] align-middle text-[var(--foreground)]">
                    <div className="flex items-center gap-[6px]">
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
                        style={{ backgroundColor: row.clientColor }}
                      >
                        {row.clientInitials}
                      </div>
                      {row.client}
                    </div>
                  </td>
                  <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)] align-middle text-[var(--foreground)]">
                    {row.date}
                  </td>
                  <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)] align-middle text-[var(--foreground)]">
                    {row.items}
                  </td>
                  <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)] align-middle font-semibold text-[var(--slate-800)]">
                    {row.amount}
                  </td>
                  <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)] align-middle">
                    <span className={`px-[9px] py-[3px] rounded-[20px] text-[11px] font-medium ${st.cls}`}>
                      {st.label}
                    </span>
                  </td>
                  <td className="px-[14px] py-[10px] border-b border-[var(--slate-100)] align-middle text-[var(--slate-500)]">
                    <MoreHorizontal size={14} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center gap-[6px] px-4 py-[10px] bg-white border-t border-[var(--slate-200)] shrink-0">
        <span className="text-xs text-[var(--slate-400)]">1–6 / 248 tétel</span>
        <div className="flex-1" />
        <PageBtn label="‹" />
        <PageBtn label="1" active />
        <PageBtn label="2" />
        <PageBtn label="3" />
        <PageBtn label="…" />
        <PageBtn label="42" />
        <PageBtn label="›" />
      </div>
    </div>
  );
}

function PageBtn({ label, active }: { label: string; active?: boolean }) {
  return (
    <button
      className={`w-7 h-7 border rounded-[6px] flex items-center justify-center text-xs cursor-pointer transition-colors ${
        active
          ? "bg-[var(--indigo-600)] text-white border-[var(--indigo-600)]"
          : "bg-white text-[var(--slate-500)] border-[var(--slate-200)] hover:border-[#6366f1] hover:text-[#6366f1]"
      }`}
    >
      {label}
    </button>
  );
}
