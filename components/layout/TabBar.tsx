"use client";

import { useTabStore, type TabType } from "@/stores/tab-store";
import { Plus, X, List, FilePlus, Pencil, Eye } from "lucide-react";

const TAB_TYPE_ICON: Record<TabType, typeof List> = {
  list: List,
  create: FilePlus,
  edit: Pencil,
  view: Eye,
};

const MODULE_TYPE_LABEL: Record<string, string> = {
  budgets: "Költségvetések",
  "budgets-detail": "Költségvetés",
  "budgets-form": "Költségvetés",
  "budgets-version": "Verzió",
  "budgets-comparison": "Összehasonlítás",
  projects: "Projektek",
  "projects-form": "Projekt",
  partners: "Partnerek",
  "partners-form": "Partner",
  quotes: "Ajánlatok",
  "quotes-form": "Ajánlat",
  scenarios: "Szcenáriók",
  "scenarios-editor": "Szcenárió",
  "scenarios-preview": "Szcenárió",
  settlements: "Elszámolások",
  "settlements-setup": "Elszámolás",
  "settlements-manager": "Elszámolás",
  "settlements-review": "Elszámolás",
  items: "Tételek",
  pricing: "Árazás",
  reports: "Riportok",
  "ai-assistant": "AI asszisztens",
};

export function TabBar() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const activateTab = useTabStore((s) => s.activateTab);
  const closeTab = useTabStore((s) => s.closeTab);
  const openTab = useTabStore((s) => s.openTab);

  return (
    <div className="flex items-end bg-[var(--slate-800)] shrink-0 px-2 pt-[6px] gap-[3px] overflow-x-auto scrollbar-thin">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const TypeIcon = TAB_TYPE_ICON[tab.tabType] ?? List;
        const typeLabel = tab.typeLabel ?? MODULE_TYPE_LABEL[tab.moduleKey];
        const subtitle = tab.subtitle;
        const hasSecondLine = Boolean(typeLabel || subtitle);
        return (
          <button
            key={tab.id}
            onClick={() => activateTab(tab.id)}
            title={[tab.title, typeLabel, subtitle].filter(Boolean).join(" · ")}
            className={`group relative flex items-center gap-[8px] pl-[10px] pr-[6px] ${
              hasSecondLine ? "py-[5px]" : "h-[34px]"
            } rounded-t-[6px] text-xs whitespace-nowrap shrink-0 transition-colors cursor-pointer border border-b-0 max-w-[240px] min-w-[150px] ${
              isActive
                ? "bg-white text-[var(--slate-800)] border-[var(--slate-300)] -mb-px z-[1]"
                : "bg-[#293548] border-[var(--slate-700)] text-[var(--slate-400)] hover:bg-[var(--slate-700)] hover:text-[var(--slate-200)] mb-[2px]"
            }`}
          >
            <TypeIcon
              size={13}
              className="shrink-0"
              style={{ color: tab.color }}
            />
            <span className="flex flex-col items-start min-w-0 leading-tight flex-1">
              <span className="truncate max-w-[180px] font-medium text-[12px]">
                {tab.title}
              </span>
              {hasSecondLine && (
                <span className="truncate max-w-[180px] text-[10px] mt-[1px] text-[var(--slate-500)]">
                  {typeLabel && (
                    <span
                      className="uppercase tracking-[0.4px] font-semibold"
                      style={{ color: isActive ? tab.color : "var(--slate-400)" }}
                    >
                      {typeLabel}
                    </span>
                  )}
                  {typeLabel && subtitle && (
                    <span className="mx-[4px] opacity-60">·</span>
                  )}
                  {subtitle}
                </span>
              )}
            </span>
            <span
              role="button"
              aria-label="Lap bezárása"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className={`shrink-0 leading-none p-[2px] rounded hover:bg-[var(--slate-200)] hover:text-red-500 ${
                isActive ? "text-[var(--slate-500)]" : "text-[var(--slate-500)]"
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
        className="flex items-center justify-center w-7 h-7 mb-[6px] border border-dashed border-[var(--slate-700)] rounded text-[var(--slate-500)] hover:border-[#6366f1] hover:text-[var(--indigo-300)] transition-all cursor-pointer shrink-0 ml-[2px]"
        aria-label="Új lap nyitása"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
