"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle } from "lucide-react";
import { loginAction, type LoginState } from "@/server/actions/auth";

const INITIAL_STATE: LoginState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-10 bg-[var(--indigo-600)] hover:bg-[var(--indigo-500)] disabled:opacity-60 disabled:cursor-not-allowed text-white text-[13px] font-medium rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
    >
      {pending ? "Bejelentkezés…" : "Bejelentkezés"}
    </button>
  );
}

/** Email + password sign-in form backed by Supabase Auth. */
export function LoginForm({ initialError }: { initialError?: string | null }) {
  const [state, formAction] = useActionState(loginAction, INITIAL_STATE);
  const errorMessage = state.error ?? initialError ?? null;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-2.5 bg-red-950/60 border border-red-700/50 text-red-300 text-[13px] px-4 py-3 rounded-lg"
        >
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          {errorMessage}
        </div>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] text-[var(--slate-400)]">E-mail cím</span>
        <input
          type="email"
          name="email"
          autoComplete="username"
          required
          className="h-10 px-3 bg-[var(--slate-900)] border border-[var(--slate-700)] focus:border-[var(--indigo-500)] outline-none rounded-lg text-[13px] text-[var(--slate-100)] placeholder:text-[var(--slate-500)] transition-colors"
          placeholder="nev@ceg.hu"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] text-[var(--slate-400)]">Jelszó</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          className="h-10 px-3 bg-[var(--slate-900)] border border-[var(--slate-700)] focus:border-[var(--indigo-500)] outline-none rounded-lg text-[13px] text-[var(--slate-100)] placeholder:text-[var(--slate-500)] transition-colors"
          placeholder="••••••••"
        />
      </label>

      <SubmitButton />
    </form>
  );
}
