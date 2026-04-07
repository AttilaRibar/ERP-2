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
  ChevronRight,
  ChevronDown,
  FolderOpen,
  Folder,
  FolderPlus,
  FileText,
  FileSignature,
  GitFork,
  Layers,
  Eye,
  EyeOff,
  MessageSquare,
} from "lucide-react";
import {
  getVersionItems,
  getVersionSections,
  getVersionsByBudgetId,
  saveItemsToVersion,
  saveItemsAsNewVersion,
  type ReconstructedItem,
  type ReconstructedSection,
  type BudgetItemInput,
  type SectionInput,
  type VersionType,
} from "@/server/actions/versions";

interface BudgetItemsPanelProps {
  versionId: number;
  versionName: string;
  versionType: VersionType;
  partnerName: string | null;
  budgetId: number;
  onBack: () => void;
  onVersionCreated: (versionId: number, versionName: string, versionType: VersionType, partnerName: string | null) => void;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 2 }).format(n);
}

type DisplayRow =
  | { type: "section"; section: ReconstructedSection; depth: number }
  | { type: "item"; item: ReconstructedItem; displayIndex: number; isAlternative: boolean; altLabel: string };

/**
 * Build display rows: sections → original items only (no alternatives).
 * Alternatives are inserted separately in displayRows based on visibility state.
 */
function buildSectionTree(
  sections: ReconstructedSection[],
  items: ReconstructedItem[],
  collapsed: Set<string>,
  parentCode: string | null = null,
  depth = 0,
): DisplayRow[] {
  const rows: DisplayRow[] = [];
  const childSections = sections
    .filter((s) => s.parentSectionCode === parentCode)
    .sort((a, b) => a.sequenceNo - b.sequenceNo);

  for (const sec of childSections) {
    rows.push({ type: "section", section: sec, depth });
    if (!collapsed.has(sec.sectionCode)) {
      rows.push(...buildSectionTree(sections, items, collapsed, sec.sectionCode, depth + 1));
      const sectionItems = items
        .filter((i) => i.sectionCode === sec.sectionCode && !i.alternativeOfItemCode)
        .sort((a, b) => a.sequenceNo - b.sequenceNo);
      for (const item of sectionItems) {
        rows.push({ type: "item", item, displayIndex: 0, isAlternative: false, altLabel: "" });
      }
    }
  }
  return rows;
}

/** Build alternatives lookup map: originalItemCode → sorted alternatives[] */
function buildAltsMap(items: ReconstructedItem[]): Map<string, ReconstructedItem[]> {
  const map = new Map<string, ReconstructedItem[]>();
  for (const item of items) {
    if (item.alternativeOfItemCode) {
      const list = map.get(item.alternativeOfItemCode) ?? [];
      list.push(item);
      map.set(item.alternativeOfItemCode, list);
    }
  }
  // Sort each group
  for (const [, list] of map) {
    list.sort((a, b) => a.sequenceNo - b.sequenceNo);
  }
  return map;
}

/** Tooltip component for alternatives hover preview */
function AltTooltip({ alts, originalName }: { alts: ReconstructedItem[]; originalName: string }) {
  return (
    <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-purple-200 rounded-lg shadow-lg p-3 min-w-[340px] max-w-[500px]">
      <div className="text-[10px] font-semibold text-purple-700 uppercase tracking-wide mb-2 flex items-center gap-1">
        <Layers size={10} />
        Alternatívák — {originalName}
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[9px] text-[var(--slate-400)] uppercase">
            <th className="text-left pb-1 pr-2">#</th>
            <th className="text-left pb-1 pr-2">Megnevezés</th>
            <th className="text-right pb-1 pr-2">Anyag e.ár</th>
            <th className="text-right pb-1 pr-2">Díj e.ár</th>
            <th className="text-right pb-1">Össz.</th>
          </tr>
        </thead>
        <tbody>
          {alts.map((alt, i) => (
            <tr key={alt.itemCode} className="border-t border-purple-100">
              <td className="py-1 pr-2 text-purple-500 font-medium">{String.fromCharCode(97 + i)}</td>
              <td className="py-1 pr-2 text-[var(--slate-700)] max-w-[200px] truncate">{alt.name}</td>
              <td className="py-1 pr-2 text-right text-[var(--slate-600)]">{fmt(alt.materialUnitPrice)}</td>
              <td className="py-1 pr-2 text-right text-[var(--slate-600)]">{fmt(alt.feeUnitPrice)}</td>
              <td className="py-1 text-right font-medium text-[var(--slate-700)]">{fmt(alt.quantity * (alt.materialUnitPrice + alt.feeUnitPrice))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function countSectionItems(
  sections: ReconstructedSection[],
  items: ReconstructedItem[],
  sectionCode: string
): number {
  const direct = items.filter((i) => i.sectionCode === sectionCode).length;
  const children = sections.filter((s) => s.parentSectionCode === sectionCode);
  return direct + children.reduce((s, c) => s + countSectionItems(sections, items, c.sectionCode), 0);
}

function sectionMaterialTotal(
  sections: ReconstructedSection[],
  items: ReconstructedItem[],
  sectionCode: string
): number {
  const direct = items
    .filter((i) => i.sectionCode === sectionCode)
    .reduce((s, i) => s + i.quantity * i.materialUnitPrice, 0);
  const children = sections.filter((s) => s.parentSectionCode === sectionCode);
  return direct + children.reduce((s, c) => s + sectionMaterialTotal(sections, items, c.sectionCode), 0);
}

function sectionFeeTotal(
  sections: ReconstructedSection[],
  items: ReconstructedItem[],
  sectionCode: string
): number {
  const direct = items
    .filter((i) => i.sectionCode === sectionCode)
    .reduce((s, i) => s + i.quantity * i.feeUnitPrice, 0);
  const children = sections.filter((s) => s.parentSectionCode === sectionCode);
  return direct + children.reduce((s, c) => s + sectionFeeTotal(sections, items, c.sectionCode), 0);
}

export function BudgetItemsPanel({
  versionId,
  versionName,
  versionType,
  partnerName,
  budgetId,
  onBack,
  onVersionCreated,
}: BudgetItemsPanelProps) {
  const [originalItems, setOriginalItems] = useState<ReconstructedItem[]>([]);
  const [workingItems, setWorkingItems] = useState<ReconstructedItem[]>([]);
  const [originalSections, setOriginalSections] = useState<ReconstructedSection[]>([]);
  const [workingSections, setWorkingSections] = useState<ReconstructedSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ReconstructedItem>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [isLeaf, setIsLeaf] = useState(true);
  const [showNewVersionDialog, setShowNewVersionDialog] = useState(false);
  const [newVersionName, setNewVersionName] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [editingSectionCode, setEditingSectionCode] = useState<string | null>(null);
  const [editSectionName, setEditSectionName] = useState("");
  const [addSectionParent, setAddSectionParent] = useState<string | null | "root">(null);
  const [newSectionName, setNewSectionName] = useState("");
  const [showAllAlts, setShowAllAlts] = useState(false);
  const [expandedAlts, setExpandedAlts] = useState<Set<string>>(new Set());
  const [hoveredAltBadge, setHoveredAltBadge] = useState<string | null>(null);
  const [versionNotes, setVersionNotes] = useState<string | null>(null);

  const [addForm, setAddForm] = useState({
    itemNumber: "",
    name: "",
    quantity: "1",
    unit: "",
    materialUnitPrice: "0",
    feeUnitPrice: "0",
    notes: "",
    sectionCode: null as string | null,
  });

  const loadItems = useCallback(async () => {
    setLoading(true);
    const [items, sections, versionsList] = await Promise.all([
      getVersionItems(versionId),
      getVersionSections(versionId),
      getVersionsByBudgetId(budgetId),
    ]);
    const currentVersion = versionsList.find((v) => v.id === versionId);
    setIsLeaf(currentVersion ? !currentVersion.hasChildren : true);
    setVersionNotes(currentVersion?.notes ?? null);
    setOriginalItems(items);
    setWorkingItems(items);
    setOriginalSections(sections);
    setWorkingSections(sections);
    // Collapse all sections by default
    setCollapsedSections(new Set(sections.map((s) => s.sectionCode)));
    setLoading(false);
  }, [versionId, budgetId]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const isDirty = useMemo(() => {
    if (originalItems.length !== workingItems.length) return true;
    if (originalSections.length !== workingSections.length) return true;
    const itemsMatch =
      JSON.stringify(originalItems.map(({ id, versionId: _v, ...r }) => r)) ===
      JSON.stringify(workingItems.map(({ id, versionId: _v, ...r }) => r));
    const sectionsMatch =
      JSON.stringify(originalSections.map(({ id, versionId: _v, ...r }) => r)) ===
      JSON.stringify(workingSections.map(({ id, versionId: _v, ...r }) => r));
    return !itemsMatch || !sectionsMatch;
  }, [originalItems, workingItems, originalSections, workingSections]);

  const altsMap = useMemo(() => buildAltsMap(workingItems), [workingItems]);

  const totalAltCount = useMemo(
    () => workingItems.filter((i) => i.alternativeOfItemCode).length,
    [workingItems]
  );

  const toggleItemAlts = useCallback((itemCode: string) => {
    setExpandedAlts((prev) => {
      const next = new Set(prev);
      if (next.has(itemCode)) next.delete(itemCode);
      else next.add(itemCode);
      return next;
    });
  }, []);

  const displayRows = useMemo((): DisplayRow[] => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const filtered = workingItems.filter(
        (item) =>
          !item.alternativeOfItemCode &&
          (item.name.toLowerCase().includes(q) ||
           item.itemNumber.toLowerCase().includes(q))
      );
      const result: DisplayRow[] = [];
      let idx = 0;
      for (const item of filtered) {
        idx++;
        result.push({ type: "item" as const, item, displayIndex: idx, isAlternative: false, altLabel: "" });
        // Show alternatives if expanded
        const isExpanded = showAllAlts || expandedAlts.has(item.itemCode);
        if (isExpanded) {
          const alts = altsMap.get(item.itemCode);
          if (alts) {
            alts.forEach((alt, ai) => {
              result.push({ type: "item" as const, item: alt, displayIndex: idx, isAlternative: true, altLabel: String.fromCharCode(97 + ai) });
            });
          }
        }
      }
      return result;
    }

    const rows = buildSectionTree(workingSections, workingItems, collapsedSections);

    // Uncategorized items (no section, not an alternative)
    const uncategorized = workingItems.filter((i) => !i.sectionCode && !i.alternativeOfItemCode);
    for (const item of uncategorized) {
      rows.push({ type: "item", item, displayIndex: 0, isAlternative: false, altLabel: "" });
    }

    // Assign displayIndex to originals, then insert alternatives
    let idx = 0;
    for (const row of rows) {
      if (row.type === "item") {
        row.displayIndex = ++idx;
      }
    }

    // Insert alternatives after their originals
    const withAlts: DisplayRow[] = [];
    for (const row of rows) {
      withAlts.push(row);
      if (row.type === "item" && !row.isAlternative) {
        const isExpanded = showAllAlts || expandedAlts.has(row.item.itemCode);
        if (isExpanded) {
          const alts = altsMap.get(row.item.itemCode);
          if (alts) {
            alts.forEach((alt, ai) => {
              withAlts.push({ type: "item", item: alt, displayIndex: row.displayIndex, isAlternative: true, altLabel: String.fromCharCode(97 + ai) });
            });
          }
        }
      }
    }

    return withAlts;
  }, [workingItems, workingSections, collapsedSections, searchQuery, showAllAlts, expandedAlts, altsMap]);

  const materialTotal = useMemo(
    () => workingItems.reduce((sum, i) => sum + i.quantity * i.materialUnitPrice, 0),
    [workingItems]
  );
  const feeTotal = useMemo(
    () => workingItems.reduce((sum, i) => sum + i.quantity * i.feeUnitPrice, 0),
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
      sectionCode: i.sectionCode,
      alternativeOfItemCode: i.alternativeOfItemCode,
    }));

  const toInputSections = (): SectionInput[] =>
    workingSections.map((s, idx) => ({
      sectionCode: s.sectionCode,
      parentSectionCode: s.parentSectionCode,
      name: s.name,
      sequenceNo: idx + 1,
    }));

  const handleDiscard = () => {
    setWorkingItems([...originalItems]);
    setWorkingSections([...originalSections]);
    setEditingCode(null);
  };

  const handleSaveToCurrent = async () => {
    setSaving(true);
    const result = await saveItemsToVersion(versionId, toInputItems(), toInputSections());
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
      toInputItems(),
      toInputSections()
    );
    setSaving(false);
    if (result.success && result.data) {
      setShowNewVersionDialog(false);
      setNewVersionName("");
      onVersionCreated(result.data.id, result.data.versionName, result.data.versionType, result.data.partnerName);
    } else {
      alert(result.error);
    }
  };

  // ---- Section actions ----

  const toggleSection = (code: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const startAddSection = (parentCode: string | null) => {
    setAddSectionParent(parentCode === null ? "root" : parentCode);
    setNewSectionName("");
  };

  const confirmAddSection = () => {
    if (!newSectionName.trim()) return;
    const maxSeq = workingSections.reduce((m, s) => Math.max(m, s.sequenceNo), 0);
    const parentSectionCode = addSectionParent === "root" ? null : addSectionParent;
    const newSection: ReconstructedSection = {
      id: 0,
      versionId,
      sectionCode: crypto.randomUUID(),
      parentSectionCode,
      name: newSectionName.trim(),
      sequenceNo: maxSeq + 1,
    };
    setWorkingSections((prev) => [...prev, newSection]);
    setAddSectionParent(null);
    setNewSectionName("");
  };

  const startEditSection = (sec: ReconstructedSection) => {
    setEditingSectionCode(sec.sectionCode);
    setEditSectionName(sec.name);
  };

  const confirmEditSection = () => {
    if (!editingSectionCode || !editSectionName.trim()) return;
    setWorkingSections((prev) =>
      prev.map((s) =>
        s.sectionCode === editingSectionCode ? { ...s, name: editSectionName.trim() } : s
      )
    );
    setEditingSectionCode(null);
    setEditSectionName("");
  };

  const deleteSection = (sectionCode: string) => {
    // Collect all descendant section codes recursively
    const collectDescendants = (code: string): string[] => {
      const children = workingSections.filter((s) => s.parentSectionCode === code);
      return children.flatMap((c) => [c.sectionCode, ...collectDescendants(c.sectionCode)]);
    };
    const allCodes = new Set([sectionCode, ...collectDescendants(sectionCode)]);

    const childSectionCount = allCodes.size - 1;
    const itemCount = workingItems.filter((i) => i.sectionCode && allCodes.has(i.sectionCode)).length;

    if (childSectionCount === 0 && itemCount === 0) {
      // Empty section — delete without extra warning
      setWorkingSections((prev) => prev.filter((s) => s.sectionCode !== sectionCode));
      return;
    }

    const parts: string[] = [];
    if (childSectionCount > 0) parts.push(`${childSectionCount} alfejezet`);
    if (itemCount > 0) parts.push(`${itemCount} tétel`);
    const msg = `A fejezet tartalmaz: ${parts.join(" és ")}.\nBiztosan törölni szeretné a fejezetet az összes tartalmával együtt?`;
    if (!confirm(msg)) return;

    setWorkingSections((prev) => prev.filter((s) => !allCodes.has(s.sectionCode)));
    setWorkingItems((prev) => prev.filter((i) => !i.sectionCode || !allCodes.has(i.sectionCode)));
  };

  // ---- Item actions ----

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
    const newSectionCode = editForm.sectionCode ?? null;
    setWorkingItems((prev) => {
      const editedItem = prev.find((i) => i.itemCode === editingCode);
      const sectionChanged = editedItem && !editedItem.alternativeOfItemCode && editedItem.sectionCode !== newSectionCode;
      return prev.map((item) => {
        if (item.itemCode === editingCode) {
          return {
            ...item,
            itemNumber: editForm.itemNumber ?? item.itemNumber,
            name: editForm.name ?? item.name,
            quantity: Number(editForm.quantity) || item.quantity,
            unit: editForm.unit ?? item.unit,
            materialUnitPrice: Number(editForm.materialUnitPrice) || 0,
            feeUnitPrice: Number(editForm.feeUnitPrice) || 0,
            notes: editForm.notes ?? item.notes,
            sectionCode: item.alternativeOfItemCode ? item.sectionCode : newSectionCode,
          };
        }
        // Move alternatives along when their parent's section changes
        if (sectionChanged && item.alternativeOfItemCode === editingCode) {
          return { ...item, sectionCode: newSectionCode };
        }
        return item;
      });
    });
    setEditingCode(null);
    setEditForm({});
  };

  const deleteItem = (itemCode: string) => {
    const alts = workingItems.filter((i) => i.alternativeOfItemCode === itemCode);
    const altWarning = alts.length > 0 ? ` Ez a tétel ${alts.length} alternatívával rendelkezik, amelyek szintén törlődnek.` : "";
    if (!confirm(`Biztosan törölni szeretné ezt a tételt?${altWarning}`)) return;
    // Remove the item and all alternatives that reference it
    setWorkingItems((prev) =>
      prev.filter((i) => i.itemCode !== itemCode && i.alternativeOfItemCode !== itemCode)
    );
  };

  const addItem = () => {
    if (!addForm.name.trim()) return;
    const maxSeq = workingItems.reduce((max, i) => Math.max(max, i.sequenceNo), 0);
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
      sectionCode: addForm.sectionCode,
      alternativeOfItemCode: null,
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
      sectionCode: addForm.sectionCode, // retain last section
    });
    setShowAddForm(false);
  };

  const createAlternative = (originalItem: ReconstructedItem) => {
    const maxSeq = workingItems.reduce((max, i) => Math.max(max, i.sequenceNo), 0);
    const altItem: ReconstructedItem = {
      id: 0,
      versionId,
      itemCode: crypto.randomUUID(),
      sequenceNo: maxSeq + 1,
      itemNumber: originalItem.itemNumber,
      name: originalItem.name,
      quantity: originalItem.quantity,
      unit: originalItem.unit,
      materialUnitPrice: originalItem.materialUnitPrice,
      feeUnitPrice: originalItem.feeUnitPrice,
      notes: "",
      sectionCode: originalItem.sectionCode,
      alternativeOfItemCode: originalItem.itemCode,
    };
    setWorkingItems((prev) => [...prev, altItem]);
    // Expand this item's alternatives so the edit form is visible
    setExpandedAlts((prev) => new Set(prev).add(originalItem.itemCode));
    startEdit(altItem);
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
        <span className="text-sm font-semibold text-[var(--slate-800)]">{versionName}</span>
        {versionType === "offer" ? (
          <span className="flex items-center gap-0.5 px-1.5 py-[1px] text-[10px] font-medium rounded bg-[var(--blue-100)] text-[var(--blue-700)]">
            <FileText size={10} />
            Ajánlati
          </span>
        ) : (
          <span className="flex items-center gap-0.5 px-1.5 py-[1px] text-[10px] font-medium rounded bg-[var(--amber-100)] text-[var(--amber-800)]">
            <FileSignature size={10} />
            Szerződött
          </span>
        )}
        {partnerName && (
          <span className="px-1.5 py-[1px] text-[10px] font-medium rounded bg-[var(--slate-100)] text-[var(--slate-600)]">
            {partnerName}
          </span>
        )}
        {versionNotes && (
          <span className="group/note relative">
            <MessageSquare size={12} className="text-[var(--amber-500)]" />
            <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 hidden group-hover/note:block z-50 w-max max-w-[260px] px-2.5 py-1.5 rounded-md bg-[var(--slate-800)] text-[10px] text-white shadow-lg whitespace-pre-wrap pointer-events-none">
              {versionNotes}
            </span>
          </span>
        )}
        {!isLeaf && (
          <span className="text-[10px] px-1.5 py-[1px] rounded bg-[var(--amber-100)] text-[var(--amber-900)]" title="Ennek a verziónak vannak gyerekverzióit — módosítások csak új verzióba menthetők">
            szülő verzió
          </span>
        )}
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--slate-400)]" size={12} />
          <input
            type="text"
            placeholder="Keresés…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 bg-[var(--slate-50)] border border-[var(--slate-200)] rounded-[6px] pl-7 pr-3 text-xs text-[var(--slate-700)] outline-none focus:border-[var(--indigo-600)] transition-colors w-[200px]"
          />
        </div>
        {totalAltCount > 0 && (
          <button
            onClick={() => { setShowAllAlts((v) => !v); if (showAllAlts) setExpandedAlts(new Set()); }}
            className={`flex items-center gap-1.5 px-3 py-[5px] rounded-[6px] text-xs border cursor-pointer transition-colors ${
              showAllAlts
                ? "border-purple-400 bg-purple-50 text-purple-700"
                : "border-purple-300 text-purple-500 hover:bg-purple-50"
            }`}
            title={showAllAlts ? "Alternatívák elrejtése" : "Összes alternatíva megjelenítése"}
          >
            {showAllAlts ? <EyeOff size={12} /> : <Eye size={12} />}
            {totalAltCount} alt.
          </button>
        )}
        <>
          <button
            onClick={() => startAddSection(null)}
            className="flex items-center gap-1.5 px-3 py-[5px] rounded-[6px] text-xs border border-[var(--amber-400)] text-[var(--amber-700)] hover:bg-amber-50 cursor-pointer transition-colors"
          >
            <FolderPlus size={12} />
            Új fejezet
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1.5 px-3 py-[5px] rounded-[6px] text-xs bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] cursor-pointer transition-colors"
          >
            <Plus size={12} />
            Új tétel
          </button>
        </>
      </div>

      {/* Unsaved changes banner */}
      {isDirty && (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border-b border-blue-200 shrink-0">
          <span className="text-xs text-blue-700 font-medium">Mentetlen módosítások</span>
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
          <span className="text-xs text-[var(--slate-600)]">Új verzió neve:</span>
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
            onClick={() => { setShowNewVersionDialog(false); setNewVersionName(""); }}
            className="p-1 text-[var(--slate-400)] hover:text-[var(--slate-700)] cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Add section inline bar */}
      {addSectionParent !== null && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 shrink-0">
          <FolderPlus size={13} className="text-amber-600" />
          <span className="text-xs text-[var(--slate-600)]">
            {addSectionParent === "root" ? "Új főfejezet:" : "Új alfejezet:"}
          </span>
          <input
            autoFocus
            value={newSectionName}
            onChange={(e) => setNewSectionName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") confirmAddSection(); if (e.key === "Escape") setAddSectionParent(null); }}
            placeholder="Fejezet neve…"
            className="h-7 px-2 border border-[var(--slate-200)] rounded-[6px] text-xs outline-none focus:border-[var(--amber-500)] w-48"
          />
          <button onClick={confirmAddSection} className="flex items-center gap-1 px-3 py-[5px] rounded-[6px] text-xs bg-amber-500 text-white hover:bg-amber-600 cursor-pointer transition-colors">
            <Check size={12} />
            Hozzáadás
          </button>
          <button onClick={() => setAddSectionParent(null)} className="p-1 text-[var(--slate-400)] hover:text-[var(--slate-700)] cursor-pointer">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Add item form */}
      {showAddForm && (
        <div className="px-4 py-3 bg-green-50 border-b border-green-200 shrink-0">
          <div className="text-xs font-semibold text-[var(--slate-700)] mb-2">Új tétel hozzáadása</div>
          <div className="grid grid-cols-[80px_1fr_80px_60px_100px_100px_140px_auto] gap-2 items-end">
            <div>
              <label className="text-[10px] text-[var(--slate-500)]">Tételszám</label>
              <input value={addForm.itemNumber} onChange={(e) => setAddForm((p) => ({ ...p, itemNumber: e.target.value }))} className="h-7 w-full px-2 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]" />
            </div>
            <div>
              <label className="text-[10px] text-[var(--slate-500)]">Megnevezés *</label>
              <input value={addForm.name} onChange={(e) => setAddForm((p) => ({ ...p, name: e.target.value }))} className="h-7 w-full px-2 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]" />
            </div>
            <div>
              <label className="text-[10px] text-[var(--slate-500)]">Menny.</label>
              <input type="number" step="any" value={addForm.quantity} onChange={(e) => setAddForm((p) => ({ ...p, quantity: e.target.value }))} className="h-7 w-full px-2 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]" />
            </div>
            <div>
              <label className="text-[10px] text-[var(--slate-500)]">Egység</label>
              <input value={addForm.unit} onChange={(e) => setAddForm((p) => ({ ...p, unit: e.target.value }))} className="h-7 w-full px-2 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]" />
            </div>
            <div>
              <label className="text-[10px] text-[var(--slate-500)]">Anyag egységár</label>
              <input type="number" step="any" value={addForm.materialUnitPrice} onChange={(e) => setAddForm((p) => ({ ...p, materialUnitPrice: e.target.value }))} className="h-7 w-full px-2 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]" />
            </div>
            <div>
              <label className="text-[10px] text-[var(--slate-500)]">Díj egységár</label>
              <input type="number" step="any" value={addForm.feeUnitPrice} onChange={(e) => setAddForm((p) => ({ ...p, feeUnitPrice: e.target.value }))} className="h-7 w-full px-2 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]" />
            </div>
            <div>
              <label className="text-[10px] text-[var(--slate-500)]">Fejezet</label>
              <select
                value={addForm.sectionCode ?? ""}
                onChange={(e) => setAddForm((p) => ({ ...p, sectionCode: e.target.value || null }))}
                className="h-7 w-full px-2 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)] bg-white"
              >
                <option value="">— Nincs fejezet —</option>
                {workingSections.map((s) => (
                  <option key={s.sectionCode} value={s.sectionCode}>
                    {s.parentSectionCode ? "  · " : ""}{s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-1">
              <button onClick={addItem} className="h-7 px-3 rounded text-xs bg-green-600 text-white hover:bg-green-700 cursor-pointer transition-colors">Hozzáadás</button>
              <button onClick={() => setShowAddForm(false)} className="h-7 px-2 rounded text-xs text-[var(--slate-500)] hover:bg-[var(--slate-100)] cursor-pointer transition-colors">Mégse</button>
            </div>
          </div>
        </div>
      )}

      {/* Items table */}
      <div className="flex-1 overflow-y-auto">
        {workingItems.length === 0 && workingSections.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-[var(--slate-400)]">
            Nincsenek tételek ebben a verzióban
          </div>
        ) : displayRows.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-[var(--slate-400)]">
            Nincs találat: &ldquo;{searchQuery}&rdquo;
          </div>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-[var(--slate-50)] z-[1]">
              <tr>
                {["#", "Tételszám", "Megnevezés", "Menny.", "Egys.", "Anyag egyságár", "Díj egyságár", "Anyag össz.", "Díj össz.", "Megjegyzés", ""].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.5px] border-b border-[var(--slate-200)] whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, rowIdx) => {
                if (row.type === "section") {
                  const sec = row.section;
                  const isCollapsed = collapsedSections.has(sec.sectionCode);
                  const isEditing = editingSectionCode === sec.sectionCode;
                  const matT = sectionMaterialTotal(workingSections, workingItems, sec.sectionCode);
                  const feeT = sectionFeeTotal(workingSections, workingItems, sec.sectionCode);
                  const cnt = countSectionItems(workingSections, workingItems, sec.sectionCode);
                  const indent = row.depth * 16;

                  return (
                    <tr key={`sec-${sec.sectionCode}`} className="bg-amber-50 hover:bg-amber-100">
                      <td className="px-3 py-1.5 border-b border-amber-200" colSpan={isEditing ? 1 : 3}>
                        <div className="flex items-center gap-1" style={{ paddingLeft: indent }}>
                          <button
                            onClick={() => toggleSection(sec.sectionCode)}
                            className="text-amber-600 hover:text-amber-800 cursor-pointer"
                          >
                            {isCollapsed
                              ? <ChevronRight size={13} />
                              : <ChevronDown size={13} />}
                          </button>
                          {isCollapsed
                            ? <Folder size={13} className="text-amber-500" />
                            : <FolderOpen size={13} className="text-amber-500" />}
                          {isEditing ? (
                            <input
                              autoFocus
                              value={editSectionName}
                              onChange={(e) => setEditSectionName(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") confirmEditSection(); if (e.key === "Escape") setEditingSectionCode(null); }}
                              className="h-6 px-1 border border-amber-300 rounded text-xs outline-none focus:border-amber-500 bg-white w-40"
                            />
                          ) : (
                            <span className="text-xs font-semibold text-amber-900">{sec.name}</span>
                          )}
                          <span className="text-[10px] text-amber-600 ml-1">({cnt} tétel)</span>
                        </div>
                      </td>
                      {!isEditing && (
                        <>
                          <td className="px-3 py-1.5 border-b border-amber-200" colSpan={4} />
                          <td className="px-3 py-1.5 border-b border-amber-200 text-right text-xs font-semibold text-amber-800">{fmt(matT)}</td>
                          <td className="px-3 py-1.5 border-b border-amber-200 text-right text-xs font-semibold text-amber-800">{fmt(feeT)}</td>
                          <td className="px-3 py-1.5 border-b border-amber-200" />
                        </>
                      )}
                      <td className="px-3 py-1.5 border-b border-amber-200">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <button onClick={confirmEditSection} className="p-0.5 text-green-600 hover:text-green-800 cursor-pointer"><Check size={13} /></button>
                            <button onClick={() => setEditingSectionCode(null)} className="p-0.5 text-[var(--slate-400)] hover:text-[var(--slate-700)] cursor-pointer"><X size={13} /></button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <button onClick={() => startAddSection(sec.sectionCode)} title="Alfejezet hozzáadása" className="p-0.5 text-amber-500 hover:text-amber-700 cursor-pointer"><FolderPlus size={12} /></button>
                            <button onClick={() => startEditSection(sec)} className="p-0.5 text-[var(--slate-400)] hover:text-[var(--indigo-600)] cursor-pointer"><Pencil size={12} /></button>
                            <button onClick={() => deleteSection(sec.sectionCode)} className="p-0.5 text-[var(--slate-400)] hover:text-red-600 cursor-pointer"><Trash2 size={12} /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                }

                // Item row
                const item = row.item;
                const isEditing = editingCode === item.itemCode;
                const matTotal = item.quantity * item.materialUnitPrice;
                const feeTotal = item.quantity * item.feeUnitPrice;
                const isAlt = row.isAlternative;
                const altCount = isAlt ? 0 : (altsMap.get(item.itemCode)?.length ?? 0);
                const isAltExpanded = showAllAlts || expandedAlts.has(item.itemCode);

                if (isEditing) {
                  const editMatTotal = (Number(editForm.quantity) || 0) * (Number(editForm.materialUnitPrice) || 0);
                  const editFeeTotal = (Number(editForm.quantity) || 0) * (Number(editForm.feeUnitPrice) || 0);
                  return (
                    <tr key={item.itemCode} className={isAlt ? "bg-purple-200/80" : "bg-blue-50"}>
                      <td className="px-3 py-2 border-b border-[var(--slate-100)] text-[var(--slate-400)]">
                        {isAlt ? (
                          <span className="text-purple-400 text-[10px] font-mono pl-3">{row.altLabel}</span>
                        ) : row.displayIndex}
                      </td>
                      <td className="px-3 py-1 border-b border-[var(--slate-100)]">
                        <input value={editForm.itemNumber ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, itemNumber: e.target.value }))} className="h-6 w-full px-1 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]" />
                      </td>
                      <td className="px-3 py-1 border-b border-[var(--slate-100)]">
                        <input value={editForm.name ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} className="h-6 w-full px-1 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]" />
                      </td>
                      <td className="px-3 py-1 border-b border-[var(--slate-100)]">
                        <input type="number" step="any" value={editForm.quantity ?? 0} onChange={(e) => setEditForm((p) => ({ ...p, quantity: Number(e.target.value) }))} className="h-6 w-16 px-1 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]" />
                      </td>
                      <td className="px-3 py-1 border-b border-[var(--slate-100)]">
                        <input value={editForm.unit ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, unit: e.target.value }))} className="h-6 w-14 px-1 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]" />
                      </td>
                      <td className="px-3 py-1 border-b border-[var(--slate-100)]">
                        <input type="number" step="any" value={editForm.materialUnitPrice ?? 0} onChange={(e) => setEditForm((p) => ({ ...p, materialUnitPrice: Number(e.target.value) }))} className="h-6 w-20 px-1 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]" />
                      </td>
                      <td className="px-3 py-1 border-b border-[var(--slate-100)]">
                        <input type="number" step="any" value={editForm.feeUnitPrice ?? 0} onChange={(e) => setEditForm((p) => ({ ...p, feeUnitPrice: Number(e.target.value) }))} className="h-6 w-20 px-1 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]" />
                      </td>
                      <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right text-[var(--slate-400)]">{fmt(editMatTotal)}</td>
                      <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right text-[var(--slate-400)]">{fmt(editFeeTotal)}</td>
                      <td className="px-3 py-1 border-b border-[var(--slate-100)]">
                        <input value={editForm.notes ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, notes: e.target.value }))} className="h-6 w-full px-1 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)]" placeholder="Megjegyzés…" />
                      </td>
                      <td className="px-3 py-1 border-b border-[var(--slate-100)]">
                        <div className="flex items-center gap-1">
                          {!isAlt && (
                            <select
                              value={editForm.sectionCode ?? ""}
                              onChange={(e) => setEditForm((p) => ({ ...p, sectionCode: e.target.value || null }))}
                              className="h-6 px-1 border border-[var(--slate-200)] rounded text-xs outline-none focus:border-[var(--indigo-600)] bg-white"
                            >
                              <option value="">— Nincs fejezet —</option>
                              {workingSections.map((s) => (
                                <option key={s.sectionCode} value={s.sectionCode}>
                                  {s.parentSectionCode ? "  · " : ""}{s.name}
                                </option>
                              ))}
                            </select>
                          )}
                          <button onClick={saveEdit} className="p-0.5 text-green-600 hover:text-green-800 cursor-pointer"><Check size={13} /></button>
                          <button onClick={cancelEdit} className="p-0.5 text-[var(--slate-400)] hover:text-[var(--slate-700)] cursor-pointer"><X size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                // Alternative row — distinct visual with left purple border
                if (isAlt) {
                  return (
                    <tr key={item.itemCode} className="bg-purple-200/80 border-l-3 border-l-purple-500">
                      <td className="px-3 py-1.5 border-b border-purple-100 text-purple-400">
                        <span className="text-[10px] font-mono pl-3">{row.altLabel}</span>
                      </td>
                      <td className="px-3 py-1.5 border-b border-purple-100 font-mono text-[11px] text-purple-600/70">{item.itemNumber || "—"}</td>
                      <td className="px-3 py-1.5 border-b border-purple-100 text-purple-900">
                        <span className="flex items-center gap-1.5">
                          <span className="shrink-0 px-1 py-[1px] text-[9px] font-bold rounded bg-purple-200 text-purple-700 uppercase tracking-wide">ALT</span>
                          {item.name}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 border-b border-purple-100 text-right text-purple-700">{fmt(item.quantity)}</td>
                      <td className="px-3 py-1.5 border-b border-purple-100 text-purple-600">{item.unit}</td>
                      <td className="px-3 py-1.5 border-b border-purple-100 text-right text-purple-700">{fmt(item.materialUnitPrice)}</td>
                      <td className="px-3 py-1.5 border-b border-purple-100 text-right text-purple-700">{fmt(item.feeUnitPrice)}</td>
                      <td className="px-3 py-1.5 border-b border-purple-100 text-right font-medium text-purple-800">{fmt(matTotal)}</td>
                      <td className="px-3 py-1.5 border-b border-purple-100 text-right font-medium text-purple-800">{fmt(feeTotal)}</td>
                      <td className="px-3 py-1.5 border-b border-purple-100 text-purple-500 max-w-[120px] truncate">{item.notes}</td>
                      <td className="px-3 py-1.5 border-b border-purple-100">
                        <div className="flex items-center gap-1">
                          <button onClick={() => startEdit(item)} className="p-0.5 text-purple-400 hover:text-purple-700 cursor-pointer"><Pencil size={12} /></button>
                          <button onClick={() => deleteItem(item.itemCode)} className="p-0.5 text-purple-400 hover:text-red-600 cursor-pointer"><Trash2 size={12} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                // Original item row
                return (
                  <tr key={item.itemCode} className="hover:[&_td]:bg-[#fafbff]">
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] text-[var(--slate-400)]">{row.displayIndex}</td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] font-mono text-[11px]">{item.itemNumber || "—"}</td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)]">
                      <span className="flex items-center gap-1.5">
                        {item.name}
                        {altCount > 0 && (
                          <span className="relative inline-flex">
                            <button
                              onClick={() => toggleItemAlts(item.itemCode)}
                              onMouseEnter={() => setHoveredAltBadge(item.itemCode)}
                              onMouseLeave={() => setHoveredAltBadge(null)}
                              className={`shrink-0 flex items-center gap-0.5 px-1.5 py-[1px] text-[9px] font-medium rounded cursor-pointer transition-colors ${
                                isAltExpanded
                                  ? "bg-purple-200 text-purple-800"
                                  : "bg-purple-100 text-purple-600 hover:bg-purple-200"
                              }`}
                            >
                              <Layers size={9} />
                              {altCount} alt.
                            </button>
                            {hoveredAltBadge === item.itemCode && !isAltExpanded && (
                              <AltTooltip alts={altsMap.get(item.itemCode) ?? []} originalName={item.name} />
                            )}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right">{fmt(item.quantity)}</td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)]">{item.unit}</td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right">{fmt(item.materialUnitPrice)}</td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right">{fmt(item.feeUnitPrice)}</td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right font-medium">{fmt(matTotal)}</td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] text-right font-medium">{fmt(feeTotal)}</td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)] text-[var(--slate-500)] max-w-[120px] truncate">{item.notes}</td>
                    <td className="px-3 py-2 border-b border-[var(--slate-100)]">
                      <div className="flex items-center gap-1">
                        <button onClick={() => createAlternative(item)} title="Alternatíva létrehozása" className="p-0.5 text-purple-400 hover:text-purple-700 cursor-pointer"><GitFork size={12} /></button>
                        <button onClick={() => startEdit(item)} className="p-0.5 text-[var(--slate-400)] hover:text-[var(--indigo-600)] cursor-pointer"><Pencil size={12} /></button>
                        <button onClick={() => deleteItem(item.itemCode)} className="p-0.5 text-[var(--slate-400)] hover:text-red-600 cursor-pointer"><Trash2 size={12} /></button>
                      </div>
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
          {workingItems.filter((i) => !i.alternativeOfItemCode).length} tétel
          {workingItems.some((i) => i.alternativeOfItemCode) && (
            <> · {workingItems.filter((i) => i.alternativeOfItemCode).length} alternatíva</>
          )}
          {" "}· {workingSections.length} fejezet
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
