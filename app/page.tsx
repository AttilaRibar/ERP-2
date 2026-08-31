import { ErpShell } from "@/components/layout";
import { getCurrentUser } from "@/lib/auth/session";

export default async function Home() {
  const session = await getCurrentUser();
  const userName = session?.user.name ?? "";
  const userEmail = session?.user.email ?? "";

  return <ErpShell userName={userName} userEmail={userEmail} />;
}

