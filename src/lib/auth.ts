const AUTH_COOKIE_NAME = "abuad_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 12;
const DEFAULT_APP_USERNAME = "Aka-babatunde Abdulbasit Ayobamidele";
const DEFAULT_APP_PASSWORD = "22/SCI01/025";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface SessionUser {
  id: string;
  name: string;
}

interface SessionPayload {
  sub: string;
  name: string;
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

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

function getEnvOrDefault(name: string, defaultValue: string): string {
  return process.env[name]?.trim() || defaultValue;
}

function normalizeUsername(username: string): string {
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

export function getAuthSecret(): string {
  return getRequiredEnv("AUTH_SECRET");
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
    };
  } catch {
    return null;
  }
}
