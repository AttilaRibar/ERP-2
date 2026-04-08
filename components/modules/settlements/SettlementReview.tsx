"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { RefreshCw, ArrowLeft } from "lucide-react";
import { useTabStore } from "@/stores/tab-store";
import {
  getSettlementContract,
  getContractInvoices,
  getInvoiceSettlementItems,
} from "@/server/actions/settlements";
import { getVersionItems, getVersionSections } from "@/server/actions/versions";
import type {
  SettlementContractRow,
  SettlementInvoiceRow,
  SettlementItemRow,
} from "@/types/settlements";
import type { ReconstructedItem, ReconstructedSection } from "@/server/actions/versions";

interface Props {
  contractId: number;
  invoiceId: number;
}

export function SettlementReview({ contractId, invoiceId }: Props) {
  const openTab = useTabStore((s) => s.openTab);
  const [contract, setContract] = useState<SettlementContractRow | null>(null);
  const [invoice, setInvoice] = useState<SettlementInvoiceRow | null>(null);
  const [items, setItems] = useState<SettlementItemRow[]>([]);
  const [budgetItems, setBudgetItems] = useState<ReconstructedItem[]>([]);
  const [sections, setSections] = useState<ReconstructedSection[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const cRes = await getSettlementContract(contractId);
    if (!cRes.success) {
      setLoading(false);
      return;
    }
    setContract(cRes.data);

    const [invs, sItems, vItems, vSections] = await Promise.all([
      getContractInvoices(contractId),
      getInvoiceSettlementItems(invoiceId),
      getVersionItems(cRes.data.versionId),
      getVersionSections(cRes.data.versionId),
    ]);

    setInvoice(invs.find((i) => i.id === invoiceId) ?? null);
    setItems(sItems);
    setBudgetItems(vItems.filter((i) => !i.alternativeOfItemCode));
    setSections(vSections);
    setLoading(false);
  }, [contractId, invoiceId]);

  useEffect(() => { void load(); }, [load]);

  const claimMap = useMemo(() => {
    const m = new Map<string, { materialAmount: number; feeAmount: number; note: string }>();
    for (const it of items) {
      m.set(it.itemCode, {
        materialAmount: Number(it.claimedMaterialAmount),
        feeAmount: Number(it.claimedFeeAmount),
        note: it.note,
      });
    }
    return m;
  }, [items]);

  // Group items by section
  const rootSections = useMemo(() => sections.filter((s) => !s.parentSectionCode), [sections]);

  const renderSection = (sec: ReconstructedSection, depth: number = 0) => {
    const sectionItems = budgetItems.filter((i) => i.sectionCode === sec.sectionCode);
    const childSections = sections.filter((s) => s.parentSectionCode === sec.sectionCode);

    return (
      <div key={sec.sectionCode} className={depth > 0 ? "ml-4" : ""}>
        <div className="bg-[var(--slate-50)] px-4 py-2 text-xs font-semibold text-[var(--slate-600)] border-t border-[var(--slate-200)]">
          📂 {sec.name}
        </div>
        {sectionItems.map((bi) => {
          const claim = claimMap.get(bi.itemCode);
          const materialAmount = claim?.materialAmount ?? 0;
          const feeAmount = claim?.feeAmount ?? 0;
          const totalMaterial = bi.quantity * bi.materialUnitPrice;
          const totalFee = bi.quantity * bi.feeUnitPrice;
          const matPct = totalMaterial > 0 ? ((materialAmount / totalMaterial) * 100).toFixed(1) : "0.0";
          const feePct = totalFee > 0 ? ((feeAmount / totalFee) * 100).toFixed(1) : "0.0";

          return (
            <div
              key={bi.itemCode}
              className="grid grid-cols-[60px_1fr_60px_80px_80px_80px_100px_100px] gap-2 px-4 py-1.5 text-xs border-t border-[var(--slate-100)] hover:bg-[var(--slate-50)]/50"
            >
              <span className="text-[var(--slate-400)]">{bi.itemNumber}</span>
              <span className="text-[var(--slate-700)] truncate">{bi.name}</span>
              <span className="text-[var(--slate-500)] text-center">{bi.unit}</span>
              <span className="text-right font-mono text-[var(--slate-600)]">
                {bi.quantity}
              </span>
              <span className="text-right font-mono text-[var(--slate-500)]">
                {matPct}%
              </span>
              <span className="text-right font-mono text-[var(--slate-500)]">
                {feePct}%
              </span>
              <span className="text-right font-mono text-[var(--slate-600)]">
                {materialAmount > 0 ? materialAmount.toLocaleString("hu") : "–"}
              </span>
              <span className="text-right font-mono text-[var(--slate-600)]">
                {feeAmount > 0 ? feeAmount.toLocaleString("hu") : "–"}
              </span>
            </div>
          );
        })}
        {childSections.map((cs) => renderSection(cs, depth + 1))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-[var(--slate-400)]">Betöltés…</p>
      </div>
    );
  }

  if (!contract || !invoice) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-red-500">Nem található</p>
      </div>
    );
  }

  const totalMaterial = items.reduce((sum, si) => {
    return sum + Number(si.claimedMaterialAmount);
  }, 0);
  const totalFee = items.reduce((sum, si) => {
    return sum + Number(si.claimedFeeAmount);
  }, 0);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* Header */}
        <div>
          <button
            onClick={() =>
              openTab({
                moduleKey: "settlements-manage",
                title: `Elszámolás: ${contract.label}`,
                color: "#0ea5e9",
                params: { contractId },
              })
            }
            className="flex items-center gap-1 text-xs text-[var(--slate-500)] hover:text-[var(--slate-700)] mb-2 transition-colors"
          >
            <ArrowLeft size={12} /> Vissza a kezeléshez
          </button>
          <h2 className="text-lg font-semibold text-[var(--slate-800)]">
            {invoice.label} — Átnézés
          </h2>
          <p className="text-sm text-[var(--slate-500)]">
            {contract.partnerName} · {contract.projectName} / {contract.budgetName}
          </p>
          {invoice.submittedNote && (
            <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
              <span className="font-medium">Alvállalkozó megjegyzése:</span> {invoice.submittedNote}
            </div>
          )}
        </div>

        {/* Items grid */}
        <div className="border border-[var(--slate-200)] rounded-xl overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[60px_1fr_60px_80px_80px_80px_100px_100px] gap-2 px-4 py-2.5 bg-[var(--slate-100)] text-[var(--slate-500)] text-xs font-medium">
            <span>Ssz.</span>
            <span>Tétel</span>
            <span className="text-center">Me.</span>
            <span className="text-right">Mennyiség</span>
            <span className="text-right">Anyag %</span>
            <span className="text-right">Díj %</span>
            <span className="text-right">Anyag (Ft)</span>
            <span className="text-right">Díj (Ft)</span>
          </div>
          {/* Sections */}
          {rootSections.map((sec) => renderSection(sec))}
          {/* Unsectioned items */}
          {budgetItems
            .filter((i) => !i.sectionCode)
            .map((bi) => {
              const claim = claimMap.get(bi.itemCode);
              const materialAmount = claim?.materialAmount ?? 0;
              const feeAmount = claim?.feeAmount ?? 0;
              const totalMat = bi.quantity * bi.materialUnitPrice;
              const totalFee_ = bi.quantity * bi.feeUnitPrice;
              const matPct = totalMat > 0 ? ((materialAmount / totalMat) * 100).toFixed(1) : "0.0";
              const feePct = totalFee_ > 0 ? ((feeAmount / totalFee_) * 100).toFixed(1) : "0.0";
              return (
                <div
                  key={bi.itemCode}
                  className="grid grid-cols-[60px_1fr_60px_80px_80px_80px_100px_100px] gap-2 px-4 py-1.5 text-xs border-t border-[var(--slate-100)]"
                >
                  <span className="text-[var(--slate-400)]">{bi.itemNumber}</span>
                  <span className="text-[var(--slate-700)]">{bi.name}</span>
                  <span className="text-[var(--slate-500)] text-center">{bi.unit}</span>
                  <span className="text-right font-mono">{bi.quantity}</span>
                  <span className="text-right font-mono">{matPct}%</span>
                  <span className="text-right font-mono">{feePct}%</span>
                  <span className="text-right font-mono">{materialAmount > 0 ? materialAmount.toLocaleString("hu") : "–"}</span>
                  <span className="text-right font-mono">{feeAmount > 0 ? feeAmount.toLocaleString("hu") : "–"}</span>
                </div>
              );
            })}
        </div>

        {/* Totals */}
        <div className="flex items-center justify-end gap-6 text-sm">
          <div className="text-[var(--slate-500)]">
            Anyag: <span className="font-mono font-medium text-[var(--slate-700)]">{totalMaterial.toLocaleString("hu")} Ft</span>
          </div>
          <div className="text-[var(--slate-500)]">
            Díj: <span className="font-mono font-medium text-[var(--slate-700)]">{totalFee.toLocaleString("hu")} Ft</span>
          </div>
          <div className="text-[var(--slate-700)] font-semibold">
            Összesen: <span className="font-mono">{(totalMaterial + totalFee).toLocaleString("hu")} Ft</span>
          </div>
        </div>
      </div>
    </div>
  );
}
