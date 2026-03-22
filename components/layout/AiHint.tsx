"use client";

import { Sparkles } from "lucide-react";

export function AiHint() {
  return (
    <button className="absolute bottom-3 right-3 bg-[var(--slate-800)] text-[var(--indigo-300)] text-[11px] px-3 py-[7px] rounded-lg flex items-center gap-[6px] border border-[var(--slate-700)] cursor-pointer z-10 hover:bg-[var(--slate-700)] transition-colors">
      <span className="w-[7px] h-[7px] bg-[var(--violet-600)] rounded-full animate-pulse-dot" />
      <Sparkles size={12} />
      AI asszisztens — ⌘K
    </button>
  );
}
