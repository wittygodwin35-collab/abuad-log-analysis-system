import { readdir, readFile, stat } from 'fs/promises';
import { extname, join } from 'path';
import { analyzeLogContent, getAnalysisThresholds, type SuspiciousActivity } from '@/lib/log-analyzer';

const SUPPORTED_EXTENSIONS = new Set(['.log', '.txt', '.json']);
const LABEL_FILE_PATTERN = /\.(?:labels|truth)\.(?:jsonl|ndjson)$/i;

export type EvaluationTruthLabel =
  | 'safe'
  | 'failed_login'
  | 'brute_force'
  | 'privilege_escalation'
  | 'unauthorized_access'
  | 'sql_injection'
  | 'path_traversal'
  | 'xss'
  | 'web_shell_probe'
  | 'reconnaissance'
  | 'data_exfiltration'
  | 'multi_step_attack'
  | 'anomaly'
  | 'suspicious_ip';

export interface ConfusionMatrixCounts {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
}

export interface ConfusionMatrixMetrics extends ConfusionMatrixCounts {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
}

export interface ClassificationReportRow {
  label: string;
  precision: number;
  recall: number;
  f1Score: number;
  support: number;
}

export interface PrecisionRecallPoint {
  precision: number;
  recall: number;
  threshold: number;
}

export interface RocPoint {
  falsePositiveRate: number;
  threshold: number;
  truePositiveRate: number;
}

export interface ConfidenceCurvePoint {
  f1Score: number;
  precision: number;
  recall: number;
  threshold: number;
}

export interface LabelledEvaluationRecord {
  label: EvaluationTruthLabel;
  line: string;
}

export interface LabelledEvaluationMetrics {
  labelledSampleCount: number;
  classConfusionMatrix: Record<string, Record<string, number>>;
  classLabels: string[];
  classificationReport: ClassificationReportRow[];
  confidenceCurve: ConfidenceCurvePoint[];
  confusionMatrix: ConfusionMatrixMetrics;
  multiclassAccuracy: number;
  precisionRecallCurve: PrecisionRecallPoint[];
  rocCurve: RocPoint[];
  thresholds: ReturnType<typeof getAnalysisThresholds>;
}

function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function calculateConfusionMatrixMetrics(
  counts: ConfusionMatrixCounts,
): ConfusionMatrixMetrics {
  const truePositive = Math.max(0, counts.truePositive || 0);
  const falsePositive = Math.max(0, counts.falsePositive || 0);
  const falseNegative = Math.max(0, counts.falseNegative || 0);
  const trueNegative = Math.max(0, counts.trueNegative || 0);
  const total = truePositive + falsePositive + falseNegative + trueNegative;
  const precision = safeDivide(truePositive, truePositive + falsePositive);
  const recall = safeDivide(truePositive, truePositive + falseNegative);

  return {
    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,
    accuracy: safeDivide(truePositive + trueNegative, total),
    precision,
    recall,
    f1Score: safeDivide(2 * precision * recall, precision + recall),
  };
}

function countRuleHits(content: string): Record<string, number> {
  const { activities } = analyzeLogContent(content);
  const counts: Record<string, number> = {};
  for (const activity of activities) {
    counts[activity.activityType] = (counts[activity.activityType] || 0) + 1;
  }
  return counts;
}

function linesFromContent(content: string, sampleMax?: number): string[] {
  const lines: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    lines.push(trimmed);
    if (sampleMax && lines.length >= sampleMax) {
      break;
    }
  }

  return lines;
}

function normalizeTruthLabel(value: unknown): EvaluationTruthLabel | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) {
    return null;
  }

  if (['normal', 'benign', 'clean', 'safe_traffic'].includes(normalized)) {
    return 'safe';
  }

  if (['sqli', 'sql_injection_attack'].includes(normalized)) {
    return 'sql_injection';
  }

  if (['traversal', 'directory_traversal'].includes(normalized)) {
    return 'path_traversal';
  }

  if (['exfiltration', 'data_exfiltration_probe'].includes(normalized)) {
    return 'data_exfiltration';
  }

  if (
    [
      'safe',
      'failed_login',
      'brute_force',
      'privilege_escalation',
      'unauthorized_access',
      'sql_injection',
      'path_traversal',
      'xss',
      'web_shell_probe',
      'reconnaissance',
      'data_exfiltration',
      'multi_step_attack',
      'anomaly',
      'suspicious_ip',
    ].includes(normalized)
  ) {
    return normalized as EvaluationTruthLabel;
  }

  return null;
}

function isThreatLabel(label: EvaluationTruthLabel): boolean {
  return label !== 'safe';
}

function classifyActivity(activity: SuspiciousActivity): EvaluationTruthLabel {
  const eventType = activity.metadata?.eventType?.toUpperCase();

  if (activity.activityType === 'web_attack') {
    if (eventType === 'SQL_INJECTION') return 'sql_injection';
    if (eventType === 'PATH_TRAVERSAL') return 'path_traversal';
    if (eventType === 'XSS') return 'xss';
    if (eventType === 'WEB_SHELL_PROBE') return 'web_shell_probe';
  }

  if (activity.activityType === 'data_exfiltration') {
    return 'data_exfiltration';
  }

  return activity.activityType as EvaluationTruthLabel;
}

function predictionPriority(label: EvaluationTruthLabel): number {
  switch (label) {
    case 'multi_step_attack':
      return 90;
    case 'brute_force':
      return 85;
    case 'sql_injection':
    case 'path_traversal':
    case 'xss':
    case 'web_shell_probe':
      return 80;
    case 'data_exfiltration':
      return 75;
    case 'privilege_escalation':
    case 'unauthorized_access':
      return 70;
    case 'reconnaissance':
    case 'suspicious_ip':
      return 65;
    case 'failed_login':
      return 55;
    case 'anomaly':
      return 50;
    case 'safe':
    default:
      return 0;
  }
}

function predictionConfidence(label: EvaluationTruthLabel): number {
  if (label === 'safe') {
    return 0.02;
  }
  return predictionPriority(label) / 100;
}

function getActivityLineNumbers(
  activity: SuspiciousActivity,
  rawLineIndex: Map<string, number[]>,
): number[] {
  const explicitLineNumber = activity.metadata?.lineNumber
    ? Number(activity.metadata.lineNumber)
    : null;
  if (explicitLineNumber && Number.isInteger(explicitLineNumber)) {
    return [explicitLineNumber];
  }

  const lineNumbers = new Set<number>();
  for (const rawLine of activity.rawLog.split(/\r?\n/)) {
    const trimmed = rawLine.trimEnd();
    const matches = rawLineIndex.get(trimmed);
    if (!matches) {
      continue;
    }

    for (const lineNumber of matches) {
      lineNumbers.add(lineNumber);
    }
  }

  return [...lineNumbers];
}

function parseLabelRecord(raw: string): LabelledEvaluationRecord | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = JSON.parse(trimmed) as {
    label?: unknown;
    line?: unknown;
    rawLine?: unknown;
  };
  const label = normalizeTruthLabel(parsed.label);
  const line = typeof parsed.line === 'string' ? parsed.line : parsed.rawLine;

  if (!label || typeof line !== 'string' || !line.trim()) {
    return null;
  }

  return {
    label,
    line: line.trimEnd(),
  };
}

async function collectLabelFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const target = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectLabelFiles(target)));
      continue;
    }

    if (entry.isFile() && LABEL_FILE_PATTERN.test(entry.name)) {
      files.push(target);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

export async function collectLabelledEvaluationRecords(
  datasetDir: string,
): Promise<LabelledEvaluationRecord[]> {
  const root = await stat(datasetDir).catch(() => null);
  if (!root?.isDirectory()) {
    return [];
  }

  const records: LabelledEvaluationRecord[] = [];
  for (const file of await collectLabelFiles(datasetDir)) {
    const content = await readFile(file, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      try {
        const record = parseLabelRecord(line);
        if (record) {
          records.push(record);
        }
      } catch {
        continue;
      }
    }
  }

  return records;
}

function collectLabelledEvaluationRecordsFromContent(
  datasetContent: string,
): LabelledEvaluationRecord[] {
  const records: LabelledEvaluationRecord[] = [];
  for (const line of datasetContent.split(/\r?\n/)) {
    try {
      const record = parseLabelRecord(line);
      if (record) {
        records.push(record);
      }
    } catch {
      continue;
    }
  }
  return records;
}

function buildClassificationReport(input: {
  classConfusionMatrix: Record<string, Record<string, number>>;
  classLabels: string[];
}): ClassificationReportRow[] {
  return input.classLabels.map((label) => {
    const truePositive = input.classConfusionMatrix[label]?.[label] || 0;
    const falsePositive = input.classLabels.reduce((sum, actual) => {
      return actual === label ? sum : sum + (input.classConfusionMatrix[actual]?.[label] || 0);
    }, 0);
    const falseNegative = input.classLabels.reduce((sum, predicted) => {
      return predicted === label ? sum : sum + (input.classConfusionMatrix[label]?.[predicted] || 0);
    }, 0);
    const support = input.classLabels.reduce((sum, predicted) => {
      return sum + (input.classConfusionMatrix[label]?.[predicted] || 0);
    }, 0);
    const precision = safeDivide(truePositive, truePositive + falsePositive);
    const recall = safeDivide(truePositive, truePositive + falseNegative);

    return {
      f1Score: safeDivide(2 * precision * recall, precision + recall),
      label,
      precision,
      recall,
      support,
    };
  });
}

function buildThresholdCurveMetrics(input: {
  actualThreats: boolean[];
  confidenceScores: number[];
}): {
  confidenceCurve: ConfidenceCurvePoint[];
  precisionRecallCurve: PrecisionRecallPoint[];
  rocCurve: RocPoint[];
} {
  const thresholdSet = new Set<number>([0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
  for (const score of input.confidenceScores) {
    thresholdSet.add(Number(score.toFixed(3)));
  }

  const thresholds = [...thresholdSet].sort((left, right) => left - right);
  const confidenceCurve: ConfidenceCurvePoint[] = [];
  const precisionRecallCurve: PrecisionRecallPoint[] = [];
  const rocCurve: RocPoint[] = [];

  for (const threshold of thresholds) {
    const counts: ConfusionMatrixCounts = {
      falseNegative: 0,
      falsePositive: 0,
      trueNegative: 0,
      truePositive: 0,
    };

    for (let index = 0; index < input.actualThreats.length; index += 1) {
      const actualThreat = input.actualThreats[index];
      const predictedThreat = input.confidenceScores[index] >= threshold;

      if (actualThreat && predictedThreat) counts.truePositive += 1;
      if (!actualThreat && predictedThreat) counts.falsePositive += 1;
      if (actualThreat && !predictedThreat) counts.falseNegative += 1;
      if (!actualThreat && !predictedThreat) counts.trueNegative += 1;
    }

    const metrics = calculateConfusionMatrixMetrics(counts);
    confidenceCurve.push({
      f1Score: metrics.f1Score,
      precision: metrics.precision,
      recall: metrics.recall,
      threshold,
    });
    precisionRecallCurve.push({
      precision: metrics.precision,
      recall: metrics.recall,
      threshold,
    });
    rocCurve.push({
      falsePositiveRate: safeDivide(counts.falsePositive, counts.falsePositive + counts.trueNegative),
      threshold,
      truePositiveRate: metrics.recall,
    });
  }

  return {
    confidenceCurve,
    precisionRecallCurve,
    rocCurve,
  };
}

export async function buildLabelledEvaluationMetrics(input: {
  datasetContent?: string;
  datasetDir?: string;
}): Promise<LabelledEvaluationMetrics | null> {
  const records =
    typeof input.datasetContent === 'string'
      ? collectLabelledEvaluationRecordsFromContent(input.datasetContent)
      : input.datasetDir
        ? await collectLabelledEvaluationRecords(input.datasetDir)
        : [];
  if (!records.length) {
    return null;
  }

  const content = records.map((record) => record.line).join('\n');
  const analysis = analyzeLogContent(content);
  const rawLineIndex = new Map<string, number[]>();
  records.forEach((record, index) => {
    const lineNumber = index + 1;
    const bucket = rawLineIndex.get(record.line) || [];
    bucket.push(lineNumber);
    rawLineIndex.set(record.line, bucket);
  });

  const predictions: EvaluationTruthLabel[] = records.map(() => 'safe');
  const confidenceScores = records.map(() => predictionConfidence('safe'));
  const priorities = records.map(() => 0);

  for (const activity of analysis.activities) {
    const predictedLabel = classifyActivity(activity);
    const priority = predictionPriority(predictedLabel);
    const confidence = predictionConfidence(predictedLabel);
    for (const lineNumber of getActivityLineNumbers(activity, rawLineIndex)) {
      const index = lineNumber - 1;
      if (index < 0 || index >= predictions.length || priority < priorities[index]) {
        continue;
      }
      predictions[index] = predictedLabel;
      confidenceScores[index] = confidence;
      priorities[index] = priority;
    }
  }

  const counts: ConfusionMatrixCounts = {
    falseNegative: 0,
    falsePositive: 0,
    trueNegative: 0,
    truePositive: 0,
  };
  const labels = new Set<EvaluationTruthLabel>(['safe']);
  const classConfusionMatrix: Record<string, Record<string, number>> = {};
  let classCorrect = 0;

  records.forEach((record, index) => {
    const actual = record.label;
    const predicted = predictions[index];
    labels.add(actual);
    labels.add(predicted);

    classConfusionMatrix[actual] = classConfusionMatrix[actual] || {};
    classConfusionMatrix[actual][predicted] =
      (classConfusionMatrix[actual][predicted] || 0) + 1;

    if (actual === predicted) {
      classCorrect += 1;
    }

    const actualThreat = isThreatLabel(actual);
    const predictedThreat = isThreatLabel(predicted);

    if (actualThreat && predictedThreat) counts.truePositive += 1;
    if (!actualThreat && predictedThreat) counts.falsePositive += 1;
    if (actualThreat && !predictedThreat) counts.falseNegative += 1;
    if (!actualThreat && !predictedThreat) counts.trueNegative += 1;
  });

  const classLabels = [...labels].sort((left, right) => {
    if (left === 'safe') return -1;
    if (right === 'safe') return 1;
    return left.localeCompare(right);
  });

  for (const actual of classLabels) {
    classConfusionMatrix[actual] = classConfusionMatrix[actual] || {};
    for (const predicted of classLabels) {
      classConfusionMatrix[actual][predicted] =
      classConfusionMatrix[actual][predicted] || 0;
    }
  }
  const curves = buildThresholdCurveMetrics({
    actualThreats: records.map((record) => isThreatLabel(record.label)),
    confidenceScores,
  });

  return {
    labelledSampleCount: records.length,
    classConfusionMatrix,
    classLabels,
    classificationReport: buildClassificationReport({
      classConfusionMatrix,
      classLabels,
    }),
    confidenceCurve: curves.confidenceCurve,
    confusionMatrix: calculateConfusionMatrixMetrics(counts),
    multiclassAccuracy: records.length ? classCorrect / records.length : 0,
    precisionRecallCurve: curves.precisionRecallCurve,
    rocCurve: curves.rocCurve,
    thresholds: getAnalysisThresholds(),
  };
}

export async function collectEvaluationSample(input: {
  datasetContent?: string;
  datasetDir?: string;
  sampleMax: number;
}): Promise<string[]> {
  if (typeof input.datasetContent === 'string') {
    return linesFromContent(input.datasetContent, input.sampleMax);
  }

  if (!input.datasetDir) {
    throw new Error('Evaluation dataset directory or content is required.');
  }

  const root = await stat(input.datasetDir).catch(() => null);
  if (!root?.isDirectory()) {
    throw new Error(
      `Evaluation dataset directory does not exist or is not a directory: ${input.datasetDir}`,
    );
  }

  const lines: string[] = [];
  const queue = [input.datasetDir];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    const entries = await readdir(current, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!SUPPORTED_EXTENSIONS.has(extname(fullPath).toLowerCase())) {
        continue;
      }

      const content = await readFile(fullPath, {
        encoding: 'utf-8',
      });
      for (const line of content.split('\n')) {
        if (line.trim()) {
          lines.push(line.trim());
        }
        if (lines.length >= input.sampleMax) {
          return lines;
        }
      }
    }
  }

  return lines;
}

export async function buildRuleHitMetrics(input: {
  datasetContent?: string;
  datasetDir?: string;
  sampleMin?: number;
  sampleMax: number;
}): Promise<{
  sampleCount: number;
  ruleHitCounts: Record<string, number>;
}> {
  const sampledLines = await collectEvaluationSample(input);
  if (input.sampleMin && sampledLines.length < input.sampleMin) {
    throw new Error(
      `Evaluation dataset has ${sampledLines.length} usable log lines, below the requested minimum of ${input.sampleMin}.`,
    );
  }

  const content = sampledLines.join('\n');
  return {
    sampleCount: sampledLines.length,
    ruleHitCounts: countRuleHits(content),
  };
}
