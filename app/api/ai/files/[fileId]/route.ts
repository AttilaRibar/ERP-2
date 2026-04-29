import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import {
  getWorkbookForDownload,
  serializeWorkbook,
} from "@/lib/agent/excel/workbook-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams an agent-produced (or originally-uploaded) Excel workbook back to
 * the user.
 *
 * Security model:
 * - Cognito session required (`getCurrentUser`).
 * - `ai-chat:write` RBAC.
 * - Workbook ownership enforced inside `getWorkbookForDownload` — a user
 *   can only fetch their own workbooks.
 * - 410 Gone if the workbook expired (TTL) or the server restarted; chat
 *   history persists the metadata, but the binary lives only in memory.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requirePermission("ai-chat:write");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { fileId } = await ctx.params;
  if (!fileId || typeof fileId !== "string") {
    return NextResponse.json({ error: "Invalid file id" }, { status: 400 });
  }

  const stored = getWorkbookForDownload({
    userId: session.user.sub,
    workbookId: fileId,
  });

  if (!stored) {
    return NextResponse.json(
      {
        error:
          "A kért Excel fájl már nem érhető el. A szerveroldali gyorsítótár lejárt — küldd újra a fájlt vagy futtasd újra az AI műveletet.",
      },
      { status: 410 },
    );
  }

  const buffer = await serializeWorkbook(stored);
  const safeName = stored.name.replace(/"/g, "");
  const encodedName = encodeURIComponent(stored.name);

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Length": String(buffer.length),
      "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
