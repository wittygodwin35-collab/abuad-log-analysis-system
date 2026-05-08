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

  it('evaluates with the model produced by the latest real-time training request', async () => {
    const { runMlEvaluation, trainMlModel } = await import('../src/lib/ml-service');
    const linuxTrainingContent = Array.from({ length: 30 }, (_, index) => {
      const second = String(index % 60).padStart(2, '0');
      return `Jan 15 08:00:${second} server sshd[${21000 + index}]: Accepted password for analyst from 10.0.0.${10 + (index % 5)} port ${54000 + index} ssh2`;
    }).join('\n');
    const apacheTrainingContent = Array.from({ length: 30 }, (_, index) => {
      const second = String(index % 60).padStart(2, '0');
      return `10.0.0.${10 + (index % 5)} - - [15/Jan/2025:08:00:${second} +0000] "GET /dashboard HTTP/1.1" 200 ${1200 + index} "-" "Mozilla/5.0"`;
    }).join('\n');
    const evaluationContent = apacheTrainingContent;

    const firstTraining = await trainMlModel({
      normalLogContent: linuxTrainingContent,
      normalLogDir: 'Linux_2k.log',
    });
    expect(firstTraining.data?.success).toBe(true);

    const firstEvaluation = await runMlEvaluation({
      datasetContent: evaluationContent,
      datasetDir: 'Apache_2k.log',
      sampleMax: 20,
      sampleMin: 20,
    });
    expect(firstEvaluation.data?.metrics.modelMeta?.normalLogDir).toBe('Linux_2k.log');

    const secondTraining = await trainMlModel({
      normalLogContent: apacheTrainingContent,
      normalLogDir: 'Apache_2k.log',
    });
    expect(secondTraining.data?.success).toBe(true);

    const secondEvaluation = await runMlEvaluation({
      datasetContent: evaluationContent,
      datasetDir: 'Apache_2k.log',
      sampleMax: 20,
      sampleMin: 20,
    });

    expect(secondEvaluation.data?.metrics.modelMeta?.normalLogDir).toBe('Apache_2k.log');
    expect(secondEvaluation.data?.metrics.modelMeta?.modelVersion).toBe(
      secondTraining.data?.modelVersion,
    );
    expect(secondEvaluation.data?.metrics.modelMeta?.modelVersion).not.toBe(
      firstEvaluation.data?.metrics.modelMeta?.modelVersion,
    );
  });
});
