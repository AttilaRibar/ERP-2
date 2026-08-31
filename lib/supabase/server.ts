import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/supabase/env";

/**
 * Supabase client bound to the current request's cookies.
 *
 * Use it in Server Components, Server Actions and Route Handlers. A fresh
 * client must be created per request — never cache one in module scope.
 *
 * Server Components cannot write cookies, so refreshed tokens are dropped
 * there; `proxy.ts` runs before every request and performs the refresh, which
 * is what keeps the session alive.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — the proxy already refreshed the
          // session cookies, so this is safe to ignore.
        }
      },
    },
  });
}
