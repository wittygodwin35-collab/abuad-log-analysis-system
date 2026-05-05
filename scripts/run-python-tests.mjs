import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const candidates = [
  join('mini-services', 'ml-analyzer', '.venv', 'Scripts', 'python.exe'),
  join('mini-services', 'ml-analyzer', '.venv', 'bin', 'python'),
  'python',
  'python3',
];

const python = candidates.find((candidate) => {
  if (candidate === 'python' || candidate === 'python3') {
    return true;
  }
  return existsSync(candidate);
});

const result = spawnSync(
  python,
  ['-m', 'unittest', 'discover', 'mini-services/ml-analyzer/tests'],
  {
    stdio: 'inherit',
    shell: false,
  },
);

process.exit(result.status ?? 1);
