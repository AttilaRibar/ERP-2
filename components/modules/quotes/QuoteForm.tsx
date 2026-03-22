"use client";

import { useState, useEffect } from "react";
import { Save, ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { getQuoteById, createQuote, updateQuote, deleteQuote, getProjectsForSelect, getPartnersForSelect } from "@/server/actions/quotes";
import { useTabStore } from "@/stores/tab-store";

interface QuoteFormProps {
  quoteId?: number;
  tabId: string;
  readOnly?: boolean;
}

export function QuoteForm({ quoteId, tabId, readOnly }: QuoteFormProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [projectsList, setProjectsList] = useState<{ id: number; name: string; projectCode: string | null }[]>([]);
  const [partnersList, setPartnersList] = useState<{ id: number; name: string }[]>([]);
  const closeTab = useTabStore((s) => s.closeTab);
  const openTab = useTabStore((s) => s.openTab);
  const updateTab = useTabStore((s) => s.updateTab);

  const [form, setForm] = useState({
    projectId: "",
    subject: "",
    offererId: "",
    price: "0",
    currency: "HUF",
    status: "pending",
    validUntil: "",
    notes: "",
  });

  useEffect(() => {
    const init = async () => {
      const [projs, parts] = await Promise.all([getProjectsForSelect(), getPartnersForSelect()]);
      setProjectsList(projs);
      setPartnersList(parts);

      if (quoteId) {
        const data = await getQuoteById(quoteId);
        if (data) {
          setForm({
            projectId: data.projectId.toString(),
            subject: data.subject,
            offererId: data.offererId?.toString() ?? "",
            price: data.price ?? "0",
            currency: data.currency,
            status: data.status,
            validUntil: data.validUntil ?? "",
            notes: data.notes,
          });
        }
      }
      setLoading(false);
    };
    init();
  }, [quoteId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));

    const result = quoteId ? await updateQuote(quoteId, fd) : await createQuote(fd);

    setSaving(false);
    if (result.success) {
      setSuccess(true);
      setTimeout(() => {
        closeTab(tabId);
        openTab({ moduleKey: "quotes", title: "Ajánlatok", color: "#22c55e" });
      }, 500);
    } else {
      setError(result.error ?? "Hiba történt");
    }
  };

  const goBack = () => {
    closeTab(tabId);
    openTab({ moduleKey: "quotes", title: "Ajánlatok", color: "#22c55e" });
  };

  const handleEdit = () => {
    updateTab(tabId, { tabType: "edit", title: `Ajánlat szerkesztése #${quoteId}` });
  };

  const handleDeleteItem = async () => {
    if (!confirm("Biztosan törölni szeretné ezt az ajánlatot?")) return;
    await deleteQuote(quoteId!);
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
            {readOnly ? "Ajánlat megtekintése" : quoteId ? "Ajánlat szerkesztése" : "Új ajánlat létrehozása"}
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
          <Field label="Tárgy *" value={form.subject} onChange={(v) => setForm((p) => ({ ...p, subject: v }))} disabled={readOnly} />
          <div>
            <label className="block text-xs font-medium text-[var(--slate-600)] mb-1">Ajánlattevő</label>
            <select
              value={form.offererId}
              onChange={(e) => setForm((p) => ({ ...p, offererId: e.target.value }))}
              disabled={readOnly}
              className={`w-full h-9 px-3 border rounded-[6px] text-sm outline-none transition-colors ${
                readOnly
                  ? "bg-[var(--slate-50)] border-[var(--slate-100)] text-[var(--slate-600)] cursor-default appearance-none"
                  : "bg-white border-[var(--slate-200)] text-[var(--slate-800)] focus:border-[var(--indigo-600)]"
              }`}
            >
              <option value="">— Válasszon partnert —</option>
              {partnersList.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Összeg" value={form.price} type="number" onChange={(v) => setForm((p) => ({ ...p, price: v }))} disabled={readOnly} />
            <div>
              <label className="block text-xs font-medium text-[var(--slate-600)] mb-1">Pénznem</label>
              <select
                value={form.currency}
                onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))}
                disabled={readOnly}
                className={`w-full h-9 px-3 border rounded-[6px] text-sm outline-none transition-colors ${
                  readOnly
                    ? "bg-[var(--slate-50)] border-[var(--slate-100)] text-[var(--slate-600)] cursor-default appearance-none"
                    : "bg-white border-[var(--slate-200)] text-[var(--slate-800)] focus:border-[var(--indigo-600)]"
                }`}
              >
                <option value="HUF">HUF</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
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
                <option value="pending">Függőben</option>
                <option value="accepted">Elfogadva</option>
                <option value="rejected">Elutasítva</option>
                <option value="expired">Lejárt</option>
              </select>
            </div>
            <Field label="Érvényesség" value={form.validUntil} type="date" onChange={(v) => setForm((p) => ({ ...p, validUntil: v }))} disabled={readOnly} />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--slate-600)] mb-1">Megjegyzés</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              disabled={readOnly}
              rows={3}
              className={`w-full px-3 py-2 border rounded-[6px] text-sm outline-none transition-colors resize-none ${
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
                  onClick={goBack}
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
