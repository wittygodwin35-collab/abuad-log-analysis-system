import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { buildRequestReference } from "@/lib/request-storage";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const adminError = await requireAdmin(request);
  if (adminError) {
    return adminError;
  }

  const { id } = await params;
  const accessRequest = await db.accessRequest
    .update({
      where: { id },
      data: {
        processedAt: new Date(),
        status: "denied",
      },
    })
    .catch(() => null);

  if (!accessRequest) {
    return NextResponse.json({ error: "Access request not found" }, { status: 404 });
  }

  return NextResponse.json({
    accessRequest: {
      ...accessRequest,
      reference: buildRequestReference("AR", accessRequest.id),
    },
  });
}
