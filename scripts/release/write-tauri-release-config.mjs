import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repositoryRoot = process.cwd();
const basePath = path.join(repositoryRoot, "apps/desktop-tauri/tauri.conf.json");
const outputPath = path.join(repositoryRoot, "apps/desktop-tauri/tauri.release.conf.json");
const publicKey = process.env.TAURI_UPDATER_PUBLIC_KEY?.trim();
const endpoint =
  process.env.TAURI_UPDATER_ENDPOINT?.trim() ??
  "https://github.com/albertbuchard/forge/releases/latest/download/latest.json";

if (!publicKey) {
  throw new Error(
    "TAURI_UPDATER_PUBLIC_KEY is required. Forge never builds an update-capable package without its pinned verification key."
  );
}

const base = JSON.parse(await readFile(basePath, "utf8"));
const releaseConfig = {
  ...base,
  plugins: {
    ...(base.plugins ?? {}),
    updater: {
      endpoints: [endpoint],
      pubkey: publicKey,
      windows: { installMode: "passive" }
    }
  }
};

await writeFile(outputPath, `${JSON.stringify(releaseConfig, null, 2)}\n`, {
  mode: 0o600
});
console.log(`Wrote signed desktop release config to ${outputPath}`);
