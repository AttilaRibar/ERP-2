"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Plus,
  GitBranch,
  Trash2,
  Pencil,
  Check,
  X,
  GitCompareArrows,
} from "lucide-react";
import {
  getVersionsByBudgetId,
  createVersion,
  renameVersion,
  deleteVersionAction,
  type VersionInfo,
} from "@/server/actions/versions";

const CARD_W = 180;
const CARD_H = 72;
const H_GAP = 60;
const V_GAP = 16;

interface VersionGraphProps {
  budgetId: number;
  onOpenVersion: (versionId: number, versionName: string) => void;
  onCompare: (
    versionAId: number,
    versionBId: number,
    nameA: string,
    nameB: string
  ) => void;
}

interface LayoutNode {
  version: VersionInfo;
  x: number;
  y: number;
}

function computeLayout(versionsList: VersionInfo[]): LayoutNode[] {
  if (versionsList.length === 0) return [];

  const childrenMap = new Map<number | null, VersionInfo[]>();
  for (const v of versionsList) {
    const key = v.parentId;
    if (!childrenMap.has(key)) childrenMap.set(key, []);
    childrenMap.get(key)!.push(v);
  }

  const positions = new Map<number, { x: number; y: number }>();
  let yCounter = 0;

  function layoutSubtree(nodeId: number, level: number): void {
    const kids = childrenMap.get(nodeId) ?? [];
    if (kids.length === 0) {
      positions.set(nodeId, {
        x: level * (CARD_W + H_GAP),
        y: yCounter * (CARD_H + V_GAP),
      });
      yCounter++;
    } else {
      for (const kid of kids) {
        layoutSubtree(kid.id, level + 1);
      }
      const firstKid = positions.get(kids[0].id)!;
      const lastKid = positions.get(kids[kids.length - 1].id)!;
      positions.set(nodeId, {
        x: level * (CARD_W + H_GAP),
        y: (firstKid.y + lastKid.y) / 2,
      });
    }
  }

  const roots = childrenMap.get(null) ?? [];
  for (const root of roots) {
    layoutSubtree(root.id, 0);
  }

  return versionsList
    .filter((v) => positions.has(v.id))
    .map((v) => ({ version: v, ...positions.get(v.id)! }));
}

function getEdgePath(
  parent: { x: number; y: number },
  child: { x: number; y: number }
): string {
  const x1 = parent.x + CARD_W;
  const y1 = parent.y + CARD_H / 2;
  const x2 = child.x;
  const y2 = child.y + CARD_H / 2;
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

export function VersionGraph({
  budgetId,
  onOpenVersion,
  onCompare,
}: VersionGraphProps) {
  const [versionsList, setVersionsList] = useState<VersionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [compareSet, setCompareSet] = useState<number[]>([]);
  const [newVersionName, setNewVersionName] = useState("");
  const [newVersionParentId, setNewVersionParentId] = useState<number | null>(
    null
  );
  const [showNewForm, setShowNewForm] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getVersionsByBudgetId(budgetId);
    setVersionsList(data);
    setLoading(false);
  }, [budgetId]);

  useEffect(() => {
    load();
  }, [load]);

  const layout = useMemo(() => computeLayout(versionsList), [versionsList]);

  const posMap = useMemo(
    () => new Map(layout.map((n) => [n.version.id, { x: n.x, y: n.y }])),
    [layout]
  );

  const containerW = useMemo(() => {
    if (layout.length === 0) return 400;
    return Math.max(...layout.map((n) => n.x)) + CARD_W + 40;
  }, [layout]);

  const containerH = useMemo(() => {
    if (layout.length === 0) return 200;
    return Math.max(...layout.map((n) => n.y)) + CARD_H + 40;
  }, [layout]);

  const toggleCompare = (id: number) => {
    setCompareSet((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const handleCreateVersion = async () => {
    if (!newVersionName.trim()) return;
    const result = await createVersion(
      budgetId,
      newVersionParentId,
      newVersionName.trim()
    );
    if (result.success) {
      setNewVersionName("");
      setShowNewForm(false);
      setNewVersionParentId(null);
      await load();
    }
  };

  const handleRename = async (id: number) => {
    if (!renameValue.trim()) return;
    await renameVersion(id, renameValue.trim());
    setRenamingId(null);
    await load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Biztosan törölni szeretné ezt a verziót?")) return;
    const result = await deleteVersionAction(id);
    if (result.success) {
      setCompareSet((prev) => prev.filter((x) => x !== id));
      await load();
    } else {
      alert(result.error);
    }
  };

  const handleCompare = () => {
    if (compareSet.length !== 2) return;
    const a = versionsList.find((v) => v.id === compareSet[0]);
    const b = versionsList.find((v) => v.id === compareSet[1]);
    if (a && b) {
      onCompare(a.id, b.id, a.versionName, b.versionName);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-[var(--slate-400)]">
        Betöltés…
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-[10px] bg-white border-b border-[var(--slate-200)] shrink-0">
        <GitBranch size={14} className="text-[var(--slate-500)]" />
        <span className="text-sm font-semibold text-[var(--slate-800)]">
          Verziófa
        </span>
        <div className="flex-1" />
        {compareSet.length === 2 && (
          <button
            onClick={handleCompare}
            className="flex items-center gap-1.5 px-3 py-[5px] rounded-[6px] text-xs bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] cursor-pointer transition-colors"
          >
            <GitCompareArrows size={12} />
            Összehasonlítás
          </button>
        )}
        {compareSet.length > 0 && (
          <button
            onClick={() => setCompareSet([])}
            className="px-3 py-[5px] rounded-[6px] text-xs border border-[var(--slate-200)] text-[var(--slate-500)] hover:bg-[var(--slate-50)] cursor-pointer transition-colors"
          >
            Kijelölés törlése
          </button>
        )}
        <button
          onClick={() => {
            setShowNewForm(true);
            setNewVersionParentId(null);
          }}
          className="flex items-center gap-1.5 px-3 py-[5px] rounded-[6px] text-xs bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] cursor-pointer transition-colors"
        >
          <Plus size={12} />
          Új gyökér verzió
        </button>
      </div>

      {/* New version inline form */}
      {showNewForm && (
        <div className="flex items-center gap-2 px-4 py-2 bg-[var(--indigo-50)] border-b border-[var(--indigo-200)]">
          <span className="text-xs text-[var(--slate-600)]">
            {newVersionParentId ? "Új gyermek verzió:" : "Új gyökér verzió:"}
          </span>
          <input
            autoFocus
            value={newVersionName}
            onChange={(e) => setNewVersionName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateVersion()}
            placeholder="Verzió neve…"
            className="h-7 px-2 border border-[var(--slate-200)] rounded-[6px] text-xs outline-none focus:border-[var(--indigo-600)] w-48"
          />
          <button
            onClick={handleCreateVersion}
            className="flex items-center gap-1 px-3 py-[5px] rounded-[6px] text-xs bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] cursor-pointer transition-colors"
          >
            <Check size={12} />
            Létrehozás
          </button>
          <button
            onClick={() => {
              setShowNewForm(false);
              setNewVersionName("");
            }}
            className="p-1 text-[var(--slate-400)] hover:text-[var(--slate-700)] cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Graph */}
      <div className="flex-1 overflow-auto bg-[var(--slate-50)] p-5">
        {versionsList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <GitBranch size={40} className="text-[var(--slate-300)]" />
            <p className="text-sm text-[var(--slate-400)]">
              Még nincs verzió. Hozzon létre egy gyökér verziót!
            </p>
          </div>
        ) : (
          <div
            className="relative"
            style={{ width: containerW, height: containerH }}
          >
            {/* SVG edges */}
            <svg
              className="absolute inset-0 pointer-events-none"
              width={containerW}
              height={containerH}
            >
              {versionsList.map((v) => {
                if (!v.parentId) return null;
                const parentPos = posMap.get(v.parentId);
                const childPos = posMap.get(v.id);
                if (!parentPos || !childPos) return null;
                return (
                  <path
                    key={`edge-${v.parentId}-${v.id}`}
                    d={getEdgePath(parentPos, childPos)}
                    fill="none"
                    stroke="var(--slate-300)"
                    strokeWidth={2}
                  />
                );
              })}
            </svg>

            {/* Version cards */}
            {layout.map((node) => {
              const v = node.version;
              const isComparing = compareSet.includes(v.id);
              const isLeaf = !v.hasChildren;
              const isRoot = v.parentId === null;
              const isRenaming = renamingId === v.id;

              return (
                <div
                  key={v.id}
                  className={`absolute bg-white border-2 rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer ${
                    isComparing
                      ? "border-[var(--indigo-500)] ring-2 ring-[var(--indigo-200)]"
                      : "border-[var(--slate-200)] hover:border-[var(--slate-300)]"
                  }`}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: CARD_W,
                    height: CARD_H,
                  }}
                  onClick={() =>
                    !isRenaming && onOpenVersion(v.id, v.versionName)
                  }
                >
                  <div className="flex flex-col h-full p-2">
                    <div className="flex items-center gap-1">
                      {isRenaming ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(v.id);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 h-5 px-1 text-xs border border-[var(--indigo-400)] rounded outline-none"
                        />
                      ) : (
                        <span className="flex-1 text-xs font-semibold text-[var(--slate-800)] truncate">
                          {v.versionName}
                        </span>
                      )}
                      <div
                        className="flex items-center gap-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isRenaming ? (
                          <>
                            <button
                              onClick={() => handleRename(v.id)}
                              className="p-0.5 text-green-600 hover:text-green-800 cursor-pointer"
                            >
                              <Check size={11} />
                            </button>
                            <button
                              onClick={() => setRenamingId(null)}
                              className="p-0.5 text-[var(--slate-400)] hover:text-[var(--slate-700)] cursor-pointer"
                            >
                              <X size={11} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => toggleCompare(v.id)}
                              title="Összehasonlításhoz kijelölés"
                              className={`p-0.5 cursor-pointer transition-colors ${
                                isComparing
                                  ? "text-[var(--indigo-600)]"
                                  : "text-[var(--slate-400)] hover:text-[var(--indigo-600)]"
                              }`}
                            >
                              <GitCompareArrows size={11} />
                            </button>
                            <button
                              onClick={() => {
                                setRenamingId(v.id);
                                setRenameValue(v.versionName);
                              }}
                              className="p-0.5 text-[var(--slate-400)] hover:text-[var(--slate-700)] cursor-pointer"
                            >
                              <Pencil size={11} />
                            </button>
                            {isLeaf && (
                              <button
                                onClick={() => handleDelete(v.id)}
                                className="p-0.5 text-[var(--slate-400)] hover:text-red-600 cursor-pointer"
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setNewVersionParentId(v.id);
                                setShowNewForm(true);
                              }}
                              title="Gyermek verzió létrehozása"
                              className="p-0.5 text-[var(--slate-400)] hover:text-green-600 cursor-pointer"
                            >
                              <Plus size={11} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 mt-auto">
                      {isRoot && (
                        <span className="px-1.5 py-[1px] text-[9px] font-medium rounded bg-[var(--amber-100)] text-[var(--amber-900)]">
                          gyökér
                        </span>
                      )}
                      {isLeaf && (
                        <span className="px-1.5 py-[1px] text-[9px] font-medium rounded bg-[var(--green-100)] text-[var(--green-800)]">
                          levél
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-[var(--slate-400)]">
                        {v.createdAt
                          ? new Date(v.createdAt).toLocaleDateString("hu-HU")
                          : ""}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
