"use client";

import { useState, useEffect } from "react";
import { Save, ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { getProjectById, createProject, updateProject, deleteProject } from "@/server/actions/projects";
import { getClientsForSelect } from "@/server/actions/projects";
import { useTabStore } from "@/stores/tab-store";

interface ProjectFormProps {
  projectId?: number;
  tabId: string;
  readOnly?: boolean;
}

export function ProjectForm({ projectId, tabId, readOnly }: ProjectFormProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [clients, setClients] = useState<{ id: number; name: string }[]>([]);
  const closeTab = useTabStore((s) => s.closeTab);
  const openTab = useTabStore((s) => s.openTab);
  const updateTab = useTabStore((s) => s.updateTab);

  const [originalFormData, setOriginalFormData] = useState({ name: "", startDate: "", endDate: "", clientId: "", warrantyMonths: "12", status: "active" });

  const [form, setForm] = useState({
    name: "",
    startDate: "",
    endDate: "",
    clientId: "",
    warrantyMonths: "12",
    status: "active",
  });

  useEffect(() => {
    const init = async () => {
      const clientList = await getClientsForSelect();
      setClients(clientList);

      if (projectId) {
        const data = await getProjectById(projectId);
        if (data) {
          const loaded = {
            name: data.name,
            startDate: data.startDate ?? "",
            endDate: data.endDate ?? "",
            clientId: data.clientId?.toString() ?? "",
            warrantyMonths: data.warrantyMonths.toString(),
            status: data.status,
          };
          setForm(loaded);
          setOriginalFormData(loaded);
        }
      }
      setLoading(false);
    };
    init();
  }, [projectId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));

    const result = projectId
      ? await updateProject(projectId, fd)
      : await createProject(fd);

    setSaving(false);
    if (result.success) {
      if (projectId) {
        setOriginalFormData(form);
        setSuccess(true);
        setTimeout(() => {
          setSuccess(false);
          updateTab(tabId, { tabType: "view", title: form.name || `Projekt #${projectId}` });
        }, 1500);
      } else {
        setSuccess(true);
        setTimeout(() => {
          closeTab(tabId);
          openTab({ moduleKey: "projects", title: "Projektek", color: "#06b6d4" });
        }, 800);
      }
    } else {
      setError(result.error ?? "Hiba történt");
    }
  };

  const goBack = () => {
    closeTab(tabId);
    openTab({ moduleKey: "projects", title: "Projektek", color: "#06b6d4" });
  };

  const handleEdit = () => {
    updateTab(tabId, { tabType: "edit", title: `Projekt szerkesztése #${projectId}` });
  };

  const handleCancel = () => {
    if (projectId != null) {
      setForm(originalFormData);
      setError(null);
      setSuccess(false);
      updateTab(tabId, { tabType: "view", title: originalFormData.name || `Projekt #${projectId}` });
    } else {
      goBack();
    }
  };

  const handleDelete = async () => {
    if (!confirm("Biztosan törölni szeretné ezt a projektet?")) return;
    await deleteProject(projectId!);
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
            {readOnly ? "Projekt megtekintése" : projectId ? "Projekt szerkesztése" : "Új projekt létrehozása"}
          </h2>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-[8px] text-sm text-red-700">{error}</div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-[8px] text-sm text-green-700">Sikeresen mentve!</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Projekt neve *" value={form.name} onChange={(v) => setForm((p) => ({ ...p, name: v }))} disabled={readOnly} />
          <div>
            <label className="block text-xs font-medium text-[var(--slate-600)] mb-1">Megrendelő</label>
            <select
              value={form.clientId}
              onChange={(e) => setForm((p) => ({ ...p, clientId: e.target.value }))}
              disabled={readOnly}
              className={`w-full h-9 px-3 border rounded-[6px] text-sm outline-none transition-colors ${
                readOnly
                  ? "bg-[var(--slate-50)] border-[var(--slate-100)] text-[var(--slate-600)] cursor-default appearance-none"
                  : "bg-white border-[var(--slate-200)] text-[var(--slate-800)] focus:border-[var(--indigo-600)]"
              }`}
            >
              <option value="">— Válasszon —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Kezdés dátuma" value={form.startDate} type="date" onChange={(v) => setForm((p) => ({ ...p, startDate: v }))} disabled={readOnly} />
            <Field label="Befejezés dátuma" value={form.endDate} type="date" onChange={(v) => setForm((p) => ({ ...p, endDate: v }))} disabled={readOnly} />
          </div>
          <Field label="Garancia (hónap)" value={form.warrantyMonths} type="number" onChange={(v) => setForm((p) => ({ ...p, warrantyMonths: v }))} disabled={readOnly} />
          <div>
            <label className="block text-xs font-medium text-[var(--slate-600)] mb-1">Státusz *</label>
            <select
              value={form.status}
              onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
              disabled={readOnly}
              className={`w-full h-9 px-3 border rounded-[6px] text-sm outline-none transition-colors ${
                readOnly
                  ? "bg-[var(--slate-50)] border-[var(--slate-100)] text-[var(--slate-600)] cursor-default appearance-none"
                  : "bg-white border-[var(--slate-200)] text-[var(--slate-800)] focus:border-[var(--indigo-600)]"
              }`}
            >
              <option value="active">Aktív</option>
              <option value="completed">Befejezett</option>
              <option value="cancelled">Törölve</option>
              <option value="on_hold">Felfüggesztve</option>
            </select>
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
                  onClick={handleDelete}
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

function Field({
  label,
  value,
  type = "text",
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  type?: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--slate-600)] mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`w-full h-9 px-3 border rounded-[6px] text-sm outline-none transition-colors ${
          disabled
            ? "bg-[var(--slate-50)] border-[var(--slate-100)] text-[var(--slate-600)] cursor-default"
            : "bg-white border-[var(--slate-200)] text-[var(--slate-800)] focus:border-[var(--indigo-600)]"
        }`}
      />
    </div>
  );
}
