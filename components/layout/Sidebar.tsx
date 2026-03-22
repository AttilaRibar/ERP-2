export function Sidebar() {
  return (
    <aside className="w-[196px] shrink-0 bg-white border-r border-[var(--slate-200)] flex flex-col overflow-y-auto">
      {/* Szűrők */}
      <div className="p-3 pb-[6px]">
        <div className="text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-2">
          Szűrők
        </div>
        <FilterItem color="#8b5cf6" label="Összes" count={248} active />
        <FilterItem color="#f59e0b" label="Folyamatban" count={34} />
        <FilterItem color="#22c55e" label="Befejezett" count={198} />
        <FilterItem color="#ef4444" label="Késedelmes" count={16} />
      </div>

      <Divider />

      {/* Időszak */}
      <div className="p-3 pb-[6px]">
        <div className="text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-2">
          Időszak
        </div>
        <FilterItem label="2025 Q1" active />
        <FilterItem label="2024 Q4" />
        <FilterItem label="2024 Q3" />
        <FilterItem label="Egyéni…" />
      </div>

      <Divider />

      {/* Mini stats */}
      <div className="p-2 px-3">
        <div className="text-[11px] text-[var(--slate-400)]">Összes bevétel</div>
        <div className="text-lg font-semibold text-[var(--slate-800)] my-[2px]">€1,24M</div>
        <div className="text-[11px] text-green-500">↑ 12,4% előző negyedévhez</div>
      </div>
      <div className="p-2 px-3">
        <div className="text-[11px] text-[var(--slate-400)]">Nyitott tételek</div>
        <div className="text-lg font-semibold text-[var(--slate-800)] my-[2px]">34</div>
        <div className="text-[11px] text-amber-500">↔ azonos előző negyedévvel</div>
      </div>
    </aside>
  );
}

function FilterItem({
  color,
  label,
  count,
  active,
}: {
  color?: string;
  label: string;
  count?: number;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 py-[5px] px-2 rounded-[6px] text-xs cursor-pointer ${
        active
          ? "bg-[var(--violet-100)] text-[var(--violet-900)]"
          : "text-[var(--slate-600)] hover:bg-[var(--slate-100)] hover:text-[var(--slate-800)]"
      }`}
    >
      {color && (
        <span
          className="w-[7px] h-[7px] rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
      )}
      {label}
      {count !== undefined && (
        <span
          className={`ml-auto text-[11px] px-[6px] py-[1px] rounded-[10px] ${
            active
              ? "bg-[var(--violet-200)] text-[var(--violet-900)]"
              : "bg-[var(--slate-100)] text-[var(--slate-500)]"
          }`}
        >
          {count}
        </span>
      )}
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-[var(--slate-100)] mx-3 my-[6px]" />;
}
