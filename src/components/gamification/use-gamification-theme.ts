import { useQuery } from "@tanstack/react-query";
import { getSettings } from "@/lib/api";
import {
  defaultGamificationTheme,
  normalizeGamificationTheme,
  type GamificationThemePreference
} from "@/lib/gamification-assets";

export function useGamificationTheme(): GamificationThemePreference {
  const settingsQuery = useQuery({
    queryKey: ["forge-settings"],
    queryFn: getSettings,
    staleTime: 30_000
  });

  return normalizeGamificationTheme(
    settingsQuery?.data?.settings.gamificationTheme ?? defaultGamificationTheme
  );
}
