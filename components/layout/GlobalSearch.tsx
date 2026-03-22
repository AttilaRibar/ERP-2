"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Users, FolderKanban, FileText, Calculator } from "lucide-react";
import { globalSearch, type SearchResult } from "@/server/actions/search";
import { useTabStore } from "@/stores/tab-store";
import { MODULE_REGISTRY } from "@/lib/modules";

const MODULE_META: Record<string, { icon: typeof Search; color: string; label: string }> = {
  projects:  { icon: FolderKanban, color: "#06b6d4", label: "Projekt" },
  partners:  { icon: Users,        color: "#8b5cf6", label: "Partner" },
  quotes:    { icon: FileText,     color: "#22c55e", label: "Ajánlat" },
  budgets:   { icon: Calculator,   color: "#f59e0b", label: "Költségvetés" },
};

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const openTab = useTabStore((s) => s.openTab);

  // Debounced search
  const doSearch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const res = await globalSearch(q);
      setResults(res);
      setOpen(true);
      setLoading(false);
      setActiveIndex(-1);
    }, 250);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    doSearch(val);
  };

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  // Keyboard shortcut: Ctrl+K / Cmd+K focuses search
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  const PARAM_KEY: Record<string, string> = {
    projects: "projectId",
    partners: "partnerId",
    quotes:   "quoteId",
    budgets:  "budgetId",
  };

  const handleSelect = (result: SearchResult) => {
    const mod = MODULE_REGISTRY.find((m) => m.key === result.moduleKey);
    const paramKey = PARAM_KEY[result.moduleKey] ?? "id";
    openTab({
      moduleKey: `${result.moduleKey}-form`,
      title: result.label,
      color: mod?.color ?? "#94a3b8",
      params: { [paramKey]: result.id },
    });
    setOpen(false);
    setQuery("");
    setResults([]);
    inputRef.current?.blur();
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) {
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => (i < results.length - 1 ? i + 1 : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => (i > 0 ? i - 1 : results.length - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < results.length) {
          handleSelect(results[activeIndex]);
        }
        break;
      case "Escape":
        setOpen(false);
        inputRef.current?.blur();
        break;
    }
  };

  // Group results by moduleKey preserving order
  const grouped: { moduleKey: string; items: SearchResult[] }[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (!seen.has(r.moduleKey)) {
      seen.add(r.moduleKey);
      grouped.push({ moduleKey: r.moduleKey, items: [] });
    }
    grouped.find((g) => g.moduleKey === r.moduleKey)!.items.push(r);
  }

  // Flat index for keyboard nav
  let flatIdx = 0;

  return (
    <div className="flex-1 max-w-[420px] relative mx-2" ref={containerRef}>
      <Search
        className="absolute left-[10px] top-1/2 -translate-y-1/2 text-[var(--slate-400)] pointer-events-none"
        size={13}
      />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (results.length > 0) setOpen(true);
        }}
        placeholder="Keresés mindenben…"
        className="w-full h-8 bg-[var(--slate-700)] border border-[var(--slate-600)] rounded-[7px] pl-8 pr-10 text-[13px] text-[var(--slate-200)] placeholder:text-[var(--slate-400)] outline-none focus:border-[var(--indigo-600)] transition-colors"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-autocomplete="list"
      />
      <kbd className="absolute right-2 top-1/2 -translate-y-1/2 bg-[var(--slate-600)] text-[var(--slate-400)] text-[10px] px-[5px] py-[2px] rounded pointer-events-none">
        ⌘K
      </kbd>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute left-0 top-full mt-1 w-full bg-[var(--slate-800)] border border-[var(--slate-600)] rounded-lg shadow-xl z-50 max-h-[400px] overflow-y-auto"
          role="listbox"
        >
          {loading && results.length === 0 && (
            <div className="px-3 py-3 text-xs text-[var(--slate-400)] text-center">
              Keresés…
            </div>
          )}

          {!loading && results.length === 0 && query.trim().length >= 2 && (
            <div className="px-3 py-3 text-xs text-[var(--slate-400)] text-center">
              Nincs találat
            </div>
          )}

          {grouped.map((group) => {
            const meta = MODULE_META[group.moduleKey];
            const Icon = meta?.icon ?? Search;
            return (
              <div key={group.moduleKey}>
                {/* Category header */}
                <div className="flex items-center gap-[6px] px-3 pt-2 pb-1">
                  <Icon size={11} style={{ color: meta?.color ?? "#94a3b8" }} />
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: meta?.color ?? "#94a3b8" }}
                  >
                    {meta?.label ?? group.moduleKey}
                  </span>
                </div>

                {/* Items */}
                {group.items.map((item) => {
                  const idx = flatIdx++;
                  const isActive = idx === activeIndex;
                  return (
                    <button
                      key={`${item.moduleKey}-${item.id}`}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onClick={() => handleSelect(item)}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={`w-full text-left px-3 py-[7px] flex items-center gap-2 transition-colors cursor-pointer text-[12px] ${
                        isActive
                          ? "bg-[var(--slate-700)]"
                          : "hover:bg-[var(--slate-700)]"
                      }`}
                    >
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          {item.code && (
                            <span
                              className="font-mono text-[11px] shrink-0"
                              style={{ color: meta?.color ?? "#94a3b8" }}
                            >
                              {item.code}
                            </span>
                          )}
                          <span className="text-[var(--slate-200)] truncate">
                            {item.label}
                          </span>
                        </span>
                        {item.subtitle && (
                          <span className="text-[11px] text-[var(--slate-400)] truncate">
                            {item.subtitle}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
