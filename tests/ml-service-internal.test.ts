import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ensureBundledDatasetDir } from '../src/lib/demo-data';

describe.sequential('internal ML service', () => {
  let stateFilePath: string;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'abuad-ml-test-'));
    stateFilePath = join(tempDir, 'ml-model-state.json');
    process.env.ML_SERVICE_MODE = 'internal';
    process.env.ML_STATE_FILE_PATH = stateFilePath;
    vi.resetModules();
  });

  afterEach(async () => {
    const { resetInternalMlRuntimeForTests } = await import('../src/lib/ml-engine');
    resetInternalMlRuntimeForTests();
    delete process.env.ML_STATE_FILE_PATH;
    delete process.env.ML_SERVICE_MODE;
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  });

  it('trains and persists the internal model state', async () => {
    const { trainMlModel } = await import('../src/lib/ml-service');
    const normalLogDir = await ensureBundledDatasetDir('normal');

    const result = await trainMlModel({
      normalLogDir,
    });

    expect(result.available).toBe(true);
    expect(result.data?.success).toBe(true);
    expect(result.data?.trainedSamples).toBeGreaterThanOrEqual(20);
    expect((await stat(stateFilePath)).isFile()).toBe(true);
  });

  it('bootstraps analysis internally without an external ML service', async () => {
    const { analyzeWithMl } = await import('../src/lib/ml-service');

    const result = await analyzeWithMl({
      content:
        'Jan 15 10:00:00 server sshd[9999]: Failed password for invalid user root from 192.168.1.50 port 22',
      logType: 'auth',
      source: 'upload',
    });

    expect(result.available).toBe(true);
    expect(result.data?.parsedEntries).toHaveLength(1);
    expect(result.data?.templatesSummary.length).toBeGreaterThan(0);
  });

  it('runs evaluation against the bundled dataset', async () => {
    const { runMlEvaluation } = await import('../src/lib/ml-service');
    const datasetDir = await ensureBundledDatasetDir('evaluation');

    const result = await runMlEvaluation({
      datasetDir,
      sampleMax: 8,
      sampleMin: 5,
    });

    expect(result.available).toBe(true);
    expect(result.data?.success).toBe(true);
    expect(result.data?.metrics.sampleCount).toBe(8);
    expect(result.data?.metrics.templateCount).toBeGreaterThan(0);
  });
});
