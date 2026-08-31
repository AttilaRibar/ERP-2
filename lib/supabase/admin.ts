import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseSecretKey, getSupabaseUrl } from "@/lib/supabase/env";

let cached: SupabaseClient | null = null;

/**
 * Service-role Supabase client for trusted server-side work (Storage writes,
 * user administration). It bypasses RLS, so it must never be reachable from
 * the browser — only import it from server-only modules.
 *
 * The client is stateless (no cookie session), so a single instance is reused.
 */
export function getSupabaseAdminClient(): SupabaseClient {
  if (!cached) {
    cached = createClient(getSupabaseUrl(), getSupabaseSecretKey(), {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return cached;
}
