"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Lock } from "lucide-react";

export default function SettleLoginPage() {
  const router = useRouter();
  const params = useParams();
  const token = params.token as string;

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError("Kérjük adja meg a jelszót");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/settle/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        router.push(`/settle/${token}/dashboard`);
      } else {
        setError(data.error ?? "Sikertelen bejelentkezés");
      }
    } catch {
      setError("Hálózati hiba. Kérjük próbálja újra.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
          <div className="flex flex-col items-center mb-6">
            <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center mb-3">
              <Lock className="text-indigo-600" size={22} />
            </div>
            <h1 className="text-lg font-semibold text-gray-800">
              Alvállalkozói belépés
            </h1>
            <p className="text-sm text-gray-500 mt-1 text-center">
              Adja meg az elszámoláshoz kapott jelszót
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="password"
                className="block text-xs font-medium text-gray-600 mb-1"
              >
                Jelszó
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete="current-password"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100 transition-all"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? "Belépés…" : "Belépés"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
