import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Download, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import {
  getGamificationAssetStatus,
  installGamificationAssetStyle,
  patchSettings
} from "@/lib/api";
import {
  defaultGamificationTheme,
  getGamificationThemePreviewUrl,
  normalizeGamificationTheme,
  type GamificationThemePreference
} from "@/lib/gamification-assets";

const setupDismissedKey = "forge-gamification-assets-setup-dismissed-v1";

export function GamificationAssetSetupDialog() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }
    return window.localStorage.getItem(setupDismissedKey) === "1";
  });
  const [selectedStyle, setSelectedStyle] =
    useState<GamificationThemePreference>(defaultGamificationTheme);

  const assetsQuery = useQuery({
    queryKey: ["forge-gamification-assets"],
    queryFn: getGamificationAssetStatus,
    staleTime: 30_000
  });

  const styles = assetsQuery.data?.assets.styles ?? [];
  const installedStyles = styles.filter((style) => style.installed);
  const settingsRoute = location.pathname.startsWith("/settings");
  const open =
    !settingsRoute &&
    !dismissed &&
    assetsQuery.isSuccess &&
    installedStyles.length === 0;

  useEffect(() => {
    const defaultStyle = normalizeGamificationTheme(
      assetsQuery.data?.assets.defaultStyle
    );
    setSelectedStyle(defaultStyle);
  }, [assetsQuery.data?.assets.defaultStyle]);

  const selected = useMemo(
    () =>
      styles.find((style) => style.id === selectedStyle) ??
      styles.find((style) => style.id === defaultGamificationTheme) ??
      styles[0],
    [selectedStyle, styles]
  );

  const installMutation = useMutation({
    mutationFn: async (style: GamificationThemePreference) => {
      const installed = await installGamificationAssetStyle(style);
      await patchSettings({ gamificationTheme: style });
      return installed;
    },
    onSuccess: async () => {
      window.localStorage.removeItem(setupDismissedKey);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-gamification-assets"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-settings"] })
      ]);
    }
  });

  function dismiss() {
    window.localStorage.setItem(setupDismissedKey, "1");
    setDismissed(true);
  }

  if (!styles.length) {
    return null;
  }

  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgba(3,7,18,0.74)] backdrop-blur-xl" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(44rem,calc(100vw-1.25rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,23,36,0.98),rgba(8,12,22,0.98))] shadow-[0_32px_90px_rgba(3,8,18,0.56)] outline-none">
          <Dialog.Title className="sr-only">Download Forge reward art</Dialog.Title>
          <Dialog.Description className="sr-only">
            Choose whether Forge should download optional trophy and mascot art.
          </Dialog.Description>
          <button
            type="button"
            onClick={dismiss}
            className="absolute right-3 top-3 z-10 inline-flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/8 text-white/62 transition hover:bg-white/12 hover:text-white"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
          <div className="grid gap-0 md:grid-cols-[16rem_minmax(0,1fr)]">
            <div className="relative min-h-[18rem] overflow-hidden bg-[linear-gradient(160deg,rgba(245,158,11,0.18),rgba(34,197,94,0.12)_42%,rgba(14,165,233,0.14))]">
              <img
                src={getGamificationThemePreviewUrl(selectedStyle)}
                alt=""
                className="absolute inset-x-0 bottom-4 mx-auto h-56 max-w-none object-contain drop-shadow-[0_24px_42px_rgba(0,0,0,0.48)]"
              />
            </div>
            <div className="p-5 sm:p-6">
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--tertiary)]">
                Optional reward art
              </div>
              <h2 className="mt-2 font-display text-2xl text-white">
                Download trophies and mascot sprites?
              </h2>
              <p className="mt-3 text-sm leading-6 text-white/62">
                Forge can keep the app package small and install only the reward
                art style you want. The app works without these images.
              </p>
              <div className="mt-5 grid gap-2">
                {styles.map((style) => {
                  const active = style.id === selectedStyle;
                  return (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => setSelectedStyle(style.id)}
                      className={[
                        "grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3 rounded-[18px] border p-2 text-left transition",
                        active
                          ? "border-[var(--primary)] bg-[var(--primary)]/12"
                          : "border-white/10 bg-white/[0.04] hover:bg-white/[0.07]"
                      ].join(" ")}
                    >
                      <img
                        src={getGamificationThemePreviewUrl(style.id)}
                        alt=""
                        className="size-14 object-contain"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-white">
                          {style.label}
                        </span>
                        <span className="mt-1 line-clamp-2 block text-[12px] leading-5 text-white/52">
                          {style.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {installMutation.isError ? (
                <div className="mt-4 rounded-[16px] border border-red-300/20 bg-red-500/10 px-3 py-2 text-[12px] leading-5 text-red-100">
                  {installMutation.error instanceof Error
                    ? installMutation.error.message
                    : "Could not download the selected art."}
                </div>
              ) : null}
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={dismiss}
                  className="inline-flex items-center justify-center rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-white/72 transition hover:bg-white/8 hover:text-white"
                >
                  Not now
                </button>
                <button
                  type="button"
                  disabled={!selected || installMutation.isPending}
                  onClick={() => {
                    if (selected) {
                      installMutation.mutate(selected.id);
                    }
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-slate-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Download className="size-4" />
                  {installMutation.isPending ? "Downloading" : "Download"}
                </button>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
