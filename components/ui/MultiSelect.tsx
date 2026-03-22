"use client";

import { useRef, useEffect, useState } from "react";
import { ChevronDown, Check, X } from "lucide-react";

export interface MultiSelectOption {
  value: string;
  label: string;
  color?: string;
}

interface MultiSelectProps {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

export function MultiSelect({ label, options, selected, onChange }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  };

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  const isActive = selected.length > 0;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] text-xs border transition-colors ${
          isActive
            ? "bg-[var(--indigo-50)] border-[var(--indigo-300)] text-[var(--indigo-700)]"
            : "bg-white border-[var(--slate-200)] text-[var(--slate-600)] hover:bg-[var(--slate-50)] hover:border-[var(--slate-300)]"
        }`}
      >
        <span className="font-medium">{label}</span>
        {isActive ? (
          <>
            <span className="bg-[var(--indigo-600)] text-white text-[10px] font-bold min-w-[16px] h-[16px] px-[3px] rounded-full flex items-center justify-center leading-none">
              {selected.length}
            </span>
            <span
              onClick={clearAll}
              className="text-[var(--indigo-400)] hover:text-[var(--indigo-700)] flex items-center"
            >
              <X size={10} />
            </span>
          </>
        ) : (
          <ChevronDown
            size={11}
            className={`text-[var(--slate-400)] transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 min-w-[180px] bg-white border border-[var(--slate-200)] rounded-[8px] shadow-[0_4px_16px_rgba(0,0,0,0.08)] z-50 py-1.5 overflow-hidden">
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => { onChange([]); setOpen(false); }}
              className="flex items-center gap-1.5 w-full px-3 py-[5px] text-xs text-[var(--slate-400)] hover:bg-[var(--slate-50)] transition-colors border-b border-[var(--slate-100)] mb-1"
            >
              <X size={10} />
              Kijelölés törlése
            </button>
          )}
          {options.map((opt) => {
            const isSelected = selected.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className="flex items-center gap-2 w-full px-3 py-[6px] text-xs text-left hover:bg-[var(--slate-50)] transition-colors"
              >
                <div
                  className={`w-[14px] h-[14px] rounded-[3px] border flex items-center justify-center shrink-0 transition-colors ${
                    isSelected
                      ? "bg-[var(--indigo-600)] border-[var(--indigo-600)]"
                      : "border-[var(--slate-300)]"
                  }`}
                >
                  {isSelected && <Check size={9} className="text-white" strokeWidth={3} />}
                </div>
                {opt.color && (
                  <span
                    className="w-[8px] h-[8px] rounded-full shrink-0"
                    style={{ backgroundColor: opt.color }}
                  />
                )}
                <span className="text-[var(--slate-700)]">{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
