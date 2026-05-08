export interface PublicSampleDatasetDefinition {
  id: 'loghub-linux-2k' | 'apache-error-2k' | 'secrepo-auth-log';
  title: string;
  description: string;
  filename: string;
  publicPath: string;
  sourceUrl: string;
  curatedLabels: boolean;
}

export const LOGHUB_SAMPLE_NAME = 'Linux_2k.log';
export const APACHE_SAMPLE_NAME = 'Apache_2k.log';
export const SECREPO_AUTH_SAMPLE_NAME = 'secrepo-auth.log';

export const LOGHUB_SAMPLE_NAME_ALIASES = [
  LOGHUB_SAMPLE_NAME,
  'loghub-linux-2k.log',
  'linux-2k-softmania.log',
  'linux_2k.log',
  'linux-2k.log',
];

export const APACHE_SAMPLE_NAME_ALIASES = [
  APACHE_SAMPLE_NAME,
  'apache_2k.log',
  'apache-2k.log',
];

export const SECREPO_AUTH_SAMPLE_NAME_ALIASES = [
  SECREPO_AUTH_SAMPLE_NAME,
  'auth.log',
  'auth.log.txt',
  'secrepo-auth.log',
];

export const PUBLIC_SAMPLE_DATASETS: PublicSampleDatasetDefinition[] = [
  {
    id: 'loghub-linux-2k',
    title: 'Linux 2k',
    description: 'Open-access Linux authentication and system log sample.',
    filename: LOGHUB_SAMPLE_NAME,
    publicPath: '/sample-logs/linux-2k-softmania.log',
    sourceUrl: 'https://github.com/SoftManiaTech/sample_log_files/blob/master/Linux/Linux_2k.log',
    curatedLabels: true,
  },
  {
    id: 'apache-error-2k',
    title: 'Apache 2k',
    description: 'Open-access Apache error log sample with notice and error events.',
    filename: APACHE_SAMPLE_NAME,
    publicPath: '/sample-logs/apache-2k.log',
    sourceUrl: 'https://github.com/SoftManiaTech/sample_log_files/blob/master/Apache/Apache_2k.log',
    curatedLabels: true,
  },
  {
    id: 'secrepo-auth-log',
    title: 'SecRepo Auth Log',
    description: 'Linux SSH authentication log with roughly 86k lines and many failed login attempts.',
    filename: SECREPO_AUTH_SAMPLE_NAME,
    publicPath: '/sample-logs/secrepo-auth.log',
    sourceUrl: 'https://www.secrepo.com/auth.log/auth.log.gz',
    curatedLabels: true,
  },
];

export function getPublicSampleDataset(
  id: PublicSampleDatasetDefinition['id'],
): PublicSampleDatasetDefinition | null {
  return PUBLIC_SAMPLE_DATASETS.find((dataset) => dataset.id === id) || null;
}

export function normalizeDatasetName(value?: string | null): string {
  return value?.trim().toLowerCase() || '';
}

export function datasetNameMatches(
  datasetName: string | undefined | null,
  aliases: string[],
): boolean {
  const normalized = normalizeDatasetName(datasetName);
  if (!normalized) {
    return false;
  }

  return aliases.some((alias) => normalized === normalizeDatasetName(alias));
}
