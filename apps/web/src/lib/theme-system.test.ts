import { beforeEach, describe, expect, it } from "vitest";
import {
  applyForgeThemeToDocument,
  defaultCustomTheme,
  FORGE_THEME_BOOTSTRAP_STORAGE_KEY,
  FORGE_THEME_CHANGE_EVENT,
  forgeThemeCatalog,
  getForgeThemeDocumentKey,
  getForgeCustomThemeMode,
  resolveForgeThemeToken
} from "@/lib/theme-system";

describe("theme system", () => {
  beforeEach(() => {
    document.body.className = "";
    document.body.removeAttribute("style");
    document.documentElement.removeAttribute("data-forge-theme");
    document.documentElement.removeAttribute("data-forge-boot-theme");
    document.documentElement.removeAttribute("style");
    window.localStorage.clear();
  });

  it("applies the solar preset through the class-based theme slot", () => {
    applyForgeThemeToDocument("solar");

    expect(document.body.classList.contains("theme-forge-solar")).toBe(true);
    expect(document.body.classList.contains("theme-forge-dark")).toBe(true);
    expect(forgeThemeCatalog.solar.label).toBe("Catppuccin");
  });

  it("applies the aurora and ember presets through the themed shell classes", () => {
    applyForgeThemeToDocument("aurora");
    expect(document.body.classList.contains("theme-forge-aurora")).toBe(true);
    expect(forgeThemeCatalog.aurora.label).toBe("Nord");

    applyForgeThemeToDocument("ember");
    expect(document.body.classList.contains("theme-forge-ember")).toBe(true);
    expect(forgeThemeCatalog.ember.label).toBe("Dracula");
  });

  it("applies the light presets through the light theme slot", () => {
    applyForgeThemeToDocument("paper");
    expect(document.body.classList.contains("theme-forge-paper")).toBe(true);
    expect(document.body.classList.contains("theme-forge-light")).toBe(true);
    expect(forgeThemeCatalog.paper.label).toBe("Paper");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(document.documentElement.dataset.forgeBootTheme).toBe("paper");
    expect(
      document.documentElement.style.getPropertyValue("--forge-boot-canvas")
    ).toBe(forgeThemeCatalog.paper.preview.canvas);
    expect(
      JSON.parse(
        window.localStorage.getItem(FORGE_THEME_BOOTSTRAP_STORAGE_KEY) ?? "{}"
      )
    ).toMatchObject({
      version: 1,
      preference: "paper",
      resolved: "paper",
      mode: "light",
      theme: forgeThemeCatalog.paper.preview
    });

    applyForgeThemeToDocument("atelier");
    expect(document.body.classList.contains("theme-forge-atelier")).toBe(true);
    expect(document.body.classList.contains("theme-forge-light")).toBe(true);
    expect(forgeThemeCatalog.atelier.label).toBe("Atelier");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(document.documentElement.dataset.forgeBootTheme).toBe("atelier");
  });

  it("stores custom theme variables on the document root", () => {
    const theme = {
      ...defaultCustomTheme,
      label: "Midnight Circuit",
      primary: "#8be9fd",
      panel: "#1f2335"
    };

    applyForgeThemeToDocument("custom", theme);

    expect(document.body.classList.contains("theme-forge-custom")).toBe(true);
    expect(document.documentElement.dataset.forgeTheme).toBe(
      "Midnight Circuit"
    );
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
      "#8be9fd"
    );
    expect(
      document.documentElement.style.getPropertyValue("--surface-panel")
    ).toBe("#1f2335");
    expect(document.documentElement.style.getPropertyValue("--canvas")).toBe(
      theme.canvas
    );
    expect(document.documentElement.style.getPropertyValue("--ui-accent")).toBe(
      theme.primary
    );
    expect(document.documentElement.style.getPropertyValue("--ui-ink")).toBe(
      theme.ink
    );
    expect(document.body.classList.contains("theme-forge-dark")).toBe(true);
  });

  it("classifies bright custom palettes as light themes", () => {
    const lightTheme = {
      ...forgeThemeCatalog.atelier.preview,
      label: "Custom daylight"
    };

    expect(getForgeCustomThemeMode(lightTheme)).toBe("light");
    applyForgeThemeToDocument("custom", lightTheme);

    expect(document.body.classList.contains("theme-forge-custom")).toBe(true);
    expect(document.body.classList.contains("theme-forge-light")).toBe(true);
    expect(document.body.classList.contains("theme-forge-dark")).toBe(false);
    expect(
      JSON.parse(
        window.localStorage.getItem(FORGE_THEME_BOOTSTRAP_STORAGE_KEY) ?? "{}"
      )
    ).toMatchObject({ mode: "light", theme: lightTheme });
  });

  it("resolves active body theme tokens before root defaults", () => {
    document.documentElement.style.setProperty("--chart-zone-1", "#38bdf8");
    document.body.style.setProperty("--chart-zone-1", "#0369a1");

    expect(resolveForgeThemeToken("--chart-zone-1", "#000000")).toBe("#0369a1");

    document.body.style.removeProperty("--chart-zone-1");
    expect(resolveForgeThemeToken("--chart-zone-1", "#000000")).toBe("#38bdf8");
  });

  it("notifies canvas and map renderers when the active theme changes", () => {
    let eventCount = 0;
    const onThemeChange = () => {
      eventCount += 1;
    };
    window.addEventListener(FORGE_THEME_CHANGE_EVENT, onThemeChange);

    try {
      const before = getForgeThemeDocumentKey();
      applyForgeThemeToDocument("atelier");

      expect(eventCount).toBe(1);
      expect(getForgeThemeDocumentKey()).not.toBe(before);
    } finally {
      window.removeEventListener(FORGE_THEME_CHANGE_EVENT, onThemeChange);
    }
  });
});
