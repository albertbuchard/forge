import { describe, expect, it } from "vitest";
import {
  buildForgeHmrConfig,
  buildForgeHmrPath,
  patchForgeViteClientSocketHost
} from "@/lib/vite-hmr";

describe("vite hmr helpers", () => {
  it("builds an hmr websocket path relative to the forge base path", () => {
    expect(buildForgeHmrPath("/forge/")).toBe("__vite_hmr");
    expect(buildForgeHmrPath("forge")).toBe("__vite_hmr");
    expect(buildForgeHmrPath("/")).toBe("__vite_hmr");
  });

  it("includes explicit host and websocket overrides when provided", () => {
    expect(
      buildForgeHmrConfig("/forge/", {
        FORGE_HMR_HOST: "macbook-pro.example.ts.net",
        FORGE_HMR_PROTOCOL: "wss",
        FORGE_HMR_PORT: "3027",
        FORGE_HMR_CLIENT_PORT: "443"
      })
    ).toEqual({
      path: "__vite_hmr",
      host: "macbook-pro.example.ts.net",
      protocol: "wss",
      port: 3027,
      clientPort: 443
    });
  });

  it("omits the websocket port separator on default HTTPS origins", () => {
    const source = [
      "const hmrPort = null;",
      'const socketHost = `${null || importMetaUrl.hostname}:${hmrPort || importMetaUrl.port}${"/forge/__vite_hmr"}`;'
    ].join("\n");

    const patched = patchForgeViteClientSocketHost(source);

    expect(patched).toContain(
      "const forgeSocketPort = hmrPort || importMetaUrl.port;"
    );
    expect(patched).toContain(
      '${forgeSocketPort ? `:${forgeSocketPort}` : ""}'
    );
    expect(patched).not.toContain(":${hmrPort || importMetaUrl.port}");
  });

  it("preserves explicit development ports and leaves unrelated modules alone", () => {
    const source =
      "const socketHost = `${__HMR_HOSTNAME__ || importMetaUrl.hostname}:${hmrPort || importMetaUrl.port}${__HMR_BASE__}`;";
    const patched = patchForgeViteClientSocketHost(source);

    expect(patched).toContain(
      "const forgeSocketPort = hmrPort || importMetaUrl.port;"
    );
    expect(patched).toContain("__HMR_HOSTNAME__ || importMetaUrl.hostname");
    expect(patched).toContain("__HMR_BASE__");
    expect(patchForgeViteClientSocketHost("export const value = 1;")).toBe(
      "export const value = 1;"
    );
  });
});
