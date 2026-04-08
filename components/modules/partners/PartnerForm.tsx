"use client";

import { useState, useEffect } from "react";
import { Save, ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { getPartnerById, createPartner, updatePartner, deletePartner } from "@/server/actions/partners";
import { useTabStore } from "@/stores/tab-store";

interface PartnerFormProps {
  partnerId?: number;
  tabId: string;
  readOnly?: boolean;
}

export function PartnerForm({ partnerId, tabId, readOnly }: PartnerFormProps) {
  const [loading, setLoading] = useState(!!partnerId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const closeTab = useTabStore((s) => s.closeTab);
  const openTab = useTabStore((s) => s.openTab);
  const updateTab = useTabStore((s) => s.updateTab);

  const [originalFormData, setOriginalFormData] = useState({ name: "", email: "", phone: "", address: "", taxNumber: "", partnerType: "client" });

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    taxNumber: "",
    partnerType: "client",
  });

  useEffect(() => {
    if (partnerId) {
      getPartnerById(partnerId).then((data) => {
        if (data) {
          const loaded = {
            name: data.name,
            email: data.email ?? "",
            phone: data.phone ?? "",
            address: data.address ?? "",
            taxNumber: data.taxNumber ?? "",
            partnerType: data.partnerType,
          };
          setForm(loaded);
          setOriginalFormData(loaded);
        }
        setLoading(false);
      });
    }
  }, [partnerId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));

    const result = partnerId
      ? await updatePartner(partnerId, fd)
      : await createPartner(fd);

    setSaving(false);
    if (result.success) {
      if (partnerId) {
        setOriginalFormData(form);
        setSuccess(true);
        setTimeout(() => {
          setSuccess(false);
          updateTab(tabId, { tabType: "view", title: form.name || `Partner #${partnerId}` });
        }, 1500);
      } else {
        setSuccess(true);
        setTimeout(() => {
          closeTab(tabId);
          openTab({ moduleKey: "partners", title: "Partnerek", color: "#8b5cf6" });
        }, 800);
      }
    } else {
      setError(result.error ?? "Hiba történt");
    }
  };

  const goBack = () => {
    closeTab(tabId);
    openTab({ moduleKey: "partners", title: "Partnerek", color: "#8b5cf6" });
  };

  const handleEdit = () => {
    updateTab(tabId, { tabType: "edit", title: `Partner szerkesztése #${partnerId}` });
  };

  const handleCancel = () => {
    if (partnerId != null) {
      setForm(originalFormData);
      setError(null);
      setSuccess(false);
      updateTab(tabId, { tabType: "view", title: originalFormData.name || `Partner #${partnerId}` });
    } else {
      goBack();
    }
  };

  const handleDelete = async () => {
    if (!confirm("Biztosan törölni szeretné ezt a partnert?")) return;
    await deletePartner(partnerId!);
    goBack();
  };

  if (loading) {
    return <div className="flex items-center justify-center h-32 text-sm text-[var(--slate-400)]">Betöltés…</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={goBack}
            className="p-1.5 rounded-[6px] hover:bg-[var(--slate-100)] text-[var(--slate-500)] cursor-pointer transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <h2 className="text-lg font-semibold text-[var(--slate-800)]">
            {readOnly ? "Partner megtekintése" : partnerId ? "Partner szerkesztése" : "Új partner létrehozása"}
          </h2>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-[8px] text-sm text-red-700">{error}</div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-[8px] text-sm text-green-700">
            Sikeresen mentve!
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField label="Név *" name="name" value={form.name} onChange={(v) => setForm((p) => ({ ...p, name: v }))} disabled={readOnly} />
          <FormSelect
            label="Típus *"
            value={form.partnerType}
            onChange={(v) => setForm((p) => ({ ...p, partnerType: v }))}
            options={[
              { value: "client", label: "Megrendelő" },
              { value: "subcontractor", label: "Alvállalkozó" },
              { value: "supplier", label: "Szállító" },
            ]}
            disabled={readOnly}
          />
          <FormField label="E-mail" name="email" type="email" value={form.email} onChange={(v) => setForm((p) => ({ ...p, email: v }))} disabled={readOnly} />
          <FormField label="Telefon" name="phone" value={form.phone} onChange={(v) => setForm((p) => ({ ...p, phone: v }))} disabled={readOnly} />
          <FormField label="Cím" name="address" value={form.address} onChange={(v) => setForm((p) => ({ ...p, address: v }))} disabled={readOnly} />
          <FormField label="Adószám" name="taxNumber" value={form.taxNumber} onChange={(v) => setForm((p) => ({ ...p, taxNumber: v }))} disabled={readOnly} />

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

function FormField({
  label,
  name,
  value,
  type = "text",
  onChange,
  disabled,
}: {
  label: string;
  name: string;
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
        name={name}
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

function FormSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--slate-600)] mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`w-full h-9 px-3 border rounded-[6px] text-sm outline-none transition-colors ${
          disabled
            ? "bg-[var(--slate-50)] border-[var(--slate-100)] text-[var(--slate-600)] cursor-default appearance-none"
            : "bg-white border-[var(--slate-200)] text-[var(--slate-800)] focus:border-[var(--indigo-600)]"
        }`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
