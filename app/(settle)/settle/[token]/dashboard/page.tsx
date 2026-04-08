"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { FileText, CheckCircle, Clock, Lock, AlertCircle, ExternalLink } from "lucide-react";
import { getSettleDashboard } from "@/server/actions/settle-portal";
import type { SettleDashboardData } from "@/types/settlements";

const STATUS_CONFIG: Record<string, { icon: typeof FileText; label: string; color: string }> = {
  locked: { icon: Lock, label: "Zárt", color: "text-gray-400 bg-gray-50 border-gray-200" },
  open: { icon: FileText, label: "Kitölthető", color: "text-yellow-600 bg-yellow-50 border-yellow-200" },
  submitted: { icon: Clock, label: "Beküldve — elbírálás alatt", color: "text-blue-600 bg-blue-50 border-blue-200" },
  approved: { icon: CheckCircle, label: "Jóváhagyva", color: "text-green-600 bg-green-50 border-green-200" },
  rejected: { icon: AlertCircle, label: "Visszautasítva — javítás szükséges", color: "text-red-600 bg-red-50 border-red-200" },
};

export default function SettleDashboardPage() {
  const router = useRouter();
  const params = useParams();
  const token = params.token as string;

  const [data, setData] = useState<SettleDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSettleDashboard().then((res) => {
      if (res.success) {
        setData(res.data);
      } else {
        setError(res.error);
      }
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <p className="text-sm text-gray-400">Betöltés…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <p className="text-sm text-red-500">{error ?? "Hiba történt"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Project info */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h1 className="text-xl font-semibold text-gray-800">{data.contract.label}</h1>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-500">
          <span>🏗 {data.contract.projectName}</span>
          <span>📋 {data.contract.budgetName}</span>
          <span>🤝 {data.contract.partnerName}</span>
        </div>
        <div className="mt-3 text-sm text-gray-600">
          Teljes nettó összeg:{" "}
          <span className="font-semibold font-mono text-gray-800">
            {data.contract.totalNetAmount.toLocaleString("hu")} Ft
          </span>
        </div>
      </div>

      {/* Invoices */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Részszámlák</h2>
        <div className="space-y-3">
          {data.invoices.map((inv) => {
            const config = STATUS_CONFIG[inv.status] ?? STATUS_CONFIG.locked;
            const Icon = config.icon;
            const claimed = Number(inv.claimedMaterialTotal) + Number(inv.claimedFeeTotal);
            const canEdit = inv.status === "open" || inv.status === "rejected";

            return (
              <div
                key={inv.id}
                className={`bg-white rounded-xl border p-5 ${config.color.split(" ").slice(1).join(" ")} transition-all`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <Icon size={20} className={config.color.split(" ")[0]} />
                    <div>
                      <h3 className="text-sm font-semibold text-gray-800">
                        {inv.invoiceNumber}. {inv.label}
                      </h3>
                      <p className={`text-xs mt-0.5 ${config.color.split(" ")[0]}`}>
                        {config.label}
                      </p>
                      {inv.reviewNote && (
                        <p className="text-xs mt-1 text-red-600 bg-red-50 px-2 py-1 rounded">
                          💬 {inv.reviewNote}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Max összeg</p>
                    <p className="text-sm font-mono font-medium text-gray-700">
                      {Number(inv.maxAmount).toLocaleString("hu")} Ft
                    </p>
                    {claimed > 0 && (
                      <>
                        <p className="text-xs text-gray-500 mt-1">Igényelt</p>
                        <p className="text-sm font-mono font-medium text-gray-800">
                          {claimed.toLocaleString("hu")} Ft
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {canEdit && (
                  <button
                    onClick={() =>
                      router.push(`/settle/${token}/invoice/${inv.id}`)
                    }
                    className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                  >
                    <ExternalLink size={14} />
                    {inv.status === "rejected"
                      ? "Javítás és újraküldés"
                      : "Elszámolás kitöltése"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
