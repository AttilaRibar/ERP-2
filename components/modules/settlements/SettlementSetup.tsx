"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Save } from "lucide-react";
import { useTabStore } from "@/stores/tab-store";
import {
  createSettlementContract,
  listContractedVersions,
  listSubcontractorPartners,
} from "@/server/actions/settlements";

interface InvoiceRow {
  invoiceNumber: number;
  label: string;
  maxAmount: string;
}

export function SettlementSetup() {
  const openTab = useTabStore((s) => s.openTab);

  const [versionsOpts, setVersionsOpts] = useState<
    Array<{ versionId: number; versionName: string; budgetId: number; budgetName: string; projectName: string }>
  >([]);
  const [partnersOpts, setPartnersOpts] = useState<Array<{ id: number; name: string }>>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [selectedPartner, setSelectedPartner] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");
  const [totalNetAmount, setTotalNetAmount] = useState("");
  const [invoices, setInvoices] = useState<InvoiceRow[]>([
    { invoiceNumber: 1, label: "1. részszámla", maxAmount: "" },
  ]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ contractId: number; accessToken: string } | null>(null);

  useEffect(() => {
    Promise.all([listContractedVersions(), listSubcontractorPartners()]).then(
      ([v, p]) => {
        setVersionsOpts(v);
        setPartnersOpts(p);
        setLoading(false);
      }
    );
  }, []);

  const addInvoice = () => {
    setInvoices((prev) => [
      ...prev,
      {
        invoiceNumber: prev.length + 1,
        label: prev.length + 1 === invoices.length + 1 ? `${prev.length + 1}. részszámla` : "Végszámla",
        maxAmount: "",
      },
    ]);
  };

  const removeInvoice = (idx: number) => {
    setInvoices((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.map((inv, i) => ({ ...inv, invoiceNumber: i + 1 }));
    });
  };

  const updateInvoice = (idx: number, field: keyof InvoiceRow, value: string) => {
    setInvoices((prev) =>
      prev.map((inv, i) => (i === idx ? { ...inv, [field]: value } : inv))
    );
  };

  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let pw = "";
    for (let i = 0; i < 12; i++) {
      pw += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setPassword(pw);
  };

  const handleSave = async () => {
    setError(null);
    if (!selectedVersion || !selectedPartner || !label || !password) {
      setError("Minden kötelező mező kitöltése szükséges");
      return;
    }
    if (invoices.length === 0) {
      setError("Legalább egy részszámlát meg kell adni");
      return;
    }

    const selectedVer = versionsOpts.find((v) => v.versionId === selectedVersion);
    if (!selectedVer) {
      setError("Érvénytelen verzió");
      return;
    }

    setSaving(true);
    const res = await createSettlementContract({
      budgetId: selectedVer.budgetId,
      versionId: selectedVersion,
      partnerId: selectedPartner,
      password,
      totalNetAmount: Number(totalNetAmount) || 0,
      label,
      invoices: invoices.map((inv) => ({
        invoiceNumber: inv.invoiceNumber,
        label: inv.label,
        maxAmount: Number(inv.maxAmount) || 0,
      })),
    });
    setSaving(false);

    if (res.success) {
      setResult(res.data);
    } else {
      setError(res.error);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-[var(--slate-400)]">Betöltés…</p>
      </div>
    );
  }

  if (result) {
    const link = `${typeof window !== "undefined" ? window.location.origin : ""}/settle/${result.accessToken}`;
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-lg mx-auto">
          <div className="bg-green-50 border border-green-200 rounded-xl p-6">
            <h3 className="text-base font-semibold text-green-800 mb-3">
              ✅ Elszámolás létrehozva
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-green-600 font-medium">Alvállalkozói link</label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    readOnly
                    value={link}
                    className="flex-1 px-3 py-2 border border-green-200 rounded-lg text-sm bg-white font-mono text-green-800"
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText(link)}
                    className="px-3 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors"
                  >
                    Másolás
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-green-600 font-medium">Jelszó</label>
                <p className="mt-1 font-mono text-sm bg-white border border-green-200 rounded-lg px-3 py-2 text-green-800">
                  {password}
                </p>
              </div>
              <p className="text-xs text-green-600">
                Ezt a linket és jelszót küldje el az alvállalkozónak. A jelszót később módosíthatja.
              </p>
            </div>
            <button
              onClick={() => {
                openTab({
                  moduleKey: "settlements",
                  title: "Elszámolások",
                  color: "#0ea5e9",
                });
              }}
              className="mt-4 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors"
            >
              Vissza a listához
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <h2 className="text-lg font-semibold text-[var(--slate-800)]">
          Új alvállalkozói elszámolás
        </h2>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Basic info */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--slate-600)] mb-1">
              Megnevezés *
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="pl. Villanyszerelés — XY Kft."
              className="w-full px-3 py-2 border border-[var(--slate-200)] rounded-lg text-sm outline-none focus:border-[var(--indigo-400)]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[var(--slate-600)] mb-1">
                Szerződött verzió *
              </label>
              <select
                value={selectedVersion ?? ""}
                onChange={(e) => setSelectedVersion(Number(e.target.value) || null)}
                className="w-full px-3 py-2 border border-[var(--slate-200)] rounded-lg text-sm outline-none focus:border-[var(--indigo-400)] bg-white"
              >
                <option value="">Válasszon…</option>
                {versionsOpts.map((v) => (
                  <option key={v.versionId} value={v.versionId}>
                    {v.projectName} / {v.budgetName} / {v.versionName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--slate-600)] mb-1">
                Alvállalkozó *
              </label>
              <select
                value={selectedPartner ?? ""}
                onChange={(e) => setSelectedPartner(Number(e.target.value) || null)}
                className="w-full px-3 py-2 border border-[var(--slate-200)] rounded-lg text-sm outline-none focus:border-[var(--indigo-400)] bg-white"
              >
                <option value="">Válasszon…</option>
                {partnersOpts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[var(--slate-600)] mb-1">
                Jelszó *
              </label>
              <div className="flex gap-2">
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="flex-1 px-3 py-2 border border-[var(--slate-200)] rounded-lg text-sm outline-none focus:border-[var(--indigo-400)] font-mono"
                  placeholder="••••••••"
                />
                <button
                  onClick={generatePassword}
                  type="button"
                  className="px-3 py-2 border border-[var(--slate-200)] text-[var(--slate-600)] text-xs rounded-lg hover:bg-[var(--slate-50)] transition-colors whitespace-nowrap"
                >
                  Generálás
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--slate-600)] mb-1">
                Teljes nettó összeg (Ft)
              </label>
              <input
                type="number"
                value={totalNetAmount}
                onChange={(e) => setTotalNetAmount(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 border border-[var(--slate-200)] rounded-lg text-sm outline-none focus:border-[var(--indigo-400)] font-mono"
              />
            </div>
          </div>
        </div>

        {/* Invoices */}
        <div>
          <h3 className="text-sm font-semibold text-[var(--slate-700)] mb-3">
            Részszámlák
          </h3>
          <div className="space-y-2">
            {invoices.map((inv, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 bg-[var(--slate-50)] rounded-lg px-4 py-2.5"
              >
                <span className="text-xs font-medium text-[var(--slate-400)] w-6 text-center">
                  {inv.invoiceNumber}.
                </span>
                <input
                  value={inv.label}
                  onChange={(e) => updateInvoice(idx, "label", e.target.value)}
                  placeholder="Megnevezés"
                  className="flex-1 px-2 py-1.5 border border-[var(--slate-200)] rounded text-sm outline-none focus:border-[var(--indigo-400)] bg-white"
                />
                <input
                  type="number"
                  value={inv.maxAmount}
                  onChange={(e) => updateInvoice(idx, "maxAmount", e.target.value)}
                  placeholder="Max összeg (Ft)"
                  className="w-40 px-2 py-1.5 border border-[var(--slate-200)] rounded text-sm outline-none focus:border-[var(--indigo-400)] bg-white font-mono"
                />
                <button
                  onClick={() => removeInvoice(idx)}
                  disabled={invoices.length <= 1}
                  className="p-1 rounded hover:bg-red-50 text-[var(--slate-400)] hover:text-red-500 disabled:opacity-30 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={addInvoice}
            className="mt-2 flex items-center gap-1 px-3 py-1.5 text-xs text-[var(--indigo-600)] hover:bg-[var(--indigo-50)] rounded transition-colors"
          >
            <Plus size={14} /> Részszámla hozzáadása
          </button>
        </div>

        {/* Save */}
        <div className="flex justify-end pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-[var(--indigo-600)] text-white text-sm font-medium rounded-lg hover:bg-[var(--indigo-700)] disabled:opacity-50 transition-colors"
          >
            <Save size={15} />
            {saving ? "Mentés…" : "Mentés & Link generálása"}
          </button>
        </div>
      </div>
    </div>
  );
}
