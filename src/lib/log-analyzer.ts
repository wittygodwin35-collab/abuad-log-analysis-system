// Log Analysis Utility for Detecting Suspicious Activities
// Based on the ABUAD research design: normalize, classify, correlate, and score.

export type LogType = 'auth' | 'syslog' | 'web_access' | 'web_error' | 'mixed';
export type AtomicLogType = Exclude<LogType, 'mixed'>;
export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type ActivityType =
  | 'failed_login'
  | 'brute_force'
  | 'privilege_escalation'
  | 'unauthorized_access'
  | 'web_attack'
  | 'reconnaissance'
  | 'data_exfiltration'
  | 'multi_step_attack'
  | 'anomaly'
  | 'suspicious_ip';

export interface ParsedLogEntry {
  timestamp: string;
  source: string;
  message: string;
  raw: string;
  metadata?: Record<string, string>;
}

export interface NormalizedLogEntry {
  lineNumber: number;
  logType: AtomicLogType;
  timestamp: string;
  timestampMs: number | null;
  sourceIp: string | null;
  username: string | null;
  eventType: string;
  message: string;
  raw: string;
  method?: string;
  path?: string;
  statusCode?: number;
  userAgent?: string;
  metadata: Record<string, string>;
}

export interface SuspiciousActivity {
  activityType: ActivityType;
  severity: Severity;
  timestamp: string;
  sourceIp: string | null;
  username: string | null;
  description: string;
  rawLog: string;
  metadata: Record<string, string> | null;
}

const ANALYSIS_THRESHOLDS = {
  bruteForceAttempts: 5,
  bruteForceWindowSeconds: 60,
  reconnaissanceRequests: 8,
  reconnaissanceWindowSeconds: 120,
};

const IPV4 = String.raw`\d{1,3}(?:\.\d{1,3}){3}`;

const LOG_PATTERNS = {
  authLog: {
    timestamp: /^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/,
    failedLogin: new RegExp(
      String.raw`Failed password for (invalid user )?(\S+) from (${IPV4})`,
      'i',
    ),
    successfulLogin: new RegExp(
      String.raw`Accepted \S+ for (\S+) from (${IPV4})`,
      'i',
    ),
    privilegeEscalation:
      /sudo:\s+(\S+)\s*:\s*TTY=\S+\s*;\s*PWD=([^;]+)\s*;\s*USER=([^;]+)\s*;\s*COMMAND=(.+)/i,
    sshConnection: /sshd\[\d+\]:\s+(.+)/i,
    invalidUser: new RegExp(String.raw`Invalid user (\S+) from (${IPV4})`, 'i'),
    authenticationFailure: new RegExp(
      String.raw`authentication failure.*(?:rhost=|from\s+)(${IPV4}).*(?:user=|for\s+)(\S+)`,
      'i',
    ),
  },
  syslog: {
    timestamp: /^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/,
    error: /error|critical|fatal|emergency|panic/i,
    warning: /warning|warn/i,
    kernel: /kernel:/i,
    service: /(\w+)\[\d+\]:/,
  },
  webAccess: {
    access: new RegExp(
      String.raw`^(${IPV4})\s+\S+\s+(\S+)\s+\[([^\]]+)\]\s+"(\S+)\s+(.*?)\s+HTTP\/[\d.]+"\s+(\d{3})\s+(\d+|-)(?:\s+"([^"]*)"\s+"([^"]*)")?`,
    ),
    suspiciousUserAgent:
      /sqlmap|nikto|nmap|masscan|dirbuster|gobuster|wfuzz|burp|zap|acunetix|nessus/i,
    sqlInjection:
      /union(?:\s+|\+|%20)*select|select.+from|information_schema|or(?:\s+|\+|%20)+1=1|sleep\(|benchmark\(|%27|'|--/i,
    pathTraversal: /\.\.\/|%2e%2e|%2fetc%2fpasswd|\/etc\/passwd|win\.ini/i,
    xss: /<script|%3cscript|onerror=|javascript:/i,
    shellProbe: /(?:cmd|exec|shell)=|webshell|c99|r57|\/uploads\/.*\.php/i,
    sensitiveProbe:
      /\.env|\.git|wp-admin|phpmyadmin|\/admin\b|config|backup|\.sql\b|\.bak\b/i,
    exfiltrationProbe: /\/(?:download|export|backup|dump|db)\b|\.tar\.gz|\.zip/i,
  },
  webError: {
    timestamp: /^\[([^\]]+)\]/,
    error: /\[error\]|\[crit\]|\[emerg\]|\[warn\]/i,
    client: new RegExp(String.raw`client:\s+(${IPV4})`, 'i'),
    message: /(?:error|crit|emerg|warn):\s*(.+)/i,
  },
};

const SUSPICIOUS_IPS = new Set([
  '192.168.1.100',
]);

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function parseSyslogTimestamp(value: string | undefined): { timestamp: string; ms: number | null } {
  if (!value) return { timestamp: '', ms: null };
  const match = value.match(/^(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return { timestamp: value, ms: null };

  const [, monthName, day, hour, minute, second] = match;
  const month = MONTHS[monthName.toLowerCase()];
  if (month === undefined) return { timestamp: value, ms: null };

  const now = new Date();
  const parsed = new Date(Date.UTC(
    now.getUTCFullYear(),
    month,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  ));

  return { timestamp: parsed.toISOString(), ms: parsed.getTime() };
}

function parseApacheTimestamp(value: string | undefined): { timestamp: string; ms: number | null } {
  if (!value) return { timestamp: '', ms: null };
  const match = value.match(
    /^(\d{1,2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s+([+-]\d{4})$/,
  );
  if (!match) return { timestamp: value, ms: null };

  const [, day, monthName, year, hour, minute, second, offset] = match;
  const month = MONTHS[monthName.toLowerCase()];
  if (month === undefined) return { timestamp: value, ms: null };

  const offsetIso = `${offset.slice(0, 3)}:${offset.slice(3)}`;
  const iso = `${year}-${String(month + 1).padStart(2, '0')}-${day.padStart(2, '0')}T${hour}:${minute}:${second}${offsetIso}`;
  const parsed = new Date(iso);

  if (Number.isNaN(parsed.getTime())) return { timestamp: value, ms: null };
  return { timestamp: parsed.toISOString(), ms: parsed.getTime() };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function classifyWebEvent(path: string, statusCode: number, userAgent: string): string {
  const decodedPath = safeDecode(path);
  const combined = `${path} ${decodedPath} ${userAgent}`;

  if (LOG_PATTERNS.webAccess.sqlInjection.test(combined)) return 'SQL_INJECTION';
  if (LOG_PATTERNS.webAccess.pathTraversal.test(combined)) return 'PATH_TRAVERSAL';
  if (LOG_PATTERNS.webAccess.xss.test(combined)) return 'XSS';
  if (LOG_PATTERNS.webAccess.shellProbe.test(combined)) return 'WEB_SHELL_PROBE';
  if (LOG_PATTERNS.webAccess.suspiciousUserAgent.test(userAgent)) return 'SCANNER_TRAFFIC';
  if (LOG_PATTERNS.webAccess.sensitiveProbe.test(combined)) return 'RECONNAISSANCE';
  if (LOG_PATTERNS.webAccess.exfiltrationProbe.test(combined)) return 'DATA_EXFILTRATION_PROBE';
  if (statusCode === 401 || statusCode === 403) return 'HTTP_UNAUTHORIZED';
  if (statusCode === 404) return 'HTTP_NOT_FOUND';
  if (statusCode >= 500) return 'HTTP_SERVER_ERROR';
  return 'WEB_REQUEST';
}

function detectLineLogType(line: string): AtomicLogType {
  if (
    LOG_PATTERNS.authLog.failedLogin.test(line) ||
    LOG_PATTERNS.authLog.successfulLogin.test(line) ||
    LOG_PATTERNS.authLog.privilegeEscalation.test(line) ||
    LOG_PATTERNS.authLog.invalidUser.test(line) ||
    LOG_PATTERNS.authLog.authenticationFailure.test(line) ||
    LOG_PATTERNS.authLog.sshConnection.test(line)
  ) {
    return 'auth';
  }

  if (LOG_PATTERNS.webAccess.access.test(line)) {
    return 'web_access';
  }

  if (LOG_PATTERNS.webError.timestamp.test(line) && LOG_PATTERNS.webError.error.test(line)) {
    return 'web_error';
  }

  return 'syslog';
}

function normalizeAuthLine(line: string, lineNumber: number): NormalizedLogEntry {
  const timestamp = parseSyslogTimestamp(line.match(LOG_PATTERNS.authLog.timestamp)?.[1]);
  const metadata: Record<string, string> = {};

  const failed = line.match(LOG_PATTERNS.authLog.failedLogin);
  if (failed) {
    const username = failed[2];
    const sourceIp = failed[3];
    const unknownUser = Boolean(failed[1]);
    metadata.unknownUser = String(unknownUser);
    metadata.authOutcome = 'failed';

    return {
      lineNumber,
      logType: 'auth',
      timestamp: timestamp.timestamp,
      timestampMs: timestamp.ms,
      sourceIp,
      username,
      eventType: 'LOGIN_FAILURE',
      message: `Failed login for ${unknownUser ? 'unknown user' : 'user'} ${username}`,
      raw: line,
      metadata,
    };
  }

  const invalid = line.match(LOG_PATTERNS.authLog.invalidUser);
  if (invalid) {
    return {
      lineNumber,
      logType: 'auth',
      timestamp: timestamp.timestamp,
      timestampMs: timestamp.ms,
      sourceIp: invalid[2],
      username: invalid[1],
      eventType: 'LOGIN_FAILURE',
      message: `Invalid user login attempt for ${invalid[1]}`,
      raw: line,
      metadata: {
        unknownUser: 'true',
        authOutcome: 'failed',
      },
    };
  }

  const accepted = line.match(LOG_PATTERNS.authLog.successfulLogin);
  if (accepted) {
    const username = accepted[1];
    return {
      lineNumber,
      logType: 'auth',
      timestamp: timestamp.timestamp,
      timestampMs: timestamp.ms,
      sourceIp: accepted[2],
      username,
      eventType: username === 'root' ? 'ROOT_LOGIN' : 'LOGIN_SUCCESS',
      message: username === 'root' ? 'Direct root login accepted' : `Successful login for ${username}`,
      raw: line,
      metadata: {
        authOutcome: 'accepted',
      },
    };
  }

  const sudo = line.match(LOG_PATTERNS.authLog.privilegeEscalation);
  if (sudo) {
    const [, user, pwd, targetUser, command] = sudo;
    return {
      lineNumber,
      logType: 'auth',
      timestamp: timestamp.timestamp,
      timestampMs: timestamp.ms,
      sourceIp: null,
      username: user,
      eventType: 'PRIVILEGE_ESCALATION',
      message: `Sudo command executed by ${user}: ${command}`,
      raw: line,
      metadata: {
        user,
        targetUser: targetUser.trim(),
        pwd: pwd.trim(),
        command: command.trim(),
      },
    };
  }

  const authFailure = line.match(LOG_PATTERNS.authLog.authenticationFailure);
  if (authFailure) {
    return {
      lineNumber,
      logType: 'auth',
      timestamp: timestamp.timestamp,
      timestampMs: timestamp.ms,
      sourceIp: authFailure[1],
      username: authFailure[2],
      eventType: 'LOGIN_FAILURE',
      message: `Authentication failure for ${authFailure[2]}`,
      raw: line,
      metadata: {
        unknownUser: 'false',
        authOutcome: 'failed',
      },
    };
  }

  return {
    lineNumber,
    logType: 'auth',
    timestamp: timestamp.timestamp,
    timestampMs: timestamp.ms,
    sourceIp: null,
    username: null,
    eventType: 'AUTH_EVENT',
    message: line,
    raw: line,
    metadata,
  };
}

function normalizeWebAccessLine(line: string, lineNumber: number): NormalizedLogEntry {
  const match = line.match(LOG_PATTERNS.webAccess.access);
  if (!match) {
    return normalizeSyslogLine(line, lineNumber);
  }

  const [, sourceIp, user, rawTimestamp, method, path, statusCodeRaw, size, referer = '', userAgent = ''] = match;
  const timestamp = parseApacheTimestamp(rawTimestamp);
  const statusCode = Number(statusCodeRaw);
  const eventType = classifyWebEvent(path, statusCode, userAgent);

  return {
    lineNumber,
    logType: 'web_access',
    timestamp: timestamp.timestamp,
    timestampMs: timestamp.ms,
    sourceIp,
    username: user === '-' ? null : user,
    eventType,
    message: `${method} ${path} returned ${statusCode}`,
    raw: line,
    method,
    path,
    statusCode,
    userAgent,
    metadata: {
      size,
      referer,
      decodedPath: safeDecode(path),
    },
  };
}

function normalizeWebErrorLine(line: string, lineNumber: number): NormalizedLogEntry {
  const rawTimestamp = line.match(LOG_PATTERNS.webError.timestamp)?.[1];
  const timestamp = rawTimestamp
    ? { timestamp: rawTimestamp, ms: Date.parse(rawTimestamp) || null }
    : { timestamp: '', ms: null };
  const client = line.match(LOG_PATTERNS.webError.client)?.[1] || null;
  const message = line.match(LOG_PATTERNS.webError.message)?.[1] || line;

  return {
    lineNumber,
    logType: 'web_error',
    timestamp: timestamp.timestamp,
    timestampMs: timestamp.ms,
    sourceIp: client,
    username: null,
    eventType: LOG_PATTERNS.webError.error.test(line) ? 'WEB_SERVER_ERROR' : 'WEB_ERROR_EVENT',
    message,
    raw: line,
    metadata: {},
  };
}

function normalizeSyslogLine(line: string, lineNumber: number): NormalizedLogEntry {
  const timestamp = parseSyslogTimestamp(line.match(LOG_PATTERNS.syslog.timestamp)?.[1]);
  let eventType = 'SYSTEM_EVENT';
  if (LOG_PATTERNS.syslog.kernel.test(line) && /Out of memory|segfault|killed process|panic/i.test(line)) {
    eventType = 'KERNEL_FAILURE';
  } else if (LOG_PATTERNS.syslog.error.test(line)) {
    eventType = 'SERVICE_ERROR';
  } else if (LOG_PATTERNS.syslog.warning.test(line)) {
    eventType = 'SERVICE_WARNING';
  }

  return {
    lineNumber,
    logType: 'syslog',
    timestamp: timestamp.timestamp,
    timestampMs: timestamp.ms,
    sourceIp: line.match(new RegExp(IPV4))?.[0] || null,
    username: null,
    eventType,
    message: line,
    raw: line,
    metadata: {},
  };
}

export function normalizeLogContent(content: string): NormalizedLogEntry[] {
  return content
    .split('\n')
    .map((line, index) => ({ line: line.trimEnd(), lineNumber: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, lineNumber }) => {
      const logType = detectLineLogType(line);
      switch (logType) {
        case 'auth':
          return normalizeAuthLine(line, lineNumber);
        case 'web_access':
          return normalizeWebAccessLine(line, lineNumber);
        case 'web_error':
          return normalizeWebErrorLine(line, lineNumber);
        case 'syslog':
        default:
          return normalizeSyslogLine(line, lineNumber);
      }
    });
}

export function detectLogType(content: string): LogType {
  const types = new Set(normalizeLogContent(content).map((entry) => entry.logType));
  if (types.size === 0) return 'syslog';
  if (types.size === 1) return [...types][0];
  return 'mixed';
}

function activityMetadata(entry: NormalizedLogEntry, extra?: Record<string, string>): Record<string, string> {
  return {
    lineNumber: String(entry.lineNumber),
    eventType: entry.eventType,
    logType: entry.logType,
    ...(entry.method ? { method: entry.method } : {}),
    ...(entry.path ? { path: entry.path } : {}),
    ...(entry.statusCode ? { statusCode: String(entry.statusCode) } : {}),
    ...(entry.userAgent ? { userAgent: entry.userAgent } : {}),
    ...entry.metadata,
    ...(extra || {}),
  };
}

function buildSignatureActivities(entries: NormalizedLogEntry[]): SuspiciousActivity[] {
  const activities: SuspiciousActivity[] = [];
  const suspiciousCommands = /chmod\s+777|rm\s+-rf\s+\/|passwd|useradd|userdel|visudo|nc\s+-e|curl\s+.*\|\s*sh/i;

  for (const entry of entries) {
    if (entry.eventType === 'LOGIN_FAILURE') {
      const unknownUser = entry.metadata.unknownUser === 'true';
      activities.push({
        activityType: 'failed_login',
        severity: unknownUser ? 'high' : 'medium',
        timestamp: entry.timestamp,
        sourceIp: entry.sourceIp,
        username: entry.username,
        description: unknownUser
          ? `Unknown user login attempt for "${entry.username}" from ${entry.sourceIp || 'unknown source'}`
          : `Failed login attempt for "${entry.username}" from ${entry.sourceIp || 'unknown source'}`,
        rawLog: entry.raw,
        metadata: activityMetadata(entry),
      });
    }

    if (entry.eventType === 'ROOT_LOGIN') {
      activities.push({
        activityType: 'unauthorized_access',
        severity: 'critical',
        timestamp: entry.timestamp,
        sourceIp: entry.sourceIp,
        username: 'root',
        description: `Direct root login detected from ${entry.sourceIp || 'unknown source'}`,
        rawLog: entry.raw,
        metadata: activityMetadata(entry),
      });
    }

    if (entry.eventType === 'PRIVILEGE_ESCALATION') {
      const command = entry.metadata.command || '';
      activities.push({
        activityType: 'privilege_escalation',
        severity: suspiciousCommands.test(command) ? 'critical' : 'medium',
        timestamp: entry.timestamp,
        sourceIp: entry.sourceIp,
        username: entry.username,
        description: `User "${entry.username}" executed elevated command: ${command}`,
        rawLog: entry.raw,
        metadata: activityMetadata(entry),
      });
    }

    if (['SQL_INJECTION', 'PATH_TRAVERSAL', 'XSS', 'WEB_SHELL_PROBE'].includes(entry.eventType)) {
      const severity: Severity = entry.eventType === 'WEB_SHELL_PROBE' ? 'critical' : 'high';
      activities.push({
        activityType: 'web_attack',
        severity,
        timestamp: entry.timestamp,
        sourceIp: entry.sourceIp,
        username: entry.username,
        description: `${entry.eventType.replace(/_/g, ' ').toLowerCase()} attempt: ${entry.method || ''} ${entry.path || ''}`.trim(),
        rawLog: entry.raw,
        metadata: activityMetadata(entry),
      });
    }

    if (entry.eventType === 'DATA_EXFILTRATION_PROBE') {
      activities.push({
        activityType: 'data_exfiltration',
        severity: 'high',
        timestamp: entry.timestamp,
        sourceIp: entry.sourceIp,
        username: entry.username,
        description: `Possible data exfiltration probe: ${entry.method || ''} ${entry.path || ''}`.trim(),
        rawLog: entry.raw,
        metadata: activityMetadata(entry),
      });
    }

    if (entry.eventType === 'SCANNER_TRAFFIC' || entry.eventType === 'RECONNAISSANCE') {
      activities.push({
        activityType: 'reconnaissance',
        severity: entry.eventType === 'SCANNER_TRAFFIC' ? 'high' : 'medium',
        timestamp: entry.timestamp,
        sourceIp: entry.sourceIp,
        username: entry.username,
        description: `Reconnaissance indicator from ${entry.sourceIp || 'unknown source'}: ${entry.path || entry.userAgent || entry.message}`,
        rawLog: entry.raw,
        metadata: activityMetadata(entry),
      });
    }

    if (entry.eventType === 'HTTP_UNAUTHORIZED') {
      activities.push({
        activityType: 'unauthorized_access',
        severity: 'medium',
        timestamp: entry.timestamp,
        sourceIp: entry.sourceIp,
        username: entry.username,
        description: `Unauthorized web request (${entry.statusCode}): ${entry.method || ''} ${entry.path || ''}`.trim(),
        rawLog: entry.raw,
        metadata: activityMetadata(entry),
      });
    }

    if (entry.eventType === 'HTTP_SERVER_ERROR' || entry.eventType === 'WEB_SERVER_ERROR') {
      activities.push({
        activityType: 'anomaly',
        severity: 'high',
        timestamp: entry.timestamp,
        sourceIp: entry.sourceIp,
        username: entry.username,
        description: `Server-side error observed: ${entry.message.substring(0, 140)}`,
        rawLog: entry.raw,
        metadata: activityMetadata(entry),
      });
    }

    if (entry.eventType === 'KERNEL_FAILURE' || entry.eventType === 'SERVICE_ERROR') {
      activities.push({
        activityType: 'anomaly',
        severity: entry.eventType === 'KERNEL_FAILURE' ? 'critical' : 'high',
        timestamp: entry.timestamp,
        sourceIp: entry.sourceIp,
        username: entry.username,
        description: `System anomaly detected: ${entry.message.substring(0, 140)}`,
        rawLog: entry.raw,
        metadata: activityMetadata(entry),
      });
    }
  }

  return activities;
}

function hasWindowThreshold(
  entries: NormalizedLogEntry[],
  threshold: number,
  windowSeconds: number,
): boolean {
  const timed = entries
    .filter((entry) => typeof entry.timestampMs === 'number')
    .sort((a, b) => Number(a.timestampMs) - Number(b.timestampMs));

  if (timed.length < threshold) {
    return entries.length >= threshold;
  }

  let start = 0;
  for (let end = 0; end < timed.length; end += 1) {
    while (
      start < end &&
      Number(timed[end].timestampMs) - Number(timed[start].timestampMs) > windowSeconds * 1000
    ) {
      start += 1;
    }
    if (end - start + 1 >= threshold) {
      return true;
    }
  }

  return false;
}

function buildBehavioralActivities(entries: NormalizedLogEntry[]): SuspiciousActivity[] {
  const activities: SuspiciousActivity[] = [];
  const failuresByIp = new Map<string, NormalizedLogEntry[]>();
  const webMissesByIp = new Map<string, NormalizedLogEntry[]>();

  for (const entry of entries) {
    if (!entry.sourceIp) continue;

    if (entry.eventType === 'LOGIN_FAILURE') {
      failuresByIp.set(entry.sourceIp, [...(failuresByIp.get(entry.sourceIp) || []), entry]);
    }

    if (entry.eventType === 'HTTP_NOT_FOUND' || entry.eventType === 'RECONNAISSANCE') {
      webMissesByIp.set(entry.sourceIp, [...(webMissesByIp.get(entry.sourceIp) || []), entry]);
    }
  }

  for (const [ip, failures] of failuresByIp) {
    if (
      !hasWindowThreshold(
        failures,
        ANALYSIS_THRESHOLDS.bruteForceAttempts,
        ANALYSIS_THRESHOLDS.bruteForceWindowSeconds,
      )
    ) {
      continue;
    }

    const usernames = [...new Set(failures.map((entry) => entry.username).filter(Boolean))];
    const last = failures[failures.length - 1];
    activities.push({
      activityType: 'brute_force',
      severity: failures.length >= 10 ? 'critical' : 'high',
      timestamp: last.timestamp,
      sourceIp: ip,
      username: null,
      description: `Brute force pattern detected: ${failures.length} failed login attempts from ${ip}`,
      rawLog: failures.map((entry) => entry.raw).join('\n'),
      metadata: {
        detector: 'behavioural_threshold',
        attemptCount: String(failures.length),
        threshold: String(ANALYSIS_THRESHOLDS.bruteForceAttempts),
        timeWindowSeconds: String(ANALYSIS_THRESHOLDS.bruteForceWindowSeconds),
        targetedUsers: usernames.join(','),
      },
    });
  }

  for (const [ip, misses] of webMissesByIp) {
    if (
      !hasWindowThreshold(
        misses,
        ANALYSIS_THRESHOLDS.reconnaissanceRequests,
        ANALYSIS_THRESHOLDS.reconnaissanceWindowSeconds,
      )
    ) {
      continue;
    }

    const last = misses[misses.length - 1];
    activities.push({
      activityType: 'reconnaissance',
      severity: 'high',
      timestamp: last.timestamp,
      sourceIp: ip,
      username: null,
      description: `Reconnaissance burst detected: ${misses.length} probe-like web requests from ${ip}`,
      rawLog: misses.map((entry) => entry.raw).join('\n'),
      metadata: {
        detector: 'behavioural_threshold',
        requestCount: String(misses.length),
        threshold: String(ANALYSIS_THRESHOLDS.reconnaissanceRequests),
        timeWindowSeconds: String(ANALYSIS_THRESHOLDS.reconnaissanceWindowSeconds),
      },
    });
  }

  return activities;
}

function buildCorrelationActivities(
  entries: NormalizedLogEntry[],
  activities: SuspiciousActivity[],
): SuspiciousActivity[] {
  const linuxThreatIps = new Set(
    activities
      .filter((activity) =>
        ['failed_login', 'brute_force', 'privilege_escalation', 'unauthorized_access'].includes(
          activity.activityType,
        ),
      )
      .map((activity) => activity.sourceIp)
      .filter((ip): ip is string => Boolean(ip)),
  );
  const webThreatIps = new Set(
    activities
      .filter((activity) =>
        ['web_attack', 'reconnaissance', 'data_exfiltration'].includes(activity.activityType),
      )
      .map((activity) => activity.sourceIp)
      .filter((ip): ip is string => Boolean(ip)),
  );

  const correlated: SuspiciousActivity[] = [];
  for (const ip of webThreatIps) {
    if (!linuxThreatIps.has(ip)) continue;
    const related = entries.filter((entry) => entry.sourceIp === ip);
    const first = related[0];
    const eventTypes = [...new Set(related.map((entry) => entry.eventType))].join(',');
    correlated.push({
      activityType: 'multi_step_attack',
      severity: 'critical',
      timestamp: first?.timestamp || '',
      sourceIp: ip,
      username: null,
      description: `Cross-layer attack story detected for ${ip}: web probing and Linux authentication events are linked`,
      rawLog: related.map((entry) => entry.raw).join('\n'),
      metadata: {
        detector: 'log_correlation',
        eventTypes,
        relatedEvents: String(related.length),
      },
    });
  }

  return correlated;
}

function applyThreatIntel(activities: SuspiciousActivity[]): SuspiciousActivity[] {
  return activities.map((activity) => {
    if (!activity.sourceIp || !SUSPICIOUS_IPS.has(activity.sourceIp)) {
      return activity;
    }

    return {
      ...activity,
      severity: 'critical',
      description: `${activity.description} [KNOWN SUSPICIOUS IP]`,
      metadata: {
        ...(activity.metadata || {}),
        threatIntel: 'known_suspicious_ip',
      },
    };
  });
}

export function analyzeLogContent(content: string): {
  logType: LogType;
  activities: SuspiciousActivity[];
  normalizedEntries: NormalizedLogEntry[];
} {
  const normalizedEntries = normalizeLogContent(content);
  const types = new Set(normalizedEntries.map((entry) => entry.logType));
  const logType: LogType = types.size === 1 ? [...types][0] : types.size > 1 ? 'mixed' : 'syslog';

  const signatureActivities = buildSignatureActivities(normalizedEntries);
  const behavioralActivities = buildBehavioralActivities(normalizedEntries);
  const activitiesBeforeCorrelation = [...signatureActivities, ...behavioralActivities];
  const correlationActivities = buildCorrelationActivities(normalizedEntries, activitiesBeforeCorrelation);

  return {
    logType,
    activities: applyThreatIntel([...activitiesBeforeCorrelation, ...correlationActivities]),
    normalizedEntries,
  };
}

export function generateSampleLog(type: 'auth' | 'web_access' | 'syslog' | 'mixed'): string {
  const samples = {
    auth: `Jan 15 08:23:45 server sshd[12345]: Failed password for invalid user admin from 192.168.1.50 port 22
Jan 15 08:23:46 server sshd[12345]: Failed password for invalid user admin from 192.168.1.50 port 22
Jan 15 08:23:47 server sshd[12345]: Failed password for invalid user admin from 192.168.1.50 port 22
Jan 15 08:23:48 server sshd[12345]: Failed password for invalid user root from 192.168.1.50 port 22
Jan 15 08:23:49 server sshd[12345]: Failed password for invalid user root from 192.168.1.50 port 22
Jan 15 08:24:01 server sshd[12346]: Accepted password for john from 192.168.1.100 port 22
Jan 15 08:25:30 server sudo: john : TTY=pts/0 ; PWD=/home/john ; USER=root ; COMMAND=/bin/bash
Jan 15 08:26:15 server sshd[12347]: Failed password for invalid user test from 10.0.0.55 port 22
Jan 15 08:27:00 server sshd[12348]: Accepted password for root from 203.0.113.50 port 22`,

    web_access: `192.168.1.100 - - [15/Jan/2025:08:00:00 +0000] "GET /index.html HTTP/1.1" 200 1234 "-" "Mozilla/5.0"
192.168.1.50 - - [15/Jan/2025:08:00:01 +0000] "GET /../../../etc/passwd HTTP/1.1" 403 512 "-" "sqlmap/1.5"
192.168.1.50 - - [15/Jan/2025:08:00:02 +0000] "GET /admin/config.php HTTP/1.1" 403 256 "-" "sqlmap/1.5"
10.0.0.55 - admin [15/Jan/2025:08:01:00 +0000] "POST /wp-login.php HTTP/1.1" 200 1024 "-" "Nikto/2.1.6"
10.0.0.55 - - [15/Jan/2025:08:01:01 +0000] "GET /.env HTTP/1.1" 404 128 "-" "Nikto/2.1.6"
203.0.113.50 - - [15/Jan/2025:08:02:00 +0000] "GET /api/users?select=* FROM users-- HTTP/1.1" 400 64 "-" "Mozilla/5.0"`,

    syslog: `Jan 15 08:00:00 server kernel: [12345.678901] Out of memory: Killed process 5678 (java)
Jan 15 08:01:00 server systemd[1]: Started Session 123 of user root.
Jan 15 08:02:00 server CRON[1234]: (root) CMD (/usr/local/bin/backup.sh)
Jan 15 08:03:00 server kernel: [12400.123456] segfault at 7f8901234567 ip 00007f89abcdef sp 00007ffe12345678 error 4 in python3[12345+67890]
Jan 15 08:04:00 server sshd[12345]: error: PAM: Authentication failure for john from 192.168.1.50`,

    mixed: `192.168.1.50 - - [15/Jan/2025:08:00:01 +0000] "GET /../../../etc/passwd HTTP/1.1" 403 512 "-" "sqlmap/1.5"
Jan 15 08:23:45 server sshd[12345]: Failed password for invalid user admin from 192.168.1.50 port 22
Jan 15 08:23:46 server sshd[12345]: Failed password for invalid user root from 192.168.1.50 port 22
Jan 15 08:23:47 server sshd[12345]: Failed password for invalid user test from 192.168.1.50 port 22
Jan 15 08:23:48 server sshd[12345]: Failed password for invalid user demo from 192.168.1.50 port 22
Jan 15 08:23:49 server sshd[12345]: Failed password for invalid user guest from 192.168.1.50 port 22`,
  };

  return samples[type];
}
