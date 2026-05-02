export const gamificationThemeOptions = [
  {
    value: "dark-fantasy",
    label: "Dark Fantasy",
    description: "Obsidian iron, ember gold, high-pressure streak energy, and mythic trophy silhouettes."
  },
  {
    value: "dramatic-smithie",
    label: "Fantasy",
    description: "Expressive, warm reward art with brighter mascot reactions and playful forge trophies."
  },
  {
    value: "mind-locksmith",
    label: "Mind Locksmith",
    description:
      "Modern, smart, Pixar-like forge metaphors for planning, memory, Psyche, health, and agent work."
  }
] as const;

export type GamificationThemePreference =
  (typeof gamificationThemeOptions)[number]["value"];

export const defaultGamificationTheme: GamificationThemePreference =
  "dark-fantasy";

export function normalizeGamificationTheme(
  value: string | null | undefined
): GamificationThemePreference {
  return gamificationThemeOptions.some((option) => option.value === value)
    ? (value as GamificationThemePreference)
    : defaultGamificationTheme;
}

export function getGamificationSpriteUrl(
  assetKey: string,
  size: 256 | 512 | 1024 = 512,
  theme: GamificationThemePreference = defaultGamificationTheme
) {
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const normalizedTheme = normalizeGamificationTheme(theme);
  const folder =
    assetKey.startsWith("item-")
      ? "items"
      : assetKey.startsWith("mascot-")
        ? "mascots"
        : "";
  return `${normalizedBase}gamification/sprites/themes/${normalizedTheme}/${folder ? `${folder}/` : ""}${assetKey}-${size}.webp`;
}

export function getGamificationPngUrl(
  assetKey: string,
  size: 256 | 512 | 1024 = 512,
  theme: GamificationThemePreference = defaultGamificationTheme
) {
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const normalizedTheme = normalizeGamificationTheme(theme);
  const folder =
    assetKey.startsWith("item-")
      ? "items"
      : assetKey.startsWith("mascot-")
        ? "mascots"
        : "";
  return `${normalizedBase}gamification/sprites/themes/${normalizedTheme}/${folder ? `${folder}/` : ""}${assetKey}-${size}.png`;
}
