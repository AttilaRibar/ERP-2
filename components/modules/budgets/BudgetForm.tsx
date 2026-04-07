"use client";

import { useState, useEffect } from "react";
import { Save, ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { getBudgetById, createBudget, updateBudget, deleteBudget } from "@/server/actions/budgets";
import { getProjectsForSelect } from "@/server/actions/quotes";
import { useTabStore } from "@/stores/tab-store";

interface BudgetFormProps {
  budgetId?: number;
  tabId: string;
  readOnly?: boolean;
}

export function BudgetForm({ budgetId, tabId, readOnly }: BudgetFormProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [projectsList, setProjectsList] = useState<{ id: number; name: string; projectCode: string | null }[]>([]);
  const closeTab = useTabStore((s) => s.closeTab);
  const openTab = useTabStore((s) => s.openTab);
  const updateTab = useTabStore((s) => s.updateTab);

  const [originalFormData, setOriginalFormData] = useState({ projectId: "", name: "" });

  const [form, setForm] = useState({
    projectId: "",
    name: "",
  });

  useEffect(() => {
    const init = async () => {
      const projs = await getProjectsForSelect();
      setProjectsList(projs);

      if (budgetId) {
        const data = await getBudgetById(budgetId);
        if (data) {
          const loaded = {
            projectId: data.projectId.toString(),
            name: data.name,
          };
          setForm(loaded);
          setOriginalFormData(loaded);
        }
      }
      setLoading(false);
    };
    init();
  }, [budgetId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));

    const result = budgetId ? await updateBudget(budgetId, fd) : await createBudget(fd);

    setSaving(false);
    if (result.success) {
      if (budgetId) {
        setOriginalFormData(form);
        setSuccess(true);
        setTimeout(() => {
          setSuccess(false);
          updateTab(tabId, { tabType: "view", title: form.name || `Költségvetés #${budgetId}` });
        }, 1500);
      } else {
        setSuccess(true);
        setTimeout(() => {
          closeTab(tabId);
          openTab({ moduleKey: "budgets", title: "Költségvetések", color: "#f59e0b" });
        }, 800);
      }
    } else {
      setError(result.error ?? "Hiba történt");
    }
  };

  const goBack = () => {
    closeTab(tabId);
    openTab({ moduleKey: "budgets", title: "Költségvetések", color: "#f59e0b" });
  };

  const handleEdit = () => {
    updateTab(tabId, { tabType: "edit", title: `Költségvetés szerkesztése #${budgetId}` });
  };

  const handleCancel = () => {
    if (budgetId != null) {
      setForm(originalFormData);
      setError(null);
      setSuccess(false);
      updateTab(tabId, { tabType: "view", title: originalFormData.name || `Költségvetés #${budgetId}` });
    } else {
      goBack();
    }
  };

  const handleDeleteItem = async () => {
    if (!confirm("Biztosan törölni szeretné ezt a költségvetést?")) return;
    await deleteBudget(budgetId!);
    goBack();
  };

  if (loading) {
    return <div className="flex items-center justify-center h-32 text-sm text-[var(--slate-400)]">Betöltés…</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={goBack} className="p-1.5 rounded-[6px] hover:bg-[var(--slate-100)] text-[var(--slate-500)] cursor-pointer transition-colors">
            <ArrowLeft size={16} />
          </button>
          <h2 className="text-lg font-semibold text-[var(--slate-800)]">
            {readOnly ? "Költségvetés megtekintése" : budgetId ? "Költségvetés szerkesztése" : "Új költségvetés létrehozása"}
          </h2>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-[8px] text-sm text-red-700">{error}</div>}
        {success && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-[8px] text-sm text-green-700">Sikeresen mentve!</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--slate-600)] mb-1">Projekt *</label>
            <select
              value={form.projectId}
              onChange={(e) => setForm((p) => ({ ...p, projectId: e.target.value }))}
              disabled={readOnly}
              className={`w-full h-9 px-3 border rounded-[6px] text-sm outline-none transition-colors ${
                readOnly
                  ? "bg-[var(--slate-50)] border-[var(--slate-100)] text-[var(--slate-600)] cursor-default appearance-none"
                  : "bg-white border-[var(--slate-200)] text-[var(--slate-800)] focus:border-[var(--indigo-600)]"
              }`}
            >
              <option value="">— Válasszon projektet —</option>
              {projectsList.map((p) => (
                <option key={p.id} value={p.id}>{p.projectCode} — {p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--slate-600)] mb-1">Költségvetés neve *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              disabled={readOnly}
              className={`w-full h-9 px-3 border rounded-[6px] text-sm outline-none transition-colors ${
                readOnly
                  ? "bg-[var(--slate-50)] border-[var(--slate-100)] text-[var(--slate-600)] cursor-default"
                  : "bg-white border-[var(--slate-200)] text-[var(--slate-800)] focus:border-[var(--indigo-600)]"
              }`}
            />
          </div>

          <div className="flex gap-3 pt-4">
            {readOnly ? (
              <>
                <button
                  type="button"
                  onClick={handleEdit}
                  className="flex items-center gap-[5px] px-4 py-2 rounded-[6px] text-sm bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] cursor-pointer transition-colors"
                >
                  <Pencil size={14} />
                  Szerkesztés
                </button>
                <button
                  type="button"
                  onClick={handleDeleteItem}
                  className="flex items-center gap-[5px] px-4 py-2 rounded-[6px] text-sm border border-red-200 text-red-600 hover:bg-red-50 cursor-pointer transition-colors"
                >
                  <Trash2 size={14} />
                  Törlés
                </button>
                <button
                  type="button"
                  onClick={goBack}
                  className="px-4 py-2 rounded-[6px] text-sm border border-[var(--slate-200)] text-[var(--slate-600)] hover:bg-[var(--slate-50)] cursor-pointer transition-colors"
                >
                  Vissza
                </button>
              </>
            ) : (
              <>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-[5px] px-4 py-2 rounded-[6px] text-sm bg-[var(--indigo-600)] text-white hover:bg-[var(--indigo-700)] disabled:opacity-50 cursor-pointer transition-colors"
                >
                  <Save size={14} />
                  {saving ? "Mentés…" : "Mentés"}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-4 py-2 rounded-[6px] text-sm border border-[var(--slate-200)] text-[var(--slate-600)] hover:bg-[var(--slate-50)] cursor-pointer transition-colors"
                >
                  Mégse
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
