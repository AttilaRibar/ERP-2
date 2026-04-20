"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Plus,
  GitBranch,
  Trash2,
  Pencil,
  Check,
  X,
  GitCompareArrows,
  FileText,
  FileSignature,
  Upload,
  Download,
  Paperclip,
  MessageSquare,
  MoreVertical,
  CheckSquare,
  ArrowLeftRight,
  Layers,
} from "lucide-react";
import {
  getVersionsByBudgetId,
  createVersion,
  renameVersion,
  deleteVersionAction,
  getPartnersForVersionSelect,
  updateVersionNotes,
  type VersionInfo,
  type VersionType,
} from "@/server/actions/versions";
import {
  uploadVersionFile,
  getVersionFileDownloadUrl,
} from "@/server/actions/version-files";

const CARD_W = 200;
const CARD_H = 96;
const H_GAP = 60;
const V_GAP = 16;

const VERSION_TYPE_CONFIG: Record<VersionType, { label: string; color: string; bg: string; border: string; edgeColor: string; icon: typeof FileText }> = {
  offer: { label: "Ajánlati", color: "text-[var(--blue-700)]", bg: "bg-[var(--blue-100)]", border: "border-[var(--blue-300)]", edgeColor: "#94a3b8", icon: FileText },
  contracted: { label: "Szerződött", color: "text-[var(--amber-800)]", bg: "bg-[var(--amber-100)]", border: "border-[var(--amber-300)]", edgeColor: "#f59e0b", icon: FileSignature },
  unpriced: { label: "Árazatlan", color: "text-[var(--slate-600)]", bg: "bg-[var(--slate-100)]", border: "border-[var(--slate-300)]", edgeColor: "#94a3b8", icon: FileText },
};

interface VersionGraphProps {
  budgetId: number;
  onOpenVersion: (versionId: number, versionName: string, versionType: VersionType, partnerName: string | null) => void;
  onCompare: (
    versionAId: number,
    versionBId: number,
    nameA: string,
    nameB: string
  ) => void;
  onMultiCompare?: (
    versionIds: number[],
    versionNames: string[]
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
  onMultiCompare,
}: VersionGraphProps) {
  const [versionsList, setVersionsList] = useState<VersionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSet, setCompareSet] = useState<number[]>([]);
  const [newVersionName, setNewVersionName] = useState("");
  const [newVersionParentId, setNewVersionParentId] = useState<number | null>(
    null
  );
  const [showNewForm, setShowNewForm] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [newVersionType, setNewVersionType] = useState<VersionType>("offer");
  const [newVersionPartnerId, setNewVersionPartnerId] = useState<number | null>(null);
  const [partnersList, setPartnersList] = useState<{ id: number; name: string }[]>([]);
  const [uploadingVersionId, setUploadingVersionId] = useState<number | null>(null);
  const [editingNotesId, setEditingNotesId] = useState<number | null>(null);
  const [notesValue, setNotesValue] = useState("");
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [showCompareChoice, setShowCompareChoice] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputVersionRef = useRef<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [data, partnersData] = await Promise.all([
      getVersionsByBudgetId(budgetId),
      getPartnersForVersionSelect(),
    ]);
    setVersionsList(data);
    setPartnersList(partnersData);
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
      return [...prev, id];
    });
  };

  // Close dropdown on outside click
  useEffect(() => {
    if (openMenuId === null) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenuId]);

  const handleCreateVersion = async () => {
    if (!newVersionName.trim()) return;
    const result = await createVersion(
      budgetId,
      newVersionParentId,
      newVersionName.trim(),
      newVersionType,
      newVersionPartnerId
    );
    if (result.success) {
      setNewVersionName("");
      setShowNewForm(false);
      setNewVersionParentId(null);
      setNewVersionType("offer");
      setNewVersionPartnerId(null);
      await load();
    }
  };

  const handleRename = async (id: number) => {
    if (!renameValue.trim()) return;
    await renameVersion(id, renameValue.trim());
    setRenamingId(null);
    await load();
  };

  const handleFileUpload = useCallback(async (versionId: number, file: File) => {
    setUploadingVersionId(versionId);
    const formData = new FormData();
    formData.append("file", file);
    const result = await uploadVersionFile(versionId, formData);
    setUploadingVersionId(null);
    if (result.success) {
      await load();
    } else {
      alert(result.error ?? "Hiba a feltöltés közben");
    }
  }, [load]);

  const handleFileDownload = useCallback(async (versionId: number) => {
    const result = await getVersionFileDownloadUrl(versionId);
    if (result.success && result.url) {
      const a = document.createElement("a");
      a.href = result.url;
      a.download = result.fileName ?? "file";
      a.click();
    } else {
      alert(result.error ?? "Hiba a letöltés közben");
    }
  }, []);

  const handleSaveNotes = useCallback(async (versionId: number) => {
    await updateVersionNotes(versionId, notesValue);
    setEditingNotesId(null);
    await load();
  }, [notesValue, load]);

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
    if (compareSet.length === 2) {
      // Show choice: simple or multi
      setShowCompareChoice(true);
    } else if (compareSet.length >= 3 && onMultiCompare) {
      const ids = compareSet;
      const names = ids.map((id) => versionsList.find((v) => v.id === id)?.versionName ?? `#${id}`);
      onMultiCompare(ids, names);
    }
  };

  const handleCompareSimple = () => {
    const a = versionsList.find((v) => v.id === compareSet[0]);
    const b = versionsList.find((v) => v.id === compareSet[1]);
    if (a && b) {
      onCompare(a.id, b.id, a.versionName, b.versionName);
    }
    setShowCompareChoice(false);
  };

  const handleCompareMulti = () => {
    if (onMultiCompare) {
      const ids = compareSet;
      const names = ids.map((id) => versionsList.find((v) => v.id === id)?.versionName ?? `#${id}`);
      onMultiCompare(ids, names);
    }
    setShowCompareChoice(false);
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

        {compareMode && (
          <span className="ml-2 text-xs text-[var(--indigo-600)] font-medium bg-[var(--indigo-50)] px-2 py-0.5 rounded-full">
            {compareSet.length} verzió kiválasztva
          </span>
        )}

        <div className="flex-1" />

        {compareMode ? (
          <>
            <button
              onClick={() => {
                setCompareMode(false);
                setCompareSet([]);
                setShowCompareChoice(false);
              }}
              className="px-3 py-[5px] rounded-[6px] text-xs border border-[var(--slate-200)] text-[var(--slate-500)] hover:bg-[var(--slate-50)] cursor-pointer transition-colors"
            >
              Mégse
            </button>
            {showCompareChoice ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-[var(--slate-500)]">Mód:</span>
                <button
                  onClick={handleCompareSimple}
                  className="flex items-center gap-1 px-3 py-[5px] rounded-[6px] text-xs bg-blue-600 text-white hover:bg-blue-700 cursor-pointer transition-colors"
                >
                  <ArrowLeftRight size={12} />
                  Egyszerű
                </button>
                <button
                  onClick={handleCompareMulti}
                  className="flex items-center gap-1 px-3 py-[5px] rounded-[6px] text-xs bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] cursor-pointer transition-colors"
                >
                  <Layers size={12} />
                  Többes
                </button>
              </div>
            ) : (
              <button
                onClick={handleCompare}
                disabled={compareSet.length < 2}
                className="flex items-center gap-1.5 px-3 py-[5px] rounded-[6px] text-xs bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <GitCompareArrows size={12} />
                Összehasonlítás{compareSet.length >= 2 ? ` (${compareSet.length})` : ""}
              </button>
            )}
          </>
        ) : (
          <>
            {versionsList.length >= 2 && (
              <button
                onClick={() => setCompareMode(true)}
                className="flex items-center gap-1.5 px-3 py-[5px] rounded-[6px] text-xs border border-[var(--slate-200)] text-[var(--slate-600)] hover:bg-[var(--indigo-50)] hover:text-[var(--indigo-600)] hover:border-[var(--indigo-200)] cursor-pointer transition-colors"
              >
                <GitCompareArrows size={12} />
                Összehasonlítás
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
          </>
        )}
      </div>

      {/* New version inline form */}
      {showNewForm && (
        <div className="flex items-center gap-2 px-4 py-2 bg-[var(--indigo-50)] border-b border-[var(--indigo-200)] flex-wrap">
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
          <select
            value={newVersionType}
            onChange={(e) => setNewVersionType(e.target.value as VersionType)}
            className="h-7 px-2 border border-[var(--slate-200)] rounded-[6px] text-xs outline-none focus:border-[var(--indigo-600)] bg-white"
          >
            <option value="offer">Ajánlati</option>
            <option value="contracted">Szerződött</option>
            <option value="unpriced">Árazatlan</option>
          </select>
          <select
            value={newVersionPartnerId ?? ""}
            onChange={(e) => setNewVersionPartnerId(e.target.value ? Number(e.target.value) : null)}
            className="h-7 px-2 border border-[var(--slate-200)] rounded-[6px] text-xs outline-none focus:border-[var(--indigo-600)] bg-white w-48"
          >
            <option value="">Partner (opcionális)</option>
            {partnersList.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={handleCreateVersion}
            disabled={!newVersionName.trim()}
            className="flex items-center gap-1 px-3 py-[5px] rounded-[6px] text-xs bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check size={12} />
            Létrehozás
          </button>
          <button
            onClick={() => {
              setShowNewForm(false);
              setNewVersionName("");
              setNewVersionType("offer");
              setNewVersionPartnerId(null);
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
                const typeConfig = VERSION_TYPE_CONFIG[v.versionType] ?? VERSION_TYPE_CONFIG.offer;
                return (
                  <path
                    key={`edge-${v.parentId}-${v.id}`}
                    d={getEdgePath(parentPos, childPos)}
                    fill="none"
                    stroke="#cbd5e1"
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
              const isRenaming = renamingId === v.id;
              const typeConfig = VERSION_TYPE_CONFIG[v.versionType] ?? VERSION_TYPE_CONFIG.offer;
              const TypeIcon = typeConfig.icon;
              const isMenuOpen = openMenuId === v.id;

              return (
                <div
                  key={v.id}
                  className={`absolute border-2 rounded-lg shadow-sm hover:shadow-md transition-all cursor-pointer ${
                    isComparing
                      ? "border-[var(--indigo-500)] ring-2 ring-[var(--indigo-200)] bg-white"
                      : `bg-white ${typeConfig.border} hover:shadow-md`
                  }`}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: CARD_W,
                    height: CARD_H,
                  }}
                  onClick={() => {
                    if (isRenaming) return;
                    if (compareMode) {
                      toggleCompare(v.id);
                      return;
                    }
                    onOpenVersion(v.id, v.versionName, v.versionType, v.partnerName);
                  }}
                >
                  <div className="flex flex-col h-full p-2">
                    {/* Header row: checkbox/name + notes indicator + kebab */}
                    <div className="flex items-center gap-1">
                      {compareMode && (
                        <div className={`flex-shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                          isComparing
                            ? "bg-[var(--indigo-600)] border-[var(--indigo-600)]"
                            : "border-[var(--slate-300)] bg-white"
                        }`}>
                          {isComparing && <Check size={9} className="text-white" strokeWidth={3} />}
                        </div>
                      )}
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
                      {/* Notes indicator dot */}
                      {!isRenaming && v.notes && (
                        <span className="group/note relative flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                          <span className="block w-2 h-2 rounded-full bg-[var(--amber-400)]" />
                          <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 hidden group-hover/note:block z-50 w-max max-w-[220px] px-2.5 py-1.5 rounded-md bg-[var(--slate-800)] text-[10px] text-white shadow-lg whitespace-pre-wrap pointer-events-none">
                            {v.notes}
                          </span>
                        </span>
                      )}
                      {/* Rename confirm/cancel */}
                      {isRenaming && (
                        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
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
                        </div>
                      )}
                      {/* Kebab menu button */}
                      {!isRenaming && !compareMode && (
                        <div className="relative flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => setOpenMenuId(isMenuOpen ? null : v.id)}
                            className="p-0.5 text-[var(--slate-400)] hover:text-[var(--slate-700)] cursor-pointer transition-colors rounded hover:bg-[var(--slate-100)]"
                          >
                            <MoreVertical size={13} />
                          </button>
                          {/* Dropdown menu */}
                          {isMenuOpen && (
                            <div
                              ref={menuRef}
                              className="absolute right-0 top-full mt-1 z-50 w-[180px] bg-white border border-[var(--slate-200)] rounded-lg shadow-lg py-1"
                            >
                              <button
                                onClick={() => {
                                  setRenamingId(v.id);
                                  setRenameValue(v.versionName);
                                  setOpenMenuId(null);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--slate-700)] hover:bg-[var(--slate-50)] cursor-pointer transition-colors"
                              >
                                <Pencil size={12} className="text-[var(--slate-400)]" />
                                Átnevezés
                              </button>
                              <button
                                onClick={() => {
                                  setEditingNotesId(v.id);
                                  setNotesValue(v.notes ?? "");
                                  setOpenMenuId(null);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--slate-700)] hover:bg-[var(--slate-50)] cursor-pointer transition-colors"
                              >
                                <MessageSquare size={12} className={v.notes ? "text-[var(--amber-500)]" : "text-[var(--slate-400)]"} />
                                Megjegyzés
                              </button>
                              <button
                                onClick={() => {
                                  setNewVersionParentId(v.id);
                                  setShowNewForm(true);
                                  setOpenMenuId(null);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--slate-700)] hover:bg-[var(--slate-50)] cursor-pointer transition-colors"
                              >
                                <Plus size={12} className="text-[var(--slate-400)]" />
                                Gyermek verzió
                              </button>
                              <div className="my-1 border-t border-[var(--slate-100)]" />
                              <label
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--slate-700)] hover:bg-[var(--slate-50)] cursor-pointer transition-colors"
                              >
                                <Upload size={12} className="text-[var(--slate-400)]" />
                                {v.originalFileName ? "Fájl cseréje" : "Fájl feltöltése"}
                                <input
                                  type="file"
                                  className="hidden"
                                  accept=".xls,.xlsx,.pdf,.doc,.docx,.csv,.zip"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handleFileUpload(v.id, file);
                                    e.target.value = "";
                                    setOpenMenuId(null);
                                  }}
                                />
                              </label>
                              {v.originalFileName && (
                                <button
                                  onClick={() => {
                                    handleFileDownload(v.id);
                                    setOpenMenuId(null);
                                  }}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--slate-700)] hover:bg-[var(--slate-50)] cursor-pointer transition-colors"
                                >
                                  <Download size={12} className="text-green-600" />
                                  Fájl letöltése
                                </button>
                              )}
                              {isLeaf && (
                                <>
                                  <div className="my-1 border-t border-[var(--slate-100)]" />
                                  <button
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      handleDelete(v.id);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-red-600 hover:bg-red-50 cursor-pointer transition-colors"
                                  >
                                    <Trash2 size={12} />
                                    Törlés
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {/* Footer row: type badge + partner + file indicator */}
                    <div className="flex items-center gap-1 mt-auto flex-wrap">
                      <span className={`flex items-center gap-0.5 px-1.5 py-[1px] text-[9px] font-medium rounded ${typeConfig.bg} ${typeConfig.color}`}>
                        <TypeIcon size={9} />
                        {typeConfig.label}
                      </span>
                      {v.partnerName && (
                        <span className="px-1.5 py-[1px] text-[9px] font-medium rounded bg-[var(--slate-100)] text-[var(--slate-600)] truncate max-w-[100px]" title={v.partnerName}>
                          {v.partnerName}
                        </span>
                      )}
                      {v.originalFileName && (
                        <span
                          className={`ml-auto flex items-center gap-0.5 text-[9px] ${
                            uploadingVersionId === v.id
                              ? "text-[var(--amber-500)] animate-pulse"
                              : "text-[var(--slate-400)]"
                          }`}
                          title={v.originalFileName}
                        >
                          <Paperclip size={9} />
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Notes editing popover */}
                  {editingNotesId === v.id && (
                    <div
                      className="absolute top-full left-0 mt-1 z-50 w-[240px] bg-white border border-[var(--slate-200)] rounded-lg shadow-lg p-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-1 mb-1.5">
                        <MessageSquare size={11} className="text-[var(--amber-500)]" />
                        <span className="text-[10px] font-semibold text-[var(--slate-700)]">Megjegyzés</span>
                      </div>
                      <textarea
                        autoFocus
                        value={notesValue}
                        onChange={(e) => setNotesValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditingNotesId(null);
                        }}
                        placeholder="Pl. feltételes ajánlat, nem tartalmazza a…"
                        rows={3}
                        className="w-full px-2 py-1.5 text-[11px] border border-[var(--slate-200)] rounded-md outline-none focus:border-[var(--indigo-400)] resize-none"
                      />
                      <div className="flex items-center gap-1 mt-1.5 justify-end">
                        <button
                          onClick={() => setEditingNotesId(null)}
                          className="px-2 py-1 text-[10px] text-[var(--slate-500)] hover:text-[var(--slate-700)] cursor-pointer"
                        >
                          Mégse
                        </button>
                        <button
                          onClick={() => handleSaveNotes(v.id)}
                          className="px-2.5 py-1 text-[10px] bg-[var(--indigo-600)] text-white rounded-md hover:bg-[var(--indigo-700)] cursor-pointer"
                        >
                          Mentés
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
