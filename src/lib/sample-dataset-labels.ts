import {
  APACHE_SAMPLE_NAME_ALIASES,
  datasetNameMatches,
  LOGHUB_SAMPLE_NAME_ALIASES,
  SECREPO_AUTH_SAMPLE_NAME_ALIASES,
} from '@/lib/sample-datasets';

export {
  APACHE_SAMPLE_NAME,
  LOGHUB_SAMPLE_NAME,
  SECREPO_AUTH_SAMPLE_NAME,
} from '@/lib/sample-datasets';

type CompanionTruthLabel = 'anomaly' | 'brute_force' | 'failed_login' | 'safe';

export interface CompanionLabelRecord {
  label: CompanionTruthLabel;
  line: string;
}

interface ParsedLoghubLine {
  host: string | null;
  isAlert: boolean;
  isAuthFailure: boolean;
  isInvalidUser: boolean;
  isUnknownUserCheck: boolean;
  line: string;
  pid: string | null;
  timestampMs: number | null;
}

const SYSLOG_MONTH_INDEX: Record<string, number> = {
  Apr: 3,
  Aug: 7,
  Dec: 11,
  Feb: 1,
  Jan: 0,
  Jul: 6,
  Jun: 5,
  Mar: 2,
  May: 4,
  Nov: 10,
  Oct: 9,
  Sep: 8,
};

function parseLoghubTimestamp(line: string): number | null {
  const match = /^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})/.exec(line);
  if (!match) {
    return null;
  }

  const [, monthName, dayText, hourText, minuteText, secondText] = match;
  const month = SYSLOG_MONTH_INDEX[monthName];
  if (month === undefined) {
    return null;
  }

  return Date.UTC(
    2025,
    month,
    Number(dayText),
    Number(hourText),
    Number(minuteText),
    Number(secondText),
  );
}

function parseLoghubLine(line: string): ParsedLoghubLine {
  return {
    host: /rhost=([^\s]+)/.exec(line)?.[1] || /from\s+(\d{1,3}(?:\.\d{1,3}){3})/i.exec(line)?.[1] || null,
    isAlert: /logrotate:\s+ALERT exited abnormally/i.test(line),
    isAuthFailure: /authentication failure/i.test(line),
    isInvalidUser: /Invalid user\s+\S+\s+from\s+\d{1,3}(?:\.\d{1,3}){3}/i.test(line),
    isUnknownUserCheck: /check pass;\s+user unknown/i.test(line),
    line,
    pid: /\[(\d+)\]/.exec(line)?.[1] || null,
    timestampMs: parseLoghubTimestamp(line),
  };
}

function buildLoghubCompanionLabels(datasetContent: string): CompanionLabelRecord[] {
  const parsedLines = datasetContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseLoghubLine);

  const pidContext = new Map<
    string,
    {
      host: string | null;
      timestampMs: number | null;
    }
  >();

  for (const entry of parsedLines) {
    if (!entry.pid) {
      continue;
    }

    const existing = pidContext.get(entry.pid);
    pidContext.set(entry.pid, {
      host: entry.host || existing?.host || null,
      timestampMs: entry.timestampMs ?? existing?.timestampMs ?? null,
    });
  }

  const authAttempts = parsedLines
    .filter((entry) => entry.isAuthFailure || entry.isInvalidUser || entry.isUnknownUserCheck)
    .map((entry, index) => {
      const context = entry.pid ? pidContext.get(entry.pid) : null;
      return {
        hostKey: entry.host || context?.host || `pid:${entry.pid || index}`,
        line: entry.line,
        timestampMs: entry.timestampMs ?? context?.timestampMs ?? index * 1000,
      };
    });

  return parsedLines.map((entry, index) => {
    if (entry.isAlert) {
      return {
        label: 'anomaly',
        line: entry.line,
      };
    }

    if (entry.isAuthFailure || entry.isInvalidUser || entry.isUnknownUserCheck) {
      const context = entry.pid ? pidContext.get(entry.pid) : null;
      const hostKey = entry.host || context?.host || `pid:${entry.pid || index}`;
      const timestampMs = entry.timestampMs ?? context?.timestampMs ?? index * 1000;
      const clusteredAttempts = authAttempts.filter(
        (attempt) =>
          attempt.hostKey === hostKey &&
          Math.abs((attempt.timestampMs || 0) - (timestampMs || 0)) <= 60_000,
      ).length;

      return {
        label: clusteredAttempts >= 5 ? 'brute_force' : 'failed_login',
        line: entry.line,
      };
    }

    return {
      label: 'safe',
      line: entry.line,
    };
  });
}

function buildAuthCompanionLabels(datasetContent: string): CompanionLabelRecord[] {
  return buildLoghubCompanionLabels(datasetContent);
}

function buildApacheCompanionLabels(datasetContent: string): CompanionLabelRecord[] {
  return datasetContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      label: /\[(?:error|crit|emerg|warn)\]/i.test(line) ? 'anomaly' : 'safe',
      line,
    }));
}

export function resolveCompanionLabelsForDataset(input: {
  datasetContent: string;
  datasetName?: string;
}): CompanionLabelRecord[] | null {
  if (datasetNameMatches(input.datasetName, LOGHUB_SAMPLE_NAME_ALIASES)) {
    return buildLoghubCompanionLabels(input.datasetContent);
  }

  if (datasetNameMatches(input.datasetName, APACHE_SAMPLE_NAME_ALIASES)) {
    return buildApacheCompanionLabels(input.datasetContent);
  }

  if (datasetNameMatches(input.datasetName, SECREPO_AUTH_SAMPLE_NAME_ALIASES)) {
    return buildAuthCompanionLabels(input.datasetContent);
  }

  return null;
}
