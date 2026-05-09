const AUTH_COOKIE_NAME = "abuad_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 12;
const DEFAULT_APP_USERNAME = "Aka-babatunde Abdulbasit Ayobamidele";
const DEFAULT_APP_PASSWORD = "22/SCI01/025";
const PASSWORD_HASH_ALGORITHM = "pbkdf2_sha256";
const PASSWORD_HASH_ITERATIONS = 120_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type SessionRole = "admin" | "user";

export interface SessionUser {
  id: string;
  name: string;
  role: SessionRole;
}

interface SessionPayload {
  sub: string;
  name: string;
  role?: SessionRole;
  iat: number;
  exp: number;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function toBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

async function importSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign", "verify"],
  );
}

function getRequiredEnv(names: string[]): string {
  const value = names.map((name) => process.env[name]?.trim()).find(Boolean);
  if (!value) {
    throw new Error(`${names.join(" or ")} is not configured.`);
  }

  return value;
}

function getEnvOrDefault(name: string, defaultValue: string): string {
  return process.env[name]?.trim() || defaultValue;
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function getConfiguredCredentials(): { username: string; password: string } {
  return {
    username: getEnvOrDefault("APP_USERNAME", DEFAULT_APP_USERNAME),
    password: getEnvOrDefault("APP_PASSWORD", DEFAULT_APP_PASSWORD),
  };
}

export function isValidCredentialAttempt(username: string, password: string): boolean {
  const configured = getConfiguredCredentials();

  return (
    normalizeUsername(username) === normalizeUsername(configured.username) &&
    password === configured.password
  );
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function timingSafeStringEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

async function derivePasswordHash(
  password: string,
  saltBytes: Uint8Array,
  iterations: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toBufferSource(saltBytes),
      iterations,
    },
    key,
    256,
  );

  return encodeBase64Url(new Uint8Array(derived));
}

export async function hashPassword(password: string): Promise<string> {
  const saltBytes = randomBytes(16);
  const hash = await derivePasswordHash(password, saltBytes, PASSWORD_HASH_ITERATIONS);

  return [
    PASSWORD_HASH_ALGORITHM,
    String(PASSWORD_HASH_ITERATIONS),
    encodeBase64Url(saltBytes),
    hash,
  ].join("$");
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const [algorithm, iterationsRaw, salt, expectedHash] = encodedHash.split("$");
  const iterations = Number(iterationsRaw);

  if (
    algorithm !== PASSWORD_HASH_ALGORITHM ||
    !Number.isInteger(iterations) ||
    iterations <= 0 ||
    !salt ||
    !expectedHash
  ) {
    return false;
  }

  const actualHash = await derivePasswordHash(password, decodeBase64Url(salt), iterations);
  return timingSafeStringEqual(actualHash, expectedHash);
}

export function isAdminUser(user: SessionUser | null | undefined): boolean {
  return user?.role === "admin";
}

export function getAuthSecret(): string {
  return getRequiredEnv(["AUTH_SECRET", "NEXTAUTH_SECRET"]);
}

export function getSessionCookieName(): string {
  return AUTH_COOKIE_NAME;
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  };
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: user.id,
    name: user.name,
    role: user.role,
    iat: now,
    exp: now + SESSION_DURATION_SECONDS,
  };
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = encoder.encode(payloadJson);
  const key = await importSigningKey(getAuthSecret());
  const signature = await crypto.subtle.sign("HMAC", key, payloadBytes);

  return `${encodeBase64Url(payloadBytes)}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(
  token: string | undefined | null,
): Promise<SessionUser | null> {
  if (!token) {
    return null;
  }

  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart) {
    return null;
  }

  try {
    const payloadBytes = decodeBase64Url(payloadPart);
    const signatureBytes = decodeBase64Url(signaturePart);
    const key = await importSigningKey(getAuthSecret());
    const verified = await crypto.subtle.verify(
      "HMAC",
      key,
      toBufferSource(signatureBytes),
      toBufferSource(payloadBytes),
    );

    if (!verified) {
      return null;
    }

    const payload = JSON.parse(decoder.decode(payloadBytes)) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp <= now) {
      return null;
    }

    return {
      id: payload.sub,
      name: payload.name,
      role: payload.role === "admin" ? "admin" : "user",
    };
  } catch {
    return null;
  }
}
