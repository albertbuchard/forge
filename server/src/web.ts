import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";

const distDir = path.join(process.cwd(), "dist");
const defaultBasePath = process.env.FORGE_BASE_PATH ?? "/forge/";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function normalizeBasePath(value: string) {
  if (!value || value === "/") {
    return "/";
  }

  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

function stripBasePath(requestPath: string, basePath: string) {
  const normalizedBasePath = normalizeBasePath(basePath);
  if (normalizedBasePath === "/") {
    return requestPath;
  }

  const normalizedRoot = normalizedBasePath.slice(0, -1);
  if (requestPath === normalizedRoot) {
    return "/";
  }

  if (requestPath.startsWith(normalizedBasePath)) {
    const stripped = requestPath.slice(normalizedRoot.length);
    return stripped.startsWith("/") ? stripped : `/${stripped}`;
  }

  return requestPath;
}

function resolveAsset(clientDir: string, requestPath: string): string {
  if (requestPath === "/") {
    return path.join(clientDir, "index.html");
  }

  const safePath = requestPath.replace(/^\/+/, "");
  return path.join(clientDir, safePath);
}

async function getClientDir() {
  await access(path.join(distDir, "index.html"));
  return distDir;
}

async function serveAsset(requestPath: string, reply: FastifyReply) {
  if (requestPath.startsWith("/api")) {
    reply.code(404);
    return { error: "Not found" };
  }

  const clientDir = await getClientDir();
  const normalizedRequestPath = stripBasePath(requestPath, defaultBasePath);
  const assetPath = resolveAsset(clientDir, normalizedRequestPath);
  const ext = path.extname(assetPath);

  try {
    const payload = await readFile(assetPath);
    reply.type(contentTypes[ext] ?? "application/octet-stream");
    reply.header("Cache-Control", "no-store, max-age=0, must-revalidate");
    if (ext === ".html") {
      reply.header("Pragma", "no-cache");
    }
    return payload;
  } catch {
    if (!path.extname(normalizedRequestPath)) {
      try {
        const payload = await readFile(path.join(clientDir, "index.html"));
        reply.type(contentTypes[".html"]);
        reply.header("Cache-Control", "no-store, max-age=0, must-revalidate");
        reply.header("Pragma", "no-cache");
        return payload;
      } catch {
        reply.code(503);
        return {
          code: "frontend_not_built",
          error: "Forge frontend build output is missing. Run the Vite build before serving the modern web client.",
          statusCode: 503
        };
      }
    }

    reply.code(404);
    return { error: "Asset not found" };
  }
}

export async function registerWebRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_request, reply) => serveAsset("/", reply));
  app.get("/*", async (request, reply) => serveAsset(request.url, reply));
}
