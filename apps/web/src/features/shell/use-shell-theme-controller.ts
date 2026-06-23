import { useEffect } from "react";
import { applyForgeThemeToDocument } from "@/lib/theme-system";
import type { SettingsPayload } from "@/lib/types";

export function useShellThemeController(settings: SettingsPayload | undefined) {
  useEffect(() => {
    if (!settings) {
      return;
    }

    const applyTheme = () => {
      applyForgeThemeToDocument(
        settings.themePreference,
        settings.customTheme ?? null
      );
    };

    applyTheme();

    if (
      settings.themePreference !== "system" ||
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, [settings]);
}
