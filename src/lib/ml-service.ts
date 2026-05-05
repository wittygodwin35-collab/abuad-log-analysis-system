import type {
  EvaluationMetrics,
  MlAnomaly,
  ParsedEntry,
  TemplateSummary,
} from '@/lib/pipeline-types';

export interface MlAnalyzeResponse {
  logType?: string | null;
  parsedEntries: ParsedEntry[];
  templatesSummary: TemplateSummary[];
  mlAnomalies: MlAnomaly[];
  meta?: Record<string, unknown>;
}

export interface MlTrainResponse {
  success: boolean;
  trainedSamples: number;
  modelVersion: string;
  trainedAt: string;
}

export interface MlEvaluateResponse {
  success: boolean;
  metrics: EvaluationMetrics;
  templatesSummary: TemplateSummary[];
  evaluatedAt: string;
}

type AvailabilityResponse<T> = {
  available: boolean;
  data?: T;
  error?: string;
  status?: number;
};

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://127.0.0.1:8001';
const REQUEST_TIMEOUT_MS = 20000;

async function fetchMl<T>(
  path: string,
  init?: RequestInit,
): Promise<AvailabilityResponse<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${ML_SERVICE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let detail = errorText || response.statusText;
      try {
        const parsed = JSON.parse(errorText) as { detail?: unknown; error?: unknown };
        detail =
          typeof parsed.detail === 'string'
            ? parsed.detail
            : typeof parsed.error === 'string'
              ? parsed.error
              : detail;
      } catch {
        // Keep raw response text when the service did not return JSON.
      }
      return {
        available: true,
        status: response.status,
        error: `ML service error (${response.status}): ${detail}`,
      };
    }

    const data = (await response.json()) as T;
    return { available: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown ML service error';
    return { available: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkMlHealth(): Promise<AvailabilityResponse<Record<string, unknown>>> {
  return fetchMl<Record<string, unknown>>('/health', {
    method: 'GET',
  });
}

export async function analyzeWithMl(payload: {
  content: string;
  logType?: string;
  source: string;
  logFileId?: string;
}): Promise<AvailabilityResponse<MlAnalyzeResponse>> {
  return fetchMl<MlAnalyzeResponse>('/analyze', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function trainMlModel(payload: {
  normalLogDir?: string;
  maxSamples?: number;
}): Promise<AvailabilityResponse<MlTrainResponse>> {
  return fetchMl<MlTrainResponse>('/train', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function runMlEvaluation(payload: {
  datasetDir: string;
  sampleMin?: number;
  sampleMax?: number;
}): Promise<AvailabilityResponse<MlEvaluateResponse>> {
  return fetchMl<MlEvaluateResponse>('/evaluate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
