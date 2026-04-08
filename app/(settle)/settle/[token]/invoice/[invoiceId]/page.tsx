"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { Save, Send, ArrowLeft, ChevronDown, ChevronRight, Link2, Unlink2 } from "lucide-react";
import {
  getInvoiceEditorData,
  saveSettlementItems,
  submitInvoice,
} from "@/server/actions/settle-portal";
import type {
  InvoiceEditorData,
  SettleBudgetItem,
  SettleSection,
} from "@/types/settlements";

// ---- Helpers ----

interface ItemState {
  materialAmount: number;
  feeAmount: number;
  note: string;
}

function fmt(n: number): string {
  if (n === 0) return "";
  // Up to 4 decimal places, no trailing zeros
  return String(Math.round(n * 10000) / 10000);
}

// ---- Component ----

export default function SettleInvoiceEditorPage() {
  const router = useRouter();
  const params = useParams();
  const token = params.token as string;
  const invoiceId = Number(params.invoiceId);

  const [data, setData] = useState<InvoiceEditorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitNote, setSubmitNote] = useState("");
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [splitMode, setSplitMode] = useState(false);

  // Amounts — source of truth for persistence
  const [itemStates, setItemStates] = useState<Map<string, ItemState>>(new Map());
  // Raw input strings — source of truth for display (avoids controlled number input bugs)
  const [qtyInputs, setQtyInputs] = useState<Map<string, string>>(new Map());
  const [pctInputs, setPctInputs] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    getInvoiceEditorData(invoiceId).then((res) => {
      if (res.success) {
        setData(res.data);
        const states = new Map<string, ItemState>();
        const qtyMap = new Map<string, string>();
        const pctMap = new Map<string, string>();
        let hasSplit = false;
        for (const bi of res.data.budgetItems) {
          const current = res.data.currentItems.find(
            (ci) => ci.itemCode === bi.itemCode
          );
          const matAmt = current ? Number(current.claimedMaterialAmount) : 0;
          const feeAmt = current ? Number(current.claimedFeeAmount) : 0;
          states.set(bi.itemCode, {
            materialAmount: matAmt,
            feeAmount: feeAmt,
            note: current?.note ?? "",
          });
          // Compute display strings from amounts
          const totalUP = bi.materialUnitPrice + bi.feeUnitPrice;
          const qty = totalUP > 0 ? (matAmt + feeAmt) / totalUP : 0;
          const totalItemAmt = bi.quantity * totalUP;
          const pct = totalItemAmt > 0 ? ((matAmt + feeAmt) / totalItemAmt) * 100 : 0;
          qtyMap.set(bi.itemCode, qty > 0 ? fmt(qty) : "");
          pctMap.set(bi.itemCode, pct > 0 ? fmt(pct) : "");
          // Detect split
          if (matAmt > 0 || feeAmt > 0) {
            const mq = bi.materialUnitPrice > 0 ? matAmt / bi.materialUnitPrice : 0;
            const fq = bi.feeUnitPrice > 0 ? feeAmt / bi.feeUnitPrice : 0;
            if (Math.abs(mq - fq) > 0.001) hasSplit = true;
          }
        }
        setItemStates(states);
        setQtyInputs(qtyMap);
        setPctInputs(pctMap);
        if (hasSplit) setSplitMode(true);
      } else {
        setError(res.error);
      }
      setLoading(false);
    });
  }, [invoiceId]);

  // ---- Previous claims map ----
  const prevClaimMap = useMemo(() => {
    if (!data) return new Map<string, { material: number; fee: number }>();
    return new Map(
      data.previousClaims.map((p) => [
        p.itemCode,
        { material: p.totalClaimedMaterial, fee: p.totalClaimedFee },
      ])
    );
  }, [data]);

  // ---- Computed totals ----
  const totals = useMemo(() => {
    let material = 0;
    let fee = 0;
    for (const [, st] of itemStates) {
      material += st.materialAmount;
      fee += st.feeAmount;
    }
    return { material, fee };
  }, [itemStates]);

  const totalNet = totals.material + totals.fee;
  const maxAmount = data?.invoice.maxAmount ?? 0;
  const overBudget = totalNet > maxAmount + 0.01;

  // ---- Handlers: qty and pct inputs stay as raw strings ----
  const updateFromQty = useCallback(
    (itemCode: string, rawQty: string) => {
      if (!data) return;
      const bi = data.budgetItems.find((b) => b.itemCode === itemCode);
      if (!bi) return;
      const qty = Number(rawQty) || 0;
      const matAmt = qty * bi.materialUnitPrice;
      const feeAmt = qty * bi.feeUnitPrice;
      const totalItemAmt = bi.quantity * (bi.materialUnitPrice + bi.feeUnitPrice);
      const pct = totalItemAmt > 0 ? ((matAmt + feeAmt) / totalItemAmt) * 100 : 0;
      setQtyInputs((prev) => new Map(prev).set(itemCode, rawQty));
      setPctInputs((prev) => new Map(prev).set(itemCode, pct > 0 ? fmt(pct) : ""));
      setItemStates((prev) => {
        const next = new Map(prev);
        const cur = next.get(itemCode) ?? { materialAmount: 0, feeAmount: 0, note: "" };
        next.set(itemCode, { ...cur, materialAmount: matAmt, feeAmount: feeAmt });
        return next;
      });
    },
    [data]
  );

  const updateFromPct = useCallback(
    (itemCode: string, rawPct: string) => {
      if (!data) return;
      const bi = data.budgetItems.find((b) => b.itemCode === itemCode);
      if (!bi) return;
      const pct = Number(rawPct) || 0;
      const qty = (bi.quantity * pct) / 100;
      const matAmt = qty * bi.materialUnitPrice;
      const feeAmt = qty * bi.feeUnitPrice;
      setPctInputs((prev) => new Map(prev).set(itemCode, rawPct));
      setQtyInputs((prev) => new Map(prev).set(itemCode, qty > 0 ? fmt(qty) : ""));
      setItemStates((prev) => {
        const next = new Map(prev);
        const cur = next.get(itemCode) ?? { materialAmount: 0, feeAmount: 0, note: "" };
        next.set(itemCode, { ...cur, materialAmount: matAmt, feeAmount: feeAmt });
        return next;
      });
    },
    [data]
  );

  const toggleSection = (code: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  // ---- Save / Submit ----
  const buildPayload = useCallback(() => {
    if (!data) return [];
    return data.budgetItems
      .map((bi) => {
        const st = itemStates.get(bi.itemCode);
        return {
          itemCode: bi.itemCode,
          claimedMaterialAmount: Math.round((st?.materialAmount ?? 0) * 100) / 100,
          claimedFeeAmount: Math.round((st?.feeAmount ?? 0) * 100) / 100,
          note: st?.note ?? "",
        };
      })
      .filter((i) => i.claimedMaterialAmount > 0 || i.claimedFeeAmount > 0 || i.note);
  }, [data, itemStates]);

  const handleSave = async () => {
    if (!data) return;
    setSaving(true);
    setError(null);
    const res = await saveSettlementItems({ invoiceId, items: buildPayload() });
    setSaving(false);
    if (!res.success) setError(res.error);
  };

  const handleSubmit = async () => {
    if (!data) return;
    setSubmitting(true);
    setError(null);
    const saveRes = await saveSettlementItems({ invoiceId, items: buildPayload() });
    if (!saveRes.success) {
      setError(saveRes.error);
      setSubmitting(false);
      return;
    }
    const submitRes = await submitInvoice(invoiceId, submitNote || undefined);
    setSubmitting(false);
    if (submitRes.success) {
      setShowSubmitDialog(false);
      router.push(`/settle/${token}/dashboard`);
    } else {
      setError(submitRes.error);
    }
  };

  // ---- Rendering ----

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <p className="text-sm text-gray-400">Betöltés…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const rootSections = data.sections.filter((s) => !s.parentSectionCode);

  // ---- Render item row ----
  const renderItemRow = (bi: SettleBudgetItem) => {
    const st = itemStates.get(bi.itemCode) ?? { materialAmount: 0, feeAmount: 0, note: "" };
    const prev = prevClaimMap.get(bi.itemCode) ?? { material: 0, fee: 0 };
    const totalMat = bi.quantity * bi.materialUnitPrice;
    const totalFee = bi.quantity * bi.feeUnitPrice;
    const totalItemAmt = totalMat + totalFee;
    const remainMat = totalMat - prev.material;
    const remainFee = totalFee - prev.fee;
    const overMat = st.materialAmount > remainMat + 0.01;
    const overFee = st.feeAmount > remainFee + 0.01;
    const isOver = overMat || overFee;

    // Current partial settlement amount
    const itemAmount = st.materialAmount + st.feeAmount;
    // Cumulative completion %
    const prevTotal = prev.material + prev.fee;
    const cumPct = totalItemAmt > 0 ? ((prevTotal + itemAmount) / totalItemAmt) * 100 : 0;

    const qtyVal = qtyInputs.get(bi.itemCode) ?? "";
    const pctVal = pctInputs.get(bi.itemCode) ?? "";

    return (
      <div
        key={bi.itemCode}
        className={`grid grid-cols-[50px_1fr_40px_55px_70px_70px_90px_55px] gap-1.5 px-3 py-1.5 text-xs border-t border-gray-100 items-center ${
          isOver ? "bg-red-50" : "hover:bg-gray-50/50"
        }`}
      >
        <span className="text-gray-400 truncate" title={bi.itemNumber}>{bi.itemNumber}</span>
        <span className="text-gray-700 truncate" title={bi.name}>{bi.name}</span>
        <span className="text-gray-500 text-center">{bi.unit}</span>
        <span className="text-right font-mono text-gray-600">{bi.quantity}</span>
        {/* % input */}
        <input
          type="text"
          inputMode="decimal"
          value={pctVal}
          onChange={(e) => updateFromPct(bi.itemCode, e.target.value)}
          placeholder="0"
          className={`w-full px-1.5 py-1 border rounded text-xs font-mono text-right outline-none transition-colors ${
            isOver
              ? "border-red-300 bg-red-50 focus:border-red-400"
              : "border-gray-200 focus:border-indigo-400"
          }`}
        />
        {/* qty input */}
        <input
          type="text"
          inputMode="decimal"
          value={qtyVal}
          onChange={(e) => updateFromQty(bi.itemCode, e.target.value)}
          placeholder="0"
          className={`w-full px-1.5 py-1 border rounded text-xs font-mono text-right outline-none transition-colors ${
            isOver
              ? "border-red-300 bg-red-50 focus:border-red-400"
              : "border-gray-200 focus:border-indigo-400"
          }`}
        />
        {/* Partial settlement amount */}
        <span className="text-right font-mono text-gray-700">
          {itemAmount > 0 ? Math.round(itemAmount).toLocaleString("hu") : "–"}
        </span>
        {/* Cumulative completion % */}
        <span
          className={`text-right font-mono text-xs ${cumPct > 100 ? "text-red-600 font-bold" : cumPct > 0 ? "text-indigo-600 font-medium" : "text-gray-400"}`}
        >
          {cumPct > 0 ? `${cumPct.toFixed(1)}%` : "–"}
        </span>
      </div>
    );
  };

  // ---- Render section ----
  const renderSection = (sec: SettleSection, depth: number = 0): React.ReactNode => {
    const isCollapsed = collapsedSections.has(sec.sectionCode);
    const sectionItems = data.budgetItems.filter(
      (i) => i.sectionCode === sec.sectionCode
    );
    const childSections = data.sections.filter(
      (s) => s.parentSectionCode === sec.sectionCode
    );
    const hasContent = sectionItems.length > 0 || childSections.length > 0;

    let sectionTotal = 0;
    for (const bi of sectionItems) {
      const st = itemStates.get(bi.itemCode);
      sectionTotal += (st?.materialAmount ?? 0) + (st?.feeAmount ?? 0);
    }

    return (
      <div key={sec.sectionCode}>
        <button
          onClick={() => toggleSection(sec.sectionCode)}
          className="w-full flex items-center gap-2 px-4 py-2 text-xs font-semibold text-gray-600 bg-gray-50 border-t border-gray-200 hover:bg-gray-100 transition-colors"
          style={depth > 0 ? { paddingLeft: `${16 + depth * 16}px` } : undefined}
        >
          {hasContent &&
            (isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />)}
          <span>📂 {sec.name}</span>
          {sectionTotal > 0 && (
            <span className="ml-auto font-mono text-gray-500">
              {Math.round(sectionTotal).toLocaleString("hu")} Ft
            </span>
          )}
        </button>
        {!isCollapsed && (
          <>
            {sectionItems.map(renderItemRow)}
            {childSections
              .sort((a, b) => a.sequenceNo - b.sequenceNo)
              .map((cs) => renderSection(cs, depth + 1))}
          </>
        )}
      </div>
    );
  };

  // ---- Main render ----
  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 80px)" }}>
      {/* Header */}
      <div className="shrink-0 mb-3">
        <button
          onClick={() => router.push(`/settle/${token}/dashboard`)}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mb-2 transition-colors"
        >
          <ArrowLeft size={12} /> Vissza
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-800">
              {data.invoice.label} — Elszámolás
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {data.contract.partnerName} · {data.contract.projectName} /{" "}
              {data.contract.budgetName}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">Max összeg</p>
            <p className="text-sm font-mono font-semibold text-gray-700">
              {maxAmount.toLocaleString("hu")} Ft
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="shrink-0 mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline text-xs">
            Bezárás
          </button>
        </div>
      )}

      {/* Sticky action bar — always visible */}
      <div className="shrink-0 sticky top-0 z-20 bg-white border border-gray-200 rounded-xl p-3 mb-3 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-600">
              Összesen:{" "}
              <span
                className={`font-mono font-semibold text-base ${overBudget ? "text-red-600" : "text-gray-800"}`}
              >
                {Math.round(totalNet).toLocaleString("hu")} Ft
              </span>
              {overBudget && (
                <span className="ml-2 text-xs text-red-500">
                  ⚠ Meghaladja a maximumot!
                </span>
              )}
            </div>
            <div className="hidden sm:flex items-center gap-3 text-xs text-gray-400">
              <span>Anyag: {Math.round(totals.material).toLocaleString("hu")} Ft</span>
              <span>Díj: {Math.round(totals.fee).toLocaleString("hu")} Ft</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Split mode toggle */}
            <button
              onClick={() => setSplitMode((p) => !p)}
              className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs transition-colors ${
                splitMode
                  ? "bg-amber-50 border-amber-300 text-amber-700 font-medium"
                  : "border-gray-200 text-gray-500 hover:bg-gray-50"
              }`}
              title={splitMode ? "Anyag és díj külön elszámolása" : "Anyag és díj együtt"}
            >
              {splitMode ? <Unlink2 size={12} /> : <Link2 size={12} />}
              {splitMode ? "Bontott" : "Összevont"}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              <Save size={14} />
              {saving ? "Mentés…" : "Mentés"}
            </button>
            <button
              onClick={() => setShowSubmitDialog(true)}
              disabled={overBudget}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              <Send size={14} /> Beküldés
            </button>
          </div>
        </div>
        {/* Progress bar */}
        <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2">
          <div
            className={`h-1.5 rounded-full transition-all ${overBudget ? "bg-red-500" : "bg-indigo-500"}`}
            style={{
              width: `${Math.min(100, maxAmount > 0 ? (totalNet / maxAmount) * 100 : 0)}%`,
            }}
          />
        </div>
      </div>

      {/* Scrollable items table */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-white border border-gray-200 rounded-xl">
        {/* Sticky table header */}
        <div className="grid grid-cols-[50px_1fr_40px_55px_70px_70px_90px_55px] gap-1.5 px-3 py-2.5 bg-gray-100 text-gray-500 text-xs font-medium sticky top-0 z-10 border-b border-gray-200">
          <span>Ssz.</span>
          <span>Tétel</span>
          <span className="text-center">Me.</span>
          <span className="text-right">Menny.</span>
          <span className="text-right">Elsz. %</span>
          <span className="text-right">Elsz. me.</span>
          <span className="text-right">Összeg (Ft)</span>
          <span className="text-right">Telj. %</span>
        </div>

        {/* Sections */}
        {rootSections
          .sort((a, b) => a.sequenceNo - b.sequenceNo)
          .map((sec) => renderSection(sec))}

        {/* Unsectioned items */}
        {data.budgetItems.filter((i) => !i.sectionCode).map(renderItemRow)}
      </div>

      {/* Submit dialog */}
      {showSubmitDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-base font-semibold text-gray-800 mb-1">
              Elszámolás beküldése
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Beküldés után az elszámolás nem módosítható, amíg az admin nem
              bírálja el.
            </p>
            <div className="mb-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
              <p className="text-sm font-medium text-indigo-800">
                Összeg: {Math.round(totalNet).toLocaleString("hu")} Ft
              </p>
              <p className="text-xs text-indigo-600 mt-0.5">
                Anyag: {Math.round(totals.material).toLocaleString("hu")} Ft + Díj:{" "}
                {Math.round(totals.fee).toLocaleString("hu")} Ft
              </p>
            </div>
            <textarea
              value={submitNote}
              onChange={(e) => setSubmitNote(e.target.value)}
              placeholder="Opcionális megjegyzés…"
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none resize-none focus:border-indigo-400"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                <Send size={14} />
                {submitting ? "Küldés…" : "Beküldés"}
              </button>
              <button
                onClick={() => setShowSubmitDialog(false)}
                className="px-4 py-2 text-sm border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Mégse
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
