import { LoginForm } from "./LoginForm";

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: "Hiányzó hitelesítési kód. Kérjük, próbálja újra.",
  code_exchange_failed:
    "A hitelesítés nem sikerült. Kérjen új linket, vagy jelentkezzen be jelszóval.",
  session_expired: "A munkamenet lejárt. Kérjük, jelentkezzen be újra.",
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
        <div className="bg-[var(--slate-800)] border border-[var(--slate-700)] rounded-2xl p-6 shadow-xl">
          <LoginForm initialError={errorMessage} />
        </div>

        <p className="text-center text-[12px] text-[var(--slate-500)] mt-6">
          © {new Date().getFullYear()} ERP 2 — Minden jog fenntartva
        </p>
      </div>
    </div>
  );
}
