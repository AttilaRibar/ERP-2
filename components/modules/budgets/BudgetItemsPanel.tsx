"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ArrowLeft,
  Search,
  Plus,
  Save,
  X,
  Pencil,
  Trash2,
  Check,
  Undo2,
  GitBranch,
} from "lucide-react";
import {
  getVersionItems,
  getVersionsByBudgetId,
  saveItemsToVersion,
  saveItemsAsNewVersion,
  type ReconstructedItem,
  type BudgetItemInput,
} from "@/server/actions/versions";

interface BudgetItemsPanelProps {
  versionId: number;
  versionName: string;
  budgetId: number;
  onBack: () => void;
  onVersionCreated: (versionId: number, versionName: string) => void;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 2 }).format(n);
}

export function BudgetItemsPanel({
  versionId,
  versionName,
  budgetId,
  onBack,
  onVersionCreated,
}: BudgetItemsPanelProps) {
  const [originalItems, setOriginalItems] = useState<ReconstructedItem[]>([]);
  const [workingItems, setWorkingItems] = useState<ReconstructedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ReconstructedItem>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [isLeaf, setIsLeaf] = useState(true);
  const [showNewVersionDialog, setShowNewVersionDialog] = useState(false);
  const [newVersionName, setNewVersionName] = useState("");

  const [addForm, setAddForm] = useState({
    itemNumber: "",
    name: "",
    quantity: "1",
    unit: "",
    materialUnitPrice: "0",
    feeUnitPrice: "0",
    notes: "",
  });

  const loadItems = useCallback(async () => {
    setLoading(true);
    const [items, versionsList] = await Promise.all([
      getVersionItems(versionId),
      getVersionsByBudgetId(budgetId),
    ]);
    const currentVersion = versionsList.find((v) => v.id === versionId);
    setIsLeaf(currentVersion ? !currentVersion.hasChildren : true);
    setOriginalItems(items);
    setWorkingItems(items);
    setLoading(false);
  }, [versionId, budgetId]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const isDirty = useMemo(() => {
    if (originalItems.length !== workingItems.length) return true;
    return (
      JSON.stringify(
        originalItems.map(({ id, versionId: _vId, ...rest }) => rest)
      ) !==
      JSON.stringify(
        workingItems.map(({ id, versionId: _vId, ...rest }) => rest)
      )
    );
  }, [originalItems, workingItems]);

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return workingItems;
    const q = searchQuery.toLowerCase();
    return workingItems.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.itemNumber.toLowerCase().includes(q)
    );
  }, [workingItems, searchQuery]);

  const materialTotal = useMemo(
    () =>
      workingItems.reduce(
        (sum, i) => sum + i.quantity * i.materialUnitPrice,
        0
      ),
    [workingItems]
  );

  const feeTotal = useMemo(
    () =>
      workingItems.reduce((sum, i) => sum + i.quantity * i.feeUnitPrice, 0),
    [workingItems]
  );

  const toInputItems = (): BudgetItemInput[] =>
    workingItems.map((i, idx) => ({
      itemCode: i.itemCode,
      sequenceNo: idx + 1,
      itemNumber: i.itemNumber,
      name: i.name,
      quantity: i.quantity,
      unit: i.unit,
      materialUnitPrice: i.materialUnitPrice,
      feeUnitPrice: i.feeUnitPrice,
      notes: i.notes,
    }));

  const handleDiscard = () => {
    setWorkingItems([...originalItems]);
    setEditingCode(null);
  };

  const handleSaveToCurrent = async () => {
    setSaving(true);
    const result = await saveItemsToVersion(versionId, toInputItems());
    setSaving(false);
    if (result.success) {
      await loadItems();
    } else {
      alert(result.error);
    }
  };

  const handleSaveAsNew = async () => {
    if (!newVersionName.trim()) return;
    setSaving(true);
    const result = await saveItemsAsNewVersion(
      versionId,
      newVersionName.trim(),
      toInputItems()
    );
    setSaving(false);
    if (result.success && result.data) {
      setShowNewVersionDialog(false);
      setNewVersionName("");
      onVersionCreated(result.data.id, result.data.versionName);
    } else {
      alert(result.error);
    }
  };

  const startEdit = (item: ReconstructedItem) => {
    setEditingCode(item.itemCode);
    setEditForm({ ...item });
  };

  const cancelEdit = () => {
    setEditingCode(null);
    setEditForm({});
  };

  const saveEdit = () => {
    if (!editingCode || !editForm.name) return;
    setWorkingItems((prev) =>
      prev.map((item) =>
        item.itemCode === editingCode
          ? {
              ...item,
              itemNumber: editForm.itemNumber ?? item.itemNumber,
              name: editForm.name ?? item.name,
              quantity: Number(editForm.quantity) || item.quantity,
              unit: editForm.unit ?? item.unit,
              materialUnitPrice: Number(editForm.materialUnitPrice) || 0,
              feeUnitPrice: Number(editForm.feeUnitPrice) || 0,
              notes: editForm.notes ?? item.notes,
            }
          : item
      )
    );
    setEditingCode(null);
    setEditForm({});
  };

  const deleteItem = (itemCode: string) => {
    if (!confirm("Biztosan törölni szeretné ezt a tételt?")) return;
    setWorkingItems((prev) => prev.filter((i) => i.itemCode !== itemCode));
  };

  const addItem = () => {
    if (!addForm.name.trim()) return;
    const maxSeq = workingItems.reduce(
      (max, i) => Math.max(max, i.sequenceNo),
      0
    );
    const newItem: ReconstructedItem = {
      id: 0,
      versionId,
      itemCode: crypto.randomUUID(),
      sequenceNo: maxSeq + 1,
      itemNumber: addForm.itemNumber,
      name: addForm.name,
      quantity: Number(addForm.quantity) || 1,
      unit: addForm.unit,
      materialUnitPrice: Number(addForm.materialUnitPrice) || 0,
      feeUnitPrice: Number(addForm.feeUnitPrice) || 0,
      notes: addForm.notes,
    };
    setWorkingItems((prev) => [...prev, newItem]);
    setAddForm({
      itemNumber: "",
      name: "",
      quantity: "1",
      unit: "",
      materialUnitPrice: "0",
      feeUnitPrice: "0",
      notes: "",
    });
    setShowAddForm(false);
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
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-[10px] bg-white border-b border-[var(--slate-200)] shrink-0">
        <button
          onClick={onBack}
          className="p-1 text-[var(--slate-500)] hover:text-[var(--slate-800)] cursor-pointer"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="text-sm font-semibold text-[var(--slate-800)]">
          {versionName}
        </span>
        {!isLeaf && (
          <span className="text-[10px] px-1.5 py-[1px] rounded bg-[var(--amber-100)] text-[var(--amber-900)]">
            csak olvasható
          </span>
        )}
        <div className="flex-1" />
        <div className="relative">
          <Search
            className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--slate-400)]"
            size={12}
          />
          <input
            type="text"
            placeholder="Keresés…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 bg-[var(--slate-50)] border border-[var(--slate-200)] rounded-[6px] pl-7 pr-3 text-xs text-[var(--slate-700)] outline-none focus:border-[var(--indigo-600)] transition-colors w-[200px]"
          />
        </div>
        {isLeaf && (
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1.5 px-3 py-[5px] rounded-[6px] text-xs bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] cursor-pointer transition-colors"
          >
            <Plus size={12} />
            Új tétel
          </button>
        )}
      </div>

      {/* Unsaved changes banner */}
      {isDirty && (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border-b border-blue-200 shrink-0">
          <span className="text-xs text-blue-700 font-medium">
            Mentetlen módosítások
          </span>
          <div className="flex-1" />
          <button
            onClick={handleDiscard}
            className="flex items-center gap-1 px-3 py-[4px] rounded-[6px] text-xs border border-[var(--slate-200)] text-[var(--slate-600)] hover:bg-[var(--slate-50)] cursor-pointer transition-colors"
          >
            <Undo2 size={11} />
            Elvetés
          </button>
          {isLeaf && (
            <button
              onClick={handleSaveToCurrent}
              disabled={saving}
              className="flex items-center gap-1 px-3 py-[4px] rounded-[6px] text-xs bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] disabled:opacity-50 cursor-pointer transition-colors"
            >
              <Save size={11} />
              {saving ? "Mentés…" : "Mentés jelenlegi verzióba"}
            </button>
          )}
          <button
            onClick={() => setShowNewVersionDialog(true)}
            className="flex items-center gap-1 px-3 py-[4px] rounded-[6px] text-xs border border-[var(--indigo-600)] text-[var(--indigo-600)] hover:bg-[var(--indigo-50)] cursor-pointer transition-colors"
          >
            <GitBranch size={11} />
            Mentés új verzióként
          </button>
        </div>
      )}

      {/* New version dialog */}
      {showNewVersionDialog && (
        <div className="flex items-center gap-2 px-4 py-2 bg-[var(--indigo-50)] border-b border-[var(--indigo-200)] shrink-0">
          <span className="text-xs text-[var(--slate-600)]">
            Új verzió neve:
          </span>
          <input
            autoFocus
            value={newVersionName}
            onChange={(e) => setNewVersionName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSaveAsNew()}
            placeholder="pl. v2.0"
            className="h-7 px-2 border border-[var(--slate-200)] rounded-[6px] text-xs outline-none focus:border-[var(--indigo-600)] w-40"
          />
          <button
            onClick={handleSaveAsNew}
            disabled={saving}
            className="flex items-center gap-1 px-3 py-[5px] rounded-[6px] text-xs bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] disabled:opacity-50 cursor-pointer transition-colors"
          >
            <Check size={12} />
            {saving ? "Mentés…" : "Létrehozás"}
          </button>
          <button
            onClick={() => {
              setShowNewVersionDialog(false);
              setNewVersionName("");
            }}
            className="p-1 text-[var(--slate-400)] hover:text-[var(--slate-700)] cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Add item form */}
      {showAddForm && isLeaf && (
        <div className="px-4 py-3 bg-green-50 border-b border-green-200 shrink-0">
          <div className="text-xs font-semibold text-[var(--slate-700)] mb-2">
            Új tétel hozzáadása
          </div>
          <div className="grid grid-cols-[80px_1fr_80px_60px_100px_100px_auto] gap-2 items-end">
            <div>
              <label className="text-[10px] text-[var(--slate-500)]">
                Tételszám
              </label>
              <input
                value={addForm.itemNumber}
                onChange={(e) =>
                  setAddForm((p) => ({ ...p, itemNumber: e.target.value }))
                }
                className="h-7 w-full px-2 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]"
              />
            </div>
            <div>
              <label className="text-[10px] text-[var(--slate-500)]">
                Megnevezés *
              </label>
              <input
                value={addForm.name}
                onChange={(e) =>
                  setAddForm((p) => ({ ...p, name: e.target.value }))
                }
                className="h-7 w-full px-2 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]"
              />
            </div>
            <div>
              <label className="text-[10px] text-[var(--slate-500)]">
                Mennyiség
              </label>
              <input
                type="number"
                step="any"
                value={addForm.quantity}
                onChange={(e) =>
                  setAddForm((p) => ({ ...p, quantity: e.target.value }))
                }
                className="h-7 w-full px-2 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]"
              />
            </div>
            <div>
              <label className="text-[10px] text-[var(--slate-500)]">
                Egység
              </label>
              <input
                value={addForm.unit}
                onChange={(e) =>
                  setAddForm((p) => ({ ...p, unit: e.target.value }))
                }
                className="h-7 w-full px-2 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]"
              />
            </div>
            <div>
              <label className="text-[10px] text-[var(--slate-500)]">
                Anyag egysár
              </label>
              <input
                type="number"
                step="any"
                value={addForm.materialUnitPrice}
                onChange={(e) =>
                  setAddForm((p) => ({
                    ...p,
                    materialUnitPrice: e.target.value,
                  }))
                }
                className="h-7 w-full px-2 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]"
              />
            </div>
            <div>
              <label className="text-[10px] text-[var(--slate-500)]">
                Díj egysár
              </label>
              <input
                type="number"
                step="any"
                value={addForm.feeUnitPrice}
                onChange={(e) =>
                  setAddForm((p) => ({ ...p, feeUnitPrice: e.target.value }))
                }
                className="h-7 w-full px-2 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]"
              />
            </div>
            <div className="flex items-end gap-1">
              <button
                onClick={addItem}
                className="h-7 px-3 rounded text-xs bg-green-600 text-white hover:bg-green-700 cursor-pointer transition-colors"
              >
                Hozzáadás
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                className="h-7 px-2 rounded text-xs text-[var(--slate-500)] hover:bg-[var(--slate-100)] cursor-pointer transition-colors"
              >
                Mégse
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Items table */}
      <div className="flex-1 overflow-y-auto">
        {workingItems.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-[var(--slate-400)]">
            Nincsenek tételek ebben a verzióban
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-[var(--slate-400)]">
            Nincs találat: &ldquo;{searchQuery}&rdquo;
          </div>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-[var(--slate-50)] z-[1]">
              <tr>
                {[
                  "#",
                  "Tételszám",
                  "Megnevezés",
                  "Menny.",
                  "Egys.",
                  "Anyag egysár",
                  "Díj egysár",
                  "Anyag össz.",
                  "Díj össz.",
                  "Megjegyzés",
                  "",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item, idx) => {
                const isEditing = editingCode === item.itemCode;
                const matTotal = item.quantity * item.materialUnitPrice;
                const feeTotal = item.quantity * item.feeUnitPrice;

                if (isEditing) {
                  const editMatTotal =
                    (Number(editForm.quantity) || 0) *
                    (Number(editForm.materialUnitPrice) || 0);
                  const editFeeTotal =
                    (Number(editForm.quantity) || 0) *
                    (Number(editForm.feeUnitPrice) || 0);
                  return (
                    <tr key={item.itemCode} className="bg-blue-50">
                      <td className="px-3 py-2 border-b border-[var(--slate-100)] text-[var(--slate-400)]">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-1 border-b border-[var(--slate-100)]">
                        <input
                          value={editForm.itemNumber ?? ""}
                          onChange={(e) =>
                            setEditForm((p) => ({
                              ...p,
                              itemNumber: e.target.value,
                            }))
                          }
                          className="h-6 w-full px-1 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]"
                        />
                      </td>
                      <td className="px-3 py-1 border-b border-[var(--slate-100)]">
                        <input
                          value={editForm.name ?? ""}
                          onChange={(e) =>
                            setEditForm((p) => ({
                              ...p,
                              name: e.target.value,
                            }))
                          }
                          className="h-6 w-full px-1 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]"
                        />
                      </td>
                      <td className="px-3 py-1 border-b border-[var(--slate-100)]">
                        <input
                          type="number"
                          step="any"
                          value={editForm.quantity ?? 0}
                          onChange={(e) =>
                            setEditForm((p) => ({
                              ...p,
                              quantity: Number(e.target.value),
                            }))
                          }
                          className="h-6 w-16 px-1 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]"
                        />
                      </td>
                      <td className="px-3 py-1 border-b border-[var(--slate-100)]">
                        <input
                          value={editForm.unit ?? ""}
                          onChange={(e) =>
                            setEditForm((p) => ({
                              ...p,
                              unit: e.target.value,
                            }))
                          }
                          className="h-6 w-14 px-1 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]"
                        />
                      </td>
                      <td className="px-3 py-1 border-b border-[var(--slate-100)]">
                        <input
                          type="number"
                          step="any"
                          value={editForm.materialUnitPrice ?? 0}
                          onChange={(e) =>
                            setEditForm((p) => ({
                              ...p,
                              materialUnitPrice: Number(e.target.value),
                            }))
                          }
                          className="h-6 w-20 px-1 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]"
                        />
                      </td>
                      <td className="px-3 py-1 border-b border-[var(--slate-100)]">
                        <input
                          type="number"
                          step="any"
                          value={editForm.feeUnitPrice ?? 0}
                          onChange={(e) =>
                            setEditForm((p) => ({
                              ...p,
                              feeUnitPrice: Number(e.target.value),
                            }))
                          }
                          className="h-6 w-20 px-1 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]"
                        />
                      </td>
                      <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right text-[var(--slate-400)]">
                        {fmt(editMatTotal)}
                      </td>
                      <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right text-[var(--slate-400)]">
                        {fmt(editFeeTotal)}
                      </td>
                      <td className="px-3 py-1 border-b border-[var(--slate-100)]">
                        <input
                          value={editForm.notes ?? ""}
                          onChange={(e) =>
                            setEditForm((p) => ({
                              ...p,
                              notes: e.target.value,
                            }))
                          }
                          className="h-6 w-full px-1 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]"
                        />
                      </td>
                      <td className="px-3 py-2 border-b border-[var(--slate-100)]">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={saveEdit}
                            className="p-0.5 text-green-600 hover:text-green-800 cursor-pointer"
                          >
                            <Check size={13} />
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="p-0.5 text-[var(--slate-400)] hover:text-[var(--slate-700)] cursor-pointer"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr
                    key={item.itemCode}
                    className="hover:[&_td]:bg-[#fafbff]"
                  >
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] text-[var(--slate-400)]">
                      {idx + 1}
                    </td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] font-mono text-[11px]">
                      {item.itemNumber || "—"}
                    </td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)]">
                      {item.name}
                    </td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right">
                      {fmt(item.quantity)}
                    </td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)]">
                      {item.unit}
                    </td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right">
                      {fmt(item.materialUnitPrice)}
                    </td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right">
                      {fmt(item.feeUnitPrice)}
                    </td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right font-medium">
                      {fmt(matTotal)}
                    </td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right font-medium">
                      {fmt(feeTotal)}
                    </td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] text-[var(--slate-500)] max-w-[120px] truncate">
                      {item.notes}
                    </td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)]">
                      {isLeaf && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => startEdit(item)}
                            className="p-0.5 text-[var(--slate-400)] hover:text-[var(--indigo-600)] cursor-pointer"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={() => deleteItem(item.itemCode)}
                            className="p-0.5 text-[var(--slate-400)] hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center px-4 py-[10px] bg-white border-t border-[var(--slate-200)] shrink-0">
        <span className="text-xs text-[var(--slate-400)]">
          {workingItems.length} tétel
          {filteredItems.length !== workingItems.length &&
            ` (${filteredItems.length} megjelenítve)`}
        </span>
        <div className="flex-1" />
        <span className="text-xs text-[var(--slate-600)] mr-4">
          Anyag összesen: <strong>{fmt(materialTotal)}</strong>
        </span>
        <span className="text-xs text-[var(--slate-600)]">
          Díj összesen: <strong>{fmt(feeTotal)}</strong>
        </span>
      </div>
    </div>
  );
}
