import { useEffect, useState } from "react";
import {
  FORGE_THEME_CHANGE_EVENT,
  getForgeThemeDocumentKey
} from "@/lib/theme-system";

export function useForgeThemeKey() {
  const [themeKey, setThemeKey] = useState(getForgeThemeDocumentKey);

  useEffect(() => {
    const updateThemeKey = () => setThemeKey(getForgeThemeDocumentKey());
    updateThemeKey();
    window.addEventListener(FORGE_THEME_CHANGE_EVENT, updateThemeKey);
    return () =>
      window.removeEventListener(FORGE_THEME_CHANGE_EVENT, updateThemeKey);
  }, []);

  return themeKey;
}
