import { readdir, readFile, stat } from 'fs/promises';
import { extname, join } from 'path';
import { IsolationForest, type DataObject } from 'isolation-forest';
import {
  DEFAULT_NORMAL_LOG_DIR,
  ensureBundledDatasetDir,
  isBundledDatasetPath,
} from '@/lib/demo-data';
import type {
  EvaluationMetrics,
  MlAnomaly,
  ParsedEntry,
  TemplateSummary,
} from '@/lib/pipeline-types';
import {
  getMlStateFilePath,
  getMlStorageBackend,
  loadPersistedMlState,
  savePersistedMlState,
} from '@/lib/ml-storage';

export interface InternalMlAnalyzeResponse {
  logType?: string | null;
  parsedEntries: ParsedEntry[];
  templatesSummary: TemplateSummary[];
  mlAnomalies: MlAnomaly[];
  meta: Record<string, unknown>;
}

export interface InternalMlTrainResponse {
  success: boolean;
  trainedSamples: number;
  modelVersion: string;
  trainedAt: string;
}

export interface InternalMlEvaluateResponse {
  success: boolean;
  metrics: EvaluationMetrics;
  templatesSummary: TemplateSummary[];
  evaluatedAt: string;
}

interface PersistedFeatureEntry {
  idf: number;
  key: string;
  token: string;
}

interface PersistedMlState {
  bootstrapModel?: boolean;
  contamination: number;
  modelVersion: string;
  normalizedTrainingLines: string[];
  normalLogDir: string;
  threshold: number;
  trainedAt: string;
  trainedSamples: number;
  vocabulary: PersistedFeatureEntry[];
  version: 1;
}

interface MlRuntime {
  forest: IsolationForest;
  state: PersistedMlState;
}

type ModelMeta = NonNullable<EvaluationMetrics['modelMeta']>;

interface WorkingTemplate {
  count: number;
  id: string;
  tokens: string[];
}

interface TemplateAssignment {
  templateId: string | null;
  templateText: string | null;
}

const SUPPORTED_DATASET_EXTENSIONS = new Set(['.json', '.log', '.txt']);
const DEFAULT_CONTAMINATION = clampNumber(
  Number.parseFloat(process.env.ISOLATION_FOREST_CONTAMINATION || '0.05'),
  0.001,
  0.4,
);
const MAX_FEATURES = 240;
const MIN_TRAINING_LINES = 20;
const NUMBER_OF_TREES = 100;
const SUBSAMPLING_SIZE = 256;
const TEMPLATE_WILDCARD = '<*>';
const MAX_TEMPLATE_DISTANCE_RATIO = 0.3;

const SYSLOG_TIMESTAMP_RE = /^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/;
const APACHE_TIMESTAMP_RE =
  /\[(\d{1,2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2}:\d{2}\s+[+-]\d{4})\]/;
const ISO_TIMESTAMP_RE =
  /(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/;

const globalForMlRuntime = globalThis as typeof globalThis & {
  __abuadMlRuntime?: MlRuntime | null;
  __abuadMlRuntimePromise?: Promise<MlRuntime | null> | null;
};

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
}

function normalizeText(text: string): string {
  let normalized = text.trim();
  normalized = normalized.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<IP>');
  normalized = normalized.replace(/\b[0-9a-fA-F]{8,}\b/g, '<HEX>');
  normalized = normalized.replace(/\b\d+\b/g, '<NUM>');
  normalized = normalized.replace(/\s+/g, ' ');
  return normalized.toLowerCase();
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[A-Za-z0-9_./:-]+/g) || [];
}

function parseTimestamp(rawLine: string): string | null {
  const isoMatch = ISO_TIMESTAMP_RE.exec(rawLine);
  if (isoMatch?.[1]) {
    const value = isoMatch[1].replace(' ', 'T');
    if (value.endsWith('Z')) {
      return value;
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString();
    }
  }

  const apacheMatch = APACHE_TIMESTAMP_RE.exec(rawLine);
  if (apacheMatch?.[1]) {
    const parsed = new Date(apacheMatch[1].replace(/^(\d{2})\/(\w{3})\//, '$2 $1, '));
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString();
    }
  }

  const syslogMatch = SYSLOG_TIMESTAMP_RE.exec(rawLine);
  if (syslogMatch?.[1]) {
    const parsed = new Date(`${new Date().getUTCFullYear()} ${syslogMatch[1]} UTC`);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString();
    }
  }

  return null;
}

function extractFeatureTokens(normalized: string): string[] {
  const baseTokens = tokenize(normalized);
  const features = [...baseTokens];

  for (let index = 0; index < baseTokens.length - 1; index += 1) {
    features.push(`${baseTokens[index]}__${baseTokens[index + 1]}`);
  }

  return features;
}

function buildVocabulary(normalizedLines: string[]): PersistedFeatureEntry[] {
  const documentFrequency = new Map<string, number>();

  for (const line of normalizedLines) {
    const uniqueTokens = new Set(extractFeatureTokens(line));
    for (const token of uniqueTokens) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    }
  }

  return [...documentFrequency.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, MAX_FEATURES)
    .map(([token, frequency], index) => ({
      idf: Math.log((1 + normalizedLines.length) / (1 + frequency)) + 1,
      key: `f${index}`,
      token,
    }));
}

function vectorizeNormalizedLine(
  normalized: string,
  vocabulary: PersistedFeatureEntry[],
): DataObject {
  const featureTokens = extractFeatureTokens(normalized);
  const counts = new Map<string, number>();

  for (const token of featureTokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  const uniqueTokenCount = new Set(featureTokens).size;
  const totalFeatureCount = Math.max(featureTokens.length, 1);
  const tokenCount = Math.max(tokenize(normalized).length, 1);
  const placeholderMatches = normalized.match(/<(?:ip|num|hex)>/g) || [];
  const slashTokenCount = tokenize(normalized).filter((token) => token.includes('/')).length;

  const vector: DataObject = {
    charLength: normalized.length,
    placeholderRatio: placeholderMatches.length / tokenCount,
    slashTokenRatio: slashTokenCount / tokenCount,
    tokenCount,
    uniqueTokenRatio: uniqueTokenCount / totalFeatureCount,
  };

  for (const entry of vocabulary) {
    const termFrequency = (counts.get(entry.token) || 0) / totalFeatureCount;
    vector[entry.key] = termFrequency * entry.idf;
  }

  return vector;
}

function quantile(values: number[], ratio: number): number {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const position = clampNumber(ratio, 0, 1) * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);

  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }

  const weight = position - lowerIndex;
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}

function buildThreshold(scores: number[], contamination: number): number {
  if (!scores.length) {
    return 0.6;
  }

  const ratio = clampNumber(1 - contamination, 0.5, 0.995);
  return quantile(scores, ratio);
}

function anomalySeverityFromScore(
  score: number,
  threshold: number,
): MlAnomaly['severity'] {
  if (score >= Math.max(threshold + 0.18, 0.8)) {
    return 'critical';
  }
  if (score >= Math.max(threshold + 0.1, 0.7)) {
    return 'high';
  }
  if (score >= Math.max(threshold + 0.04, 0.58)) {
    return 'medium';
  }
  return 'low';
}

async function directoryExists(path: string): Promise<boolean> {
  const fileStat = await stat(path).catch(() => null);
  return Boolean(fileStat?.isDirectory());
}

async function resolveBootstrapNormalLogDir(): Promise<string> {
  const configured = process.env.NORMAL_LOG_DIR?.trim();
  const candidate = configured || DEFAULT_NORMAL_LOG_DIR;

  if (isBundledDatasetPath(candidate, 'normal')) {
    return ensureBundledDatasetDir('normal');
  }

  if (await directoryExists(candidate)) {
    return candidate;
  }

  return ensureBundledDatasetDir('normal');
}

async function collectDatasetFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, {
    withFileTypes: true,
  });
  const files: string[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const target = join(rootDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectDatasetFiles(target)));
      continue;
    }

    if (entry.isFile() && SUPPORTED_DATASET_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(target);
    }
  }

  return files;
}

async function readLinesFromDir(
  directory: string,
  maxSamples?: number,
): Promise<string[]> {
  if (!(await directoryExists(directory))) {
    throw new MlInputError(`Directory does not exist: ${directory}`);
  }

  const files = await collectDatasetFiles(directory);
  const lines: string[] = [];

  for (const file of files) {
    try {
      const content = await readFile(file, 'utf-8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        lines.push(trimmed);
        if (maxSamples && lines.length >= maxSamples) {
          return lines;
        }
      }
    } catch {
      continue;
    }
  }

  return lines;
}

function readLinesFromContent(content: string, maxSamples?: number): string[] {
  const lines: string[] = [];

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    lines.push(trimmed);
    if (maxSamples && lines.length >= maxSamples) {
      break;
    }
  }

  return lines;
}

function mergeTemplateTokens(current: string[], incoming: string[]): string[] {
  return current.map((token, index) => (token === incoming[index] ? token : TEMPLATE_WILDCARD));
}

function templateDistance(current: string[], incoming: string[]): number | null {
  if (current.length !== incoming.length) {
    return null;
  }

  let differences = 0;

  for (let index = 0; index < current.length; index += 1) {
    if (current[index] !== TEMPLATE_WILDCARD && current[index] !== incoming[index]) {
      differences += 1;
    }
  }

  const ratio = differences / Math.max(current.length, 1);
  if (ratio > MAX_TEMPLATE_DISTANCE_RATIO) {
    return null;
  }

  return differences;
}

function assignTemplates(
  normalizedLines: string[],
): {
  assignments: TemplateAssignment[];
  summary: TemplateSummary[];
} {
  const templates: WorkingTemplate[] = [];
  const assignments: TemplateAssignment[] = [];

  for (const normalized of normalizedLines) {
    const tokens = normalized.split(' ').filter(Boolean);

    if (!tokens.length) {
      assignments.push({
        templateId: null,
        templateText: null,
      });
      continue;
    }

    let bestTemplate: WorkingTemplate | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const template of templates) {
      const distance = templateDistance(template.tokens, tokens);
      if (distance === null || distance > bestDistance) {
        continue;
      }
      bestTemplate = template;
      bestDistance = distance;
    }

    if (!bestTemplate) {
      bestTemplate = {
        count: 0,
        id: `tpl-${templates.length + 1}`,
        tokens: [...tokens],
      };
      templates.push(bestTemplate);
    } else {
      bestTemplate.tokens = mergeTemplateTokens(bestTemplate.tokens, tokens);
    }

    bestTemplate.count += 1;
    assignments.push({
      templateId: bestTemplate.id,
      templateText: null,
    });
  }

  const finalTemplateText = new Map<string, string>();
  for (const template of templates) {
    finalTemplateText.set(template.id, template.tokens.join(' '));
  }

  for (const assignment of assignments) {
    if (!assignment.templateId) {
      continue;
    }
    assignment.templateText = finalTemplateText.get(assignment.templateId) || null;
  }

  const summary = templates
    .map<TemplateSummary>((template) => ({
      count: template.count,
      templateId: template.id,
      templateText: finalTemplateText.get(template.id) || null,
    }))
    .sort((left, right) => right.count - left.count);

  return {
    assignments,
    summary,
  };
}

function buildRuntimeFromState(state: PersistedMlState): MlRuntime {
  const forest = new IsolationForest(NUMBER_OF_TREES, SUBSAMPLING_SIZE);
  const vectors = state.normalizedTrainingLines.map((line) =>
    vectorizeNormalizedLine(line, state.vocabulary),
  );
  forest.fit(vectors);
  return {
    forest,
    state,
  };
}

async function persistRuntimeState(state: PersistedMlState): Promise<void> {
  await savePersistedMlState(state);
  globalForMlRuntime.__abuadMlRuntime = buildRuntimeFromState(state);
}

async function trainRuntime(
  normalLogDir: string,
  maxSamples?: number,
  normalLogContent?: string,
  options?: {
    bootstrapModel?: boolean;
  },
): Promise<PersistedMlState> {
  const lines =
    typeof normalLogContent === 'string'
      ? readLinesFromContent(normalLogContent, maxSamples)
      : await readLinesFromDir(normalLogDir, maxSamples);

  if (!lines.length) {
    throw new MlInputError(
      `No usable .log/.txt/.json lines found in normalLogDir: ${normalLogDir}`,
    );
  }

  if (lines.length < MIN_TRAINING_LINES) {
    throw new MlInputError(
      `At least ${MIN_TRAINING_LINES} log lines are required to train the model.`,
    );
  }

  const normalizedTrainingLines = lines
    .map((line) => normalizeText(line))
    .filter(Boolean);
  const vocabulary = buildVocabulary(normalizedTrainingLines);
  const vectors = normalizedTrainingLines.map((line) =>
    vectorizeNormalizedLine(line, vocabulary),
  );

  const forest = new IsolationForest(NUMBER_OF_TREES, SUBSAMPLING_SIZE);
  forest.fit(vectors);
  const scores = forest.scores();
  const trainedAt = new Date().toISOString();

  return {
    bootstrapModel: Boolean(options?.bootstrapModel),
    contamination: DEFAULT_CONTAMINATION,
    modelVersion: `iforest-js-${trainedAt.replace(/[-:.TZ]/g, '').slice(0, 17)}`,
    normalizedTrainingLines,
    normalLogDir,
    threshold: buildThreshold(scores, DEFAULT_CONTAMINATION),
    trainedAt,
    trainedSamples: normalizedTrainingLines.length,
    vocabulary,
    version: 1,
  };
}

async function loadOrBootstrapRuntime(): Promise<MlRuntime | null> {
  if (globalForMlRuntime.__abuadMlRuntime) {
    return globalForMlRuntime.__abuadMlRuntime;
  }

  if (!globalForMlRuntime.__abuadMlRuntimePromise) {
    globalForMlRuntime.__abuadMlRuntimePromise = (async () => {
      const persisted = await loadPersistedMlState<PersistedMlState>();
      if (persisted) {
        const runtime = buildRuntimeFromState(persisted);
        globalForMlRuntime.__abuadMlRuntime = runtime;
        return runtime;
      }

      const bootstrapDir = await resolveBootstrapNormalLogDir();
      const bootstrapState = await trainRuntime(bootstrapDir, undefined, undefined, {
        bootstrapModel: true,
      });
      await persistRuntimeState(bootstrapState);
      return globalForMlRuntime.__abuadMlRuntime || buildRuntimeFromState(bootstrapState);
    })().finally(() => {
      globalForMlRuntime.__abuadMlRuntimePromise = null;
    });
  }

  return globalForMlRuntime.__abuadMlRuntimePromise;
}

function mulberry32(seed: number): () => number {
  return () => {
    let next = (seed += 0x6d2b79f5);
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleWithSeed(lines: string[], maxSamples: number): string[] {
  if (lines.length <= maxSamples) {
    return lines;
  }

  const copy = [...lines];
  const random = mulberry32(42);

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy.slice(0, maxSamples);
}

function buildModelMeta(state: PersistedMlState): ModelMeta {
  return {
    bootstrapModel: Boolean(state.bootstrapModel),
    contamination: state.contamination,
    modelVersion: state.modelVersion,
    normalLogDir: state.normalLogDir,
    trainedAt: state.trainedAt,
    trainedSamples: state.trainedSamples,
  };
}

function analyzeLines(
  lines: string[],
  source: string,
  runtime: MlRuntime | null,
): {
  mlAnomalies: MlAnomaly[];
  parsedEntries: ParsedEntry[];
  templatesSummary: TemplateSummary[];
} {
  const rawEntries: Array<{
    lineNumber: number;
    normalizedText: string;
    rawLine: string;
    source: string;
    timestamp: string | null;
    tokens: string[];
  }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    if (!rawLine.trim()) {
      continue;
    }

    const normalizedText = normalizeText(rawLine);
    rawEntries.push({
      lineNumber: index + 1,
      normalizedText,
      rawLine,
      source,
      timestamp: parseTimestamp(rawLine),
      tokens: tokenize(normalizedText),
    });
  }

  const templateAnalysis = assignTemplates(rawEntries.map((entry) => entry.normalizedText));
  const parsedEntries: ParsedEntry[] = rawEntries.map((entry, index) => ({
    anomalyFlag: false,
    anomalyScore: null,
    detector: null,
    lineNumber: entry.lineNumber,
    metadata: null,
    normalizedText: entry.normalizedText,
    rawLine: entry.rawLine,
    source: entry.source,
    templateId: templateAnalysis.assignments[index]?.templateId || null,
    templateText: templateAnalysis.assignments[index]?.templateText || null,
    timestamp: entry.timestamp,
    tokens: entry.tokens,
  }));

  const mlAnomalies: MlAnomaly[] = [];

  if (runtime && parsedEntries.length) {
    const scores = runtime.forest.predict(
      parsedEntries.map((entry) => vectorizeNormalizedLine(entry.normalizedText, runtime.state.vocabulary)),
    );

    for (let index = 0; index < parsedEntries.length; index += 1) {
      const anomalyScore = Number(scores[index].toFixed(6));
      const anomalyFlag = anomalyScore >= runtime.state.threshold;
      parsedEntries[index].anomalyScore = anomalyScore;
      parsedEntries[index].anomalyFlag = anomalyFlag;
      parsedEntries[index].detector = 'isolation_forest';

      if (!anomalyFlag) {
        continue;
      }

      mlAnomalies.push({
        anomalyFlag,
        anomalyScore,
        detector: 'isolation_forest',
        lineNumber: parsedEntries[index].lineNumber,
        rawLine: parsedEntries[index].rawLine,
        severity: anomalySeverityFromScore(anomalyScore, runtime.state.threshold),
        source: parsedEntries[index].source,
        templateId: parsedEntries[index].templateId,
        templateText: parsedEntries[index].templateText,
        timestamp: parsedEntries[index].timestamp,
      });
    }
  }

  return {
    mlAnomalies,
    parsedEntries,
    templatesSummary: templateAnalysis.summary,
  };
}

export class MlInputError extends Error {
  status = 400;
}

export async function getInternalMlHealth(): Promise<Record<string, unknown>> {
  const persisted = await loadPersistedMlState<PersistedMlState>();
  const runtime = persisted ? buildRuntimeFromState(persisted) : null;

  return {
    modelArtifactsPresent: Boolean(persisted),
    modelLoaded: Boolean(runtime),
    modelMeta: persisted ? buildModelMeta(persisted) : {},
    stateLocation:
      getMlStorageBackend() === 'filesystem' ? getMlStateFilePath() : 'netlify-blobs:abuad-ml-service/model-state',
    storageBackend: getMlStorageBackend(),
    timestamp: new Date().toISOString(),
  };
}

export async function trainInternalMlModel(payload: {
  maxSamples?: number;
  normalLogContent?: string;
  normalLogDir: string;
}): Promise<InternalMlTrainResponse> {
  const state = await trainRuntime(
    payload.normalLogDir,
    payload.maxSamples,
    payload.normalLogContent,
  );
  await persistRuntimeState(state);

  return {
    modelVersion: state.modelVersion,
    success: true,
    trainedAt: state.trainedAt,
    trainedSamples: state.trainedSamples,
  };
}

export async function analyzeWithInternalMl(payload: {
  content: string;
  logFileId?: string;
  logType?: string;
  source: string;
}): Promise<InternalMlAnalyzeResponse> {
  const lines = payload.content.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) {
    throw new MlInputError('No usable log lines were provided for analysis.');
  }

  const runtime = await loadOrBootstrapRuntime();
  const result = analyzeLines(lines, payload.source, runtime);

  return {
    logType: payload.logType || null,
    meta: {
      detector: 'isolation_forest',
      modelMeta: runtime ? buildModelMeta(runtime.state) : {},
      processedLines: result.parsedEntries.length,
      storageBackend: getMlStorageBackend(),
    },
    mlAnomalies: result.mlAnomalies,
    parsedEntries: result.parsedEntries,
    templatesSummary: result.templatesSummary,
  };
}

export async function runInternalMlEvaluation(payload: {
  datasetContent?: string;
  datasetDir: string;
  sampleMax?: number;
  sampleMin?: number;
}): Promise<InternalMlEvaluateResponse> {
  const sampleMin = payload.sampleMin ?? 300;
  const sampleMax = payload.sampleMax ?? 500;

  if (sampleMin <= 0 || sampleMax <= 0 || sampleMin > sampleMax) {
    throw new MlInputError('sampleMin/sampleMax values are invalid.');
  }

  const lines =
    typeof payload.datasetContent === 'string'
      ? readLinesFromContent(payload.datasetContent)
      : await readLinesFromDir(payload.datasetDir);
  if (!lines.length) {
    throw new MlInputError(
      `No usable .log/.txt/.json lines found in datasetDir: ${payload.datasetDir}`,
    );
  }
  if (lines.length < sampleMin) {
    throw new MlInputError(
      `Evaluation dataset has ${lines.length} usable log lines, below the requested minimum of ${sampleMin}.`,
    );
  }

  const sampledLines = sampleWithSeed(lines, sampleMax);
  const runtime = await loadOrBootstrapRuntime();
  const result = analyzeLines(sampledLines, 'evaluation', runtime);
  const scores = result.parsedEntries
    .map((entry) => entry.anomalyScore)
    .filter((score): score is number => typeof score === 'number');

  return {
    evaluatedAt: new Date().toISOString(),
    metrics: {
      anomalyCount: result.mlAnomalies.length,
      anomalyRate: sampledLines.length ? result.mlAnomalies.length / sampledLines.length : 0,
      availableSamples: lines.length,
      datasetDir: payload.datasetDir,
      sampleCount: sampledLines.length,
      sampleWindowTarget: {
        max: sampleMax,
        min: sampleMin,
      },
      modelMeta: runtime ? buildModelMeta(runtime.state) : undefined,
      scoreQuantiles: {
        p25: scores.length ? quantile(scores, 0.25) : null,
        p50: scores.length ? quantile(scores, 0.5) : null,
        p75: scores.length ? quantile(scores, 0.75) : null,
        p95: scores.length ? quantile(scores, 0.95) : null,
      },
      templateCount: result.templatesSummary.length,
    },
    success: true,
    templatesSummary: result.templatesSummary,
  };
}

export function resetInternalMlRuntimeForTests(): void {
  globalForMlRuntime.__abuadMlRuntime = null;
  globalForMlRuntime.__abuadMlRuntimePromise = null;
}
