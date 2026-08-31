import { headers } from "next/headers";
import { type ErpRole, isErpRole } from "@/lib/auth/roles";

export type { ErpRole } from "@/lib/auth/roles";

/** Maps ERP roles (Supabase `app_metadata.erp_roles`) to permission strings. */
export const PERMISSIONS: Record<ErpRole, string[]> = {
  "erp-admin": ["*"],
  "erp-manager": [
    "orders:*",
    "inventory:*",
    "hr:read",
    "partners:*",
    "projects:*",
    "quotes:*",
    "budgets:*",
    "versions:*",
    "budget-items:*",
    "imports:*",
    "reports:*",
    "comparisons:*",
    "agent-proposals:*",
    "ai-chat:*",
    "internet-search:use",
    "settlements:*",
  ],
  "erp-accountant": [
    "finance:*",
    "orders:read",
    "inventory:read",
    "partners:read",
    "projects:read",
    "quotes:read",
    "budgets:read",
    "versions:read",
    "budget-items:read",
    "reports:read",
    "comparisons:read",
    "agent-proposals:read",
    "ai-chat:*",
    "internet-search:use",
    "settlements:read",
  ],
  "erp-viewer": [
    "orders:read",
    "inventory:read",
    "finance:read",
    "partners:read",
    "projects:read",
    "quotes:read",
    "budgets:read",
    "versions:read",
    "budget-items:read",
    "reports:read",
    "comparisons:read",
    "agent-proposals:read",
    "ai-chat:*",
    "internet-search:use",
  ],
};

export function hasPermission(roles: ErpRole[], permission: string): boolean {
  return roles.some((role) => {
    const perms = PERMISSIONS[role] ?? [];
    return (
      perms.includes("*") ||
      perms.includes(permission) ||
      perms.includes(`${permission.split(":")[0]}:*`)
    );
  });
}

/** Reads the roles injected by the proxy from request headers. */
export async function getRolesFromHeaders(): Promise<ErpRole[]> {
  const headerStore = await headers();
  const raw = headerStore.get("x-user-roles");
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const roles = Array.isArray(parsed) ? parsed.filter(isErpRole) : [];
    // In development, grant admin if the Supabase user has no roles assigned
    if (roles.length === 0 && process.env.NODE_ENV === "development") {
      return ["erp-admin"];
    }
    return roles;
  } catch {
    return [];
  }
}

/**
 * Throws "FORBIDDEN" if the current user (from proxy headers) lacks the
 * required permission. Call at the top of every Server Action.
 */
export async function requirePermission(permission: string): Promise<void> {
  const roles = await getRolesFromHeaders();
  if (!hasPermission(roles, permission)) {
    throw new Error("FORBIDDEN");
  }
}
