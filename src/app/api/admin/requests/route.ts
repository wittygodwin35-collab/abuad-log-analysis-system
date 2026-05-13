import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { buildRequestReference } from "@/lib/request-storage";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const adminError = await requireAdmin(request);
  if (adminError) {
    return adminError;
  }

  const [accessRequests, recoveryRequests] = await Promise.all([
    db.accessRequest.findMany({
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    }),
    db.passwordResetRequest.findMany({
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    }),
  ]);

  return NextResponse.json({
    accessRequests: accessRequests.map((accessRequest) => ({
      ...accessRequest,
      reference: buildRequestReference("AR", accessRequest.id),
    })),
    recoveryRequests: recoveryRequests.map((recoveryRequest) => ({
      ...recoveryRequest,
      reference: buildRequestReference("PR", recoveryRequest.id),
    })),
    email: {
      adminEmail:
        process.env.ADMIN_EMAIL?.trim() ||
        process.env.EMAIL_FROM?.trim() ||
        "akababatundebasit28@gmail.com",
      automaticDeliveryConfigured: Boolean(
        process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim(),
      ),
    },
  });
}
