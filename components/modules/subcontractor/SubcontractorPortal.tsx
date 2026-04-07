"use client";
// reason: interactive state — billing form, version list, status updates

import { useState, useEffect, useCallback } from "react";
import { FileText, Plus, Send, ChevronDown } from "lucide-react";
import {
  getMyPartner,
  getMyVersions,
  getMyBillings,
  createBilling,
  submitBilling,
} from "@/server/actions/subcontractor";

// ─── Types ───────────────────────────────────────────────────────────────────

type Version = Awaited<ReturnType<typeof getMyVersions>>[number];
type Billing = Awaited<ReturnType<typeof getMyBillings>>[number];
type Partner = Awaited<ReturnType<typeof getMyPartner>>;

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  draft: "Vázlat",
  submitted: "Benyújtva",
  approved: "Jóváhagyva",
  rejected: "Elutasítva",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  submitted: "bg-blue-100 text-blue-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ─── New billing form ─────────────────────────────────────────────────────────

interface NewBillingFormProps {
  token: string;
  versions: Version[];
  onCreated: () => void;
}

function NewBillingForm({ token, versions, onCreated }: NewBillingFormProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    versionId: versions[0]?.id ?? 0,
    amount: "",
    description: "",
    periodStart: "",
    periodEnd: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const result = await createBilling(token, {
      versionId: form.versionId,
      amount: parseFloat(form.amount),
      description: form.description,
      periodStart: form.periodStart || undefined,
      periodEnd: form.periodEnd || undefined,
    });

    setSaving(false);

    if (result.success) {
      setForm({ versionId: versions[0]?.id ?? 0, amount: "", description: "", periodStart: "", periodEnd: "" });
      setOpen(false);
      onCreated();
    } else {
      setError(result.error);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors"
      >
        <Plus size={16} />
        Új számla benyújtása
      </button>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 mt-4">
      <h3 className="text-base font-semibold text-gray-800 mb-4">Új számla</h3>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Version select */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Verzió *
          </label>
          <select
            value={form.versionId}
            onChange={(e) => setForm((p) => ({ ...p, versionId: Number(e.target.value) }))}
            required
            className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white text-gray-800 focus:border-indigo-600 outline-none"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.versionName}
              </option>
            ))}
          </select>
        </div>

        {/* Amount */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Összeg (HUF) *
          </label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={form.amount}
            onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
            required
            placeholder="pl. 150000"
            className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white text-gray-800 focus:border-indigo-600 outline-none"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Leírás *
          </label>
          <textarea
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            required
            rows={3}
            placeholder="Számla tárgyának rövid leírása…"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-800 focus:border-indigo-600 outline-none resize-none"
          />
        </div>

        {/* Period */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Időszak kezdete
            </label>
            <input
              type="date"
              value={form.periodStart}
              onChange={(e) => setForm((p) => ({ ...p, periodStart: e.target.value }))}
              className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white text-gray-800 focus:border-indigo-600 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Időszak vége
            </label>
            <input
              type="date"
              value={form.periodEnd}
              onChange={(e) => setForm((p) => ({ ...p, periodEnd: e.target.value }))}
              className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white text-gray-800 focus:border-indigo-600 outline-none"
            />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "Mentés…" : "Vázlat mentése"}
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); setError(null); }}
            className="px-4 py-2 text-sm border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Mégse
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Billing row ──────────────────────────────────────────────────────────────

interface BillingRowProps {
  billing: Billing;
  token: string;
  onUpdated: () => void;
}

function BillingRow({ billing, token, onUpdated }: BillingRowProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!confirm("Biztosan benyújtja ezt a számlát felülvizsgálatra?")) return;
    setSubmitting(true);
    setError(null);

    const result = await submitBilling(token, billing.id);
    setSubmitting(false);

    if (result.success) {
      onUpdated();
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="flex items-start gap-4 p-4 border border-gray-100 rounded-lg hover:bg-gray-50 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-gray-800">
            {billing.billingNumber ?? `#${billing.id}`}
          </span>
          <StatusBadge status={billing.status} />
        </div>
        <p className="text-sm text-gray-600 truncate">{billing.description}</p>
        {(billing.periodStart || billing.periodEnd) && (
          <p className="text-xs text-gray-400 mt-0.5">
            {billing.periodStart ?? "?"} – {billing.periodEnd ?? "?"}
          </p>
        )}
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
        {billing.reviewerNotes && (
          <p className="text-xs text-amber-700 mt-1 italic">
            Megjegyzés: {billing.reviewerNotes}
          </p>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-gray-800">
          {Number(billing.amount).toLocaleString("hu-HU")} HUF
        </p>
        {billing.status === "draft" && (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="mt-2 flex items-center gap-1 px-3 py-1 bg-indigo-600 text-white text-xs rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            <Send size={12} />
            {submitting ? "…" : "Benyújtás"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main portal ──────────────────────────────────────────────────────────────

interface SubcontractorPortalProps {
  token: string;
}

export function SubcontractorPortal({ token }: SubcontractorPortalProps) {
  const [partner, setPartner] = useState<Partner>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [billings, setBillings] = useState<Billing[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [p, v, b] = await Promise.all([
      getMyPartner(token),
      getMyVersions(token),
      getMyBillings(token),
    ]);
    setPartner(p);
    setVersions(v);
    setBillings(b);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Betöltés…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs text-gray-400 mb-0.5">Alvállalkozói portál</p>
          <h1 className="text-xl font-semibold text-gray-900">
            {partner?.name ?? "Üdvözöljük!"}
          </h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        {/* Contracted versions */}
        <section>
          <h2 className="text-base font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <FileText size={16} className="text-indigo-500" />
            Leszerződött verziók
          </h2>
          {versions.length === 0 ? (
            <p className="text-sm text-gray-400 italic">
              Önhöz jelenleg nem rendelt hozzá leszerződött verzió.
            </p>
          ) : (
            <div className="space-y-2">
              {versions.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between px-4 py-3 bg-white border border-gray-100 rounded-lg"
                >
                  <span className="text-sm font-medium text-gray-800">
                    {v.versionName}
                  </span>
                  <span className="text-xs text-gray-400 capitalize">
                    {v.versionType}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Billings */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-700 flex items-center gap-2">
              <ChevronDown size={16} className="text-indigo-500" />
              Számlák
            </h2>
            {versions.length > 0 && (
              <NewBillingForm
                token={token}
                versions={versions}
                onCreated={load}
              />
            )}
          </div>

          {billings.length === 0 ? (
            <p className="text-sm text-gray-400 italic">
              Még nincs benyújtott számla.
            </p>
          ) : (
            <div className="space-y-2">
              {billings.map((b) => (
                <BillingRow
                  key={b.id}
                  billing={b}
                  token={token}
                  onUpdated={load}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
