import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const monorepoRuntimePreferencePath = path.resolve(projectRoot, "..", "..", "data", "forge-runtime.json");
export function getMonorepoRuntimePreferencePath() {
    return monorepoRuntimePreferencePath;
}
export async function readMonorepoPreferredDataRoot() {
    if (!existsSync(monorepoRuntimePreferencePath)) {
        return null;
    }
    try {
        const raw = await readFile(monorepoRuntimePreferencePath, "utf8");
        const parsed = JSON.parse(raw);
        return typeof parsed.dataRoot === "string" && parsed.dataRoot.trim().length > 0
            ? path.resolve(parsed.dataRoot)
            : null;
    }
    catch {
        return null;
    }
}
export async function writeMonorepoPreferredDataRoot(dataRoot) {
    await mkdir(path.dirname(monorepoRuntimePreferencePath), { recursive: true });
    await writeFile(monorepoRuntimePreferencePath, `${JSON.stringify({
        dataRoot: path.resolve(dataRoot),
        updatedAt: new Date().toISOString()
    }, null, 2)}\n`, "utf8");
}
async function patchJsonFile(filePath, transform) {
    let payload = {};
    if (existsSync(filePath)) {
        try {
            const raw = await readFile(filePath, "utf8");
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
                payload = parsed;
            }
        }
        catch {
            payload = {};
        }
    }
    const next = transform(payload);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
export async function syncLocalAdapterDataRoots(dataRoot) {
    const resolved = path.resolve(dataRoot);
    const openClawConfigPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
    const hermesConfigPath = path.join(os.homedir(), ".hermes", "forge", "config.json");
    await patchJsonFile(openClawConfigPath, (payload) => {
        const plugins = payload.plugins && typeof payload.plugins === "object"
            ? { ...payload.plugins }
            : {};
        const entries = plugins.entries && typeof plugins.entries === "object"
            ? { ...plugins.entries }
            : {};
        const currentEntryValue = entries["forge-openclaw-plugin"];
        const currentEntry = currentEntryValue && typeof currentEntryValue === "object"
            ? { ...currentEntryValue }
            : { enabled: true };
        const currentConfigValue = currentEntry["config"];
        const currentConfig = currentConfigValue && typeof currentConfigValue === "object"
            ? { ...currentConfigValue }
            : {};
        currentConfig.dataRoot = resolved;
        currentEntry["config"] = currentConfig;
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
