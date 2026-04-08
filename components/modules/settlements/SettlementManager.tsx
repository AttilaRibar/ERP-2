"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  ClipboardCopy,
  LockOpen,
  Check,
  X,
  Eye,
  ArrowLeft,
  Key,
} from "lucide-react";
import { useTabStore } from "@/stores/tab-store";
import {
  getSettlementContract,
  getContractInvoices,
  openInvoice,
  approveInvoice,
  rejectInvoice,
  changeContractPassword,
  updateContractStatus,
} from "@/server/actions/settlements";
import type {
  SettlementContractRow,
  SettlementInvoiceRow,
} from "@/types/settlements";

const INV_STATUS_LABELS: Record<string, string> = {
  locked: "Zárt",
  open: "Nyitott",
  submitted: "Beküldve",
  approved: "Jóváhagyva",
  rejected: "Visszautasítva",
};
const INV_STATUS_COLORS: Record<string, string> = {
  locked: "bg-gray-100 text-gray-500",
  open: "bg-yellow-100 text-yellow-700",
  submitted: "bg-blue-100 text-blue-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

interface Props {
  contractId: number;
  tabId: string;
}

export function SettlementManager({ contractId, tabId }: Props) {
  const openTab = useTabStore((s) => s.openTab);
  const [contract, setContract] = useState<SettlementContractRow | null>(null);
  const [invoices, setInvoices] = useState<SettlementInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reject dialog
  const [rejectTarget, setRejectTarget] = useState<SettlementInvoiceRow | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  // Password dialog
  const [showPwDialog, setShowPwDialog] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [cRes, invs] = await Promise.all([
      getSettlementContract(contractId),
      getContractInvoices(contractId),
    ]);
    if (cRes.success) {
      setContract(cRes.data);
      setInvoices(invs);
    } else {
      setError(cRes.error);
    }
    setLoading(false);
  }, [contractId]);

  useEffect(() => { void load(); }, [load]);

  const handleCopyLink = async () => {
    if (!contract) return;
    await navigator.clipboard.writeText(
      `${window.location.origin}/settle/${contract.accessToken}`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenInvoice = async (inv: SettlementInvoiceRow) => {
    setActionLoading(inv.id);
    const res = await openInvoice(inv.id);
    setActionLoading(null);
    if (!res.success) setError(res.error);
    await load();
  };

  const handleApproveInvoice = async (inv: SettlementInvoiceRow) => {
    if (!confirm(`Jóváhagyja a(z) "${inv.label}" részszámlát?`)) return;
    setActionLoading(inv.id);
    const res = await approveInvoice(inv.id);
    setActionLoading(null);
    if (!res.success) setError(res.error);
    await load();
  };

  const handleRejectSubmit = async () => {
    if (!rejectTarget || !rejectNote.trim()) return;
    setActionLoading(rejectTarget.id);
    const res = await rejectInvoice(rejectTarget.id, rejectNote.trim());
    setActionLoading(null);
    if (!res.success) setError(res.error);
    setRejectTarget(null);
    setRejectNote("");
    await load();
  };

  const handleReviewInvoice = (inv: SettlementInvoiceRow) => {
    openTab({
      moduleKey: "settlements-review",
      title: `Átnézés: ${inv.label}`,
      color: "#0ea5e9",
      params: { contractId, invoiceId: inv.id },
    });
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 6) {
      setError("A jelszónak legalább 6 karakter hosszúnak kell lennie");
      return;
    }
    setPwSaving(true);
    const res = await changeContractPassword(contractId, newPassword);
    setPwSaving(false);
    if (res.success) {
      setPwSuccess(true);
      setTimeout(() => {
        setShowPwDialog(false);
        setPwSuccess(false);
        setNewPassword("");
      }, 1500);
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

  if (!contract) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-red-500">{error ?? "Nem található"}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <button
              onClick={() =>
                openTab({ moduleKey: "settlements", title: "Elszámolások", color: "#0ea5e9" })
              }
              className="flex items-center gap-1 text-xs text-[var(--slate-500)] hover:text-[var(--slate-700)] mb-2 transition-colors"
            >
              <ArrowLeft size={12} /> Vissza
            </button>
            <h2 className="text-lg font-semibold text-[var(--slate-800)]">
              {contract.label}
            </h2>
            <p className="text-sm text-[var(--slate-500)] mt-0.5">
              {contract.projectName} / {contract.budgetName} / {contract.versionName}
            </p>
            <p className="text-sm text-[var(--slate-500)]">
              Alvállalkozó: <span className="font-medium text-[var(--slate-700)]">{contract.partnerName}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPwDialog(true)}
              className="p-1.5 rounded-[6px] hover:bg-[var(--slate-100)] text-[var(--slate-500)] transition-colors"
              title="Jelszó módosítás"
            >
              <Key size={15} />
            </button>
            <button
              onClick={load}
              disabled={loading}
              className="p-1.5 rounded-[6px] hover:bg-[var(--slate-100)] text-[var(--slate-500)] disabled:opacity-50 transition-colors"
              title="Frissítés"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Link */}
        <div className="bg-[var(--slate-50)] border border-[var(--slate-200)] rounded-lg px-4 py-3 flex items-center gap-3">
          <span className="text-xs text-[var(--slate-500)] shrink-0">Alvállalkozói link:</span>
          <code className="flex-1 text-xs font-mono text-[var(--slate-700)] truncate">
            {typeof window !== "undefined" ? window.location.origin : ""}/settle/{contract.accessToken}
          </code>
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-white border border-[var(--slate-200)] rounded hover:bg-[var(--slate-50)] transition-colors"
          >
            <ClipboardCopy size={12} />
            {copied ? "Másolva!" : "Másolás"}
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline text-xs">
              Bezárás
            </button>
          </div>
        )}

        {/* Invoice Table */}
        <div>
          <h3 className="text-sm font-semibold text-[var(--slate-700)] mb-3">Részszámlák</h3>
          <div className="border border-[var(--slate-200)] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--slate-50)] text-[var(--slate-500)] text-xs">
                  <th className="text-center px-3 py-2.5 font-medium w-12">#</th>
                  <th className="text-left px-3 py-2.5 font-medium">Megnevezés</th>
                  <th className="text-right px-3 py-2.5 font-medium">Max összeg</th>
                  <th className="text-right px-3 py-2.5 font-medium">Igényelt</th>
                  <th className="text-center px-3 py-2.5 font-medium">Állapot</th>
                  <th className="text-center px-3 py-2.5 font-medium">Műveletek</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const claimedTotal =
                    Number(inv.claimedMaterialTotal) + Number(inv.claimedFeeTotal);
                  return (
                    <tr key={inv.id} className="border-t border-[var(--slate-100)]">
                      <td className="text-center px-3 py-2.5 text-[var(--slate-400)] font-medium">
                        {inv.invoiceNumber}.
                      </td>
                      <td className="px-3 py-2.5 text-[var(--slate-700)]">{inv.label}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-[var(--slate-600)]">
                        {Number(inv.maxAmount).toLocaleString("hu")} Ft
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[var(--slate-700)]">
                        {claimedTotal > 0
                          ? `${claimedTotal.toLocaleString("hu")} Ft`
                          : "–"}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${INV_STATUS_COLORS[inv.status] ?? "bg-gray-100"}`}
                        >
                          {INV_STATUS_LABELS[inv.status] ?? inv.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-center gap-1">
                          {inv.status === "locked" && (
                            <button
                              onClick={() => handleOpenInvoice(inv)}
                              disabled={actionLoading === inv.id}
                              className="flex items-center gap-1 px-2 py-1 text-xs bg-yellow-50 border border-yellow-200 text-yellow-700 rounded hover:bg-yellow-100 disabled:opacity-50 transition-colors"
                              title="Megnyitás az alvállalkozónak"
                            >
                              <LockOpen size={12} /> Megnyitás
                            </button>
                          )}
                          {inv.status === "submitted" && (
                            <>
                              <button
                                onClick={() => handleReviewInvoice(inv)}
                                className="p-1 rounded hover:bg-[var(--slate-100)] text-[var(--slate-500)] transition-colors"
                                title="Átnézés"
                              >
                                <Eye size={14} />
                              </button>
                              <button
                                onClick={() => handleApproveInvoice(inv)}
                                disabled={actionLoading === inv.id}
                                className="p-1 rounded hover:bg-green-50 text-green-600 disabled:opacity-50 transition-colors"
                                title="Jóváhagyás"
                              >
                                <Check size={14} />
                              </button>
                              <button
                                onClick={() => {
                                  setRejectTarget(inv);
                                  setRejectNote("");
                                }}
                                className="p-1 rounded hover:bg-red-50 text-red-500 transition-colors"
                                title="Visszautasítás"
                              >
                                <X size={14} />
                              </button>
                            </>
                          )}
                          {(inv.status === "approved" || inv.status === "rejected") && (
                            <button
                              onClick={() => handleReviewInvoice(inv)}
                              className="p-1 rounded hover:bg-[var(--slate-100)] text-[var(--slate-500)] transition-colors"
                              title="Megtekintés"
                            >
                              <Eye size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Reject Dialog */}
      {rejectTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-base font-semibold text-gray-800 mb-1">
              Részszámla visszautasítása
            </h3>
            <p className="text-sm text-gray-500 mb-4">{rejectTarget.label}</p>
            <textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Visszautasítás indoklása… (kötelező)"
              rows={4}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none resize-none focus:border-red-400"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={handleRejectSubmit}
                disabled={!rejectNote.trim() || actionLoading === rejectTarget.id}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                <X size={14} /> Visszautasítás
              </button>
              <button
                onClick={() => setRejectTarget(null)}
                className="px-4 py-2 text-sm border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Mégse
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Password Dialog */}
      {showPwDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-base font-semibold text-gray-800 mb-4">
              Jelszó módosítás
            </h3>
            {pwSuccess ? (
              <p className="text-sm text-green-600">✅ Jelszó sikeresen módosítva!</p>
            ) : (
              <>
                <input
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Új jelszó (min. 6 karakter)"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-[var(--indigo-400)] font-mono"
                />
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={handleChangePassword}
                    disabled={pwSaving}
                    className="px-4 py-2 bg-[var(--indigo-600)] text-white text-sm rounded-lg hover:bg-[var(--indigo-700)] disabled:opacity-50 transition-colors"
                  >
                    {pwSaving ? "Mentés…" : "Mentés"}
                  </button>
                  <button
                    onClick={() => {
                      setShowPwDialog(false);
                      setNewPassword("");
                    }}
                    className="px-4 py-2 text-sm border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Mégse
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
