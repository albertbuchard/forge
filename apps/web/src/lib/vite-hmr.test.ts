import { describe, expect, it } from "vitest";
import { buildForgeHmrConfig, buildForgeHmrPath } from "@/lib/vite-hmr";

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
});
