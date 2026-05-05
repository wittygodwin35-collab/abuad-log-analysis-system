export interface LogPrivacyMetadata {
  mode: 'sanitized';
  fieldsRedacted: string[];
  replacements: {
    ipAddresses: number;
    usernames: number;
    emails: number;
    hostnames: number;
  };
}

export interface SanitizedLogContent {
  content: string;
  metadata: LogPrivacyMetadata;
}

function replaceWithStableTokens(
  input: string,
  pattern: RegExp,
  prefix: string,
): { output: string; count: number } {
  const seen = new Map<string, string>();
  let sequence = 0;

  const output = input.replace(pattern, (match: string) => {
    const key = match.toLowerCase();
    const existing = seen.get(key);
    if (existing) return existing;

    sequence += 1;
    const token = `<${prefix}_${sequence}>`;
    seen.set(key, token);
    return token;
  });

  return { output, count: seen.size };
}

export function sanitizeLogContentForAi(content: string): SanitizedLogContent {
  const emailResult = replaceWithStableTokens(
    content,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    'EMAIL',
  );
  const ipResult = replaceWithStableTokens(
    emailResult.output,
    /\b\d{1,3}(?:\.\d{1,3}){3}\b/g,
    'IP',
  );
  const hostResult = replaceWithStableTokens(
    ipResult.output,
    /\b(?:host|server|node|web|db)-?[A-Za-z0-9_-]*\b/gi,
    'HOST',
  );

  const userPatterns = [
    /\bFailed password for (?:invalid user )?([A-Za-z0-9._-]{2,64})/gi,
    /\bAccepted \S+ for ([A-Za-z0-9._-]{2,64})/gi,
    /\binvalid user\s+([A-Za-z0-9._-]{2,64})/gi,
    /\buser=([A-Za-z0-9._-]{2,64})/gi,
    /\bsudo:\s+([A-Za-z0-9._-]{2,64})\s+:/gi,
  ];
  let output = hostResult.output;
  const usernames = new Map<string, string>();
  let usernameSequence = 0;

  for (const pattern of userPatterns) {
    output = output.replace(pattern, (match: string, username: string) => {
      const key = username.toLowerCase();
      let token = usernames.get(key);
      if (!token) {
        usernameSequence += 1;
        token = `<USER_${usernameSequence}>`;
        usernames.set(key, token);
      }

      return match.replace(username, token);
    });
  }

  return {
    content: output,
    metadata: {
      mode: 'sanitized',
      fieldsRedacted: ['ip_addresses', 'usernames', 'emails', 'hostnames'],
      replacements: {
        ipAddresses: ipResult.count,
        usernames: usernames.size,
        emails: emailResult.count,
        hostnames: hostResult.count,
      },
    },
  };
}
