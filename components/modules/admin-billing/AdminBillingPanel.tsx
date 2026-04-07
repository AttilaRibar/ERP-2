"use client";
// reason: interactive state — filter, approve/reject dialogs, pagination

import { useState, useEffect, useCallback } from "react";
import { Check, X, RefreshCw } from "lucide-react";
import {
  listAllBillings,
  approveBilling,
  rejectBilling,
  type BillingWithDetails,
} from "@/server/actions/admin-billing";

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

// ─── Reject dialog ────────────────────────────────────────────────────────────

interface RejectDialogProps {
  billingId: number;
  billingNumber: string | null;
  onClose: () => void;
  onRejected: () => void;
}

function RejectDialog({ billingId, billingNumber, onClose, onRejected }: RejectDialogProps) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReject = async () => {
    if (!notes.trim()) {
      setError("Az elutasítás indoklása kötelező");
      return;
    }
    setSaving(true);
    const result = await rejectBilling(billingId, notes.trim());
    setSaving(false);
    if (result.success) {
      onRejected();
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
        <h3 className="text-base font-semibold text-gray-800 mb-1">Számla elutasítása</h3>
        <p className="text-sm text-gray-500 mb-4">
          {billingNumber ?? `#${billingId}`}
        </p>

        {error && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Elutasítás indoklása…"
          rows={4}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none resize-none focus:border-red-400"
        />

        <div className="flex gap-3 mt-4">
          <button
            onClick={handleReject}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            <X size={14} />
            {saving ? "Mentés…" : "Elutasítás"}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Mégse
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

const FILTER_OPTIONS = [
  { value: "all", label: "Összes" },
  { value: "submitted", label: "Benyújtva" },
  { value: "approved", label: "Jóváhagyva" },
  { value: "rejected", label: "Elutasítva" },
  { value: "draft", label: "Vázlat" },
];

export function AdminBillingPanel() {
  const [billings, setBillings] = useState<BillingWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("submitted");
  const [approving, setApproving] = useState<number | null>(null);
  const [rejectTarget, setRejectTarget] = useState<BillingWithDetails | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await listAllBillings();
    setBillings(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleApprove = async (billing: BillingWithDetails) => {
    if (!confirm(`Jóváhagyja a(z) ${billing.billingNumber ?? `#${billing.id}`} számlát?`)) return;
    setApproving(billing.id);
    await approveBilling(billing.id);
    setApproving(null);
    await load();
  };

  const filtered =
    filter === "all" ? billings : billings.filter((b) => b.status === filter);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-[var(--slate-800)]">
          Alvállalkozói számlák
        </h2>
        <button
          onClick={load}
          disabled={loading}
          className="p-1.5 rounded-[6px] hover:bg-[var(--slate-100)] text-[var(--slate-500)] disabled:opacity-50 transition-colors"
          title="Frissítés"
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={`px-3 py-1.5 rounded-[6px] text-xs font-medium transition-colors ${
              filter === opt.value
                ? "bg-[var(--indigo-600)] text-white"
                : "border border-[var(--slate-200)] text-[var(--slate-600)] hover:bg-[var(--slate-50)]"
            }`}
          >
            {opt.label}
            {opt.value !== "all" && (
              <span className="ml-1 opacity-70">
                ({billings.filter((b) => b.status === opt.value).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-sm text-[var(--slate-400)] py-8 text-center">
          Betöltés…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-[var(--slate-400)] py-8 text-center italic">
          Nincs találat a szűrési feltételeknek megfelelően.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((billing) => (
            <div
              key={billing.id}
              className="bg-white border border-[var(--slate-100)] rounded-[8px] p-4 flex items-start gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-sm font-medium text-[var(--slate-800)]">
                    {billing.billingNumber ?? `#${billing.id}`}
                  </span>
                  <StatusBadge status={billing.status} />
                </div>
                <p className="text-xs text-[var(--slate-500)]">
                  <span className="font-medium">{billing.partnerName}</span>
                  {" · "}
                  {billing.versionName}
                </p>
                {billing.description && (
                  <p className="text-xs text-[var(--slate-400)] mt-0.5 truncate">
                    {billing.description}
                  </p>
                )}
                {(billing.periodStart || billing.periodEnd) && (
                  <p className="text-xs text-[var(--slate-400)] mt-0.5">
                    Időszak: {billing.periodStart ?? "?"} – {billing.periodEnd ?? "?"}
                  </p>
                )}
                {billing.reviewerNotes && (
                  <p className="text-xs text-amber-700 mt-1 italic">
                    Megjegyzés: {billing.reviewerNotes}
                  </p>
                )}
              </div>

              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-[var(--slate-800)]">
                  {Number(billing.amount).toLocaleString("hu-HU")} HUF
                </p>
                {billing.status === "submitted" && (
                  <div className="flex gap-2 mt-2 justify-end">
                    <button
                      onClick={() => handleApprove(billing)}
                      disabled={approving === billing.id}
                      className="flex items-center gap-1 px-3 py-1 bg-green-600 text-white text-xs rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors"
                    >
                      <Check size={12} />
                      {approving === billing.id ? "…" : "Jóváhagyás"}
                    </button>
                    <button
                      onClick={() => setRejectTarget(billing)}
                      className="flex items-center gap-1 px-3 py-1 bg-red-600 text-white text-xs rounded-md hover:bg-red-700 transition-colors"
                    >
                      <X size={12} />
                      Elutasítás
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reject dialog */}
      {rejectTarget && (
        <RejectDialog
          billingId={rejectTarget.id}
          billingNumber={rejectTarget.billingNumber}
          onClose={() => setRejectTarget(null)}
          onRejected={async () => {
            setRejectTarget(null);
            await load();
          }}
        />
      )}
    </div>
  );
}
