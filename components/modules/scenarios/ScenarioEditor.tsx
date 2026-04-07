"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ArrowLeft,
  Plus,
  Trash2,
  GripVertical,
  Save,
  Layers,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from "lucide-react";
import {
  getScenarioById,
  getAvailableVersionsForProject,
  getProjectsList,
  createScenario,
  updateScenario,
  type ScenarioDetail,
  type AvailableVersion,
  type PriceComponent,
} from "@/server/actions/scenarios";
import { useTabStore } from "@/stores/tab-store";

interface ScenarioEditorProps {
  scenarioId?: number;
  tabId: string;
}

interface LayerDraft {
  /** Client-side key for React */
  key: string;
  versionId: number | null;
  layerOrder: number;
  label: string;
  priceComponent: PriceComponent;
  useCheapestAlternative: boolean;
}

let layerKeyCounter = 0;
function nextLayerKey() {
  return `layer-${++layerKeyCounter}`;
}

const VERSION_TYPE_LABELS: Record<string, string> = {
  offer: "Ajánlat",
  contracted: "Szerződött",
  unpriced: "Árazatlan",
};

export function ScenarioEditor({ scenarioId, tabId }: ScenarioEditorProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [layers, setLayers] = useState<LayerDraft[]>([]);
  const [projects, setProjects] = useState<{ id: number; name: string; projectCode: string | null }[]>([]);
  const [versions, setVersions] = useState<AvailableVersion[]>([]);
  const [loading, setLoading] = useState(!!scenarioId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const closeTab = useTabStore((s) => s.closeTab);
  const openTab = useTabStore((s) => s.openTab);
  const updateTab = useTabStore((s) => s.updateTab);

  // Load projects
  useEffect(() => {
    getProjectsList().then(setProjects);
  }, []);

  // Load versions when project changes
  useEffect(() => {
    if (projectId) {
      getAvailableVersionsForProject(projectId).then(setVersions);
    } else {
      setVersions([]);
    }
  }, [projectId]);

  // Load existing scenario
  useEffect(() => {
    if (!scenarioId) return;
    setLoading(true);
    getScenarioById(scenarioId).then((data) => {
      if (data) {
        setName(data.name);
        setDescription(data.description);
        setProjectId(data.projectId);
        setLayers(
          data.layers.map((l) => ({
            key: nextLayerKey(),
            versionId: l.versionId,
            layerOrder: l.layerOrder,
            label: l.label,
            priceComponent: l.priceComponent,
            useCheapestAlternative: l.useCheapestAlternative,
          }))
        );
      }
      setLoading(false);
    });
  }, [scenarioId]);

  const addLayer = () => {
    setLayers((prev) => [
      ...prev,
      {
        key: nextLayerKey(),
        versionId: null,
        layerOrder: prev.length,
        label: "",
        priceComponent: "both",
        useCheapestAlternative: false,
      },
    ]);
  };

  const removeLayer = (index: number) => {
    setLayers((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      return updated.map((l, i) => ({ ...l, layerOrder: i }));
    });
  };

  const updateLayer = (index: number, patch: Partial<LayerDraft>) => {
    setLayers((prev) =>
      prev.map((l, i) => (i === index ? { ...l, ...patch } : l))
    );
  };

  const moveLayer = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setLayers((prev) => {
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      return updated.map((l, i) => ({ ...l, layerOrder: i }));
    });
  };

  const moveLayerUp = (index: number) => {
    if (index === 0) return;
    moveLayer(index, index - 1);
  };

  const moveLayerDown = (index: number) => {
    if (index >= layers.length - 1) return;
    moveLayer(index, index + 1);
  };

  // Drag & drop handlers
  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== toIndex) {
      moveLayer(dragIndex, toIndex);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const canSave =
    name.trim().length > 0 &&
    projectId !== null &&
    layers.length > 0 &&
    layers.every((l) => l.versionId !== null);

  const handleSave = async () => {
    if (!canSave || !projectId) return;
    setError(null);
    setSaving(true);

    const data = {
      name: name.trim(),
      description: description.trim(),
      projectId,
    };
    const layerData = layers.map((l, i) => ({
      versionId: l.versionId!,
      layerOrder: i,
      label: l.label.trim(),
      priceComponent: l.priceComponent,
      useCheapestAlternative: l.useCheapestAlternative,
    }));

    const result = scenarioId
      ? await updateScenario(scenarioId, data, layerData)
      : await createScenario(data, layerData);

    setSaving(false);

    if (!result.success) {
      setError(result.error ?? "Hiba történt a mentés során");
      return;
    }

    // Close editor and open preview
    closeTab(tabId);
    if (result.data) {
      openTab({
        moduleKey: "scenarios-preview",
        title: `${result.data.name} — Előnézet`,
        color: "#ec4899",
        tabType: "view",
        params: { scenarioId: result.data.id },
      });
    } else {
      openTab({
        moduleKey: "scenarios",
        title: "Szcenáriók",
        color: "#ec4899",
      });
    }
  };

  const goBack = () => {
    closeTab(tabId);
    openTab({ moduleKey: "scenarios", title: "Szcenáriók", color: "#ec4899" });
  };

  // Group versions by budget for the dropdown
  const versionsByBudget = versions.reduce<
    Record<string, AvailableVersion[]>
  >((acc, v) => {
    const bName = v.budgetName || `Költségvetés #${v.budgetId}`;
    if (!acc[bName]) acc[bName] = [];
    acc[bName].push(v);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-[var(--slate-400)]">
        Betöltés…
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--slate-200)] shrink-0">
        <button
          onClick={goBack}
          className="flex items-center gap-1.5 text-xs text-[var(--slate-500)] hover:text-[var(--slate-800)] transition-colors cursor-pointer"
        >
          <ArrowLeft size={14} />
          Vissza
        </button>
        <div className="h-4 w-px bg-[var(--slate-200)]" />
        <Layers size={15} className="text-pink-500" />
        <span className="text-sm font-semibold text-[var(--slate-800)]">
          {scenarioId ? "Szcenárió szerkesztése" : "Új szcenárió"}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-6 space-y-6">
          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-[8px] bg-red-50 border border-red-200 text-sm text-red-700">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          {/* Basic info */}
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-1.5">
                Szcenárió neve *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="pl. Vegyes forrás — X villanyszerelő + Lámpás Kft."
                className="h-9 w-full bg-[var(--slate-50)] border border-[var(--slate-200)] rounded-[6px] px-3 text-sm text-[var(--slate-700)] outline-none focus:border-[var(--indigo-600)] transition-colors"
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-1.5">
                Leírás
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Mi a szcenárió célja, milyen kombinációt vizsgálunk…"
                rows={2}
                className="w-full bg-[var(--slate-50)] border border-[var(--slate-200)] rounded-[6px] px-3 py-2 text-sm text-[var(--slate-700)] outline-none focus:border-[var(--indigo-600)] transition-colors resize-none"
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px] mb-1.5">
                Projekt *
              </label>
              <select
                value={projectId ?? ""}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : null;
                  setProjectId(val);
                  // Clear layers when project changes (versions are project-scoped)
                  if (val !== projectId) {
                    setLayers([]);
                  }
                }}
                className="h-9 w-full bg-[var(--slate-50)] border border-[var(--slate-200)] rounded-[6px] px-3 text-sm text-[var(--slate-700)] outline-none focus:border-[var(--indigo-600)] transition-colors"
              >
                <option value="">Válasszon projektet…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.projectCode ? `${p.projectCode} — ` : ""}
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Layers */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-[0.8px]">
                  Rétegek
                </div>
                <div className="text-[11px] text-[var(--slate-400)] mt-0.5">
                  A felsőbb rétegben lévő beárazott tétel felülírja az alatta lévőket
                </div>
              </div>
              <button
                onClick={addLayer}
                disabled={!projectId}
                className="flex items-center gap-1 px-3 py-1.5 rounded-[6px] text-xs bg-pink-50 text-pink-700 hover:bg-pink-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                <Plus size={12} />
                Réteg hozzáadása
              </button>
            </div>

            {!projectId && (
              <div className="text-sm text-[var(--slate-400)] py-6 text-center bg-[var(--slate-50)] rounded-[8px] border border-dashed border-[var(--slate-200)]">
                Először válasszon projektet a verziók betöltéséhez
              </div>
            )}

            {projectId && layers.length === 0 && (
              <div className="text-sm text-[var(--slate-400)] py-6 text-center bg-[var(--slate-50)] rounded-[8px] border border-dashed border-[var(--slate-200)]">
                Adjon hozzá rétegeket a verzió-választóval
              </div>
            )}

            {layers.length > 0 && (
              <div className="space-y-0">
                {/* Priority indicator — top */}
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 h-px bg-gradient-to-r from-pink-300 to-transparent" />
                  <span className="text-[10px] font-semibold text-pink-500 uppercase tracking-wider">
                    ▲ Legmagasabb prioritás
                  </span>
                  <div className="flex-1 h-px bg-gradient-to-l from-pink-300 to-transparent" />
                </div>

                {/* Layers — top layer (highest priority) first */}
                <div className="space-y-2">
                  {[...layers].reverse().map((layer, revIdx) => {
                    const realIndex = layers.length - 1 - revIdx;
                    const isDragging = dragIndex === realIndex;
                    const isDragOver = dragOverIndex === realIndex;

                    return (
                      <div
                        key={layer.key}
                        draggable
                        onDragStart={() => handleDragStart(realIndex)}
                        onDragOver={(e) => handleDragOver(e, realIndex)}
                        onDrop={(e) => handleDrop(e, realIndex)}
                        onDragEnd={handleDragEnd}
                        className={`
                          group flex items-stretch rounded-[8px] border transition-all
                          ${isDragging ? "opacity-40" : ""}
                          ${isDragOver ? "border-pink-400 bg-pink-50/50" : "border-[var(--slate-200)] bg-white hover:border-[var(--slate-300)]"}
                        `}
                      >
                        {/* Drag handle + order */}
                        <div className="flex flex-col items-center justify-center w-10 shrink-0 border-r border-[var(--slate-100)] cursor-grab active:cursor-grabbing">
                          <GripVertical
                            size={14}
                            className="text-[var(--slate-300)] group-hover:text-[var(--slate-500)]"
                          />
                          <span className="text-[9px] font-bold text-[var(--slate-400)] mt-0.5">
                            {realIndex}
                          </span>
                        </div>

                        {/* Layer content */}
                        <div className="flex-1 p-3 space-y-2">
                          {/* Version selector */}
                          <select
                            value={layer.versionId ?? ""}
                            onChange={(e) =>
                              updateLayer(realIndex, {
                                versionId: e.target.value
                                  ? Number(e.target.value)
                                  : null,
                              })
                            }
                            className="h-8 w-full bg-[var(--slate-50)] border border-[var(--slate-200)] rounded-[6px] px-2 text-xs text-[var(--slate-700)] outline-none focus:border-[var(--indigo-600)] transition-colors"
                          >
                            <option value="">Válasszon verziót…</option>
                            {Object.entries(versionsByBudget).map(
                              ([bName, bVersions]) => (
                                <optgroup key={bName} label={bName}>
                                  {bVersions.map((v) => (
                                    <option key={v.id} value={v.id}>
                                      {v.versionName}
                                      {v.partnerName
                                        ? ` (${v.partnerName})`
                                        : ""}
                                      {" — "}
                                      {VERSION_TYPE_LABELS[v.versionType] ??
                                        v.versionType}
                                    </option>
                                  ))}
                                </optgroup>
                              )
                            )}
                          </select>

                          {/* Label */}
                          <input
                            type="text"
                            value={layer.label}
                            onChange={(e) =>
                              updateLayer(realIndex, { label: e.target.value })
                            }
                            placeholder="Réteg címke (opcionális, pl. Lámpás cég ajánlata)"
                            className="h-7 w-full bg-[var(--slate-50)] border border-[var(--slate-200)] rounded-[6px] px-2 text-[11px] text-[var(--slate-600)] outline-none focus:border-[var(--indigo-600)] transition-colors"
                          />

                          {/* Price component toggle + cheapest alternative */}
                          <div className="flex items-center gap-3 flex-wrap pt-0.5">
                            {/* Price component selector */}
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-[var(--slate-400)] font-medium shrink-0">
                                Árazási forrás:
                              </span>
                              <div className="flex rounded-[5px] border border-[var(--slate-200)] overflow-hidden text-[10px]">
                                {(
                                  [
                                    { value: "both", label: "Mindkettő" },
                                    { value: "material", label: "Anyag" },
                                    { value: "fee", label: "Díj" },
                                  ] as { value: PriceComponent; label: string }[]
                                ).map((opt) => (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() =>
                                      updateLayer(realIndex, {
                                        priceComponent: opt.value,
                                      })
                                    }
                                    className={`px-2 py-1 transition-colors cursor-pointer ${
                                      layer.priceComponent === opt.value
                                        ? "bg-pink-500 text-white font-semibold"
                                        : "bg-white text-[var(--slate-500)] hover:bg-[var(--slate-50)]"
                                    }`}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Cheapest alternative checkbox */}
                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={layer.useCheapestAlternative}
                                onChange={(e) =>
                                  updateLayer(realIndex, {
                                    useCheapestAlternative: e.target.checked,
                                  })
                                }
                                className="w-3 h-3 rounded accent-pink-500 cursor-pointer"
                              />
                              <span className="text-[10px] text-[var(--slate-500)]">
                                Legolcsóbb alternatíva
                              </span>
                            </label>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col items-center justify-center gap-1 px-2 border-l border-[var(--slate-100)]">
                          <button
                            onClick={() => moveLayerUp(realIndex)}
                            disabled={realIndex >= layers.length - 1}
                            title="Feljebb (magasabb prioritás)"
                            className="p-1 rounded hover:bg-[var(--slate-100)] text-[var(--slate-400)] hover:text-[var(--slate-700)] disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer transition-colors"
                          >
                            <ChevronUp size={12} />
                          </button>
                          <button
                            onClick={() => moveLayerDown(realIndex)}
                            disabled={realIndex <= 0}
                            title="Lejjebb (alacsonyabb prioritás)"
                            className="p-1 rounded hover:bg-[var(--slate-100)] text-[var(--slate-400)] hover:text-[var(--slate-700)] disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer transition-colors"
                          >
                            <ChevronDown size={12} />
                          </button>
                          <button
                            onClick={() => removeLayer(realIndex)}
                            title="Réteg törlése"
                            className="p-1 rounded hover:bg-red-50 text-[var(--slate-400)] hover:text-red-600 cursor-pointer transition-colors"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Priority indicator — bottom */}
                <div className="flex items-center gap-2 mt-2">
                  <div className="flex-1 h-px bg-gradient-to-r from-[var(--slate-300)] to-transparent" />
                  <span className="text-[10px] font-semibold text-[var(--slate-400)] uppercase tracking-wider">
                    ▼ Legalacsonyabb prioritás (alap)
                  </span>
                  <div className="flex-1 h-px bg-gradient-to-l from-[var(--slate-300)] to-transparent" />
                </div>
              </div>
            )}
          </div>

          {/* Save button */}
          <div className="flex items-center gap-3 pt-4 border-t border-[var(--slate-100)]">
            <button
              onClick={handleSave}
              disabled={!canSave || saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-[6px] text-sm font-medium bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              <Save size={14} />
              {saving
                ? "Mentés…"
                : scenarioId
                ? "Módosítások mentése"
                : "Szcenárió létrehozása"}
            </button>
            <button
              onClick={goBack}
              className="px-4 py-2.5 rounded-[6px] text-sm text-[var(--slate-600)] hover:bg-[var(--slate-100)] cursor-pointer transition-colors"
            >
              Mégse
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
