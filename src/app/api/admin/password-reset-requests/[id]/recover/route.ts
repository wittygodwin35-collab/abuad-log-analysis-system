import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { sendCredentialEmail } from "@/lib/credential-mailer";
import { buildRequestReference } from "@/lib/request-storage";
import {
  createOrUpdateCredential,
  findCredentialForRecovery,
  generatePassword,
  generateUniqueUsername,
  resetCredentialPassword,
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
  const recoveryRequest = await db.passwordResetRequest.findUnique({
    where: { id },
  });

  if (!recoveryRequest) {
    return NextResponse.json({ error: "Recovery request not found" }, { status: 404 });
  }

  const password = generatePassword();
  const existingCredential = await findCredentialForRecovery({
    email: recoveryRequest.email,
    username: recoveryRequest.username,
  });
  const credential = existingCredential
    ? await resetCredentialPassword({
        email: recoveryRequest.email,
        fullName: recoveryRequest.fullName || existingCredential.fullName,
        id: existingCredential.id,
        password,
      })
    : await createOrUpdateCredential({
        email: recoveryRequest.email,
        fullName: recoveryRequest.fullName,
        password,
        source: "password-recovery",
        username: await generateUniqueUsername({
          email: recoveryRequest.email,
          fullName: recoveryRequest.username || recoveryRequest.fullName,
        }),
      });

  const reference = buildRequestReference("PR", recoveryRequest.id);
  const notification = await sendCredentialEmail({
    fullName: recoveryRequest.fullName,
    password,
    reference,
    requestType: "recovery",
    to: recoveryRequest.email,
    username: credential.username,
  });

  const updatedRequest = await db.passwordResetRequest.update({
    where: { id },
    data: {
      notificationError: notification.error || null,
      notificationStatus: notification.status,
      processedAt: new Date(),
      resolvedUsername: credential.username,
      status: "completed",
    },
  });

  return NextResponse.json({
    credentials: {
      password,
      username: credential.username,
    },
    notification,
    recoveryRequest: {
      ...updatedRequest,
      reference,
    },
  });
}
