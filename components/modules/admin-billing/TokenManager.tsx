"use client";
// reason: interactive state — token generation form, clipboard, revoke actions

import { useState, useEffect, useCallback } from "react";
import { Plus, Copy, Check, Trash2, RefreshCw } from "lucide-react";
import {
  generateSubcontractorToken,
  revokeSubcontractorToken,
  listSubcontractorTokens,
  type SubcontractorTokenRow,
} from "@/server/actions/subcontractor-tokens";

// ─── Token status helpers ─────────────────────────────────────────────────────

function getTokenStatus(token: SubcontractorTokenRow): "active" | "expired" | "revoked" {
  if (token.revokedAt !== null) return "revoked";
  if (new Date(token.expiresAt) < new Date()) return "expired";
  return "active";
}

const STATUS_LABELS = {
  active: "Aktív",
  expired: "Lejárt",
  revoked: "Visszavonva",
};

const STATUS_COLORS = {
  active: "bg-green-100 text-green-700",
  expired: "bg-gray-100 text-gray-500",
  revoked: "bg-red-100 text-red-600",
};

// ─── Generate form ────────────────────────────────────────────────────────────

interface GenerateFormProps {
  partnerId: number;
  onGenerated: (magicLink: string) => void;
  onClose: () => void;
}

function GenerateForm({ partnerId, onGenerated, onClose }: GenerateFormProps) {
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(90);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const result = await generateSubcontractorToken(partnerId, label.trim(), days);
    setSaving(false);

    if (result.success) {
      onGenerated(result.data.magicLink);
    } else {
      setError(result.error);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-3 p-4 bg-[var(--slate-50)] border border-[var(--slate-200)] rounded-[8px] space-y-3">
      {error && (
        <div className="p-2 bg-red-50 border border-red-200 rounded-[6px] text-xs text-red-700">
          {error}
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-[var(--slate-600)] mb-1">
          Megnevezés *
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
          placeholder="pl. 2024 Q1 hozzáférés"
          className="w-full h-8 px-3 border border-[var(--slate-200)] rounded-[6px] text-sm bg-white text-[var(--slate-800)] focus:border-[var(--indigo-600)] outline-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-[var(--slate-600)] mb-1">
          Lejárat (napokban)
        </label>
        <input
          type="number"
          min={1}
          max={3650}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          required
          className="w-full h-8 px-3 border border-[var(--slate-200)] rounded-[6px] text-sm bg-white text-[var(--slate-800)] focus:border-[var(--indigo-600)] outline-none"
        />
        <p className="text-xs text-[var(--slate-400)] mt-0.5">
          Lejár:{" "}
          {new Date(Date.now() + days * 86400000).toLocaleDateString("hu-HU")}
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--indigo-600)] text-white text-xs rounded-[6px] hover:bg-[var(--indigo-700)] disabled:opacity-50 transition-colors"
        >
          <Plus size={12} />
          {saving ? "Generálás…" : "Token generálása"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-xs border border-[var(--slate-200)] text-[var(--slate-600)] rounded-[6px] hover:bg-white transition-colors"
        >
          Mégse
        </button>
      </div>
    </form>
  );
}

// ─── Magic link display ───────────────────────────────────────────────────────

interface MagicLinkProps {
  magicLink: string;
  onClose: () => void;
}

function MagicLinkDisplay({ magicLink, onClose }: MagicLinkProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(magicLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-3 p-4 bg-green-50 border border-green-200 rounded-[8px]">
      <p className="text-xs font-medium text-green-700 mb-2">
        ✓ Token sikeresen létrehozva! Másolja ki és küldje el az alvállalkozónak:
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs bg-white border border-green-200 rounded-[4px] px-2 py-1.5 text-green-900 truncate">
          {magicLink}
        </code>
        <button
          onClick={handleCopy}
          className="shrink-0 flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs rounded-[6px] hover:bg-green-700 transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Másolva!" : "Másolás"}
        </button>
      </div>
      <button
        onClick={onClose}
        className="mt-2 text-xs text-green-600 hover:underline"
      >
        Bezárás
      </button>
    </div>
  );
}

// ─── Main TokenManager ────────────────────────────────────────────────────────

interface TokenManagerProps {
  partnerId: number;
}

export function TokenManager({ partnerId }: TokenManagerProps) {
  const [tokens, setTokens] = useState<SubcontractorTokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newMagicLink, setNewMagicLink] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await listSubcontractorTokens(partnerId);
    setTokens(data);
    setLoading(false);
  }, [partnerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRevoke = async (tokenId: number) => {
    if (!confirm("Biztosan visszavonja ezt a tokent?")) return;
    setRevoking(tokenId);
    await revokeSubcontractorToken(tokenId);
    setRevoking(null);
    await load();
  };

  const handleGenerated = async (magicLink: string) => {
    setShowForm(false);
    setNewMagicLink(magicLink);
    await load();
  };

  return (
    <div className="mt-6 pt-6 border-t border-[var(--slate-100)]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--slate-700)]">
          Hozzáférési tokenek (Magic Link)
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="p-1 rounded-[4px] hover:bg-[var(--slate-100)] text-[var(--slate-400)] disabled:opacity-50 transition-colors"
            title="Frissítés"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
          {!showForm && (
            <button
              onClick={() => { setShowForm(true); setNewMagicLink(null); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--indigo-600)] text-white text-xs rounded-[6px] hover:bg-[var(--indigo-700)] transition-colors"
            >
              <Plus size={12} />
              Új token
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <GenerateForm
          partnerId={partnerId}
          onGenerated={handleGenerated}
          onClose={() => setShowForm(false)}
        />
      )}

      {newMagicLink && (
        <MagicLinkDisplay
          magicLink={newMagicLink}
          onClose={() => setNewMagicLink(null)}
        />
      )}

      {loading ? (
        <p className="text-xs text-[var(--slate-400)] py-2">Betöltés…</p>
      ) : tokens.length === 0 ? (
        <p className="text-xs text-[var(--slate-400)] italic py-2">
          Még nincs létrehozott hozzáférési token.
        </p>
      ) : (
        <div className="space-y-2">
          {tokens.map((token) => {
            const status = getTokenStatus(token);
            return (
              <div
                key={token.id}
                className="flex items-start gap-3 p-3 border border-[var(--slate-100)] rounded-[6px] bg-white"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium text-[var(--slate-700)]">
                      {token.label || "Névtelen token"}
                    </span>
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${STATUS_COLORS[status]}`}
                    >
                      {STATUS_LABELS[status]}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--slate-400)]">
                    Lejár: {new Date(token.expiresAt).toLocaleDateString("hu-HU")}
                    {token.usedAt && (
                      <> · Utoljára használva: {new Date(token.usedAt).toLocaleDateString("hu-HU")}</>
                    )}
                  </p>
                </div>
                {status === "active" && (
                  <button
                    onClick={() => handleRevoke(token.id)}
                    disabled={revoking === token.id}
                    className="shrink-0 flex items-center gap-1 px-2 py-1 border border-red-200 text-red-600 text-[11px] rounded-[4px] hover:bg-red-50 disabled:opacity-50 transition-colors"
                    title="Token visszavonása"
                  >
                    <Trash2 size={11} />
                    {revoking === token.id ? "…" : "Visszavon"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
