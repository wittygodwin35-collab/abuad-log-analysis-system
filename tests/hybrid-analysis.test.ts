import { describe, expect, it, vi } from 'vitest';
import { generateSampleLog } from '../src/lib/log-analyzer';

vi.mock('@/lib/ml-service', () => ({
  analyzeWithMl: vi.fn(async () => ({
    available: false,
    error: 'connection refused',
  })),
}));

describe('hybrid analysis fallback', () => {
  it('returns rule detections when the ML service is unavailable', async () => {
    const { runHybridAnalysis } = await import('../src/lib/hybrid-analysis');
    const result = await runHybridAnalysis(generateSampleLog('auth'), {
      source: 'upload',
    });

    expect(result.mlServiceStatus).toBe('unavailable');
    expect(result.mlServiceError).toContain('connection refused');
    expect(result.mergedActivities.length).toBeGreaterThan(0);
    expect(result.parsedEntries).toEqual([]);
  });
});
