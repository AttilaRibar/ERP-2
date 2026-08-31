import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/supabase/env";

/**
 * Supabase client for `proxy.ts`.
 *
 * The proxy is the only place that can both read the request cookies and write
 * refreshed ones back, so it owns session refresh for the whole app. Cookies
 * produced by a refresh are recorded here and copied onto whichever response
 * the proxy ends up returning via {@link ProxySupabase.applyAuthCookies}.
 */
export interface ProxySupabase {
  supabase: ReturnType<typeof createServerClient>;
  /** Copies refreshed Supabase auth cookies onto an outgoing response. */
  applyAuthCookies: <T extends NextResponse>(response: T) => T;
  /** True once a token refresh has written new cookies onto the request. */
  hasRefreshedCookies: () => boolean;
}

export function createSupabaseProxyClient(request: NextRequest): ProxySupabase {
  const refreshed: { name: string; value: string; options?: Record<string, unknown> }[] = [];

  const supabase = createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          // Update the request too, so the forwarded `cookie` header carries
          // the refreshed tokens down to Server Components.
          request.cookies.set(cookie.name, cookie.value);
          refreshed.push(cookie);
        }
      },
    },
  });

  return {
    supabase,
    applyAuthCookies(response) {
      for (const { name, value, options } of refreshed) {
        response.cookies.set(name, value, options);
      }
      return response;
    },
    hasRefreshedCookies() {
      return refreshed.length > 0;
    },
  };
}

/** Clears every Supabase auth cookie (`sb-*`) from the response. */
export function clearSupabaseCookies(
  request: NextRequest,
  response: NextResponse
): void {
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith("sb-")) {
      response.cookies.delete(cookie.name);
    }
  }
}
