"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { MODULE_REGISTRY } from "@/lib/modules";
import { useTabStore } from "@/stores/tab-store";
import type { ModuleDef } from "@/types/modules";

function DropdownButton({ mod, openTab }: { mod: ModuleDef; openTab: ReturnType<typeof useTabStore>["openTab"] }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const Icon = mod.icon;

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const root = btnRef.current?.closest("[data-dropdown-root]");
      const panel = panelRef.current;
      const target = e.target as Node;
      if (
        (!root || !root.contains(target)) &&
        (!panel || !panel.contains(target))
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function handleToggle() {
    if (btnRef.current) {
      setRect(btnRef.current.getBoundingClientRect());
    }
    setOpen((v) => !v);
  }

  return (
    <div data-dropdown-root className="h-full flex items-center shrink-0">
      <button
        ref={btnRef}
        onClick={handleToggle}
        className="flex items-center gap-[7px] px-[13px] h-full text-[13px] text-[var(--slate-300)] hover:text-white hover:bg-[var(--slate-800)] whitespace-nowrap transition-colors cursor-pointer"
      >
        <Icon size={13} />
        {mod.label}
        <ChevronDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && rect && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", top: rect.bottom + 1, left: rect.left, zIndex: 9999 }}
          className="min-w-[200px] bg-[var(--slate-900)] border border-[var(--slate-700)] rounded shadow-lg py-1"
        >
          {mod.dropdownItems!.map((item) => {
            const isPlaceholder = !!item.params;
            return (
              <button
                key={item.key}
                onClick={() => {
                  if (!isPlaceholder) {
                    openTab({
                      moduleKey: item.moduleKey,
                      title: item.label,
                      color: mod.color,
                    });
                  }
                  setOpen(false);
                }}
                className={`flex w-full items-center px-4 py-2 text-[13px] whitespace-nowrap transition-colors ${
                  isPlaceholder
                    ? "text-[var(--slate-600)] cursor-not-allowed"
                    : "text-[var(--slate-300)] hover:text-white hover:bg-[var(--slate-800)] cursor-pointer"
                }`}
              >
                {item.label}
                {isPlaceholder && (
                  <span className="ml-auto pl-3 text-[11px] text-[var(--slate-700)]">hamarosan</span>
                )}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

export function ModuleNav() {
  const openTab = useTabStore((s) => s.openTab);

  return (
    <nav className="flex items-center h-10 bg-[var(--slate-900)] shrink-0 px-3 gap-[2px] overflow-x-auto scrollbar-hide border-b border-[var(--slate-800)]">
      {MODULE_REGISTRY.map((mod) => {
        const Icon = mod.icon;
        return (
          <div key={mod.key} className="contents">
            {mod.group === "sep" && (
              <div className="w-px h-[18px] bg-[var(--slate-800)] mx-1 shrink-0" />
            )}
            {mod.dropdownItems ? (
              <DropdownButton mod={mod} openTab={openTab} />
            ) : (
              <button
                onClick={() =>
                  openTab({
                    moduleKey: mod.key,
                    title: mod.label,
                    color: mod.color,
                  })
                }
                className="flex items-center gap-[7px] px-[13px] h-full text-[13px] text-[var(--slate-300)] hover:text-white hover:bg-[var(--slate-800)] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                <Icon size={13} />
                {mod.label}
              </button>
            )}
          </div>
        );
      })}
    </nav>
  );
}
