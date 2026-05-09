import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { sendCredentialEmail } from "@/lib/credential-mailer";
import { buildRequestReference } from "@/lib/request-storage";
import {
  createOrUpdateCredential,
  generatePassword,
  generateUniqueUsername,
} from "@/lib/user-credentials";

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
  const accessRequest = await db.accessRequest.findUnique({
    where: { id },
  });

  if (!accessRequest) {
    return NextResponse.json({ error: "Access request not found" }, { status: 404 });
  }

  const username =
    accessRequest.approvedUsername ||
    (await generateUniqueUsername({
      email: accessRequest.email,
      fullName: accessRequest.fullName,
    }));
  const password = generatePassword();

  await createOrUpdateCredential({
    email: accessRequest.email,
    fullName: accessRequest.fullName,
    password,
    source: "access-request",
    username,
  });

  const reference = buildRequestReference("AR", accessRequest.id);
  const notification = await sendCredentialEmail({
    fullName: accessRequest.fullName,
    password,
    reference,
    requestType: "access",
    to: accessRequest.email,
    username,
  });

  const updatedRequest = await db.accessRequest.update({
    where: { id },
    data: {
      approvedUsername: username,
      notificationError: notification.error || null,
      notificationStatus: notification.status,
      processedAt: new Date(),
      status: "approved",
    },
  });

  return NextResponse.json({
    accessRequest: {
      ...updatedRequest,
      reference,
    },
    credentials: {
      password,
      username,
    },
    notification,
  });
}
