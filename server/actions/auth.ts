"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cognitoSignOut } from "@/lib/aws/cognito";
import { buildLogoutUrl } from "@/lib/aws/cognito-oidc";

/**
 * Server Action: globally invalidates Cognito tokens, clears cookies,
 * then redirects to the Cognito Hosted UI logout endpoint.
 */
export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("access_token")?.value;

  if (accessToken) {
    try {
      await cognitoSignOut(accessToken);
      console.log("[logoutAction] GlobalSignOut OK");
    } catch (err) {
      // Best-effort — proceed with local cleanup regardless
      console.error("[logoutAction] GlobalSignOut failed (ignored):", err);
    }
  }

  cookieStore.delete("id_token");
  cookieStore.delete("access_token");
  cookieStore.delete("refresh_token");

  const logoutUri = `${process.env.NEXT_PUBLIC_APP_URL}/login`;
  redirect(buildLogoutUrl(logoutUri));
}
