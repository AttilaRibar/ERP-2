import { headers } from "next/headers";

export type CognitoGroup =
  | "erp-admin"
  | "erp-manager"
  | "erp-accountant"
  | "erp-viewer";

/** Maps Cognito groups to allowed permission strings. */
export const PERMISSIONS: Record<CognitoGroup, string[]> = {
  "erp-admin": ["*"],
  "erp-manager": ["orders:*", "inventory:*", "hr:read", "projects:*"],
  "erp-accountant": ["finance:*", "orders:read", "inventory:read"],
  "erp-viewer": ["orders:read", "inventory:read", "finance:read"],
};

export function hasPermission(
  groups: CognitoGroup[],
  permission: string
): boolean {
  return groups.some((group) => {
    const perms = PERMISSIONS[group] ?? [];
    return (
      perms.includes("*") ||
      perms.includes(permission) ||
      perms.includes(`${permission.split(":")[0]}:*`)
    );
  });
}

/** Reads user groups injected by middleware from request headers. */
export async function getGroupsFromHeaders(): Promise<CognitoGroup[]> {
  const headerStore = await headers();
  const raw = headerStore.get("x-user-groups");
  if (!raw) return [];
  try {
    return JSON.parse(raw) as CognitoGroup[];
  } catch {
    return [];
  }
}

/**
 * Throws "FORBIDDEN" if the current user (from middleware headers) lacks the
 * required permission. Call at the top of every Server Action.
 */
export async function requirePermission(permission: string): Promise<void> {
  const groups = await getGroupsFromHeaders();
  if (!hasPermission(groups, permission)) {
    throw new Error("FORBIDDEN");
  }
}
