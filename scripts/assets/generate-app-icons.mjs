#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const forgeRoot = path.resolve(__dirname, "../..");

const mastersDir = path.join(forgeRoot, "assets", "app-icons", "masters");
const master = {
  largeDark: path.join(mastersDir, "forge-icon-large-dark-master.png"),
  largeLight: path.join(mastersDir, "forge-icon-large-light-master.png"),
  mediumDark: path.join(mastersDir, "forge-icon-medium-dark-master.png"),
  mediumLight: path.join(mastersDir, "forge-icon-medium-light-master.png"),
  smallDark: path.join(mastersDir, "forge-icon-small-dark-master.png"),
  smallLight: path.join(mastersDir, "forge-icon-small-light-master.png"),
  letterhead: path.join(mastersDir, "forge-letterhead-watermark.png"),
};

const tauriIconDir = path.join(forgeRoot, "src-tauri", "icons");
const iosIconDir = path.join(
  forgeRoot,
  "ios-companion",
  "ForgeCompanion",
  "ForgeCompanion",
  "Assets.xcassets",
  "AppIcon.appiconset",
);
const watchIconDir = path.join(
  forgeRoot,
  "ios-companion",
  "ForgeCompanion",
  "ForgeWatch Watch App",
  "Assets.xcassets",
  "AppIcon.appiconset",
);
const watchSharedIconDir = path.join(
  forgeRoot,
  "ios-companion",
  "ForgeCompanion",
  "ForgeWatch",
  "Assets.xcassets",
  "AppIcon.appiconset",
);

const pngOptions = {
  compressionLevel: 9,
  adaptiveFiltering: true,
};

function requireMasters() {
  for (const file of Object.values(master)) {
    if (!fs.existsSync(file)) {
      throw new Error(`Missing app icon master: ${path.relative(forgeRoot, file)}`);
    }
  }
}

async function writePng(input, output, size, options = {}) {
  const background = options.background ?? { r: 1, g: 7, b: 24 };
  let image = sharp(input, { failOn: "none" })
    .rotate()
    .resize(size, size, { fit: "cover", position: "center" })
    .flatten({ background })
    .toColorspace("srgb");

  if (options.grayscale) {
    image = image.grayscale();
  }

  if (options.tint) {
    image = image.tint(options.tint);
  }

  if (options.sharpen) {
    image = image.sharpen({ sigma: options.sharpen });
  }

  await fs.promises.mkdir(path.dirname(output), { recursive: true });
  await image.png(pngOptions).toFile(output);
}

async function pngBuffer(input, size) {
  let image = sharp(input, { failOn: "none" })
    .rotate()
    .resize(size, size, { fit: "cover", position: "center" })
    .flatten({ background: { r: 1, g: 7, b: 24 } })
    .toColorspace("srgb");

  if (size <= 64) {
    image = image.sharpen({ sigma: 0.65 });
  }

  return image
    .png(pngOptions)
    .toBuffer();
}

async function writeIco(input, output, sizes) {
  const images = await Promise.all(sizes.map((size) => pngBuffer(input, size)));
  const headerSize = 6;
  const directorySize = images.length * 16;
  let offset = headerSize + directorySize;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = images.map((buffer, index) => {
    const size = sizes[index];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += buffer.length;
    return entry;
  });

  await fs.promises.mkdir(path.dirname(output), { recursive: true });
  await fs.promises.writeFile(output, Buffer.concat([header, ...entries, ...images]));
}

async function writeSvgFromPng(input, output) {
  const png = await pngBuffer(input, 256);
  const href = `data:image/png;base64,${png.toString("base64")}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" role="img" aria-label="Forge icon">
  <image href="${href}" width="256" height="256" preserveAspectRatio="xMidYMid slice"/>
</svg>
`;
  await fs.promises.writeFile(output, svg, "utf8");
}

async function writeIcns(input, outputDir) {
  const iconset = path.join(outputDir, "icon.iconset");
  await fs.promises.rm(iconset, { recursive: true, force: true });
  await fs.promises.mkdir(iconset, { recursive: true });

  const entries = [
    ["icon_16x16.png", 16],
    ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32],
    ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128],
    ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256],
    ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512],
    ["icon_512x512@2x.png", 1024],
  ];

  for (const [filename, size] of entries) {
    await writePng(input, path.join(iconset, filename), size);
  }

  execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(outputDir, "icon.icns")], {
    stdio: "inherit",
  });
  await fs.promises.rm(iconset, { recursive: true, force: true });
}

async function writeWebIcons() {
  const targets = [
    path.join(forgeRoot, "public", "favicon.png"),
    path.join(forgeRoot, "public", "favicon-64.png"),
  ];

  for (const target of targets) {
    await writePng(master.smallDark, target, 64, { sharpen: 0.65 });
  }

  await writePng(master.smallDark, path.join(forgeRoot, "public", "favicon-32.png"), 32, { sharpen: 0.65 });
  await writePng(master.smallDark, path.join(forgeRoot, "public", "favicon-16.png"), 16, { sharpen: 0.65 });
  await writePng(master.mediumLight, path.join(forgeRoot, "public", "apple-touch-icon.png"), 180, {
    background: { r: 248, g: 240, b: 220 },
  });
  await writePng(master.letterhead, path.join(forgeRoot, "public", "forge-letterhead-watermark.png"), 1024, {
    background: { r: 255, g: 255, b: 255 },
  });

  await writeIco(master.smallDark, path.join(forgeRoot, "public", "favicon.ico"), [16, 32, 48, 64]);
  await writeSvgFromPng(master.smallDark, path.join(forgeRoot, "public", "favicon.svg"));
}

async function writeIosIcons() {
  await writePng(master.largeLight, path.join(iosIconDir, "AppIcon-ios-1024.png"), 1024, {
    background: { r: 248, g: 240, b: 220 },
  });
  await writePng(master.largeDark, path.join(iosIconDir, "AppIcon-ios-dark-1024.png"), 1024);
  await writePng(master.smallLight, path.join(iosIconDir, "AppIcon-ios-tinted-1024.png"), 1024, {
    background: { r: 248, g: 240, b: 220 },
    grayscale: true,
    tint: { r: 31, g: 41, b: 51 },
  });
}

async function writeWatchIcons() {
  const target = path.join(watchIconDir, "AppIcon-watch-1024.png");
  await writePng(master.mediumDark, target, 1024);
  await fs.promises.mkdir(watchSharedIconDir, { recursive: true });
  await fs.promises.copyFile(target, path.join(watchSharedIconDir, "AppIcon-watch-1024.png"));
}

async function writeTauriIcons() {
  await fs.promises.mkdir(tauriIconDir, { recursive: true });
  await writePng(master.smallDark, path.join(tauriIconDir, "32x32.png"), 32, { sharpen: 0.65 });
  await writePng(master.mediumDark, path.join(tauriIconDir, "128x128.png"), 128);
  await writePng(master.mediumDark, path.join(tauriIconDir, "128x128@2x.png"), 256);
  await writePng(master.largeDark, path.join(tauriIconDir, "icon.png"), 1024);
  await writeIco(master.mediumDark, path.join(tauriIconDir, "icon.ico"), [16, 32, 48, 64, 128, 256]);
  await writeIcns(master.largeDark, tauriIconDir);
}

async function main() {
  requireMasters();
  await writeWebIcons();
  await writeIosIcons();
  await writeWatchIcons();
  await writeTauriIcons();
  console.log("Forge app icons generated.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
