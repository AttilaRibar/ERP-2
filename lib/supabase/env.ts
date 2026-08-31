/**
 * Central place where the Supabase connection settings are read and validated.
 *
 * Required environment variables:
 *   NEXT_PUBLIC_SUPABASE_URL              – https://<project-ref>.supabase.co
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  – publishable ("anon") key, safe for the browser
 *   SUPABASE_SECRET_KEY                   – secret ("service_role") key, server only
 *
 * The legacy names (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)
 * are still accepted so existing deployments keep working.
 *
 * `NEXT_PUBLIC_*` values are referenced literally so Next.js can inline them
 * into any client bundle that ends up importing this module.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable: ${name}. Add it to .env.local (see README).`
    );
  }
  return value;
}

/** Project URL — used by every Supabase client (browser and server alike). */
export function getSupabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/**
 * Publishable (anon) key. Safe to expose: it only grants what RLS allows and is
 * the key the auth cookie session is bound to.
 */
export function getSupabasePublishableKey(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/**
 * Secret (service_role) key. Bypasses RLS — never import this from a Client
 * Component and never prefix it with `NEXT_PUBLIC_`.
 */
export function getSupabaseSecretKey(): string {
  return required(
    "SUPABASE_SECRET_KEY",
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}
