import { mkdtemp, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { generateSampleLog } from "@/lib/log-analyzer";

export const DEFAULT_EVALUATION_DATASET_DIR = "examples/evaluation-dataset";
export const DEFAULT_NORMAL_LOG_DIR = "examples/normal-training-dataset";

export interface DemoLogDefinition {
  id: string;
  filename: string;
  title: string;
  description: string;
  content: string;
}

interface DemoDatasetFile {
  relativePath: string;
  content: string;
}

type DatasetKind = "evaluation" | "normal";

const globalForBundledDatasets = globalThis as unknown as {
  bundledDatasetDirs?: Partial<Record<DatasetKind, string>>;
};

function buildDemoLogs(): DemoLogDefinition[] {
  return [
    {
      id: "auth-bruteforce",
      filename: "demo-auth-bruteforce.log",
      title: "Auth Brute Force",
      description: "Failed SSH logins, root access, and privilege escalation.",
      content: generateSampleLog("auth"),
    },
    {
      id: "web-attack",
      filename: "demo-web-attack.log",
      title: "Web Attack Probe",
      description: "Reconnaissance, traversal, SQL injection, and scanner traffic.",
      content: generateSampleLog("web_access"),
    },
    {
      id: "mixed-incident",
      filename: "demo-mixed-incident.log",
      title: "Mixed Incident Story",
      description: "Cross-layer incident linking web probes and auth failures.",
      content: generateSampleLog("mixed"),
    },
  ];
}

function buildBundledNormalDatasetFiles(): DemoDatasetFile[] {
  const lines: string[] = [];

  for (let index = 0; index < 220; index += 1) {
    const second = String(index % 60).padStart(2, "0");
    const minute = String(Math.floor(index / 60) % 60).padStart(2, "0");
    const day = String((index % 27) + 1).padStart(2, " ");

    lines.push(
      `Jan ${day} 08:${minute}:${second} server sshd[${14000 + index}]: Accepted password for analyst from 10.0.0.${(index % 20) + 10} port ${54000 + index}`,
    );
    lines.push(
      `10.0.0.${(index % 20) + 10} - analyst [15/Jan/2025:08:${minute}:${second} +0000] "GET /dashboard HTTP/1.1" 200 ${1200 + index} "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"`,
    );
  }

  return [
    {
      relativePath: "baseline/normal.log",
      content: lines.join("\n"),
    },
  ];
}

function buildBundledEvaluationDatasetFiles(): DemoDatasetFile[] {
  const authLines: string[] = [];
  const webLines: string[] = [];
  const mixedLines: string[] = [];

  for (let index = 0; index < 80; index += 1) {
    const minute = String(Math.floor(index / 60)).padStart(2, "0");
    const second = String(index % 60).padStart(2, "0");
    const octet = (index % 12) + 40;

    authLines.push(
      `Jan 15 08:${minute}:${second} server sshd[${22000 + index}]: Failed password for invalid user admin from 192.168.1.${octet} port ${40000 + index}`,
    );
    authLines.push(
      `Jan 15 08:${minute}:${second} server sshd[${23000 + index}]: Failed password for invalid user root from 192.168.1.${octet} port ${41000 + index}`,
    );

    webLines.push(
      `192.168.1.${octet} - - [15/Jan/2025:08:${minute}:${second} +0000] "GET /../../../etc/passwd HTTP/1.1" 403 512 "-" "sqlmap/1.5.${index % 5}"`,
    );
    webLines.push(
      `192.168.1.${octet} - - [15/Jan/2025:08:${minute}:${second} +0000] "GET /api/users?select=* FROM users-- HTTP/1.1" 400 64 "-" "Mozilla/5.0"`,
    );

    mixedLines.push(
      `203.0.113.${(index % 20) + 10} - - [15/Jan/2025:09:${minute}:${second} +0000] "GET /.env HTTP/1.1" 404 128 "-" "Nikto/2.1.6"`,
    );
    mixedLines.push(
      `Jan 15 09:${minute}:${second} server kernel: [${13000 + index}.123456] Out of memory: Killed process ${5100 + index} (python3)`,
    );
  }

  return [
    {
      relativePath: "auth/auth-eval.log",
      content: authLines.join("\n"),
    },
    {
      relativePath: "web/web-eval.log",
      content: webLines.join("\n"),
    },
    {
      relativePath: "mixed/mixed-eval.log",
      content: mixedLines.join("\n"),
    },
  ];
}

export function getDemoLogs(): DemoLogDefinition[] {
  return buildDemoLogs();
}

export function getDemoLogById(id: string): DemoLogDefinition | null {
  return getDemoLogs().find((entry) => entry.id === id) || null;
}

export function isBundledDatasetPath(value: string | undefined, kind: DatasetKind): boolean {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed === "__bundled_demo__") {
    return true;
  }

  return trimmed === (kind === "evaluation" ? DEFAULT_EVALUATION_DATASET_DIR : DEFAULT_NORMAL_LOG_DIR);
}

async function writeDatasetFiles(rootDir: string, files: DemoDatasetFile[]): Promise<void> {
  for (const file of files) {
    const target = join(rootDir, file.relativePath);
    await mkdir(join(target, ".."), {
      recursive: true,
    });
    await writeFile(target, file.content, "utf-8");
  }
}

export async function ensureBundledDatasetDir(kind: DatasetKind): Promise<string> {
  const cached = globalForBundledDatasets.bundledDatasetDirs?.[kind];
  if (cached) {
    return cached;
  }

  const rootDir = await mkdtemp(join(tmpdir(), `abuad-${kind}-`));
  await writeDatasetFiles(
    rootDir,
    kind === "evaluation" ? buildBundledEvaluationDatasetFiles() : buildBundledNormalDatasetFiles(),
  );

  globalForBundledDatasets.bundledDatasetDirs = {
    ...(globalForBundledDatasets.bundledDatasetDirs || {}),
    [kind]: rootDir,
  };

  return rootDir;
}
