import { basename } from 'path';
import { access, open, stat } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { db } from '@/lib/db';
import { createAndAnalyzeLogFile } from '@/lib/analysis-storage';

const DEFAULT_LOG_PATHS = [
  '/var/log/auth.log',
  '/var/log/syslog',
  '/var/log/nginx/access.log',
  '/var/log/nginx/error.log',
  '/var/log/apache2/access.log',
  '/var/log/apache2/error.log',
];

function isNetlifyRuntime(): boolean {
  return Boolean(process.env.NETLIFY || process.env.CONTEXT || process.env.SITE_ID);
}

export function getCollectorSupportInfo(): {
  available: boolean;
  availabilityMessage: string | null;
} {
  if (isNetlifyRuntime()) {
    return {
      available: false,
      availabilityMessage:
        'Collector is disabled on hosted Netlify deployments because operating-system log paths are not readable there. Use the Loghub sample, upload a local log file, or self-host the app to collect from live server paths.',
    };
  }

  return {
    available: true,
    availabilityMessage: null,
  };
}

export function getConfiguredCollectorPaths(): string[] {
  const configured = process.env.LOG_COLLECTOR_PATHS;
  if (!configured) {
    return DEFAULT_LOG_PATHS;
  }
  return configured
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

export function countNonEmptyLines(content: string): number {
  if (!content.trim()) return 0;
  return content.split('\n').filter((line) => line.trim().length > 0).length;
}

export function getReadOffset(previousOffset: number, currentSize: number): number {
  if (!Number.isFinite(previousOffset) || previousOffset < 0) {
    return 0;
  }
  return currentSize < previousOffset ? 0 : previousOffset;
}

async function readAppendedContent(filePath: string, offset: number, size: number): Promise<string> {
  const length = size - offset;
  if (length <= 0) {
    return '';
  }

  const file = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, offset);
    return buffer.subarray(0, bytesRead).toString('utf-8');
  } finally {
    await file.close();
  }
}

async function updateOffset(filePath: string, offset: number): Promise<void> {
  await db.collectorOffset.upsert({
    where: { filePath },
    create: {
      filePath,
      offset,
    },
    update: {
      offset,
    },
  });
}

export interface CollectorRunResult {
  success: boolean;
  filesScanned: number;
  linesIngested: number;
  logFilesCreated: number;
  errors: string[];
}

export async function runCollectorCycle(): Promise<CollectorRunResult> {
  const paths = getConfiguredCollectorPaths();
  let filesScanned = 0;
  let linesIngested = 0;
  let logFilesCreated = 0;
  const errors: string[] = [];

  await db.collectorState.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      status: 'running',
      lastRunAt: new Date(),
      filesScanned: 0,
      linesIngested: 0,
      logFilesCreated: 0,
      lastError: null,
    },
    update: {
      status: 'running',
      lastRunAt: new Date(),
      filesScanned: 0,
      linesIngested: 0,
      logFilesCreated: 0,
      lastError: null,
    },
  });

  for (const filePath of paths) {
    try {
      await access(filePath, fsConstants.R_OK);
    } catch {
      continue;
    }

    filesScanned += 1;

    try {
      const fileStat = await stat(filePath);
      const offsetRecord = await db.collectorOffset.findUnique({
        where: { filePath },
      });
      const previousOffset = offsetRecord?.offset ?? 0;
      const currentSize = fileStat.size;
      const readOffset = getReadOffset(previousOffset, currentSize);
      const newContent = await readAppendedContent(filePath, readOffset, currentSize);

      if (!newContent.trim()) {
        await updateOffset(filePath, currentSize);
        continue;
      }

      const ingestedLines = countNonEmptyLines(newContent);
      if (ingestedLines === 0) {
        await updateOffset(filePath, currentSize);
        continue;
      }

      linesIngested += ingestedLines;

      await createAndAnalyzeLogFile({
        originalName: `${basename(filePath)}.collector.log`,
        fileSize: Buffer.byteLength(newContent, 'utf-8'),
        content: newContent,
        source: 'collector',
      });

      await updateOffset(filePath, currentSize);
      logFilesCreated += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${filePath}: ${message}`);
    }
  }

  const success = errors.length === 0;
  const finalStatus = success ? 'completed' : 'error';
  const joinedError = errors.length > 0 ? errors.join(' | ') : null;

  await db.collectorState.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      status: finalStatus,
      lastRunAt: new Date(),
      filesScanned,
      linesIngested,
      logFilesCreated,
      lastError: joinedError,
    },
    update: {
      status: finalStatus,
      lastRunAt: new Date(),
      filesScanned,
      linesIngested,
      logFilesCreated,
      lastError: joinedError,
    },
  });

  return {
    success,
    filesScanned,
    linesIngested,
    logFilesCreated,
    errors,
  };
}

export async function getCollectorStatus(): Promise<{
  availabilityMessage: string | null;
  available: boolean;
  lastRunAt: string | null;
  status: string;
  filesScanned: number;
  linesIngested: number;
  logFilesCreated: number;
  lastError: string | null;
}> {
  const support = getCollectorSupportInfo();
  const state = await db.collectorState.findUnique({
    where: { id: 'default' },
  });

  if (!state) {
    return {
      availabilityMessage: support.availabilityMessage,
      available: support.available,
      lastRunAt: null,
      status: support.available ? 'idle' : 'disabled',
      filesScanned: 0,
      linesIngested: 0,
      logFilesCreated: 0,
      lastError: null,
    };
  }

  return {
    availabilityMessage: support.availabilityMessage,
    available: support.available,
    lastRunAt: state.lastRunAt ? state.lastRunAt.toISOString() : null,
    status: support.available ? state.status : 'disabled',
    filesScanned: state.filesScanned,
    linesIngested: state.linesIngested,
    logFilesCreated: state.logFilesCreated,
    lastError: state.lastError,
  };
}
