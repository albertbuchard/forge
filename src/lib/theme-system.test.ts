import { beforeEach, describe, expect, it } from "vitest";
import {
  applyForgeThemeToDocument,
  defaultCustomTheme,
  forgeThemeCatalog
} from "@/lib/theme-system";

describe("theme system", () => {
  beforeEach(() => {
    document.body.className = "";
    document.documentElement.removeAttribute("data-forge-theme");
    document.documentElement.removeAttribute("style");
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

    applyForgeThemeToDocument("atelier");
    expect(document.body.classList.contains("theme-forge-atelier")).toBe(true);
    expect(document.body.classList.contains("theme-forge-light")).toBe(true);
    expect(forgeThemeCatalog.atelier.label).toBe("Atelier");
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
    expect(document.documentElement.dataset.forgeTheme).toBe("Midnight Circuit");
    expect(
      document.documentElement.style.getPropertyValue("--primary")
    ).toBe("#8be9fd");
    expect(
      document.documentElement.style.getPropertyValue("--surface-panel")
    ).toBe("#1f2335");
  });
});
