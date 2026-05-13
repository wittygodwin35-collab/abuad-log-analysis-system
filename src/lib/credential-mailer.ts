import { connect, type TLSSocket } from "node:tls";

const DEFAULT_ADMIN_EMAIL = "akababatundebasit28@gmail.com";

export interface CredentialEmailInput {
  fullName?: string | null;
  password: string;
  reference: string;
  requestType: "access" | "recovery";
  to: string;
  username: string;
}

export interface CredentialNotificationResult {
  body: string;
  error?: string;
  from: string;
  mailtoUrl: string;
  status: "sent" | "not_configured" | "failed";
  subject: string;
  to: string;
}

function getAdminEmail(): string {
  return process.env.ADMIN_EMAIL?.trim() || process.env.EMAIL_FROM?.trim() || DEFAULT_ADMIN_EMAIL;
}

function getSmtpConfig():
  | {
      from: string;
      host: string;
      password: string;
      port: number;
      username: string;
    }
  | null {
  const username = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASS?.trim();
  if (!username || !password) {
    return null;
  }

  return {
    from: process.env.SMTP_FROM?.trim() || process.env.EMAIL_FROM?.trim() || username,
    host: process.env.SMTP_HOST?.trim() || "smtp.gmail.com",
    password,
    port: Number(process.env.SMTP_PORT || 465),
    username,
  };
}

function buildCredentialEmail(input: CredentialEmailInput): {
  body: string;
  subject: string;
} {
  const greeting = input.fullName?.trim() ? `Hello ${input.fullName.trim()},` : "Hello,";
  const reason =
    input.requestType === "access"
      ? "Your access request has been approved."
      : "Your login credentials have been recovered.";
  const subject =
    input.requestType === "access"
      ? `ABUAD Log Analysis access approved (${input.reference})`
      : `ABUAD Log Analysis credentials recovered (${input.reference})`;

  return {
    subject,
    body: `${greeting}

${reason}

Reference: ${input.reference}
Username: ${input.username}
Password: ${input.password}

Sign in at https://log-analysis-system.netlify.app/login

Regards,
ABUAD Log Analysis Admin`,
  };
}

function buildMailtoUrl(input: {
  body: string;
  from: string;
  subject: string;
  to: string;
}): string {
  const params = new URLSearchParams({
    subject: input.subject,
    body: `${input.body}\n\nSender: ${input.from}`,
  });

  return `mailto:${encodeURIComponent(input.to)}?${params.toString()}`;
}

function escapeSmtpData(value: string): string {
  return value
    .replace(/\r?\n/g, "\r\n")
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

function encodeHeader(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) {
    return value;
  }

  return `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

function buildSmtpMessage(input: {
  body: string;
  from: string;
  subject: string;
  to: string;
}): string {
  return [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    input.body,
  ].join("\r\n");
}

async function readSmtpResponse(socket: TLSSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const lastLine = lines.at(-1);
      if (lastLine && /^\d{3}\s/.test(lastLine)) {
        cleanup();
        resolve(buffer);
      }
    };

    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function sendCommand(socket: TLSSocket, command: string, expected: number[]): Promise<string> {
  socket.write(`${command}\r\n`);
  const response = await readSmtpResponse(socket);
  const code = Number(response.slice(0, 3));
  if (!expected.includes(code)) {
    throw new Error(`SMTP command failed (${code}): ${response.trim()}`);
  }
  return response;
}

async function sendViaSmtp(input: {
  body: string;
  from: string;
  host: string;
  password: string;
  port: number;
  subject: string;
  to: string;
  username: string;
}): Promise<void> {
  const socket = await new Promise<TLSSocket>((resolve, reject) => {
    const connection = connect({
      host: input.host,
      port: input.port,
      servername: input.host,
    });

    connection.once("secureConnect", () => resolve(connection));
    connection.once("error", reject);
  });

  try {
    const greeting = await readSmtpResponse(socket);
    if (!greeting.startsWith("220")) {
      throw new Error(`SMTP greeting failed: ${greeting.trim()}`);
    }

    await sendCommand(socket, "EHLO log-analysis-system.netlify.app", [250]);
    await sendCommand(socket, "AUTH LOGIN", [334]);
    await sendCommand(socket, Buffer.from(input.username).toString("base64"), [334]);
    await sendCommand(socket, Buffer.from(input.password).toString("base64"), [235]);
    await sendCommand(socket, `MAIL FROM:<${input.from}>`, [250]);
    await sendCommand(socket, `RCPT TO:<${input.to}>`, [250, 251]);
    await sendCommand(socket, "DATA", [354]);
    await sendCommand(
      socket,
      `${escapeSmtpData(
        buildSmtpMessage({
          body: input.body,
          from: input.from,
          subject: input.subject,
          to: input.to,
        }),
      )}\r\n.`,
      [250],
    );
    await sendCommand(socket, "QUIT", [221]);
  } finally {
    socket.destroy();
  }
}

export async function sendCredentialEmail(
  input: CredentialEmailInput,
): Promise<CredentialNotificationResult> {
  const adminEmail = getAdminEmail();
  const email = buildCredentialEmail(input);
  const smtpConfig = getSmtpConfig();
  const from = smtpConfig?.from || adminEmail;
  const baseResult = {
    body: email.body,
    from,
    mailtoUrl: buildMailtoUrl({
      body: email.body,
      from,
      subject: email.subject,
      to: input.to,
    }),
    subject: email.subject,
    to: input.to,
  };

  if (!smtpConfig) {
    return {
      ...baseResult,
      status: "not_configured",
    };
  }

  try {
    await sendViaSmtp({
      ...smtpConfig,
      body: email.body,
      subject: email.subject,
      to: input.to,
    });

    return {
      ...baseResult,
      from: smtpConfig.from,
      status: "sent",
    };
  } catch (error) {
    return {
      ...baseResult,
      error: error instanceof Error ? error.message : String(error),
      status: "failed",
    };
  }
}
