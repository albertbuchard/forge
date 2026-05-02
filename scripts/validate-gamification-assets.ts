import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  GAMIFICATION_ASSET_MANIFEST,
  GAMIFICATION_CATALOG,
  GAMIFICATION_MASCOT_KEYS
} from "../src/lib/gamification-catalog.js";

const projectRoot = path.resolve(import.meta.dirname, "..");
const publicRoot = path.join(projectRoot, "public");
const gamificationRoot = path.join(publicRoot, "gamification");
const generatedManifestPath = path.join(
  gamificationRoot,
  "source",
  "asset-manifest.generated.json"
);

const themes = ["dark-fantasy", "dramatic-smithie", "mind-locksmith"] as const;

const atlasConfigs = [
  {
    key: "trophies",
    file: "trophies-100.png",
    columns: 10,
    rows: 10,
    expectedCount: 100
  },
  {
    key: "unlocks",
    file: "unlocks-100.png",
    columns: 10,
    rows: 10,
    expectedCount: 100
  },
  {
    key: "mascots",
    file: "mascot-states-30.png",
    columns: 6,
    rows: 5,
    expectedCount: 30
  }
] as const;

type GeneratedAssetRecord = {
  key: string;
  theme: (typeof themes)[number];
  role: "item" | "mascot";
  kind?: "trophy" | "unlock";
  sourcePath: string;
  spritePath: string;
  perceptualHash: string;
  atlasKey: "trophies" | "unlocks" | "mascots";
  atlasIndex: number;
};

async function assertFile(pathname: string) {
  await access(pathname);
}

async function fileHash(pathname: string) {
  return createHash("sha256").update(await readFile(pathname)).digest("hex");
}

async function assertSquareImage(pathname: string, size: number) {
  await assertFile(pathname);
  const metadata = await sharp(pathname).metadata();
  if (metadata.width !== size || metadata.height !== size) {
    throw new Error(
      `${pathname} expected ${size}x${size}, found ${metadata.width}x${metadata.height}`
    );
  }
}

async function assertCroppedImageHasContent(pathname: string) {
  const stats = await sharp(pathname).stats();
  const variation = stats.channels.reduce(
    (sum, channel) => sum + (channel.max - channel.min),
    0
  );
  const stdev = stats.channels.reduce((sum, channel) => sum + channel.stdev, 0);
  if (variation < 30 || stdev < 6) {
    throw new Error(`${pathname} looks blank or incorrectly cropped.`);
  }
}

async function assertTransparentSprite(pathname: string) {
  const image = sharp(pathname).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const pixelCount = info.width * info.height;
  let transparent = 0;
  let opaque = 0;
  let greenKeyPixels = 0;
  const cornerIndexes = [
    0,
    info.width - 1,
    (info.height - 1) * info.width,
    info.height * info.width - 1
  ];
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const alpha = data[offset + 3];
    if (alpha <= 8) transparent += 1;
    if (alpha >= 220) opaque += 1;
    if (alpha > 20 && green > 190 && red < 90 && blue < 90) {
      greenKeyPixels += 1;
    }
  }
  const cornerAlpha = cornerIndexes.map((pixel) => data[pixel * 4 + 3]);
  if (!cornerAlpha.every((alpha) => alpha <= 8)) {
    throw new Error(`${pathname} does not have transparent corners.`);
  }
  if (transparent / pixelCount < 0.2) {
    throw new Error(`${pathname} does not contain enough transparent area.`);
  }
  if (opaque / pixelCount < 0.01) {
    throw new Error(`${pathname} does not contain enough opaque subject pixels.`);
  }
  if (greenKeyPixels / pixelCount > 0.002) {
    throw new Error(`${pathname} still contains visible chroma-key background.`);
  }
}

if (GAMIFICATION_CATALOG.length !== 144) {
  throw new Error(`Expected 144 catalog items, found ${GAMIFICATION_CATALOG.length}`);
}

const trophies = GAMIFICATION_CATALOG.filter((item) => item.kind === "trophy");
const unlocks = GAMIFICATION_CATALOG.filter((item) => item.kind === "unlock");
if (trophies.length !== 96 || unlocks.length !== 48) {
  throw new Error(`Expected 96 trophies and 48 unlocks, found ${trophies.length}/${unlocks.length}`);
}

const xpOnlyTrophies = trophies.filter((item) => {
  const serialized = JSON.stringify(item.requirement);
  return serialized.includes('"totalXp"') || serialized.includes('"nonManualXp"') || serialized.includes('"level"');
});
if (xpOnlyTrophies.length >= trophies.length / 2) {
  throw new Error("XP-only trophies must remain a minority of the gamification catalog.");
}

if (GAMIFICATION_MASCOT_KEYS.length !== 30) {
  throw new Error(`Expected 30 mascot state keys, found ${GAMIFICATION_MASCOT_KEYS.length}`);
}

for (const theme of themes) {
  for (const atlas of atlasConfigs) {
    const atlasPath = path.join(
      gamificationRoot,
      "source",
      "themes",
      theme,
      "atlases",
      atlas.file
    );
    await assertFile(atlasPath);
    const metadata = await sharp(atlasPath).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error(`${atlasPath} has no readable dimensions.`);
    }
    if (atlas.columns * atlas.rows < atlas.expectedCount) {
      throw new Error(`${theme}/${atlas.key} atlas grid does not contain ${atlas.expectedCount} slots.`);
    }
    if (metadata.width / atlas.columns < 96 || metadata.height / atlas.rows < 96) {
      throw new Error(`${theme}/${atlas.key} atlas cells are too small for reliable cropping.`);
    }
  }
}

const itemAssetKeys = new Set<string>();
for (const item of GAMIFICATION_CATALOG) {
  if (!GAMIFICATION_ASSET_MANIFEST[item.assetKey]) {
    throw new Error(`${item.id} references missing asset key ${item.assetKey}`);
  }
  if (itemAssetKeys.has(item.assetKey)) {
    throw new Error(`Duplicate catalog asset key ${item.assetKey}`);
  }
  itemAssetKeys.add(item.assetKey);
}

const generatedManifestRaw = await readFile(generatedManifestPath, "utf8");
const generatedManifest = JSON.parse(generatedManifestRaw) as GeneratedAssetRecord[];
const generatedKeyByTheme = new Set(
  generatedManifest.map((entry) => `${entry.theme}:${entry.key}`)
);

for (const theme of themes) {
  const themeRecords = generatedManifest.filter((entry) => entry.theme === theme);
  const trophyAtlasRecords = themeRecords.filter((entry) => entry.atlasKey === "trophies");
  const unlockAtlasRecords = themeRecords.filter((entry) => entry.atlasKey === "unlocks");
  const mascotAtlasRecords = themeRecords.filter((entry) => entry.atlasKey === "mascots");
  if (trophyAtlasRecords.length !== 100) {
    throw new Error(`${theme} expected 100 cropped trophy sprites, found ${trophyAtlasRecords.length}`);
  }
  if (unlockAtlasRecords.length !== 100) {
    throw new Error(`${theme} expected 100 cropped cosmetic unlock sprites, found ${unlockAtlasRecords.length}`);
  }
  if (mascotAtlasRecords.length !== 30) {
    throw new Error(`${theme} expected 30 cropped mascot states, found ${mascotAtlasRecords.length}`);
  }

  for (const key of Object.keys(GAMIFICATION_ASSET_MANIFEST)) {
    if (!generatedKeyByTheme.has(`${theme}:${key}`)) {
      throw new Error(`Generated asset manifest is missing ${theme}:${key}`);
    }
  }
}

for (const record of generatedManifest) {
  const sourcePath = path.join(publicRoot, record.sourcePath);
  await assertSquareImage(sourcePath, 1024);
  await assertCroppedImageHasContent(sourcePath);
  await assertTransparentSprite(sourcePath);
  for (const size of [256, 512, 1024] as const) {
    const relativeSpritePath = record.spritePath.replace("{size}", String(size));
    await assertSquareImage(path.join(publicRoot, relativeSpritePath), size);
    await assertSquareImage(
      path.join(publicRoot, relativeSpritePath.replace(/\.webp$/, ".png")),
      size
    );
    await assertTransparentSprite(path.join(publicRoot, relativeSpritePath));
  }
}

for (const key of Object.keys(GAMIFICATION_ASSET_MANIFEST)) {
  const manifest = GAMIFICATION_ASSET_MANIFEST[key]!;
  const sourcePath = path.join(publicRoot, manifest.sourcePath);
  await assertSquareImage(sourcePath, 1024);
  await assertTransparentSprite(sourcePath);
  for (const size of [256, 512, 1024] as const) {
    const relativeSpritePath = manifest.spritePath.replace("{size}", String(size));
    await assertSquareImage(path.join(publicRoot, relativeSpritePath), size);
    await assertSquareImage(
      path.join(publicRoot, relativeSpritePath.replace(/\.webp$/, ".png")),
      size
    );
    await assertTransparentSprite(path.join(publicRoot, relativeSpritePath));
  }
}

const itemSourceHashes = new Map<string, string>();
for (const item of GAMIFICATION_CATALOG) {
  const manifest = GAMIFICATION_ASSET_MANIFEST[item.assetKey]!;
  const hash = await fileHash(path.join(publicRoot, manifest.sourcePath));
  const existing = itemSourceHashes.get(hash);
  if (existing) {
    throw new Error(
      `${item.assetKey} shares identical source art with ${existing}; each item needs a unique icon.`
    );
  }
  itemSourceHashes.set(hash, item.assetKey);
}

const generatedHashes = new Set(generatedManifest.map((entry) => entry.perceptualHash));
if (generatedHashes.size !== generatedManifest.length) {
  throw new Error("Generated asset manifest contains duplicated perceptual hashes.");
}

for (const theme of themes) {
  await assertFile(path.join(gamificationRoot, "source", "themes", theme, "sheets", "trophies-cropped-contact-sheet.png"));
  await assertFile(path.join(gamificationRoot, "source", "themes", theme, "sheets", "unlocks-cropped-contact-sheet.png"));
  await assertFile(path.join(gamificationRoot, "source", "themes", theme, "sheets", "mascots-contact-sheet.png"));
}

console.log(
  `Validated transparent atlas assets for ${themes.length} themes: 100 trophies, 100 cosmetic unlocks, 30 mascot states per theme.`
);
