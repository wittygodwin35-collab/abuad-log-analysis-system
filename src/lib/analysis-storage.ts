import { db } from '@/lib/db';
import { runHybridAnalysis, type LogSource } from '@/lib/hybrid-analysis';
import type { PipelineMetadata } from '@/lib/pipeline-types';

interface Summary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

function buildSummary(severities: string[]): Summary {
  return {
    total: severities.length,
    critical: severities.filter((s) => s === 'critical').length,
    high: severities.filter((s) => s === 'high').length,
    medium: severities.filter((s) => s === 'medium').length,
    low: severities.filter((s) => s === 'low').length,
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

export async function createAndAnalyzeLogFile(input: {
  originalName: string;
  fileSize: number;
  content: string;
  source: LogSource;
}): Promise<{
  logFile: unknown;
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
  logFile: unknown;
  summary: Summary;
  pipeline: PipelineMetadata;
}> {
  const logFile = await db.logFile.findUnique({
    where: { id: input.id },
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

    await db.suspiciousActivity.deleteMany({
      where: { logFileId: logFile.id },
    });

    await db.parsedLogEntry.deleteMany({
      where: { logFileId: logFile.id },
    });

    if (hybrid.mergedActivities.length > 0) {
      await db.suspiciousActivity.createMany({
        data: hybrid.mergedActivities.map((activity) => ({
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
    }

    if (hybrid.parsedEntries.length > 0) {
      await db.parsedLogEntry.createMany({
        data: hybrid.parsedEntries.map((entry) => ({
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
    }

    const pipeline: PipelineMetadata = {
      templatesGenerated: hybrid.templatesSummary.length,
      mlAnomalyCount: hybrid.mlAnomalyCount,
      mlServiceStatus: hybrid.mlServiceStatus,
      mlServiceError: hybrid.mlServiceError,
      templatesSummary: hybrid.templatesSummary,
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

    const result = await db.logFile.findUnique({
      where: { id: logFile.id },
      include: {
        activities: {
          orderBy: {
            createdAt: 'desc',
          },
        },
        parsedEntries: {
          orderBy: {
            lineNumber: 'asc',
          },
        },
      },
    });

    if (!result) {
      throw new Error('Log file disappeared after analysis');
    }

    const summary = buildSummary(result.activities.map((a) => a.severity));
    return { logFile: result, summary, pipeline };
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
