"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "zod";

const CredentialsSchema = z.object({
  email: z.email().max(255),
  password: z.string().min(1).max(256),
});

export interface LoginState {
  error?: string;
}

/**
 * Server Action: signs the user in with Supabase Auth (email + password).
 * On success the session cookies are written and the user lands on the
 * dashboard; on failure a Hungarian error message is returned to the form.
 */
export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const parsed = CredentialsSchema.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  });

  if (!parsed.success) {
    return { error: "Adjon meg egy érvényes e-mail címet és jelszót." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    console.error("[loginAction] Supabase sign-in failed:", error.message);
    // Generic message — never reveal whether the e-mail address exists
    return { error: "Hibás e-mail cím vagy jelszó." };
  }

  redirect("/");
}

/**
 * Server Action: signs the user out of Supabase Auth, which clears the
 * session cookies, then returns to the login page.
 */
export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    // Best-effort — the cookies are cleared either way
    console.error("[logoutAction] Supabase sign-out failed (ignored):", error.message);
  }

  redirect("/login");
}
