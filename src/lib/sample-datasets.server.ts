import { readFile } from 'fs/promises';
import { join } from 'path';
import {
  getPublicSampleDataset,
  type PublicSampleDatasetDefinition,
} from '@/lib/sample-datasets';

export async function readPublicSampleDatasetById(
  sampleDatasetId: PublicSampleDatasetDefinition['id'],
): Promise<{
  absolutePath: string;
  content: string;
  definition: PublicSampleDatasetDefinition;
}> {
  const definition = getPublicSampleDataset(sampleDatasetId);
  if (!definition) {
    throw new Error(`Unsupported sample dataset: ${sampleDatasetId}`);
  }

  const relativeParts = definition.publicPath.replace(/^\/+/, '').split('/');
  const absolutePath = join(process.cwd(), 'public', ...relativeParts);
  const content = await readFile(absolutePath, 'utf-8');

  return {
    absolutePath,
    content,
    definition,
  };
}
