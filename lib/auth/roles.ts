/**
 * ERP roles and how they are read off a Supabase user.
 *
 * Roles live in the Supabase user's `app_metadata` so they travel inside the
 * access token (JWT) and can be read without an extra query. Assign them with
 * the service-role key or straight from SQL:
 *
 *   update auth.users
 *      set raw_app_meta_data = raw_app_meta_data || '{"erp_roles":["erp-admin"]}'::jsonb
 *    where email = 'user@example.com';
 *
 * `user_metadata` is accepted as a fallback for local experiments, but it is
 * user-writable — production roles belong in `app_metadata`.
 */

export type ErpRole = "erp-admin" | "erp-manager" | "erp-accountant" | "erp-viewer";

export const ERP_ROLES: readonly ErpRole[] = [
  "erp-admin",
  "erp-manager",
  "erp-accountant",
  "erp-viewer",
] as const;

export function isErpRole(value: unknown): value is ErpRole {
  return typeof value === "string" && (ERP_ROLES as readonly string[]).includes(value);
}

/** Metadata keys scanned for roles, in priority order. */
const ROLE_KEYS = ["erp_roles", "roles", "erp_role", "role"] as const;

type Metadata = Record<string, unknown> | null | undefined;

function readRoles(metadata: Metadata): ErpRole[] {
  if (!metadata) return [];
  for (const key of ROLE_KEYS) {
    const raw = metadata[key];
    if (Array.isArray(raw)) {
      const roles = raw.filter(isErpRole);
      if (roles.length > 0) return roles;
    } else if (isErpRole(raw)) {
      return [raw];
    }
  }
  return [];
}

/**
 * Extracts the ERP roles from a Supabase user or from decoded JWT claims.
 * `app_metadata` wins; `user_metadata` is only consulted if it carries none.
 */
export function extractRoles(source: {
  app_metadata?: Metadata;
  user_metadata?: Metadata;
}): ErpRole[] {
  const fromApp = readRoles(source.app_metadata);
  if (fromApp.length > 0) return fromApp;
  return readRoles(source.user_metadata);
}
