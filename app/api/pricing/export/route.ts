import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { createPricedWorkbookFormData } from "@/lib/pricing/pricing-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Ismeretlen export hiba";
}

function contentDisposition(fileName: string): string {
  const safeName = fileName.replace(/"/g, "");
  const encodedName = encodeURIComponent(fileName);
  return `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`;
}

/** Creates and streams the priced Excel workbook for download. */
export async function POST(request: NextRequest): Promise<Response> {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await requirePermission("projects:read");
    await requirePermission("budgets:read");
    await requirePermission("versions:read");
    await requirePermission("budget-items:read");

    const formData = await request.formData();
    const pricedFile = await createPricedWorkbookFormData(formData);

    return new Response(new Uint8Array(pricedFile.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Length": String(pricedFile.buffer.length),
        "Content-Disposition": contentDisposition(pricedFile.fileName),
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}