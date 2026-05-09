import { db } from "@/lib/db";
import { hashPassword, normalizeUsername, verifyPassword } from "@/lib/auth";

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export interface GeneratedCredential {
  password: string;
  username: string;
}

export async function authenticateUserCredential(input: {
  password: string;
  username: string;
}): Promise<{ id: string; name: string; username: string } | null> {
  const credential = await db.userCredential.findUnique({
    where: {
      usernameNormalized: normalizeUsername(input.username),
    },
  });

  if (!credential || credential.status !== "active") {
    return null;
  }

  const passwordMatches = await verifyPassword(input.password, credential.passwordHash);
  if (!passwordMatches) {
    return null;
  }

  return {
    id: credential.id,
    name: credential.fullName || credential.username,
    username: credential.username,
  };
}

function randomInt(max: number): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] % max;
}

export function generatePassword(length = 14): string {
  return Array.from({ length }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join(
    "",
  );
}

function slugifyUsername(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");

  return slug || "user";
}

export async function generateUniqueUsername(input: {
  email: string;
  fullName?: string | null;
}): Promise<string> {
  const emailPrefix = input.email.split("@")[0] || "";
  const base = slugifyUsername(input.fullName || emailPrefix).slice(0, 42);
  let candidate = base;
  let suffix = 1;

  while (
    await db.userCredential.findUnique({
      where: {
        usernameNormalized: normalizeUsername(candidate),
      },
      select: {
        id: true,
      },
    })
  ) {
    suffix += 1;
    candidate = `${base}.${suffix}`;
  }

  return candidate;
}

export async function createOrUpdateCredential(input: {
  email: string;
  fullName?: string | null;
  password: string;
  source: string;
  username: string;
}): Promise<{ id: string; username: string }> {
  const passwordHash = await hashPassword(input.password);
  const usernameNormalized = normalizeUsername(input.username);

  const credential = await db.userCredential.upsert({
    where: {
      email: input.email,
    },
    create: {
      email: input.email,
      fullName: input.fullName || null,
      username: input.username,
      usernameNormalized,
      passwordHash,
      source: input.source,
      status: "active",
      lastPasswordResetAt: new Date(),
    },
    update: {
      fullName: input.fullName || undefined,
      username: input.username,
      usernameNormalized,
      passwordHash,
      source: input.source,
      status: "active",
      lastPasswordResetAt: new Date(),
    },
    select: {
      id: true,
      username: true,
    },
  });

  return credential;
}

export async function resetCredentialPassword(input: {
  email?: string | null;
  fullName?: string | null;
  id: string;
  password: string;
}): Promise<{ id: string; username: string }> {
  const passwordHash = await hashPassword(input.password);

  return db.userCredential.update({
    where: {
      id: input.id,
    },
    data: {
      ...(input.email ? { email: input.email } : {}),
      ...(input.fullName ? { fullName: input.fullName } : {}),
      passwordHash,
      status: "active",
      lastPasswordResetAt: new Date(),
    },
    select: {
      id: true,
      username: true,
    },
  });
}

export async function findCredentialForRecovery(input: {
  email: string;
  username: string;
}): Promise<{ email: string; fullName: string | null; id: string; username: string } | null> {
  const usernameNormalized = normalizeUsername(input.username);
  const credential = await db.userCredential.findFirst({
    where: {
      OR: [
        {
          usernameNormalized,
        },
        {
          email: input.email,
        },
      ],
    },
    select: {
      email: true,
      fullName: true,
      id: true,
      username: true,
    },
  });

  return credential;
}
