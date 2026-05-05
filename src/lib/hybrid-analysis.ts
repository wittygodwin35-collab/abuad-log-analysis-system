import {
  analyzeLogContent,
  type SuspiciousActivity,
} from '@/lib/log-analyzer';
import {
  analyzeWithMl,
} from '@/lib/ml-service';
import { sanitizeLogContentForAi, type LogPrivacyMetadata } from '@/lib/privacy';
import type {
  ParsedEntry,
  TemplateSummary,
} from '@/lib/pipeline-types';

export type LogSource = 'upload' | 'collector';

export interface HybridAnalysisResult {
  logType: string;
  mergedActivities: SuspiciousActivity[];
  parsedEntries: ParsedEntry[];
  templatesSummary: TemplateSummary[];
  mlAnomalyCount: number;
  mlServiceStatus: 'available' | 'unavailable';
  mlServiceError: string | null;
  privacy: LogPrivacyMetadata;
  normalizedEntryCount: number;
  correlatedAlertCount: number;
  logTypes: string[];
}

function severityFromScore(score: number): SuspiciousActivity['severity'] {
  if (score >= 0.22) return 'critical';
  if (score >= 0.14) return 'high';
  if (score >= 0.08) return 'medium';
  return 'low';
}

function toMlActivity(anomaly: {
  timestamp?: string | null;
  source?: string | null;
  rawLine: string;
  templateId?: string | null;
  templateText?: string | null;
  anomalyScore: number;
  detector: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
}): SuspiciousActivity {
  const severity = anomaly.severity || severityFromScore(anomaly.anomalyScore);

  return {
    activityType: 'anomaly',
    severity,
    timestamp: anomaly.timestamp || '',
    sourceIp: null,
    username: null,
    description: `Isolation Forest anomaly detected (score: ${anomaly.anomalyScore.toFixed(4)})`,
    rawLog: anomaly.rawLine,
    metadata: {
      detector: anomaly.detector,
      anomalyScore: anomaly.anomalyScore.toString(),
      templateId: anomaly.templateId || '',
      templateText: anomaly.templateText || '',
      source: anomaly.source || '',
    },
  };
}

export async function runHybridAnalysis(
  content: string,
  options: {
    source: LogSource;
    logFileId?: string;
  },
): Promise<HybridAnalysisResult> {
  const ruleResult = analyzeLogContent(content);
  const sanitized = sanitizeLogContentForAi(content);
  const mlResult = await analyzeWithMl({
    content: sanitized.content,
    logType: ruleResult.logType,
    source: options.source,
    logFileId: options.logFileId,
  });
  const logTypes = [...new Set(ruleResult.normalizedEntries.map((entry) => entry.logType))];
  const correlatedAlertCount = ruleResult.activities.filter(
    (activity) => activity.activityType === 'multi_step_attack',
  ).length;

  if (!mlResult.available || !mlResult.data) {
    return {
      logType: ruleResult.logType,
      mergedActivities: ruleResult.activities,
      parsedEntries: [],
      templatesSummary: [],
      mlAnomalyCount: 0,
      mlServiceStatus: 'unavailable',
      mlServiceError: mlResult.error || 'ML service unavailable',
      privacy: sanitized.metadata,
      normalizedEntryCount: ruleResult.normalizedEntries.length,
      correlatedAlertCount,
      logTypes,
    };
  }

  const mlActivities = mlResult.data.mlAnomalies.map((anomaly) =>
    toMlActivity(anomaly),
  );

  return {
    logType: ruleResult.logType,
    mergedActivities: [...ruleResult.activities, ...mlActivities],
    parsedEntries: mlResult.data.parsedEntries,
    templatesSummary: mlResult.data.templatesSummary,
    mlAnomalyCount: mlActivities.length,
    mlServiceStatus: 'available',
    mlServiceError: mlResult.error || null,
    privacy: sanitized.metadata,
    normalizedEntryCount: ruleResult.normalizedEntries.length,
    correlatedAlertCount,
    logTypes,
  };
}
