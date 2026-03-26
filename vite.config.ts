import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

function normalizeBasePath(value: string) {
  if (!value || value === "/") {
    return "/";
  }

  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

export default defineConfig(({ command }) => {
  const base = normalizeBasePath(process.env.FORGE_BASE_PATH ?? (command === "build" ? "/forge/" : "/"));
  const apiTarget = process.env.FORGE_API_ORIGIN ?? "http://127.0.0.1:3017";

  return {
    base,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src")
      }
    },
    server: {
      host: "0.0.0.0",
      port: 3027,
      allowedHosts: true,
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
      port: 3017,
      strictPort: true
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) {
              return undefined;
            }

            if (id.includes("recharts") || id.includes("/d3-")) {
              return "viz";
            }

            if (id.includes("framer-motion") || id.includes("motion-dom") || id.includes("motion-utils")) {
              return "motion";
            }

            if (id.includes("@tanstack/react-table") || id.includes("@tanstack/table-core")) {
              return "table";
            }

            if (id.includes("@radix-ui") || id.includes("@floating-ui") || id.includes("react-remove-scroll")) {
              return "ui";
            }

            if (id.includes("@dnd-kit")) {
              return "board";
            }

            return "vendor";
          }
        }
      }
    },
    test: {
      environment: "jsdom",
      setupFiles: "./vitest.setup.ts",
      include: ["src/**/*.test.{ts,tsx}"]
    }
  };
});
