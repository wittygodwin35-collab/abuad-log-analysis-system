import { db } from '@/lib/db';
import { runHybridAnalysis, type LogSource } from '@/lib/hybrid-analysis';
import type { PipelineMetadata } from '@/lib/pipeline-types';

export interface Summary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

const MAX_PERSISTED_ACTIVITIES = 4000;
const MAX_PERSISTED_PARSED_ENTRIES = 4000;
const MAX_RESPONSE_ACTIVITIES = 250;
const MAX_RESPONSE_PARSED_ENTRIES = 200;
const CREATE_BATCH_SIZE = 500;

function buildSummary(severities: string[]): Summary {
  return {
    total: severities.length,
    critical: severities.filter((severity) => severity === 'critical').length,
    high: severities.filter((severity) => severity === 'high').length,
    medium: severities.filter((severity) => severity === 'medium').length,
    low: severities.filter((severity) => severity === 'low').length,
  };
}

function safeJson(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function parsePipelineMetadata(value: string | null): PipelineMetadata | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as PipelineMetadata;
  } catch {
    return null;
  }
}

function limitCollection<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) {
    return items;
  }

  return items.slice(0, limit);
}

async function createManyInBatches<T>(
  items: T[],
  createBatch: (batch: T[]) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < items.length; index += CREATE_BATCH_SIZE) {
    await createBatch(items.slice(index, index + CREATE_BATCH_SIZE));
  }
}

async function fetchLogFileResponseBase(logFileId: string) {
  return db.logFile.findUnique({
    where: { id: logFileId },
    select: {
      id: true,
      filename: true,
      originalName: true,
      fileType: true,
      logSource: true,
      fileSize: true,
      status: true,
      pipelineMetadata: true,
      createdAt: true,
    },
  });
}

async function fetchLogFileActivitiesPreview(logFileId: string, take: number) {
  return db.suspiciousActivity.findMany({
    where: { logFileId },
    orderBy: {
      createdAt: 'desc',
    },
    take,
  });
}

async function fetchLogFileParsedEntriesPreview(logFileId: string, take: number) {
  return db.parsedLogEntry.findMany({
    where: { logFileId },
    orderBy: {
      lineNumber: 'asc',
    },
    take,
  });
}

async function fetchStoredSummary(logFileId: string): Promise<Summary> {
  const groups = await db.suspiciousActivity.groupBy({
    by: ['severity'],
    where: { logFileId },
    _count: {
      _all: true,
    },
  });

  const counts = new Map(groups.map((group) => [group.severity, group._count._all]));
  const total = groups.reduce((sum, group) => sum + group._count._all, 0);

  return {
    total,
    critical: counts.get('critical') || 0,
    high: counts.get('high') || 0,
    medium: counts.get('medium') || 0,
    low: counts.get('low') || 0,
  };
}

function buildLogFileResponse(
  base: NonNullable<Awaited<ReturnType<typeof fetchLogFileResponseBase>>>,
  activities: Awaited<ReturnType<typeof fetchLogFileActivitiesPreview>>,
  parsedEntries: Awaited<ReturnType<typeof fetchLogFileParsedEntriesPreview>>,
  pipelineMetadata: PipelineMetadata | null,
) {
  const activityCount = pipelineMetadata?.activityCount ?? activities.length;
  const parsedEntryCount = pipelineMetadata?.parsedEntryCount ?? parsedEntries.length;

  return {
    ...base,
    activities,
    activityCount,
    activitiesTruncated:
      Boolean(pipelineMetadata?.activitiesTruncated) || activityCount > activities.length,
    parsedEntries,
    parsedEntryCount,
    parsedEntriesTruncated:
      Boolean(pipelineMetadata?.parsedEntriesTruncated) || parsedEntryCount > parsedEntries.length,
  };
}

export async function fetchLogFileResponse(logFileId: string): Promise<{
  logFile: Record<string, unknown>;
  summary: Summary;
  pipeline?: PipelineMetadata;
} | null> {
  const base = await fetchLogFileResponseBase(logFileId);
  if (!base) {
    return null;
  }

  const pipelineMetadata = parsePipelineMetadata(base.pipelineMetadata);
  const [activities, parsedEntries, fallbackSummary] = await Promise.all([
    fetchLogFileActivitiesPreview(logFileId, MAX_RESPONSE_ACTIVITIES),
    fetchLogFileParsedEntriesPreview(logFileId, MAX_RESPONSE_PARSED_ENTRIES),
    pipelineMetadata?.activitySummary ? Promise.resolve(null) : fetchStoredSummary(logFileId),
  ]);

  return {
    logFile: buildLogFileResponse(base, activities, parsedEntries, pipelineMetadata),
    summary: pipelineMetadata?.activitySummary || fallbackSummary || buildSummary([]),
    ...(pipelineMetadata ? { pipeline: pipelineMetadata } : {}),
  };
}

export async function createAndAnalyzeLogFile(input: {
  originalName: string;
  fileSize: number;
  content: string;
  source: LogSource;
}): Promise<{
  logFile: Record<string, unknown>;
  summary: Summary;
  pipeline: PipelineMetadata;
}> {
  const logFile = await db.logFile.create({
    data: {
      filename: `${Date.now()}_${input.originalName}`,
      originalName: input.originalName,
      fileType: 'syslog',
      fileSize: input.fileSize,
      content: input.content,
      logSource: input.source,
      status: 'processing',
    },
  });

  return analyzeExistingLogFile({
    id: logFile.id,
    source: input.source,
  });
}

export async function analyzeExistingLogFile(input: {
  id: string;
  source?: LogSource;
}): Promise<{
  logFile: Record<string, unknown>;
  summary: Summary;
  pipeline: PipelineMetadata;
}> {
  const logFile = await db.logFile.findUnique({
    where: { id: input.id },
    select: {
      id: true,
      content: true,
      logSource: true,
    },
  });

  if (!logFile) {
    throw new Error('Log file not found');
  }

  const source = input.source || (logFile.logSource as LogSource) || 'upload';

  try {
    const hybrid = await runHybridAnalysis(logFile.content, {
      source,
      logFileId: logFile.id,
    });
    const summary = buildSummary(hybrid.mergedActivities.map((activity) => activity.severity));
    const persistedActivities = limitCollection(hybrid.mergedActivities, MAX_PERSISTED_ACTIVITIES);
    const persistedParsedEntries = limitCollection(
      hybrid.parsedEntries,
      MAX_PERSISTED_PARSED_ENTRIES,
    );

    await db.suspiciousActivity.deleteMany({
      where: { logFileId: logFile.id },
    });

    await db.parsedLogEntry.deleteMany({
      where: { logFileId: logFile.id },
    });

    if (persistedActivities.length > 0) {
      await createManyInBatches(persistedActivities, async (batch) => {
        await db.suspiciousActivity.createMany({
          data: batch.map((activity) => ({
            logFileId: logFile.id,
            activityType: activity.activityType,
            severity: activity.severity,
            timestamp: activity.timestamp,
            sourceIp: activity.sourceIp,
            username: activity.username,
            description: activity.description,
            rawLog: activity.rawLog,
            metadata: safeJson(activity.metadata),
          })),
        });
      });
    }

    if (persistedParsedEntries.length > 0) {
      await createManyInBatches(persistedParsedEntries, async (batch) => {
        await db.parsedLogEntry.createMany({
          data: batch.map((entry) => ({
            logFileId: logFile.id,
            lineNumber: entry.lineNumber,
            timestamp: entry.timestamp || null,
            source: entry.source || source,
            rawLine: entry.rawLine,
            normalizedText: entry.normalizedText,
            tokens: safeJson(entry.tokens),
            templateId: entry.templateId || null,
            templateText: entry.templateText || null,
            anomalyScore: entry.anomalyScore ?? null,
            anomalyFlag: Boolean(entry.anomalyFlag),
            detector: entry.detector || null,
            metadata: safeJson(entry.metadata),
          })),
        });
      });
    }

    const pipeline: PipelineMetadata = {
      templatesGenerated: hybrid.templatesSummary.length,
      mlAnomalyCount: hybrid.mlAnomalyCount,
      mlServiceStatus: hybrid.mlServiceStatus,
      mlServiceError: hybrid.mlServiceError,
      templatesSummary: hybrid.templatesSummary,
      activityCount: hybrid.mergedActivities.length,
      activitySummary: summary,
      activitiesTruncated: persistedActivities.length < hybrid.mergedActivities.length,
      parsedEntryCount: hybrid.parsedEntries.length,
      parsedEntriesTruncated: persistedParsedEntries.length < hybrid.parsedEntries.length,
      privacy: hybrid.privacy,
      ruleSummary: {
        normalizedEntries: hybrid.normalizedEntryCount,
        correlatedAlerts: hybrid.correlatedAlertCount,
        logTypes: hybrid.logTypes,
      },
    };

    await db.logFile.update({
      where: { id: logFile.id },
      data: {
        fileType: hybrid.logType,
        status: 'completed',
        logSource: source,
        pipelineMetadata: safeJson(pipeline),
        lastAnalyzedAt: new Date(),
      },
    });

    const response = await fetchLogFileResponse(logFile.id);
    if (!response) {
      throw new Error('Log file disappeared after analysis');
    }

    return {
      logFile: response.logFile,
      summary,
      pipeline,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.logFile.update({
      where: { id: logFile.id },
      data: {
        status: 'error',
        pipelineMetadata: safeJson({ error: message }),
      },
    });
    throw error;
  }
}
