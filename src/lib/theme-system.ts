import { z } from "zod";

export const forgeThemePreferenceValues = [
  "obsidian",
  "solar",
  "aurora",
  "ember",
  "paper",
  "dawn",
  "atelier",
  "custom",
  "system"
] as const;

export const forgeThemePreferenceSchema = z.enum(forgeThemePreferenceValues);

const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color");

export const forgeCustomThemeSchema = z.object({
  label: z.string().trim().min(1, "Theme name is required").max(40),
  primary: hexColorSchema,
  secondary: hexColorSchema,
  tertiary: hexColorSchema,
  canvas: hexColorSchema,
  panel: hexColorSchema,
  panelHigh: hexColorSchema,
  panelLow: hexColorSchema,
  ink: hexColorSchema
});

export type ForgeThemePreference = z.infer<typeof forgeThemePreferenceSchema>;
export type ForgeCustomTheme = z.infer<typeof forgeCustomThemeSchema>;

type ThemeSpec = {
  label: string;
  description: string;
  mode: "dark" | "light";
  preview: ForgeCustomTheme;
};

const CUSTOM_THEME_STORAGE_KEYS = [
  "--primary",
  "--secondary",
  "--tertiary",
  "--surface",
  "--surface-low",
  "--surface-panel",
  "--surface-high",
  "--surface-glass",
  "--surface-psyche",
  "--surface-psyche-high",
  "--hero-gradient",
  "--card-gradient",
  "--card-shadow",
  "--card-shadow-hover",
  "--forge-body-ambient-primary",
  "--forge-body-ambient-secondary",
  "--forge-body-gradient-start",
  "--forge-body-gradient-end",
  "--forge-body-text"
] as const;

export const defaultCustomTheme: ForgeCustomTheme = {
  label: "Custom Forge",
  primary: "#7cc7ff",
  secondary: "#4edea3",
  tertiary: "#ffb95f",
  canvas: "#0b1326",
  panel: "#171f33",
  panelHigh: "#222a3d",
  panelLow: "#131b2e",
  ink: "#eef2ff"
};

export const forgeThemeCatalog: Record<
  Exclude<ForgeThemePreference, "system" | "custom">,
  ThemeSpec
> = {
  obsidian: {
    label: "Obsidian",
    description: "Deep indigo with cool neon edges. This is the current default.",
    mode: "dark",
    preview: {
      label: "Obsidian",
      primary: "#c0c1ff",
      secondary: "#4edea3",
      tertiary: "#ffb95f",
      canvas: "#0b1326",
      panel: "#171f33",
      panelHigh: "#222a3d",
      panelLow: "#131b2e",
      ink: "#eef2ff"
    }
  },
  solar: {
    label: "Catppuccin",
    description:
      "Pastel mocha surfaces inspired by the widely adopted Catppuccin palette.",
    mode: "dark",
    preview: {
      label: "Catppuccin",
      primary: "#cba6f7",
      secondary: "#94e2d5",
      tertiary: "#fab387",
      canvas: "#1e1e2e",
      panel: "#313244",
      panelHigh: "#45475a",
      panelLow: "#181825",
      ink: "#cdd6f4"
    }
  },
  aurora: {
    label: "Nord",
    description:
      "Arctic blue-grey surfaces based on Nord's clean and uncluttered palette.",
    mode: "dark",
    preview: {
      label: "Nord",
      primary: "#88c0d0",
      secondary: "#a3be8c",
      tertiary: "#ebcb8b",
      canvas: "#2e3440",
      panel: "#3b4252",
      panelHigh: "#434c5e",
      panelLow: "#242933",
      ink: "#eceff4"
    }
  },
  ember: {
    label: "Dracula",
    description:
      "High-contrast purple and pink accents drawn from the official Dracula specification.",
    mode: "dark",
    preview: {
      label: "Dracula",
      primary: "#bd93f9",
      secondary: "#8be9fd",
      tertiary: "#ff79c6",
      canvas: "#282a36",
      panel: "#343746",
      panelHigh: "#424450",
      panelLow: "#21222c",
      ink: "#f8f8f2"
    }
  },
  paper: {
    label: "Paper",
    description:
      "Warm ivory surfaces with navy ink and restrained blue-green accents for a crisp daytime workspace.",
    mode: "light",
    preview: {
      label: "Paper",
      primary: "#2f6fed",
      secondary: "#1d8f6b",
      tertiary: "#c9772b",
      canvas: "#f4efe6",
      panel: "#fbf7f1",
      panelHigh: "#ffffff",
      panelLow: "#e5ddd0",
      ink: "#182235"
    }
  },
  dawn: {
    label: "Dawn",
    description:
      "Rosy morning tones with plum-blue ink and enough contrast to stay readable across dense settings screens.",
    mode: "light",
    preview: {
      label: "Dawn",
      primary: "#8b5cf6",
      secondary: "#ec7a6b",
      tertiary: "#d0a12b",
      canvas: "#f8eef1",
      panel: "#fff7f8",
      panelHigh: "#ffffff",
      panelLow: "#ead9df",
      ink: "#2d1834"
    }
  },
  atelier: {
    label: "Atelier",
    description:
      "Cool drafting-table neutrals with slate ink and modern cobalt accents for a brighter, studio-like shell.",
    mode: "light",
    preview: {
      label: "Atelier",
      primary: "#2563eb",
      secondary: "#0f8b6d",
      tertiary: "#b85c38",
      canvas: "#edf3f7",
      panel: "#f8fbfd",
      panelHigh: "#ffffff",
      panelLow: "#dbe5ec",
      ink: "#162334"
    }
  }
};

export const forgeThemeOptions: Array<{
  value: ForgeThemePreference;
  label: string;
  description: string;
}> = [
  {
    value: "obsidian",
    label: forgeThemeCatalog.obsidian.label,
    description: forgeThemeCatalog.obsidian.description
  },
  {
    value: "solar",
    label: forgeThemeCatalog.solar.label,
    description: forgeThemeCatalog.solar.description
  },
  {
    value: "aurora",
    label: forgeThemeCatalog.aurora.label,
    description: forgeThemeCatalog.aurora.description
  },
  {
    value: "ember",
    label: forgeThemeCatalog.ember.label,
    description: forgeThemeCatalog.ember.description
  },
  {
    value: "paper",
    label: forgeThemeCatalog.paper.label,
    description: forgeThemeCatalog.paper.description
  },
  {
    value: "dawn",
    label: forgeThemeCatalog.dawn.label,
    description: forgeThemeCatalog.dawn.description
  },
  {
    value: "atelier",
    label: forgeThemeCatalog.atelier.label,
    description: forgeThemeCatalog.atelier.description
  },
  {
    value: "custom",
    label: "Custom",
    description:
      "Use your own Forge token set through the guided editor or direct JSON import."
  },
  {
    value: "system",
    label: "System",
    description:
      "Follow the device preference. Forge maps dark mode to Obsidian and light mode to Paper."
  }
];

function hexToRgb(value: string) {
  const normalized = value.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
}

function rgbToHex({
  r,
  g,
  b
}: {
  r: number;
  g: number;
  b: number;
}) {
  return `#${[r, g, b]
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(channel)))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

function mixHex(base: string, overlay: string, weight: number) {
  const baseRgb = hexToRgb(base);
  const overlayRgb = hexToRgb(overlay);
  return rgbToHex({
    r: baseRgb.r + (overlayRgb.r - baseRgb.r) * weight,
    g: baseRgb.g + (overlayRgb.g - baseRgb.g) * weight,
    b: baseRgb.b + (overlayRgb.b - baseRgb.b) * weight
  });
}

function alpha(hex: string, opacity: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export function resolveForgeThemePreference(
  preference: ForgeThemePreference,
  prefersDark: boolean
): Exclude<ForgeThemePreference, "system"> {
  if (preference === "system") {
    return prefersDark ? "obsidian" : "paper";
  }
  return preference;
}

export function getForgeThemePreview(
  preference: ForgeThemePreference,
  customTheme?: ForgeCustomTheme | null
): ForgeCustomTheme {
  if (preference === "custom") {
    return customTheme ?? defaultCustomTheme;
  }
  if (preference === "system") {
    return forgeThemeCatalog.obsidian.preview;
  }
  return forgeThemeCatalog[preference].preview;
}

export function buildForgeThemeVariables(theme: ForgeCustomTheme) {
  const cardTop = mixHex(theme.panelHigh, theme.primary, 0.08);
  const heroTop = mixHex(theme.panelHigh, theme.primary, 0.16);
  const heroBottom = mixHex(theme.canvas, theme.secondary, 0.06);
  return {
    "--primary": theme.primary,
    "--secondary": theme.secondary,
    "--tertiary": theme.tertiary,
    "--surface": theme.canvas,
    "--surface-low": theme.panelLow,
    "--surface-panel": theme.panel,
    "--surface-high": theme.panelHigh,
    "--surface-glass": alpha(theme.canvas, 0.82),
    "--surface-psyche": alpha(mixHex(theme.canvas, theme.secondary, 0.12), 0.94),
    "--surface-psyche-high": alpha(
      mixHex(theme.panelHigh, theme.secondary, 0.1),
      0.96
    ),
    "--hero-gradient": `linear-gradient(180deg, ${alpha(
      heroTop,
      0.95
    )}, ${alpha(heroBottom, 0.95)})`,
    "--card-gradient": `linear-gradient(180deg, ${alpha(
      cardTop,
      0.96
    )}, ${alpha(theme.panelLow, 0.94)})`,
    "--card-shadow": `0 24px 60px ${alpha(theme.canvas, 0.3)}`,
    "--card-shadow-hover": `0 32px 80px ${alpha(theme.canvas, 0.38)}`,
    "--forge-body-ambient-primary": alpha(theme.primary, 0.2),
    "--forge-body-ambient-secondary": alpha(theme.secondary, 0.14),
    "--forge-body-gradient-start": mixHex(theme.panel, theme.primary, 0.08),
    "--forge-body-gradient-end": mixHex(theme.canvas, "#000000", 0.16),
    "--forge-body-text": theme.ink
  };
}

export function applyForgeThemeToDocument(
  preference: ForgeThemePreference,
  customTheme?: ForgeCustomTheme | null
) {
  if (typeof document === "undefined") {
    return;
  }

  const prefersDark =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = resolveForgeThemePreference(preference, prefersDark);
  const body = document.body;
  const root = document.documentElement;

  body.classList.remove(
    "theme-forge-dark",
    "theme-forge-light",
    "theme-forge-obsidian",
    "theme-forge-solar",
    "theme-forge-aurora",
    "theme-forge-ember",
    "theme-forge-paper",
    "theme-forge-dawn",
    "theme-forge-atelier",
    "theme-forge-custom"
  );

  if (resolved === "custom") {
    const theme = customTheme ?? defaultCustomTheme;
    const variables = buildForgeThemeVariables(theme);
    body.classList.add("theme-forge-custom");
    body.classList.add("theme-forge-dark");
    for (const [name, value] of Object.entries(variables)) {
      root.style.setProperty(name, value);
    }
    root.dataset.forgeTheme = theme.label;
    return;
  }

  for (const name of CUSTOM_THEME_STORAGE_KEYS) {
    root.style.removeProperty(name);
  }
  delete root.dataset.forgeTheme;
  body.classList.add(
    forgeThemeCatalog[resolved].mode === "light" ? "theme-forge-light" : "theme-forge-dark"
  );
  body.classList.add(`theme-forge-${resolved}`);
}
