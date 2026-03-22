"use client";

import { MODULE_REGISTRY } from "@/lib/modules";
import { useTabStore } from "@/stores/tab-store";

export function ModuleNav() {
  const openTab = useTabStore((s) => s.openTab);

  return (
    <nav className="flex items-center h-10 bg-[var(--slate-900)] shrink-0 px-3 gap-[2px] overflow-x-auto scrollbar-hide border-b border-[var(--slate-800)]">
      {MODULE_REGISTRY.map((mod, i) => {
        const Icon = mod.icon;
        return (
          <div key={mod.key} className="contents">
            {mod.group === "sep" && (
              <div className="w-px h-[18px] bg-[var(--slate-800)] mx-1 shrink-0" />
            )}
            <button
              onClick={() =>
                openTab({
                  moduleKey: mod.key,
                  title: mod.label,
                  color: mod.color,
                })
              }
              className="flex items-center gap-[7px] px-[13px] h-full text-[13px] text-[var(--slate-500)] hover:text-[var(--slate-200)] hover:bg-[var(--slate-800)] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              <Icon size={13} />
              {mod.label}
            </button>
          </div>
        );
      })}
    </nav>
  );
}
