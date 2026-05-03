import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { getEffectiveDataRoot } from "../db.js";
import {
  GAMIFICATION_CATALOG,
  GAMIFICATION_MASCOT_KEYS
} from "../../../src/lib/gamification-catalog.js";

export type GamificationAssetStyleId =
  | "dark-fantasy"
  | "dramatic-smithie"
  | "mind-locksmith";

export type GamificationAssetStyleStatus = {
  id: GamificationAssetStyleId;
  label: string;
  description: string;
  previewUrl: string;
  fileName: string;
  downloadUrl: string;
  sha256: string;
  installed: boolean;
  spriteCount: number;
  expectedSpriteCount: number;
  installedAt: string | null;
};

const assetVersion = "0.2.59";
const defaultReleaseBaseUrl =
  "https://github.com/albertbuchard/forge/releases/download/forge-gamification-assets-v0.2.59";
const styleDefinitions: Array<
  Omit<
    GamificationAssetStyleStatus,
    "downloadUrl" | "installed" | "spriteCount" | "expectedSpriteCount" | "installedAt"
  >
> = [
  {
    id: "dramatic-smithie",
    label: "Fantasy",
    description:
      "Warm, lighthearted 3D forge art with expressive mascot reactions and playful trophies.",
    previewUrl: "/gamification-previews/dramatic-smithie-mascot.webp",
    fileName: `forge-gamification-dramatic-smithie-${assetVersion}.zip`,
    sha256: "407c98a89626d723f9f92e79411df7c999458459c96e0e09e73020b3d3ce14c0"
  },
  {
    id: "dark-fantasy",
    label: "Dark Fantasy",
    description:
      "Obsidian iron, ember gold, high-pressure streak energy, and mythic trophy silhouettes.",
    previewUrl: "/gamification-previews/dark-fantasy-mascot.webp",
    fileName: `forge-gamification-dark-fantasy-${assetVersion}.zip`,
    sha256: "9545900906784a23d15f4536eb8c32683ffff0ef42006d06c70cea101c1db570"
  },
  {
    id: "mind-locksmith",
    label: "Mind Locksmith",
    description:
      "Modern locksmith-of-the-mind art for planning, memory, Psyche, health, and agent work.",
    previewUrl: "/gamification-previews/mind-locksmith-mascot.webp",
    fileName: `forge-gamification-mind-locksmith-${assetVersion}.zip`,
    sha256: "cfdfd4259145e589e6e0fba8e1deb69d30931cfabbe6d626c0053e4f4cfe5f10"
  }
];

export const defaultGamificationAssetStyle: GamificationAssetStyleId =
  "dramatic-smithie";

function getCustomReleaseBaseUrl() {
  return process.env.FORGE_GAMIFICATION_ASSET_BASE_URL?.trim().replace(/\/+$/, "");
}

function getDownloadUrl(
  style: (typeof styleDefinitions)[number]
) {
  const customReleaseBaseUrl = getCustomReleaseBaseUrl();
  return `${customReleaseBaseUrl ?? defaultReleaseBaseUrl}/${style.fileName}`;
}

function getStyleDefinition(styleId: string) {
  const style = styleDefinitions.find((candidate) => candidate.id === styleId);
  if (!style) {
    throw new Error(`Unknown gamification asset style: ${styleId}`);
  }
  return style;
}

function getExpectedSpritePaths(styleId: GamificationAssetStyleId) {
  const itemAssetKeys = [
    ...new Set(GAMIFICATION_CATALOG.map((item) => item.assetKey))
  ];
  const expectedPaths = new Set<string>();
  for (const key of itemAssetKeys) {
    expectedPaths.add(`themes/${styleId}/items/${key}-256.webp`);
    expectedPaths.add(`themes/${styleId}/items/${key}-512.webp`);
  }
  for (const key of GAMIFICATION_MASCOT_KEYS) {
    expectedPaths.add(`themes/${styleId}/mascots/${key}-256.webp`);
    expectedPaths.add(`themes/${styleId}/mascots/${key}-512.webp`);
  }
  return expectedPaths;
}

function assertSafeRelativePath(relativePath: string) {
  if (
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    relativePath.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(`Unsafe gamification asset path: ${relativePath}`);
  }
}

function getStyleRoot(styleId: GamificationAssetStyleId) {
  const style = getStyleDefinition(styleId);
  return path.join(
    getEffectiveDataRoot(),
    "runtime-assets",
    "gamification",
    "styles",
    `${style.id}-${assetVersion}-${style.sha256.slice(0, 16)}`
  );
}

function getMarkerPath(styleId: GamificationAssetStyleId) {
  return path.join(getStyleRoot(styleId), ".forge-gamification-style-ready.json");
}

async function countReadableFiles(root: string, relativePaths: Set<string>) {
  let count = 0;
  for (const relativePath of relativePaths) {
    try {
      await access(path.join(root, relativePath));
      count += 1;
    } catch {
      // Missing files are reported through the count.
    }
  }
  return count;
}

async function readInstalledAt(styleId: GamificationAssetStyleId) {
  try {
    const marker = JSON.parse(await readFile(getMarkerPath(styleId), "utf8"));
    return typeof marker.installedAt === "string" ? marker.installedAt : null;
  } catch {
    return null;
  }
}

async function getStyleStatus(
  styleId: GamificationAssetStyleId
): Promise<GamificationAssetStyleStatus> {
  const style = getStyleDefinition(styleId);
  const expectedPaths = getExpectedSpritePaths(style.id);
  const root = getStyleRoot(style.id);
  const spriteCount = existsSync(getMarkerPath(style.id))
    ? await countReadableFiles(root, expectedPaths)
    : 0;
  const installed = spriteCount === expectedPaths.size;
  return {
    ...style,
    downloadUrl: getDownloadUrl(style),
    installed,
    spriteCount,
    expectedSpriteCount: expectedPaths.size,
    installedAt: installed ? await readInstalledAt(style.id) : null
  };
}

export async function getGamificationAssetStatus() {
  const styles = await Promise.all(
    styleDefinitions.map((style) => getStyleStatus(style.id))
  );
  return {
    version: assetVersion,
    defaultStyle: defaultGamificationAssetStyle,
    styles
  };
}

function buildDownloadHeaders(url: string) {
  const headers: Record<string, string> = {
    Accept: "application/octet-stream"
  };
  const token = resolveGithubTokenForDownload(url);
  if (token && /github\.com/i.test(url)) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function resolveGithubTokenForDownload(url: string) {
  if (!/github\.com/i.test(url)) {
    return undefined;
  }
  const envToken =
    process.env.FORGE_GAMIFICATION_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;
  if (envToken?.trim()) {
    return envToken.trim();
  }
  const result = spawnSync("gh", ["auth", "token"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  const cliToken = result.status === 0 ? result.stdout.trim() : "";
  return cliToken || undefined;
}

function validateArchive(
  styleId: GamificationAssetStyleId,
  archive: AdmZip
) {
  const expectedPaths = getExpectedSpritePaths(styleId);
  const entriesByName = new Map(
    archive
      .getEntries()
      .filter((entry) => !entry.isDirectory)
      .map((entry) => {
        assertSafeRelativePath(entry.entryName);
        return [entry.entryName, entry] as const;
      })
  );
  const missing = [...expectedPaths].filter((entryName) => !entriesByName.has(entryName));
  const unexpected = [...entriesByName.keys()].filter(
    (entryName) => !expectedPaths.has(entryName)
  );
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Invalid gamification style archive for ${styleId}. Missing ${missing.length}, unexpected ${unexpected.length}.`
    );
  }
  return { expectedPaths, entriesByName };
}

export async function installGamificationAssetStyle(
  styleId: GamificationAssetStyleId,
  fetchImpl: typeof fetch = fetch
) {
  const style = getStyleDefinition(styleId);
  const downloadUrl = getDownloadUrl(style);
  const response = await fetchImpl(downloadUrl, {
    headers: buildDownloadHeaders(downloadUrl)
  });
  if (!response.ok) {
    throw new Error(
      `Could not download gamification assets (${response.status} ${response.statusText}).`
    );
  }

  const archivePayload = Buffer.from(await response.arrayBuffer());
  const actualSha256 = createHash("sha256").update(archivePayload).digest("hex");
  if (actualSha256 !== style.sha256) {
    throw new Error(
      `Gamification asset checksum mismatch for ${style.id}. Expected ${style.sha256}, got ${actualSha256}.`
    );
  }

  const archive = new AdmZip(archivePayload);
  const { expectedPaths, entriesByName } = validateArchive(style.id, archive);
  const targetRoot = getStyleRoot(style.id);
  await rm(targetRoot, { recursive: true, force: true });
  for (const relativePath of expectedPaths) {
    const entry = entriesByName.get(relativePath);
    if (!entry) {
      throw new Error(`Missing gamification archive entry: ${relativePath}`);
    }
    const targetPath = path.join(targetRoot, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, entry.getData());
  }

  await writeFile(
    getMarkerPath(style.id),
    `${JSON.stringify(
      {
        style: style.id,
        version: assetVersion,
        sha256: style.sha256,
        spriteCount: expectedPaths.size,
        installedAt: new Date().toISOString(),
        source: downloadUrl
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return getStyleStatus(style.id);
}

export async function resolveGamificationSpriteAssetPath(
  relativeSpritePath: string
) {
  const safePath = relativeSpritePath.replace(/^\/+/, "");
  try {
    assertSafeRelativePath(safePath);
  } catch {
    return path.join(getEffectiveDataRoot(), "runtime-assets", "missing-gamification-asset");
  }

  const match = /^themes\/([^/]+)\//.exec(safePath);
  if (!match) {
    return path.join(getEffectiveDataRoot(), "runtime-assets", "missing-gamification-asset");
  }
  const styleId = match[1] as GamificationAssetStyleId;
  const style = styleDefinitions.find((candidate) => candidate.id === styleId);
  if (!style) {
    return path.join(getEffectiveDataRoot(), "runtime-assets", "missing-gamification-asset");
  }
  if (!getExpectedSpritePaths(style.id).has(safePath)) {
    return path.join(getEffectiveDataRoot(), "runtime-assets", "missing-gamification-asset");
  }
  const status = await getStyleStatus(style.id);
  if (!status.installed) {
    return path.join(getEffectiveDataRoot(), "runtime-assets", "missing-gamification-asset");
  }
  return path.join(getStyleRoot(style.id), safePath);
}
