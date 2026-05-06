import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

const NETLIFY_STORE_NAME = 'abuad-ml-service';
const NETLIFY_STATE_KEY = 'model-state';
const DEFAULT_LOCAL_STATE_FILE = join(
  /*turbopackIgnore: true*/ process.cwd(),
  'mini-services',
  'ml-analyzer',
  'state',
  'ml-model-state.json',
);

export function getMlStateFilePath(): string {
  return process.env.ML_STATE_FILE_PATH?.trim() || DEFAULT_LOCAL_STATE_FILE;
}

export function getMlStorageBackend(): 'netlify-blobs' | 'filesystem' {
  if (process.env.NETLIFY || process.env.CONTEXT || process.env.SITE_ID) {
    return 'netlify-blobs';
  }

  return 'filesystem';
}

export async function loadPersistedMlState<T>(): Promise<T | null> {
  if (getMlStorageBackend() === 'netlify-blobs') {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore(NETLIFY_STORE_NAME);
    return (await store.get(NETLIFY_STATE_KEY, {
      type: 'json',
    })) as T | null;
  }

  try {
    const raw = await readFile(getMlStateFilePath(), 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function savePersistedMlState<T>(state: T): Promise<void> {
  if (getMlStorageBackend() === 'netlify-blobs') {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore(NETLIFY_STORE_NAME);
    await store.setJSON(NETLIFY_STATE_KEY, state);
    return;
  }

  const filePath = getMlStateFilePath();
  await mkdir(dirname(filePath), {
    recursive: true,
  });
  await writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
}
