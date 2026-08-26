import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import {
  buildForgeHmrConfig,
  forgeViteClientOriginPlugin
} from "./apps/web/src/lib/vite-hmr";
import { forgeViteSecurityGateway } from "./apps/web/vite-security-gateway";

const testWorkerExecArgv = process.allowedNodeEnvironmentFlags.has(
  "--no-experimental-webstorage"
)
  ? ["--no-experimental-webstorage"]
  : [];

function normalizeBasePath(value: string) {
  if (!value || value === "/") {
    return "/";
  }

  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.endsWith("/")
    ? withLeadingSlash
    : `${withLeadingSlash}/`;
}

export default defineConfig(({ command }) => {
  const base = normalizeBasePath(
    process.env.FORGE_BASE_PATH ?? (command === "build" ? "/forge/" : "/")
  );
  const apiTarget = process.env.FORGE_API_ORIGIN ?? "http://127.0.0.1:4317";

  return {
    root: path.resolve(__dirname, "apps/web"),
    base,
    plugins: [
      forgeViteSecurityGateway({ apiTarget }),
      forgeViteClientOriginPlugin(),
      react(),
      tailwindcss()
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./apps/web/src")
      }
    },
    server: {
      host: "0.0.0.0",
      port: 3027,
      strictPort: true,
      allowedHosts: true,
      hmr: buildForgeHmrConfig(base, process.env),
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true
        },
        "/forge/api": {
          target: apiTarget,
          changeOrigin: true,
          rewrite: (requestPath) => requestPath.replace(/^\/forge/, "")
        }
      }
    },
    preview: {
      host: "0.0.0.0",
      port: 4317,
      strictPort: true
    },
    build: {
      outDir: path.resolve(__dirname, "dist"),
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) {
              return undefined;
            }

            if (
              id.includes("framer-motion") ||
              id.includes("motion-dom") ||
              id.includes("motion-utils")
            ) {
              return "motion";
            }

            if (
              id.includes("@tanstack/react-table") ||
              id.includes("@tanstack/table-core")
            ) {
              return "table";
            }

            if (
              id.includes("@radix-ui") ||
              id.includes("@floating-ui") ||
              id.includes("react-remove-scroll")
            ) {
              return "ui";
            }

            if (id.includes("@dnd-kit")) {
              return "board";
            }

            if (
              id.includes("@tanstack/react-query") ||
              id.includes("@reduxjs/toolkit") ||
              id.includes("react-redux") ||
              id.includes("zustand")
            ) {
              return "state";
            }

            if (id.includes("recharts")) {
              return "charts";
            }

            if (
              id.includes("@xyflow") ||
              id.includes("sigma") ||
              id.includes("graphology")
            ) {
              return "graph";
            }

            if (id.includes("maplibre-gl")) {
              return "maps";
            }

            if (id.includes("@tiptap") || id.includes("prosemirror")) {
              return "editor";
            }

            if (
              id.includes("react-hook-form") ||
              id.includes("@hookform/resolvers") ||
              id.includes("zod")
            ) {
              return "forms";
            }

            if (
              id.includes("tsdav") ||
              id.includes("node-ical") ||
              id.includes("cron-parser")
            ) {
              return "calendar-data";
            }

            return "vendor";
          }
        }
      }
    },
    test: {
      environment: "jsdom",
      setupFiles: path.resolve(__dirname, "vitest.setup.ts"),
      include: ["src/**/*.test.{ts,tsx}"],
      poolOptions: {
        threads: {
          execArgv: testWorkerExecArgv
        },
        forks: {
          execArgv: testWorkerExecArgv
        }
      }
    }
  };
});
