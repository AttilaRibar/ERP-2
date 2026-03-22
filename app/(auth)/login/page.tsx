import { AlertCircle } from "lucide-react";

const ERROR_MESSAGES: Record<string, string> = {
  state_mismatch: "Biztonsági hiba (CSRF). Kérjük, próbálja újra.",
  missing_code: "Hiányzó hitelesítési kód. Kérjük, próbálja újra.",
  token_exchange_failed: "A token csere sikertelen. Ellenőrizze a Cognito callback URL beállítást.",
};

function getErrorMessage(raw: string): string {
  return ERROR_MESSAGES[raw] ?? decodeURIComponent(raw);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorMessage = error ? getErrorMessage(error) : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--slate-950)] px-4">
      <div className="w-full max-w-[380px]">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="w-12 h-12 bg-[var(--indigo-600)] rounded-xl flex items-center justify-center shadow-lg shadow-indigo-900/40">
            <svg width="22" height="22" viewBox="0 0 16 16" fill="white">
              <path d="M2 3h5v5H2zm7 0h5v5H9zM2 10h5v5H2zm7 0h5v5H9z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-semibold text-[var(--slate-50)] text-center tracking-tight">
              ERP 2
            </h1>
            <p className="text-[13px] text-[var(--slate-400)] text-center mt-0.5">
              Jelentkezzen be fiókjába
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-[var(--slate-800)] border border-[var(--slate-700)] rounded-2xl p-6 shadow-xl flex flex-col gap-4">
          {/* Error message */}
          {errorMessage && (
            <div className="flex items-start gap-2.5 bg-red-950/60 border border-red-700/50 text-red-300 text-[13px] px-4 py-3 rounded-lg">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {errorMessage}
            </div>
          )}

          <p className="text-[13px] text-[var(--slate-400)] text-center">
            A bejelentkezés az AWS Cognito azonosítóján keresztül történik.
          </p>

          {/* Redirect to Cognito Hosted UI */}
          <a
            href="/api/auth/login"
            className="h-10 bg-[var(--indigo-600)] hover:bg-[var(--indigo-500)] text-white text-[13px] font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            Bejelentkezés
          </a>
        </div>

        <p className="text-center text-[12px] text-[var(--slate-500)] mt-6">
          © {new Date().getFullYear()} ERP 2 — Minden jog fenntartva
        </p>
      </div>
    </div>
  );
}
