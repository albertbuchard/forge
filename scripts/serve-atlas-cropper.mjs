import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolRoot = path.join(projectRoot, "tools", "atlas-cropper");
const gamificationRoot = path.join(projectRoot, "public", "gamification");
const cropRegionRoot = path.join(toolRoot, "crop-regions");
const port = Number(process.env.PORT ?? 4325);
const host = process.env.HOST ?? "127.0.0.1";

const atlasFiles = new Map([
  ["trophies", "trophies-100.png"],
  ["unlocks", "unlocks-100.png"],
  ["mascots", "mascot-states-30.png"]
]);
const themes = new Set(["dark-fantasy", "dramatic-smithie", "mind-locksmith"]);

function send(response, status, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  response.end(body);
}

function contentTypeFor(pathname) {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function cropRegionPath(theme, atlasKey) {
  if (!themes.has(theme)) {
    throw new Error(`Unknown theme: ${theme}`);
  }
  if (!atlasFiles.has(atlasKey)) {
    throw new Error(`Unknown atlas: ${atlasKey}`);
  }
  return path.join(cropRegionRoot, theme, `${atlasKey}.json`);
}

function validatePayload(payload) {
  if (!payload || payload.schema !== "forge-gamification-atlas-crops-v1") {
    throw new Error("Invalid crop payload schema.");
  }
  if (!themes.has(payload.theme)) {
    throw new Error(`Unknown theme: ${payload.theme}`);
  }
  if (!atlasFiles.has(payload.atlasKey)) {
    throw new Error(`Unknown atlas: ${payload.atlasKey}`);
  }
  if (!Array.isArray(payload.regions) || payload.regions.length === 0) {
    throw new Error("Payload must include at least one crop region.");
  }
  payload.regions.forEach((region, index) => {
    for (const key of ["x", "y", "width", "height"]) {
      if (!Number.isFinite(Number(region[key]))) {
        throw new Error(`Region ${index + 1} has invalid ${key}.`);
      }
    }
    if (Number(region.width) <= 0 || Number(region.height) <= 0) {
      throw new Error(`Region ${index + 1} must have positive width and height.`);
    }
  });
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function serveFile(response, pathname, root) {
  const normalized = path.normalize(safeDecode(pathname)).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(root, normalized);
  if (!absolutePath.startsWith(root)) {
    send(response, 403, "Forbidden");
    return;
  }
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    send(response, 404, "Not found");
    return;
  }
  const body = await readFile(absolutePath);
  send(response, 200, body, contentTypeFor(absolutePath));
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);

    if (request.method === "GET" && url.pathname === "/") {
      await serveFile(response, "index.html", toolRoot);
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/gamification/")) {
      await serveFile(response, url.pathname.replace(/^\/gamification\//, ""), gamificationRoot);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/crop-regions") {
      const theme = url.searchParams.get("theme") ?? "";
      const atlas = url.searchParams.get("atlas") ?? "";
      const pathname = cropRegionPath(theme, atlas);
      const body = await readFile(pathname, "utf8");
      send(response, 200, body, "application/json; charset=utf-8");
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/crop-regions") {
      const body = await readRequestBody(request);
      const payload = JSON.parse(body);
      validatePayload(payload);
      const pathname = cropRegionPath(payload.theme, payload.atlasKey);
      await mkdir(path.dirname(pathname), { recursive: true });
      await writeFile(pathname, `${JSON.stringify(payload, null, 2)}\n`);
      send(
        response,
        200,
        JSON.stringify({
          ok: true,
          path: path.relative(projectRoot, pathname)
        }),
        "application/json; charset=utf-8"
      );
      return;
    }

    send(response, 404, "Not found");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send(response, 500, message);
  }
});

server.listen(port, host, () => {
  console.log(`Forge atlas cropper running at http://${host}:${port}/`);
});
