"use client";

import { useTabStore, type TabType } from "@/stores/tab-store";
import { Plus, X, List, FilePlus, Pencil, Eye } from "lucide-react";

const TAB_TYPE_ICON: Record<TabType, typeof List> = {
  list: List,
  create: FilePlus,
  edit: Pencil,
  view: Eye,
};

export function TabBar() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const activateTab = useTabStore((s) => s.activateTab);
  const closeTab = useTabStore((s) => s.closeTab);
  const openTab = useTabStore((s) => s.openTab);

  return (
    <div className="flex items-center h-9 bg-[var(--slate-800)] shrink-0 px-2 gap-[3px] border-b-2 border-[var(--slate-900)] overflow-x-auto scrollbar-thin">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const TypeIcon = TAB_TYPE_ICON[tab.tabType] ?? List;
        return (
          <button
            key={tab.id}
            onClick={() => activateTab(tab.id)}
            className={`flex items-center gap-[6px] px-[10px] h-[27px] rounded-[5px] text-xs whitespace-nowrap shrink-0 transition-all cursor-pointer border ${
              isActive
                ? "bg-[var(--slate-50)] text-[var(--slate-800)] border-[var(--slate-50)]"
                : "bg-[#293548] border-[var(--slate-700)] text-[var(--slate-400)] hover:bg-[var(--slate-700)] hover:text-[var(--slate-300)]"
            }`}
          >
            <TypeIcon
              size={12}
              className="shrink-0"
              style={{ color: tab.color }}
            />
            {tab.title}
            <span
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className={`text-sm ml-[2px] leading-none hover:text-red-500 ${
                isActive ? "text-[var(--slate-500)]" : "text-[var(--slate-600)]"
              }`}
            >
              <X size={12} />
            </span>
          </button>
        );
      })}
      <button
        onClick={() =>
          openTab({
            moduleKey: "new",
            title: "Új lap",
            color: "#94a3b8",
          })
        }
        className="flex items-center justify-center w-6 h-6 border border-dashed border-[var(--slate-700)] rounded text-[var(--slate-600)] hover:border-[#6366f1] hover:text-[var(--indigo-300)] transition-all cursor-pointer shrink-0 ml-[2px]"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
