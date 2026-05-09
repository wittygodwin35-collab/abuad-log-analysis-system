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
  const recoveryRequest = await db.passwordResetRequest
    .update({
      where: { id },
      data: {
        processedAt: new Date(),
        status: "reviewed",
      },
    })
    .catch(() => null);

  if (!recoveryRequest) {
    return NextResponse.json({ error: "Recovery request not found" }, { status: 404 });
  }

  return NextResponse.json({
    recoveryRequest: {
      ...recoveryRequest,
      reference: buildRequestReference("PR", recoveryRequest.id),
    },
  });
}
