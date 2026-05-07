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
  labelledSampleCount?: number;
  classConfusionMatrix?: Record<string, Record<string, number>>;
  classLabels?: string[];
  multiclassAccuracy?: number;
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
