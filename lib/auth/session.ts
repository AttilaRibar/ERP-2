import { extractRoles, type ErpRole } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** The signed-in ERP user, derived from the verified Supabase access token. */
export interface ErpUser {
  /** Supabase `auth.users.id` — the value stored in every `user_id` column. */
  id: string;
  email: string;
  /** Display name from `user_metadata` (full_name / name), if the user has one. */
  name: string;
  /** Roles read from `app_metadata` — the source of truth for RBAC. */
  roles: ErpRole[];
}

export interface AuthSession {
  user: ErpUser;
}

/** The subset of Supabase JWT claims the app reads. */
export interface SupabaseClaims {
  sub: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}

function readString(metadata: Record<string, unknown> | undefined, key: string): string {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
}

/** Builds the ERP user object from verified Supabase JWT claims. */
export function userFromClaims(claims: SupabaseClaims): ErpUser {
  const userMetadata = claims.user_metadata;
  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : readString(userMetadata, "email"),
    name:
      readString(userMetadata, "full_name") ||
      readString(userMetadata, "name") ||
      readString(userMetadata, "user_name"),
    roles: extractRoles(claims),
  };
}

/**
 * Reads the Supabase session from the request cookies and verifies the access
 * token. With asymmetric signing keys the JWT is verified locally (JWKS);
 * with a legacy symmetric secret Supabase Auth is asked to validate it.
 *
 * Returns null when there is no valid session.
 */
export async function getCurrentUser(): Promise<AuthSession | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return { user: userFromClaims(data.claims) };
}
