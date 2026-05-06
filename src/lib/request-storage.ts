import type { PrismaClient } from "@prisma/client";

const REQUEST_STORE_NAME = "abuad-public-requests";

interface StoredRequest {
  createdAt: string;
  id: string;
  status: "pending";
  storage: "netlify-blobs";
  type: "access" | "password-reset";
}

export interface AccessRequestInput {
  department?: string | null;
  email: string;
  fullName: string;
  useCase: string;
}

export interface PasswordResetRequestInput {
  email: string;
  fullName?: string | null;
  note?: string | null;
  username: string;
}

interface SavedRequest {
  id: string;
}

function hasDatabaseConfig(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function isNetlifyRuntime(): boolean {
  return Boolean(process.env.NETLIFY || process.env.CONTEXT || process.env.SITE_ID);
}

function createRequestId(): string {
  return crypto.randomUUID();
}

async function getDb(): Promise<PrismaClient> {
  const { db } = await import("@/lib/db");
  return db;
}

async function saveToBlobs<T extends object>(
  type: StoredRequest["type"],
  data: T,
): Promise<SavedRequest> {
  if (!isNetlifyRuntime()) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const { getStore } = await import("@netlify/blobs");
  const store = getStore({
    name: REQUEST_STORE_NAME,
    consistency: "strong",
  });
  const id = createRequestId();
  const createdAt = new Date().toISOString();
  const key = `${type}/${createdAt}-${id}.json`;

  await store.setJSON(key, {
    ...data,
    createdAt,
    id,
    status: "pending",
    storage: "netlify-blobs",
    type,
  } satisfies T & StoredRequest);

  return { id };
}

export function buildRequestReference(prefix: "AR" | "PR", id: string): string {
  return `${prefix}-${id.slice(-6).toUpperCase()}`;
}

export async function saveAccessRequest(input: AccessRequestInput): Promise<SavedRequest> {
  if (hasDatabaseConfig()) {
    try {
      const db = await getDb();
      const accessRequest = await db.accessRequest.create({
        data: {
          fullName: input.fullName,
          email: input.email,
          department: input.department || null,
          useCase: input.useCase,
        },
      });

      return { id: accessRequest.id };
    } catch (error) {
      if (!isNetlifyRuntime()) {
        throw error;
      }
    }
  }

  return saveToBlobs("access", input);
}

export async function savePasswordResetRequest(
  input: PasswordResetRequestInput,
): Promise<SavedRequest> {
  if (hasDatabaseConfig()) {
    try {
      const db = await getDb();
      const resetRequest = await db.passwordResetRequest.create({
        data: {
          fullName: input.fullName || null,
          email: input.email,
          username: input.username,
          note: input.note || null,
        },
      });

      return { id: resetRequest.id };
    } catch (error) {
      if (!isNetlifyRuntime()) {
        throw error;
      }
    }
  }

  return saveToBlobs("password-reset", input);
}
