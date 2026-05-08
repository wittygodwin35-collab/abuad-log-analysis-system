export interface ParsedEntry {
  id?: string;
  lineNumber: number;
  timestamp?: string | null;
  source?: string | null;
  rawLine: string;
  normalizedText: string;
  tokens?: string[];
  templateId?: string | null;
  templateText?: string | null;
  anomalyScore?: number | null;
  anomalyFlag?: boolean;
  detector?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface TemplateSummary {
  templateId?: string | null;
  templateText?: string | null;
  count: number;
}

export interface MlAnomaly {
  lineNumber: number;
  timestamp?: string | null;
  source?: string | null;
  rawLine: string;
  templateId?: string | null;
  templateText?: string | null;
  anomalyScore: number;
  anomalyFlag: boolean;
  detector: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
}

export interface PipelineMetadata {
  templatesGenerated: number;
  mlAnomalyCount: number;
  mlServiceStatus: 'available' | 'unavailable';
  mlServiceError: string | null;
  templatesSummary: TemplateSummary[];
  activityCount?: number;
  activitySummary?: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  activitiesTruncated?: boolean;
  parsedEntryCount?: number;
  parsedEntriesTruncated?: boolean;
  privacy?: {
    mode: 'sanitized';
    fieldsRedacted: string[];
    replacements: {
      ipAddresses: number;
      usernames: number;
      emails: number;
      hostnames: number;
    };
  };
  ruleSummary?: {
    normalizedEntries: number;
    correlatedAlerts: number;
    logTypes: string[];
  };
}

export interface CollectorStatus {
  availabilityMessage: string | null;
  available: boolean;
  lastRunAt: string | null;
  status: string;
  filesScanned: number;
  linesIngested: number;
  logFilesCreated: number;
  lastError: string | null;
}

export interface EvaluationMetrics {
  datasetDir: string;
  availableSamples: number;
  sampleCount: number;
  sampleWindowTarget: {
    min: number;
    max: number;
  };
  templateCount: number;
  anomalyCount: number;
  anomalyRate: number;
  scoreQuantiles: Record<string, number | null>;
  ruleHitCounts?: Record<string, number>;
  ruleSampleCount?: number;
  modelMeta?: {
    bootstrapModel?: boolean;
    contamination: number;
    modelVersion: string;
    normalLogDir: string;
    trainedAt: string;
    trainedSamples: number;
  };
  labelledSampleCount?: number;
  classificationReport?: Array<{
    label: string;
    precision: number;
    recall: number;
    f1Score: number;
    support: number;
  }>;
  classConfusionMatrix?: Record<string, Record<string, number>>;
  classLabels?: string[];
  confidenceCurve?: Array<{
    f1Score: number;
    precision: number;
    recall: number;
    threshold: number;
  }>;
  multiclassAccuracy?: number;
  precisionRecallCurve?: Array<{
    precision: number;
    recall: number;
    threshold: number;
  }>;
  rocCurve?: Array<{
    falsePositiveRate: number;
    threshold: number;
    truePositiveRate: number;
  }>;
  thresholds?: Record<string, number>;
  confusionMatrix?: {
    truePositive: number;
    falsePositive: number;
    falseNegative: number;
    trueNegative: number;
    accuracy: number;
    precision: number;
    recall: number;
    f1Score: number;
  };
}
