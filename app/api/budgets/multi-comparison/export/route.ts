import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { createMultiComparisonWorkbook } from "@/lib/export/multi-comparison-excel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ExportRequestSchema = z
  .object({
    budgetId: z.number().int().positive().optional(),
    versionIds: z.array(z.number().int().positive()).min(2).max(50),
    hiddenVersionIdxs: z.array(z.number().int().min(0)).max(50).default([]),
    versionOrder: z.array(z.number().int().min(0)).max(50).default([]),
  })
  .strict()
  .refine((data) => new Set(data.versionIds).size === data.versionIds.length, {
    message: "Egy verzió csak egyszer szerepelhet az exportban",
    path: ["versionIds"],
  });

function contentDisposition(fileName: string): string {
  const safeName = fileName.replace(/"/g, "");
  const encodedName = encodeURIComponent(fileName);
  return `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Ismeretlen ártükör export hiba";
}

/** Creates and streams the multi-version price mirror Excel workbook. */
export async function POST(request: NextRequest): Promise<Response> {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await requirePermission("budgets:read");
    await requirePermission("versions:read");
    await requirePermission("budget-items:read");
    await requirePermission("comparisons:read");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ExportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const workbookFile = await createMultiComparisonWorkbook(parsed.data);
    return new Response(new Uint8Array(workbookFile.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Length": String(workbookFile.buffer.length),
        "Content-Disposition": contentDisposition(workbookFile.fileName),
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}