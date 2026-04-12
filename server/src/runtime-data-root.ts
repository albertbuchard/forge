import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const monorepoRuntimePreferencePath = path.resolve(
  projectRoot,
  "..",
  "..",
  "data",
  "forge-runtime.json"
);

export function getMonorepoRuntimePreferencePath() {
  return monorepoRuntimePreferencePath;
}

export async function readMonorepoPreferredDataRoot(): Promise<string | null> {
  if (!existsSync(monorepoRuntimePreferencePath)) {
    return null;
  }
  try {
    const raw = await readFile(monorepoRuntimePreferencePath, "utf8");
    const parsed = JSON.parse(raw) as { dataRoot?: unknown };
    return typeof parsed.dataRoot === "string" && parsed.dataRoot.trim().length > 0
      ? path.resolve(parsed.dataRoot)
      : null;
  } catch {
    return null;
  }
}

export async function writeMonorepoPreferredDataRoot(dataRoot: string): Promise<void> {
  await mkdir(path.dirname(monorepoRuntimePreferencePath), { recursive: true });
  await writeFile(
    monorepoRuntimePreferencePath,
    `${JSON.stringify(
      {
        dataRoot: path.resolve(dataRoot),
        updatedAt: new Date().toISOString()
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function patchJsonFile(
  filePath: string,
  transform: (payload: Record<string, unknown>) => Record<string, unknown>
) {
  let payload: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = {};
    }
  }
  const next = transform(payload);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export async function syncLocalAdapterDataRoots(dataRoot: string): Promise<void> {
  const resolved = path.resolve(dataRoot);
  const openClawConfigPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  const hermesConfigPath = path.join(os.homedir(), ".hermes", "forge", "config.json");

  await patchJsonFile(openClawConfigPath, (payload) => {
    const plugins =
      payload.plugins && typeof payload.plugins === "object"
        ? { ...(payload.plugins as Record<string, unknown>) }
        : {};
    const entries =
      plugins.entries && typeof plugins.entries === "object"
        ? { ...(plugins.entries as Record<string, unknown>) }
        : {};
    const currentEntry =
      entries["forge-openclaw-plugin"] &&
      typeof entries["forge-openclaw-plugin"] === "object"
        ? { ...(entries["forge-openclaw-plugin"] as Record<string, unknown>) }
        : { enabled: true };
    const currentConfig =
      currentEntry.config && typeof currentEntry.config === "object"
        ? { ...(currentEntry.config as Record<string, unknown>) }
        : {};
    currentConfig.dataRoot = resolved;
    currentEntry.config = currentConfig;
    entries["forge-openclaw-plugin"] = currentEntry;
    plugins.entries = entries;
    return {
      ...payload,
      plugins
    };
  });

  await patchJsonFile(hermesConfigPath, (payload) => ({
    ...payload,
    dataRoot: resolved
  }));
}
