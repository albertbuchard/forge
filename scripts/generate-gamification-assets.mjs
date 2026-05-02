import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const {
  GAMIFICATION_ASSET_MANIFEST,
  GAMIFICATION_CATALOG,
  GAMIFICATION_MASCOT_KEYS
} = await import("../src/lib/gamification-catalog.ts");

const projectRoot = path.resolve(import.meta.dirname, "..");
const publicRoot = path.join(projectRoot, "public", "gamification");
const sourceRoot = path.join(publicRoot, "source");
const spriteRoot = path.join(publicRoot, "sprites");
const manualCropRoot = path.join(
  projectRoot,
  "tools",
  "atlas-cropper",
  "crop-regions"
);
const regriddedSourceRoots = [
  path.join(sourceRoot, "themes", "regrided"),
  path.join(projectRoot, "dist", "gamification", "source", "themes", "regrided")
];
const sizes = [256, 512, 1024];

const themes = [
  {
    id: "dark-fantasy",
    label: "Dark Fantasy",
    defaultTheme: true
  },
  {
    id: "dramatic-smithie",
    label: "Fantasy",
    defaultTheme: false
  },
  {
    id: "mind-locksmith",
    label: "Mind Locksmith",
    defaultTheme: false
  }
];

// Alternate trophy atlases currently contain label/neighbor bleed in several
// slots; use the verified clean trophy grid until those sheets are replaced.
const regriddedAtlasSourceOverrides = new Map([
  ["dramatic-smithie:trophies", "dark-fantasy"],
  ["mind-locksmith:trophies", "dark-fantasy"]
]);

const atlasConfigs = {
  trophies: {
    atlasKey: "trophies",
    file: "trophies-100.png",
    columns: 10,
    rows: 10,
    count: 100,
    labelCutoff: 1
  },
  unlocks: {
    atlasKey: "unlocks",
    file: "unlocks-100.png",
    columns: 10,
    rows: 10,
    count: 100,
    labelCutoff: 1
  },
  mascots: {
    atlasKey: "mascots",
    file: "mascot-states-30.png",
    columns: 6,
    rows: 5,
    count: 30,
    labelCutoff: 1
  }
};

function hashFileKey(...values) {
  return createHash("sha256")
    .update(values.join(":"))
    .digest("hex")
    .slice(0, 16);
}

function atlasPathForTheme(theme, atlas) {
  return path.join(sourceRoot, "themes", theme.id, "atlases", atlas.file);
}

function regriddedAtlasPathForTheme(theme, atlas) {
  const filename = atlas.file.replace(/\.png$/u, "-imagegen.png");
  const sourceThemeId =
    regriddedAtlasSourceOverrides.get(`${theme.id}:${atlas.atlasKey}`) ??
    theme.id;
  for (const root of regriddedSourceRoots) {
    const pathname = path.join(root, sourceThemeId, filename);
    if (existsSync(pathname)) {
      return pathname;
    }
  }
  return null;
}

function cropRegionPathForTheme(theme, atlas) {
  return path.join(manualCropRoot, theme.id, `${atlas.atlasKey}.json`);
}

function themeDirs(theme) {
  const themeSourceRoot = path.join(sourceRoot, "themes", theme.id);
  const themeSpriteRoot = path.join(spriteRoot, "themes", theme.id);
  return {
    atlasRoot: path.join(themeSourceRoot, "atlases"),
    sheetDir: path.join(themeSourceRoot, "sheets"),
    itemSourceDir: path.join(themeSourceRoot, "items"),
    mascotSourceDir: path.join(themeSourceRoot, "mascots"),
    itemSpriteDir: path.join(themeSpriteRoot, "items"),
    mascotSpriteDir: path.join(themeSpriteRoot, "mascots")
  };
}

const cropRegionCache = new Map();

async function cropRegionsForThemeAtlas(theme, atlas) {
  const cacheKey = `${theme.id}:${atlas.atlasKey}`;
  if (cropRegionCache.has(cacheKey)) {
    return cropRegionCache.get(cacheKey);
  }

  const pathname = cropRegionPathForTheme(theme, atlas);
  try {
    const payload = JSON.parse(await readFile(pathname, "utf8"));
    if (
      payload.schema !== "forge-gamification-atlas-crops-v1" ||
      payload.theme !== theme.id ||
      payload.atlasKey !== atlas.atlasKey ||
      !Array.isArray(payload.regions)
    ) {
      throw new Error(`Invalid manual crop payload in ${pathname}`);
    }
    cropRegionCache.set(cacheKey, payload.regions);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      cropRegionCache.set(cacheKey, null);
    } else {
      throw error;
    }
  }
  return cropRegionCache.get(cacheKey);
}

function manualSlotForRegion(region, slotIndex, atlas) {
  const left = Math.max(0, Math.round(Number(region.x)));
  const top = Math.max(0, Math.round(Number(region.y)));
  const width = Math.max(1, Math.round(Number(region.width)));
  const height = Math.max(1, Math.round(Number(region.height)));
  return {
    left,
    top,
    width,
    height,
    fullCell: { left, top, width, height },
    row: region.row ?? Math.floor(slotIndex / atlas.columns) + 1,
    column: region.column ?? (slotIndex % atlas.columns) + 1
  };
}

async function detectAtlasBounds(pathname) {
  const { data, info } = await sharp(pathname)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * 4;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const alpha = data[offset + 3];
      const isGreenKey = green > 170 && green - Math.max(red, blue) > 70;
      const isMagentaKey = red > 170 && blue > 170 && green < 100;
      if (alpha > 0 && (isGreenKey || isMagentaKey)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    const metadata = await sharp(pathname).metadata();
    return { left: 0, top: 0, width: metadata.width, height: metadata.height };
  }
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

function slotForIndex(index, columns, bounds, rows, labelCutoff) {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const left = bounds.left + Math.round((column * bounds.width) / columns);
  const right =
    bounds.left + Math.round(((column + 1) * bounds.width) / columns);
  const top = bounds.top + Math.round((row * bounds.height) / rows);
  const bottom = bounds.top + Math.round(((row + 1) * bounds.height) / rows);
  const cellWidth = right - left;
  const cellHeight = bottom - top;
  const insetX = Math.max(1, Math.round(cellWidth * 0.012));
  const insetY = Math.max(1, Math.round(cellHeight * 0.012));
  return {
    left: left + insetX,
    top: top + insetY,
    width: Math.max(1, cellWidth - insetX * 2),
    height: Math.max(1, Math.round(cellHeight * labelCutoff) - insetY * 2),
    fullCell: { left, top, width: cellWidth, height: cellHeight },
    row: row + 1,
    column: column + 1
  };
}

function regriddedSlotForIndex(index, atlas, metadata) {
  const column = index % atlas.columns;
  const row = Math.floor(index / atlas.columns);
  const left = Math.round((column * metadata.width) / atlas.columns);
  const right = Math.round(((column + 1) * metadata.width) / atlas.columns);
  const top = Math.round((row * metadata.height) / atlas.rows);
  const bottom = Math.round(((row + 1) * metadata.height) / atlas.rows);
  const inset = Math.max(
    2,
    Math.round(Math.min(right - left, bottom - top) * 0.008)
  );
  return {
    left: left + inset,
    top: top + inset,
    width: Math.max(1, right - left - inset * 2),
    height: Math.max(1, bottom - top - inset * 2),
    fullCell: { left, top, width: right - left, height: bottom - top },
    row: row + 1,
    column: column + 1
  };
}

async function assertFile(pathname) {
  await access(pathname);
}

async function removeChromaKey(buffer) {
  const image = sharp(buffer).ensureAlpha();
  const { data, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let index = 0; index < data.length; index += 4) {
    const pixel = index / 4;
    const y = Math.floor(pixel / info.width);
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];
    const channelSpread =
      Math.max(red, green, blue) - Math.min(red, green, blue);
    const isLabelBand = y < info.height * 0.2 || y > info.height * 0.72;
    const isWhiteLabelInk =
      isLabelBand &&
      red > 190 &&
      green > 175 &&
      blue > 190 &&
      channelSpread < 86;
    const greenGap = green - Math.max(red, blue);
    const magentaStrength = Math.min(red, blue) - green;
    if (isWhiteLabelInk) {
      data[index + 3] = 0;
      continue;
    }
    const hardKey =
      (green > 170 && greenGap > 70) ||
      (red > 170 && blue > 170 && green < 150 && magentaStrength > 42) ||
      (red > 205 && blue > 145 && green < 190 && magentaStrength > 18);
    const softKey =
      (green > 120 && greenGap > 42) ||
      (red > 115 && blue > 105 && green < 190 && magentaStrength > 14);
    if (hardKey) {
      data[index + 3] = 0;
      continue;
    }
    if (softKey) {
      const keyStrength = Math.max(greenGap, magentaStrength);
      const opacity = Math.max(0, Math.min(1, (keyStrength - 14) / 34));
      data[index + 3] = Math.round(alpha * (1 - opacity));
      data[index] = Math.min(red, green + 70);
      data[index + 1] = Math.min(green, Math.max(red, blue) + 24);
      data[index + 2] = Math.min(blue, green + 70);
    }
  }
  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels
    }
  })
    .png()
    .toBuffer();
}

function isConnectedGreenKeyPixel(red, green, blue, alpha) {
  if (alpha <= 0) {
    return false;
  }
  const greenGap = green - Math.max(red, blue);
  return (
    (green > 130 && greenGap > 42) || (green > 70 && red < 42 && blue < 42)
  );
}

function isStrictGreenKeyPixel(red, green, blue, alpha) {
  if (alpha <= 0) {
    return false;
  }
  return (
    green > 165 && red < 105 && blue < 105 && green - Math.max(red, blue) > 80
  );
}

async function removeConnectedGreenChromaKey(buffer) {
  const image = sharp(buffer).ensureAlpha();
  const { data, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixelCount = info.width * info.height;
  const seen = new Uint8Array(pixelCount);
  const queue = [];

  function enqueue(pixel) {
    if (pixel < 0 || pixel >= pixelCount || seen[pixel]) {
      return;
    }
    const offset = pixel * 4;
    if (
      !isConnectedGreenKeyPixel(
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3]
      )
    ) {
      return;
    }
    seen[pixel] = 1;
    queue.push(pixel);
  }

  for (let x = 0; x < info.width; x += 1) {
    enqueue(x);
    enqueue((info.height - 1) * info.width + x);
  }
  for (let y = 0; y < info.height; y += 1) {
    enqueue(y * info.width);
    enqueue(y * info.width + info.width - 1);
  }

  while (queue.length > 0) {
    const current = queue.pop();
    const x = current % info.width;
    const y = Math.floor(current / info.width);
    enqueue(x > 0 ? current - 1 : -1);
    enqueue(x < info.width - 1 ? current + 1 : -1);
    enqueue(y > 0 ? current - info.width : -1);
    enqueue(y < info.height - 1 ? current + info.width : -1);
  }

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    if (
      seen[pixel] ||
      isStrictGreenKeyPixel(
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3]
      )
    ) {
      data[pixel * 4 + 3] = 0;
    }
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels
    }
  })
    .png()
    .toBuffer();
}

async function removeSmallAlphaComponents(buffer) {
  const image = sharp(buffer).ensureAlpha();
  const { data, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixelCount = info.width * info.height;
  const seen = new Uint8Array(pixelCount);
  const keep = new Uint8Array(pixelCount);
  const minComponentPixels = Math.max(56, Math.round(pixelCount * 0.003));
  const queue = [];

  for (let start = 0; start < pixelCount; start += 1) {
    if (seen[start] || data[start * 4 + 3] <= 18) {
      continue;
    }
    queue.length = 0;
    const component = [];
    queue.push(start);
    seen[start] = 1;
    while (queue.length > 0) {
      const current = queue.pop();
      component.push(current);
      const x = current % info.width;
      const y = Math.floor(current / info.width);
      const neighbors = [
        x > 0 ? current - 1 : -1,
        x < info.width - 1 ? current + 1 : -1,
        y > 0 ? current - info.width : -1,
        y < info.height - 1 ? current + info.width : -1
      ];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || seen[neighbor] || data[neighbor * 4 + 3] <= 18) {
          continue;
        }
        seen[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    if (component.length >= minComponentPixels) {
      for (const pixel of component) {
        keep[pixel] = 1;
      }
    }
  }

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (!keep[pixel]) {
      data[pixel * 4 + 3] = 0;
    }
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels
    }
  })
    .png()
    .toBuffer();
}

async function removeNumberLabelComponents(buffer) {
  const image = sharp(buffer).ensureAlpha();
  const { data, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixelCount = info.width * info.height;
  const seen = new Uint8Array(pixelCount);
  const queue = [];

  for (let start = 0; start < pixelCount; start += 1) {
    if (seen[start] || data[start * 4 + 3] <= 18) {
      continue;
    }
    queue.length = 0;
    const component = [];
    let minX = info.width;
    let maxX = -1;
    let minY = info.height;
    let maxY = -1;
    let brightPixels = 0;
    let totalBrightness = 0;

    queue.push(start);
    seen[start] = 1;
    while (queue.length > 0) {
      const current = queue.pop();
      component.push(current);
      const x = current % info.width;
      const y = Math.floor(current / info.width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      const offset = current * 4;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const brightness = (red + green + blue) / 3;
      totalBrightness += brightness;
      if (red > 160 && green > 150 && blue > 160) {
        brightPixels += 1;
      }

      const neighbors = [
        x > 0 ? current - 1 : -1,
        x < info.width - 1 ? current + 1 : -1,
        y > 0 ? current - info.width : -1,
        y < info.height - 1 ? current + info.width : -1
      ];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || seen[neighbor] || data[neighbor * 4 + 3] <= 18) {
          continue;
        }
        seen[neighbor] = 1;
        queue.push(neighbor);
      }
    }

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const centerY = (minY + maxY) / 2;
    const brightRatio = brightPixels / component.length;
    const averageBrightness = totalBrightness / component.length;
    const looksLikeBottomNumber =
      centerY > info.height * 0.73 &&
      height < info.height * 0.24 &&
      width < info.width * 0.32 &&
      component.length < pixelCount * 0.08 &&
      (brightRatio > 0.18 || averageBrightness > 128);

    if (looksLikeBottomNumber) {
      for (const pixel of component) {
        data[pixel * 4 + 3] = 0;
      }
    }
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels
    }
  })
    .png()
    .toBuffer();
}

function alphaComponents(data, info) {
  const pixelCount = info.width * info.height;
  const seen = new Uint8Array(pixelCount);
  const queue = [];
  const components = [];

  for (let start = 0; start < pixelCount; start += 1) {
    if (seen[start] || data[start * 4 + 3] <= 18) {
      continue;
    }

    queue.length = 0;
    const pixels = [];
    let minX = info.width;
    let minY = info.height;
    let maxX = -1;
    let maxY = -1;
    let brightPixels = 0;
    let darkPixels = 0;

    queue.push(start);
    seen[start] = 1;
    while (queue.length > 0) {
      const current = queue.pop();
      pixels.push(current);
      const x = current % info.width;
      const y = Math.floor(current / info.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const offset = current * 4;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const maxChannel = Math.max(red, green, blue);
      const minChannel = Math.min(red, green, blue);
      if (maxChannel > 145 && maxChannel - minChannel < 115) {
        brightPixels += 1;
      }
      if (maxChannel < 90 && maxChannel - minChannel < 80) {
        darkPixels += 1;
      }

      const neighbors = [
        x > 0 ? current - 1 : -1,
        x < info.width - 1 ? current + 1 : -1,
        y > 0 ? current - info.width : -1,
        y < info.height - 1 ? current + info.width : -1
      ];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || seen[neighbor] || data[neighbor * 4 + 3] <= 18) {
          continue;
        }
        seen[neighbor] = 1;
        queue.push(neighbor);
      }
    }

    components.push({
      pixels,
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      count: pixels.length,
      brightPixels,
      darkPixels
    });
  }

  return components;
}

function clearComponent(data, component) {
  for (const pixel of component.pixels) {
    data[pixel * 4 + 3] = 0;
  }
}

function looksLikeNumberGlyph(component, info) {
  const centerY = (component.minY + component.maxY) / 2;
  const tonalRatio =
    (component.brightPixels + component.darkPixels) /
    Math.max(1, component.count);
  const smallGlyph =
    component.height <= info.height * 0.18 &&
    component.width <= info.width * 0.25 &&
    component.count <= info.width * info.height * 0.025;
  return (
    smallGlyph &&
    tonalRatio > 0.14 &&
    (centerY < info.height * 0.22 || centerY > info.height * 0.42)
  );
}

function erasePaleLabelInkBands(
  data,
  info,
  { topBand = 0.18, bottomBand = 0.66, radius = 1 } = {}
) {
  const mask = new Uint8Array(info.width * info.height);

  for (let y = 0; y < info.height; y += 1) {
    const inLabelBand =
      y < info.height * topBand || y > info.height * bottomBand;
    if (!inLabelBand) {
      continue;
    }
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * 4;
      if (
        isPaleLabelPixel(
          data[offset],
          data[offset + 1],
          data[offset + 2],
          data[offset + 3]
        )
      ) {
        mask[y * info.width + x] = 1;
      }
    }
  }

  const paleMask = mask.slice();
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (!paleMask[y * info.width + x]) {
        continue;
      }
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= info.width || yy >= info.height) {
            continue;
          }
          const offset = (yy * info.width + xx) * 4;
          const maxChannel = Math.max(
            data[offset],
            data[offset + 1],
            data[offset + 2]
          );
          const minChannel = Math.min(
            data[offset],
            data[offset + 1],
            data[offset + 2]
          );
          if (
            data[offset + 3] > 18 &&
            (maxChannel < 130 || maxChannel - minChannel < 115)
          ) {
            mask[yy * info.width + xx] = 1;
          }
        }
      }
    }
  }

  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (mask[pixel]) {
      data[pixel * 4 + 3] = 0;
    }
  }
}

async function removeItemLabelComponents(buffer, slot) {
  const image = sharp(buffer).ensureAlpha();
  const { data, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });
  const components = alphaComponents(data, info);
  const largest = Math.max(
    ...components.map((component) => component.count),
    0
  );

  for (const component of components) {
    const centerY = (component.minY + component.maxY) / 2;
    const scoreAsArt =
      component.count >= largest * 0.1 ||
      component.height >= info.height * 0.26 ||
      component.width >= info.width * 0.36;
    const lowDigit =
      centerY > info.height * 0.45 &&
      component.height < info.height * 0.23 &&
      component.width < info.width * 0.31 &&
      component.count < largest * 0.18;
    const topLeak =
      centerY < info.height * 0.16 &&
      component.height < info.height * 0.15 &&
      component.width < info.width * 0.38 &&
      component.count < largest * 0.09;
    const topOverflow =
      slot.row > 1 &&
      component.minY <= 2 &&
      component.maxY < info.height * 0.35 &&
      component.count < largest * 0.7;
    const sideOverflow =
      component.width < info.width * 0.22 &&
      component.height > info.height * 0.16 &&
      component.count < largest * 0.62 &&
      (component.minX <= 2 || component.maxX >= info.width - 3);
    const dust =
      component.count < Math.max(10, info.width * info.height * 0.00022);

    if (
      (!scoreAsArt && (looksLikeNumberGlyph(component, info) || lowDigit)) ||
      topLeak ||
      topOverflow ||
      sideOverflow ||
      dust
    ) {
      clearComponent(data, component);
    }
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels
    }
  })
    .png()
    .toBuffer();
}

function isPaleLabelPixel(red, green, blue, alpha) {
  if (alpha < 18) {
    return false;
  }
  const maxChannel = Math.max(red, green, blue);
  const minChannel = Math.min(red, green, blue);
  return (
    (maxChannel > 135 && minChannel > 95 && maxChannel - minChannel < 135) ||
    (red > 150 && blue > 135 && green > 95 && maxChannel - minChannel < 160)
  );
}

async function removeMascotLabelInk(buffer) {
  const image = sharp(buffer).ensureAlpha();
  const { data, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });
  erasePaleLabelInkBands(data, info, {
    topBand: 0.16,
    bottomBand: 0.76,
    radius: 2
  });

  for (const component of alphaComponents(data, info)) {
    if (component.count < Math.max(10, info.width * info.height * 0.00018)) {
      clearComponent(data, component);
    }
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels
    }
  })
    .png()
    .toBuffer();
}

async function removeRegriddedBleedComponents(buffer, role) {
  const image = sharp(buffer).ensureAlpha();
  const { data, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });
  const components = alphaComponents(data, info).sort(
    (left, right) => right.count - left.count
  );

  if (components.length <= 1) {
    return buffer;
  }

  const largest = components[0];
  const largestCenterX = (largest.minX + largest.maxX) / 2;
  const largestCenterY = (largest.minY + largest.maxY) / 2;
  const minDust = Math.max(12, Math.round(info.width * info.height * 0.0002));
  const edgeInset = Math.max(
    3,
    Math.round(Math.min(info.width, info.height) * 0.01)
  );

  for (const component of components.slice(1)) {
    const componentCenterX = (component.minX + component.maxX) / 2;
    const componentCenterY = (component.minY + component.maxY) / 2;
    const horizontalGap =
      component.maxX < largest.minX
        ? largest.minX - component.maxX
        : component.minX > largest.maxX
          ? component.minX - largest.maxX
          : 0;
    const verticalGap =
      component.maxY < largest.minY
        ? largest.minY - component.maxY
        : component.minY > largest.maxY
          ? component.minY - largest.maxY
          : 0;
    const touchesLeft = component.minX <= edgeInset;
    const touchesRight = component.maxX >= info.width - 1 - edgeInset;
    const touchesTop = component.minY <= edgeInset;
    const touchesBottom = component.maxY >= info.height - 1 - edgeInset;
    const edgeTouching =
      touchesLeft || touchesRight || touchesTop || touchesBottom;
    const sideSlice =
      (touchesLeft || touchesRight) &&
      component.width < info.width * 0.34 &&
      component.count < largest.count * 0.55;
    const rowSlice =
      (touchesTop || touchesBottom) &&
      component.height < info.height * (role === "mascot" ? 0.28 : 0.22) &&
      component.count < largest.count * 0.55;
    const detachedSideSlice =
      role === "item" &&
      horizontalGap > info.width * 0.08 &&
      Math.abs(componentCenterX - largestCenterX) > info.width * 0.34 &&
      component.count < largest.count * 0.35;
    const detachedRowSlice =
      role === "mascot" &&
      verticalGap > info.height * 0.06 &&
      componentCenterY > largestCenterY &&
      component.count < largest.count * 0.35;
    const tinyDust = component.count < minDust;

    if (
      tinyDust ||
      detachedSideSlice ||
      detachedRowSlice ||
      (edgeTouching && (sideSlice || rowSlice))
    ) {
      clearComponent(data, component);
    }
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels
    }
  })
    .png()
    .toBuffer();
}

async function cropToAlphaBounds(
  buffer,
  { padRatio = 0.18, bottomExtra = 4 } = {}
) {
  const image = sharp(buffer).ensureAlpha();
  const { data, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;

  for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
    if (data[pixel * 4 + 3] <= 22) {
      continue;
    }
    const x = pixel % info.width;
    const y = Math.floor(pixel / info.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (maxX < 0 || maxY < 0) {
    return buffer;
  }

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const pad = Math.ceil(Math.max(width, height) * padRatio);
  const left = Math.max(0, minX - pad - 2);
  const top = Math.max(0, minY - pad - 2);
  const right = Math.min(info.width - 1, maxX + pad + 2);
  const bottom = Math.min(info.height - 1, maxY + pad + bottomExtra);

  return sharp(buffer)
    .extract({
      left,
      top,
      width: right - left + 1,
      height: bottom - top + 1
    })
    .png()
    .toBuffer();
}

async function writeSpriteSet(
  sourceBuffer,
  outputSourceDir,
  outputSpriteDir,
  key
) {
  await sharp(sourceBuffer)
    .png()
    .toFile(path.join(outputSourceDir, `${key}.png`));
  for (const size of sizes) {
    await sharp(sourceBuffer)
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(path.join(outputSpriteDir, `${key}-${size}.png`));
    await sharp(sourceBuffer)
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .webp({ quality: 94, alphaQuality: 100 })
      .toFile(path.join(outputSpriteDir, `${key}-${size}.webp`));
  }
}

async function softenTransparentEdgeChromaSpill(buffer) {
  const image = sharp(buffer).ensureAlpha();
  const { data, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixelCount = info.width * info.height;
  const originalAlpha = new Uint8Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    originalAlpha[pixel] = data[pixel * 4 + 3];
  }

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const alpha = originalAlpha[pixel];
    if (alpha <= 20) {
      continue;
    }

    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const greenGap = green - Math.max(red, blue);
    const magentaGap = Math.min(red, blue) - green;
    const greenSpill = green > 74 && greenGap > 18;
    const magentaSpill = red > 90 && blue > 90 && magentaGap > 18;
    if (!greenSpill && !magentaSpill) {
      continue;
    }

    const x = pixel % info.width;
    const y = Math.floor(pixel / info.width);
    const nearTransparent =
      (x > 0 && originalAlpha[pixel - 1] <= 18) ||
      (x < info.width - 1 && originalAlpha[pixel + 1] <= 18) ||
      (y > 0 && originalAlpha[pixel - info.width] <= 18) ||
      (y < info.height - 1 && originalAlpha[pixel + info.width] <= 18) ||
      (x > 0 && y > 0 && originalAlpha[pixel - info.width - 1] <= 18) ||
      (x < info.width - 1 &&
        y > 0 &&
        originalAlpha[pixel - info.width + 1] <= 18) ||
      (x > 0 &&
        y < info.height - 1 &&
        originalAlpha[pixel + info.width - 1] <= 18) ||
      (x < info.width - 1 &&
        y < info.height - 1 &&
        originalAlpha[pixel + info.width + 1] <= 18);
    if (!nearTransparent) {
      continue;
    }

    if (greenSpill) {
      data[offset + 1] = Math.max(
        red,
        blue,
        green - Math.min(greenGap, 70)
      );
      if (greenGap > 28) {
        data[offset + 3] = Math.round(alpha * 0.48);
      }
    } else {
      const target = Math.max(green + 8, Math.min(red, blue) - 32);
      data[offset] = Math.min(red, target);
      data[offset + 2] = Math.min(blue, target);
      if (magentaGap > 32) {
        data[offset + 3] = Math.round(alpha * 0.6);
      }
    }
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels
    }
  })
    .png()
    .toBuffer();
}

async function cropAtlasSlot({
  theme,
  atlas,
  slotIndex,
  key,
  role,
  outputSourceDir,
  outputSpriteDir
}) {
  const originalAtlasPath = atlasPathForTheme(theme, atlas);
  const regriddedAtlasPath = regriddedAtlasPathForTheme(theme, atlas);
  const atlasPath = regriddedAtlasPath ?? originalAtlasPath;
  const manualRegions = await cropRegionsForThemeAtlas(theme, atlas);
  const manualRegion = regriddedAtlasPath
    ? null
    : (manualRegions?.[slotIndex] ?? null);
  const metadata = regriddedAtlasPath
    ? await sharp(atlasPath).metadata()
    : null;
  const bounds =
    manualRegion || regriddedAtlasPath
      ? null
      : await detectAtlasBounds(atlasPath);
  const slot = regriddedAtlasPath
    ? regriddedSlotForIndex(slotIndex, atlas, metadata)
    : manualRegion
      ? manualSlotForRegion(manualRegion, slotIndex, atlas)
      : slotForIndex(
          slotIndex,
          atlas.columns,
          bounds,
          atlas.rows,
          atlas.labelCutoff
        );
  const slotBuffer = await sharp(atlasPath).extract(slot).png().toBuffer();
  const transparentSlotBuffer = regriddedAtlasPath
    ? await removeConnectedGreenChromaKey(slotBuffer)
    : await removeChromaKey(slotBuffer);
  const labelCleanedSlotBuffer = manualRegion
    ? transparentSlotBuffer
    : theme.id === "dramatic-smithie" && role === "mascot"
      ? await removeMascotLabelInk(transparentSlotBuffer)
      : await removeItemLabelComponents(transparentSlotBuffer, slot);
  const bleedCleanedSlotBuffer = regriddedAtlasPath
    ? await removeRegriddedBleedComponents(labelCleanedSlotBuffer, role)
    : labelCleanedSlotBuffer;
  const componentCleanedSlotBuffer = await removeSmallAlphaComponents(
    bleedCleanedSlotBuffer
  );
  const cleanedSlotBuffer = await cropToAlphaBounds(
    componentCleanedSlotBuffer,
    {
      padRatio: manualRegion
        ? 0.08
        : theme.id === "dramatic-smithie" && role === "mascot"
          ? 0.26
          : 0.22,
      bottomExtra: manualRegion
        ? 2
        : theme.id === "dramatic-smithie" && role === "mascot"
          ? 10
          : 8
    }
  );
  const framedSpriteBuffer = await sharp(cleanedSlotBuffer)
    .resize(928, 928, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();
  const sourceBuffer = await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: framedSpriteBuffer, left: 48, top: 48 }])
    .png()
    .toBuffer();
  const finalSourceBuffer = key.startsWith("item-trophy-projects-")
    ? await softenTransparentEdgeChromaSpill(sourceBuffer)
    : sourceBuffer;
  await writeSpriteSet(finalSourceBuffer, outputSourceDir, outputSpriteDir, key);

  return {
    key,
    theme: theme.id,
    role,
    atlasKey: atlas.atlasKey,
    atlasIndex: slotIndex + 1,
    atlasRow: slot.row,
    atlasColumn: slot.column,
    cropSource: regriddedAtlasPath ? "regridded" : "atlas",
    cropSourcePath: regriddedAtlasPath ?? originalAtlasPath,
    manualCrop: Boolean(manualRegion),
    cropRegion: {
      x: slot.left,
      y: slot.top,
      width: slot.width,
      height: slot.height
    },
    sourcePath:
      role === "mascot"
        ? `gamification/source/themes/${theme.id}/mascots/${key}.png`
        : `gamification/source/themes/${theme.id}/items/${key}.png`,
    spritePath:
      role === "mascot"
        ? `gamification/sprites/themes/${theme.id}/mascots/${key}-{size}.webp`
        : `gamification/sprites/themes/${theme.id}/items/${key}-{size}.webp`,
    perceptualHash: hashFileKey(theme.id, atlas.atlasKey, key, slotIndex)
  };
}

async function buildContactSheet(keys, spriteDir, outputPath, columns) {
  const cell = 256;
  const rows = Math.ceil(keys.length / columns);
  await sharp({
    create: {
      width: columns * cell,
      height: rows * cell,
      channels: 4,
      background: { r: 7, g: 10, b: 18, alpha: 1 }
    }
  })
    .composite(
      keys.map((key, index) => ({
        input: path.join(spriteDir, `${key}-256.png`),
        left: (index % columns) * cell,
        top: Math.floor(index / columns) * cell
      }))
    )
    .png()
    .toFile(outputPath);
}

for (const theme of themes) {
  const dirs = themeDirs(theme);
  await Promise.all(
    Object.values(dirs).map((directory) =>
      mkdir(directory, { recursive: true })
    )
  );
  await Promise.all(
    Object.values(atlasConfigs).map((config) =>
      assertFile(atlasPathForTheme(theme, config))
    )
  );
}

const trophies = GAMIFICATION_CATALOG.filter((item) => item.kind === "trophy");
const unlocks = GAMIFICATION_CATALOG.filter((item) => item.kind === "unlock");
const trophySlots = Array.from({ length: 100 }, (_, index) => ({
  key:
    trophies[index]?.assetKey ??
    `trophy-reserve-${String(index + 1).padStart(3, "0")}`,
  item: trophies[index] ?? null
}));
const unlockSlots = Array.from({ length: 100 }, (_, index) => ({
  key:
    unlocks[index]?.assetKey ??
    `unlock-reserve-${String(index + 1).padStart(3, "0")}`,
  item: unlocks[index] ?? null
}));

const manifestRecords = [];

for (const theme of themes) {
  const dirs = themeDirs(theme);

  for (const [index, slot] of trophySlots.entries()) {
    const record = await cropAtlasSlot({
      theme,
      atlas: atlasConfigs.trophies,
      slotIndex: index,
      key: slot.key,
      role: "item",
      outputSourceDir: dirs.itemSourceDir,
      outputSpriteDir: dirs.itemSpriteDir
    });
    manifestRecords.push({
      ...record,
      itemId: slot.item?.id ?? null,
      kind: "trophy",
      prompt: slot.item
        ? GAMIFICATION_ASSET_MANIFEST[slot.item.assetKey].prompt
        : "Reserved future trophy atlas sprite.",
      alt: slot.item
        ? GAMIFICATION_ASSET_MANIFEST[slot.item.assetKey].alt
        : `Reserved trophy sprite ${index + 1}.`,
      dominantColor: slot.item
        ? GAMIFICATION_ASSET_MANIFEST[slot.item.assetKey].dominantColor
        : "#f59e0b",
      sheetKey:
        slot.item?.sheetKey ??
        `trophies-r${Math.floor(index / 10) + 1}-c${(index % 10) + 1}`
    });
  }

  for (const [index, slot] of unlockSlots.entries()) {
    const record = await cropAtlasSlot({
      theme,
      atlas: atlasConfigs.unlocks,
      slotIndex: index,
      key: slot.key,
      role: "item",
      outputSourceDir: dirs.itemSourceDir,
      outputSpriteDir: dirs.itemSpriteDir
    });
    manifestRecords.push({
      ...record,
      itemId: slot.item?.id ?? null,
      kind: "unlock",
      prompt: slot.item
        ? GAMIFICATION_ASSET_MANIFEST[slot.item.assetKey].prompt
        : "Reserved future cosmetic unlock atlas sprite.",
      alt: slot.item
        ? GAMIFICATION_ASSET_MANIFEST[slot.item.assetKey].alt
        : `Reserved cosmetic unlock sprite ${index + 1}.`,
      dominantColor: slot.item
        ? GAMIFICATION_ASSET_MANIFEST[slot.item.assetKey].dominantColor
        : "#38bdf8",
      sheetKey:
        slot.item?.sheetKey ??
        `unlocks-r${Math.floor(index / 10) + 1}-c${(index % 10) + 1}`
    });
  }

  for (const [index, key] of GAMIFICATION_MASCOT_KEYS.entries()) {
    const record = await cropAtlasSlot({
      theme,
      atlas: atlasConfigs.mascots,
      slotIndex: index,
      key,
      role: "mascot",
      outputSourceDir: dirs.mascotSourceDir,
      outputSpriteDir: dirs.mascotSpriteDir
    });
    const manifest = GAMIFICATION_ASSET_MANIFEST[key];
    manifestRecords.push({
      ...record,
      prompt: manifest.prompt,
      alt: manifest.alt,
      dominantColor: manifest.dominantColor,
      sheetKey: manifest.sheetKey
    });
  }

  await buildContactSheet(
    trophySlots.map((slot) => slot.key),
    dirs.itemSpriteDir,
    path.join(dirs.sheetDir, "trophies-cropped-contact-sheet.png"),
    10
  );
  await buildContactSheet(
    unlockSlots.map((slot) => slot.key),
    dirs.itemSpriteDir,
    path.join(dirs.sheetDir, "unlocks-cropped-contact-sheet.png"),
    10
  );
  await buildContactSheet(
    GAMIFICATION_CATALOG.map((item) => item.assetKey),
    dirs.itemSpriteDir,
    path.join(dirs.sheetDir, "items-contact-sheet.png"),
    12
  );
  await buildContactSheet(
    GAMIFICATION_MASCOT_KEYS,
    dirs.mascotSpriteDir,
    path.join(dirs.sheetDir, "mascots-contact-sheet.png"),
    6
  );
}

await writeFile(
  path.join(sourceRoot, "asset-manifest.generated.json"),
  `${JSON.stringify(manifestRecords, null, 2)}\n`
);

console.log(
  `Cropped transparent atlas sprites for ${themes.length} themes: ${trophySlots.length} trophies, ${unlockSlots.length} cosmetic unlocks, ${GAMIFICATION_MASCOT_KEYS.length} mascot states per theme.`
);
