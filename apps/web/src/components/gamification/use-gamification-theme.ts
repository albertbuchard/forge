import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  createElement,
  useContext,
  type ReactNode
} from "react";
import { getSettings } from "@/lib/api";
import {
  defaultGamificationTheme,
  normalizeGamificationTheme,
  type GamificationThemePreference
} from "@/lib/gamification-assets";

const GamificationThemeContext =
  createContext<GamificationThemePreference | null>(null);

export function GamificationThemeProvider({
  initialTheme,
  children
}: {
  initialTheme: string | null | undefined;
  children: ReactNode;
}) {
  return createElement(
    GamificationThemeContext.Provider,
    { value: normalizeGamificationTheme(initialTheme) },
    children
  );
}

export function useGamificationTheme(): GamificationThemePreference {
  const initialTheme = useContext(GamificationThemeContext);
  const settingsQuery = useQuery({
    queryKey: ["forge-settings"],
    queryFn: getSettings,
    staleTime: 30_000
  });

  return normalizeGamificationTheme(
    settingsQuery?.data?.settings.gamificationTheme ??
      initialTheme ??
      defaultGamificationTheme
  );
}
