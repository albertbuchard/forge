import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { Check, Download, Info, Sparkles, Trophy } from "lucide-react";
import { ThemeCustomizerDialog } from "@/components/settings/theme-customizer-dialog";
import { SettingsSectionNav } from "@/components/settings/settings-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/page-state";
import { useI18n } from "@/lib/i18n";
import {
  ensureOperatorSession,
  getCompanionOverview,
  getGamificationAssetStatus,
  getSettings,
  installGamificationAssetStyle,
  patchSettings,
  revokeOperatorSession
} from "@/lib/api";
import {
  settingsMutationSchema,
  type SettingsMutationInput
} from "@/lib/schemas";
import {
  gamificationThemeOptions,
  getGamificationThemePreviewUrl,
  type GamificationThemePreference
} from "@/lib/gamification-assets";
import {
  applyForgeThemeToDocument,
  defaultCustomTheme,
  forgeThemeOptions,
  getForgeThemePreview,
  type ForgeThemePreference
} from "@/lib/theme-system";

function ThemePreviewSwatches({
  theme
}: {
  theme: ReturnType<typeof getForgeThemePreview>;
}) {
  return (
    <div className="mt-3 grid grid-cols-4 gap-2">
      {[theme.primary, theme.secondary, theme.tertiary, theme.panelHigh].map(
        (color) => (
          <div
            key={color}
            className="h-6 rounded-[10px] border border-black/10"
            style={{ background: color }}
          />
        )
      )}
    </div>
  );
}

function GamificationStylePreview({
  selected,
  theme
}: {
  selected: boolean;
  theme: GamificationThemePreference;
}) {
  return (
    <div className="relative min-h-[138px] overflow-hidden rounded-[18px] border border-white/10 bg-[radial-gradient(circle_at_24%_10%,rgba(255,199,104,0.22),transparent_30%),radial-gradient(circle_at_88%_12%,rgba(84,191,255,0.16),transparent_32%),linear-gradient(145deg,rgba(255,255,255,0.08),rgba(255,255,255,0.025))]">
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/42 to-transparent" />
      <img
        src={getGamificationThemePreviewUrl(theme)}
        alt=""
        className="absolute bottom-1 left-1/2 h-[128px] w-[128px] -translate-x-1/2 object-contain drop-shadow-[0_18px_30px_rgba(0,0,0,0.34)]"
      />
      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full border border-white/10 bg-black/28 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-white/78 backdrop-blur-md">
        <Sparkles className="size-3 text-amber-200" />
        Live rewards
      </div>
      <div className="absolute bottom-3 left-3 flex items-center gap-1.5">
        {[
          "item-trophy-xp-levels-the-first-heat",
          "item-trophy-tasks-anvil-marathon",
          "item-unlock-streaks-molten-crown-fire"
        ].map((assetKey) => (
          <span
            key={assetKey}
            className="grid size-10 place-items-center rounded-[12px] border border-white/12 bg-black/26 shadow-[0_12px_22px_rgba(0,0,0,0.22)] backdrop-blur-md"
          >
            <Trophy className="size-5 text-amber-100" />
          </span>
        ))}
      </div>
      <span
        className={`absolute right-3 top-3 grid size-7 place-items-center rounded-full border ${
          selected
            ? "border-emerald-200/55 bg-emerald-300/18 text-emerald-100"
            : "border-white/15 bg-black/20 text-white/40"
        }`}
      >
        {selected ? <Check className="size-4" /> : null}
      </span>
    </div>
  );
}

function MobileCompanionSettingsCard({ healthy }: { healthy: boolean }) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Mobile companion
          </div>
          <div className="mt-1 text-base font-medium text-white">
            {healthy ? "iPhone bridge is syncing" : "Connect the iPhone bridge"}
          </div>
          <div className="mt-1 max-w-3xl text-sm leading-6 text-white/58">
            {healthy
              ? "Review HealthKit, movement, and background sync permissions."
              : "Pair or refresh the native companion before relying on HealthKit, movement, or watch signals."}
          </div>
        </div>
        <Link
          to="/settings/mobile"
          className="inline-flex min-h-10 items-center rounded-[14px] bg-white/[0.08] px-3 py-2 text-sm text-white transition hover:bg-white/[0.12]"
        >
          Open mobile settings
        </Link>
      </div>
    </Card>
  );
}

function formatAuditDate(value: string) {
  return new Date(value).toLocaleString();
}

function getIntegrityExplanation({
  integrityScore,
  storageMode,
  lastAuditAt
}: {
  integrityScore: number;
  storageMode: string;
  lastAuditAt: string;
}) {
  if (integrityScore >= 100) {
    return [
      "All currently reported settings and storage checks passed.",
      `Latest audit: ${formatAuditDate(lastAuditAt)}.`
    ];
  }

  const gap = Math.max(0, 100 - integrityScore);
  return [
    `Forge is holding back ${gap}% because the latest settings and storage audit reported a consistency warning.`,
    "The current audit only exposes the aggregate score, so per-check details are not available yet.",
    `Storage mode: ${storageMode}. Latest audit: ${formatAuditDate(lastAuditAt)}.`
  ];
}

function IntegrityHelpPill({
  integrityScore,
  storageMode,
  lastAuditAt
}: {
  integrityScore: number;
  storageMode: string;
  lastAuditAt: string;
}) {
  const explanation = getIntegrityExplanation({
    integrityScore,
    storageMode,
    lastAuditAt
  });

  return (
    <details className="group relative inline-flex">
      <summary
        className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium normal-case tracking-normal text-white/72 transition marker:hidden hover:border-white/18 hover:bg-white/[0.08] hover:text-white/88 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(192,193,255,0.35)] [&::-webkit-details-marker]:hidden"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.currentTarget.parentElement?.removeAttribute("open");
          }
        }}
      >
        <Info className="size-3.5" aria-hidden="true" />
        {integrityScore}% integrity
      </summary>
      <span
        role="tooltip"
        className="absolute right-0 top-[calc(100%+0.55rem)] z-50 hidden w-[min(19rem,calc(100vw-2rem))] rounded-[16px] border border-white/10 bg-[rgba(10,15,27,0.98)] px-3 py-2.5 text-left text-xs leading-5 tracking-normal text-white/70 normal-case shadow-[0_18px_48px_rgba(3,8,18,0.46)] group-open:block"
      >
        <span className="block font-medium text-white/88">
          {integrityScore >= 100
            ? "Integrity is complete"
            : `Why this is ${integrityScore}%`}
        </span>
        {explanation.map((line) => (
          <span key={line} className="mt-1 block">
            {line}
          </span>
        ))}
      </span>
    </details>
  );
}

function SecurityPostureCard({
  integrityScore,
  storageMode,
  lastAuditAt
}: {
  integrityScore: number;
  storageMode: string;
  lastAuditAt: string;
}) {
  const [primaryExplanation] = getIntegrityExplanation({
    integrityScore,
    storageMode,
    lastAuditAt
  });

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Security posture
          </div>
          <div className="mt-1 text-sm leading-6 text-white/58">
            Local-first means Forge stores its runtime data on this machine.
            Integrity is the latest internal consistency score from settings and
            data checks.
          </div>
          <div className="mt-2 text-xs leading-5 text-white/50">
            {primaryExplanation}
          </div>
        </div>
        <IntegrityHelpPill
          integrityScore={integrityScore}
          storageMode={storageMode}
          lastAuditAt={lastAuditAt}
        />
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className="rounded-[14px] bg-white/[0.04] px-3 py-3">
          <div className="text-xs text-white/54">Storage mode</div>
          <div className="mt-1 text-base font-medium text-white">
            {storageMode}
          </div>
        </div>
        <div className="rounded-[14px] bg-white/[0.04] px-3 py-3">
          <div className="text-xs text-white/54">Last audit</div>
          <div className="mt-1 text-base font-medium text-white">
            {formatAuditDate(lastAuditAt)}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function SettingsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);

  const operatorSessionQuery = useQuery({
    queryKey: ["forge-operator-session"],
    queryFn: ensureOperatorSession
  });
  const operatorReady = operatorSessionQuery.isSuccess;

  const settingsQuery = useQuery({
    queryKey: ["forge-settings"],
    queryFn: getSettings,
    enabled: operatorReady
  });
  const companionOverviewQuery = useQuery({
    queryKey: ["forge-companion-overview"],
    queryFn: async () => (await getCompanionOverview()).overview,
    enabled: operatorReady,
    staleTime: 30_000
  });
  const gamificationAssetsQuery = useQuery({
    queryKey: ["forge-gamification-assets"],
    queryFn: getGamificationAssetStatus,
    enabled: operatorReady,
    staleTime: 30_000
  });

  const settingsForm = useForm<SettingsMutationInput>({
    defaultValues: {
      profile: {
        operatorName: "",
        operatorEmail: "",
        operatorTitle: ""
      },
      notifications: {
        goalDriftAlerts: true,
        dailyQuestReminders: true,
        achievementCelebrations: true
      },
      execution: {
        maxActiveTasks: 2,
        timeAccountingMode: "split"
      },
      themePreference: "obsidian",
      gamificationTheme: "dramatic-smithie",
      customTheme: defaultCustomTheme,
      localePreference: "en"
    }
  });

  const invalidateSettings = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["forge-operator-session"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-settings"] })
    ]);
  };

  const updateMutation = useMutation({
    mutationFn: (input: SettingsMutationInput) => patchSettings(input),
    onSuccess: invalidateSettings
  });

  const themeMutation = useMutation({
    mutationFn: (
      input: Pick<SettingsMutationInput, "themePreference" | "customTheme">
    ) => patchSettings(input),
    onSuccess: async (response) => {
      queryClient.setQueryData(["forge-settings"], response);
      await invalidateSettings();
    }
  });

  const gamificationThemeMutation = useMutation({
    mutationFn: (input: Pick<SettingsMutationInput, "gamificationTheme">) =>
      patchSettings(input),
    onSuccess: async (response) => {
      queryClient.setQueryData(["forge-settings"], response);
      await invalidateSettings();
    }
  });
  const gamificationAssetInstallMutation = useMutation({
    mutationFn: async (gamificationTheme: GamificationThemePreference) => {
      await installGamificationAssetStyle(gamificationTheme);
      return patchSettings({ gamificationTheme });
    },
    onSuccess: async (response) => {
      queryClient.setQueryData(["forge-settings"], response);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-settings"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-gamification-assets"] })
      ]);
    }
  });

  const revokeSessionMutation = useMutation({
    mutationFn: revokeOperatorSession,
    onSuccess: async () => {
      await invalidateSettings();
      await operatorSessionQuery.refetch();
    }
  });

  useEffect(() => {
    if (!settingsQuery.data?.settings) return;
    settingsForm.reset(
      settingsMutationSchema.parse(settingsQuery.data.settings)
    );
  }, [settingsQuery.data, settingsForm]);

  const settings = settingsQuery.data?.settings;
  const selectedTheme = settingsForm.watch("themePreference");
  const selectedGamificationTheme = settingsForm.watch("gamificationTheme");
  const gamificationAssetStyles =
    gamificationAssetsQuery.data?.assets.styles ?? [];
  const selectedGamificationAssetStatus = gamificationAssetStyles.find(
    (style) => style.id === selectedGamificationTheme
  );
  const customTheme = settingsForm.watch("customTheme") ?? defaultCustomTheme;
  const hasHealthyMobileCompanion =
    companionOverviewQuery.data?.healthState === "healthy_sync";

  const saveThemeSelection = async (
    themePreference: ForgeThemePreference,
    nextCustomTheme: SettingsMutationInput["customTheme"] = customTheme
  ) => {
    settingsForm.setValue("themePreference", themePreference, {
      shouldDirty: true
    });
    settingsForm.setValue(
      "customTheme",
      nextCustomTheme ?? defaultCustomTheme,
      {
        shouldDirty: true
      }
    );
    await themeMutation.mutateAsync({
      themePreference,
      customTheme: nextCustomTheme ?? defaultCustomTheme
    });
  };

  const saveGamificationThemeSelection = async (
    gamificationTheme: GamificationThemePreference
  ) => {
    settingsForm.setValue("gamificationTheme", gamificationTheme, {
      shouldDirty: true
    });
    await gamificationThemeMutation.mutateAsync({ gamificationTheme });
  };

  useEffect(() => {
    if (!settings) {
      return;
    }

    applyForgeThemeToDocument(selectedTheme, customTheme);

    return () => {
      applyForgeThemeToDocument(
        settings.themePreference,
        settings.customTheme ?? null
      );
    };
  }, [
    customTheme,
    selectedTheme,
    settings,
    settings?.customTheme,
    settings?.themePreference
  ]);

  if (operatorSessionQuery.isLoading || settingsQuery.isLoading) {
    return (
      <SurfaceSkeleton
        eyebrow="Settings"
        title="Loading settings"
        description="Establishing the operator session and fetching current configuration."
        columns={2}
        blocks={6}
      />
    );
  }

  if (operatorSessionQuery.isError) {
    return (
      <ErrorState
        eyebrow="Settings"
        error={operatorSessionQuery.error}
        onRetry={() => void operatorSessionQuery.refetch()}
      />
    );
  }

  if (settingsQuery.isError || !settings) {
    return (
      <ErrorState
        eyebrow="Settings"
        error={
          settingsQuery.error ??
          new Error("Forge returned an empty settings payload.")
        }
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-[1220px] gap-5">
      <PageHero
        title="Settings"
        description="Tune execution policy, timer behaviour, and personal preferences."
        badge={
          <IntegrityHelpPill
            integrityScore={settings.security.integrityScore}
            storageMode={settings.security.storageMode}
            lastAuditAt={settings.security.lastAuditAt}
          />
        }
      />

      {import.meta.env.DEV ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-amber-400/25 bg-amber-500/[0.1] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-amber-100/92">
            Dev frontend
          </span>
          <span className="text-sm text-white/50">
            Forge UI is currently being served by the Vite dev server.
          </span>
        </div>
      ) : null}

      <SettingsSectionNav />

      {operatorSessionQuery.data?.session ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-emerald-400/20 bg-emerald-500/[0.08] px-4 py-3 text-sm text-emerald-100/88">
          <div>
            Operator session active as{" "}
            <span className="font-medium text-white">
              {operatorSessionQuery.data.session.actorLabel}
            </span>
            .
          </div>
          <Button
            variant="secondary"
            size="sm"
            pending={revokeSessionMutation.isPending}
            pendingLabel="Resetting session"
            onClick={() => void revokeSessionMutation.mutateAsync()}
          >
            Reset operator session
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4">
        {!hasHealthyMobileCompanion ? (
          <MobileCompanionSettingsCard healthy={false} />
        ) : null}

        <form
          className="grid gap-4"
          onSubmit={settingsForm.handleSubmit(async (values) => {
            await updateMutation.mutateAsync(values);
          })}
        >
          <Card className="p-4">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Operator profile
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm text-white/58">Name</span>
                <Input {...settingsForm.register("profile.operatorName")} />
              </label>
              <label className="grid gap-2">
                <span className="text-sm text-white/58">Email</span>
                <Input {...settingsForm.register("profile.operatorEmail")} />
              </label>
            </div>
            <label className="grid gap-2">
              <span className="text-sm text-white/58">Title</span>
              <Input {...settingsForm.register("profile.operatorTitle")} />
            </label>

            <div className="mt-2 font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Execution policy
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
              <label className="grid gap-2">
                <span className="text-sm text-white/58">
                  Maximum active tasks
                </span>
                <Input
                  type="number"
                  min={1}
                  max={8}
                  {...settingsForm.register("execution.maxActiveTasks", {
                    valueAsNumber: true
                  })}
                />
              </label>
              <div className="grid gap-3">
                <div className="text-sm text-white/58">
                  Time accounting mode
                </div>
                <div className="grid gap-2 md:grid-cols-3">
                  {(
                    [
                      {
                        value: "split",
                        label: "Split",
                        description:
                          "Multitasking divides credited time across active tasks."
                      },
                      {
                        value: "parallel",
                        label: "Parallel",
                        description:
                          "Every active task receives full credited wall time."
                      },
                      {
                        value: "primary_only",
                        label: "Primary only",
                        description:
                          "Only the highlighted task earns credited time during overlap."
                      }
                    ] as const
                  ).map((mode) => (
                    <label
                      key={mode.value}
                      className="grid gap-2 rounded-[16px] bg-white/[0.04] px-3 py-3"
                    >
                      <span className="flex items-center gap-3">
                        <input
                          type="radio"
                          value={mode.value}
                          {...settingsForm.register(
                            "execution.timeAccountingMode"
                          )}
                        />
                        <span className="text-white/82">{mode.label}</span>
                      </span>
                      <span className="text-xs leading-5 text-white/56">
                        {mode.description}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-2 font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Notification rules
            </div>
            <label className="flex items-center justify-between rounded-[16px] bg-white/[0.04] px-3 py-2.5">
              <span className="text-white/72">Goal drift alerts</span>
              <input
                type="checkbox"
                {...settingsForm.register("notifications.goalDriftAlerts")}
              />
            </label>
            <label className="flex items-center justify-between rounded-[16px] bg-white/[0.04] px-3 py-2.5">
              <span className="text-white/72">Daily quest reminders</span>
              <input
                type="checkbox"
                {...settingsForm.register("notifications.dailyQuestReminders")}
              />
            </label>
            <label className="flex items-center justify-between rounded-[16px] bg-white/[0.04] px-3 py-2.5">
              <span className="text-white/72">Achievement celebrations</span>
              <input
                type="checkbox"
                {...settingsForm.register(
                  "notifications.achievementCelebrations"
                )}
              />
            </label>
          </Card>

          <Card className="p-4">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Theme calibration
            </div>
            <p className="text-sm text-white/58">
              Switch between Forge dark and light presets, follow the system
              palette, or save your own shell theme.
            </p>
            <div className="grid gap-2 xl:grid-cols-3">
              {forgeThemeOptions.map((themeOption) => {
                const preview = getForgeThemePreview(
                  themeOption.value,
                  customTheme
                );
                const selected = selectedTheme === themeOption.value;
                return (
                  <button
                    key={themeOption.value}
                    type="button"
                    onClick={() =>
                      void saveThemeSelection(
                        themeOption.value as ForgeThemePreference,
                        themeOption.value === "custom"
                          ? customTheme
                          : customTheme
                      )
                    }
                    className={`rounded-[18px] border px-3 py-3 text-left transition ${
                      selected
                        ? "border-[rgba(192,193,255,0.28)] bg-[rgba(192,193,255,0.14)] shadow-[0_18px_36px_rgba(5,12,24,0.24)]"
                        : "border-white/8 bg-white/[0.04] hover:bg-white/[0.07]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-white">
                          {themeOption.value === "custom"
                            ? customTheme.label
                            : themeOption.label}
                        </div>
                        <div className="mt-1 line-clamp-2 text-xs leading-5 text-white/58">
                          {themeOption.description}
                        </div>
                      </div>
                      <div
                        className={`mt-1 size-4 rounded-full border ${
                          selected
                            ? "border-[rgba(192,193,255,0.65)] bg-[var(--primary)]"
                            : "border-white/25"
                        }`}
                      />
                    </div>
                    <ThemePreviewSwatches theme={preview} />
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[16px] bg-white/[0.04] px-3 py-3">
              <div>
                <div className="text-sm font-medium text-white">
                  Custom theme editor
                </div>
                <div className="mt-1 text-sm leading-6 text-white/58">
                  Save a custom Forge palette through a guided modal, or paste
                  and upload JSON directly.
                </div>
              </div>
              <Button
                type="button"
                variant={selectedTheme === "custom" ? "secondary" : "ghost"}
                onClick={() => setThemeEditorOpen(true)}
                pending={themeMutation.isPending}
              >
                {selectedTheme === "custom"
                  ? "Edit custom theme"
                  : "Create custom theme"}
              </Button>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                  Gamification style
                </div>
                <p className="text-sm text-white/58">
                  Choose the reward art style and download its optional trophy,
                  unlock, and mascot sprites.
                </p>
              </div>
              {selectedGamificationAssetStatus?.installed ? (
                <span className="inline-flex rounded-full border border-emerald-200/18 bg-emerald-300/10 px-3 py-1 text-xs font-medium text-emerald-100">
                  Selected style downloaded
                </span>
              ) : (
                <span className="inline-flex rounded-full border border-amber-200/18 bg-amber-300/10 px-3 py-1 text-xs font-medium text-amber-100">
                  Selected style not downloaded
                </span>
              )}
            </div>
            <div className="mt-3 grid gap-2 xl:grid-cols-3">
              {gamificationThemeOptions.map((themeOption) => {
                const selected =
                  selectedGamificationTheme === themeOption.value;
                const assetStatus = gamificationAssetStyles.find(
                  (style) => style.id === themeOption.value
                );
                const installed = assetStatus?.installed ?? false;
                const installing =
                  gamificationAssetInstallMutation.isPending &&
                  gamificationAssetInstallMutation.variables === themeOption.value;
                return (
                  <div
                    key={themeOption.value}
                    className={`grid gap-2 rounded-[18px] border p-2.5 text-left transition ${
                      selected
                        ? "border-amber-200/28 bg-amber-300/[0.09] shadow-[0_18px_42px_rgba(0,0,0,0.26)]"
                        : "border-white/8 bg-white/[0.035] hover:border-white/16 hover:bg-white/[0.065]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        void saveGamificationThemeSelection(themeOption.value)
                      }
                      className="grid gap-2 text-left"
                      aria-label={`Select ${themeOption.label}`}
                      aria-pressed={selected}
                    >
                      <GamificationStylePreview
                        selected={selected}
                        theme={themeOption.value}
                      />
                    </button>
                    <span className="grid gap-1 px-1 pb-1">
                      <span className="text-sm font-semibold text-white">
                        {themeOption.label}
                      </span>
                      <span className="line-clamp-2 text-xs leading-5 text-white/58">
                        {themeOption.description}
                      </span>
                      <span className="mt-1 text-[11px] uppercase tracking-[0.14em] text-white/42">
                        {installed
                          ? `Downloaded ${assetStatus?.spriteCount ?? 0}/${assetStatus?.expectedSpriteCount ?? 0}`
                          : "Not downloaded"}
                      </span>
                      <Button
                        type="button"
                        variant={installed ? "secondary" : "primary"}
                        pending={installing}
                        disabled={installed || gamificationAssetInstallMutation.isPending}
                        onClick={() =>
                          gamificationAssetInstallMutation.mutate(themeOption.value)
                        }
                      >
                        <Download className="size-4" />
                        {installed ? "Downloaded" : "Download"}
                      </Button>
                    </span>
                  </div>
                );
              })}
            </div>
            {gamificationThemeMutation.isPending ? (
              <div className="text-sm text-white/48">Saving reward style…</div>
            ) : null}
            {gamificationAssetInstallMutation.isError ? (
              <div className="mt-3 rounded-[14px] border border-red-300/20 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                {gamificationAssetInstallMutation.error instanceof Error
                  ? gamificationAssetInstallMutation.error.message
                  : "Could not download the selected reward art."}
              </div>
            ) : null}
          </Card>

          <Card className="p-4">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              {t("common.settings.localeLabel")}
            </div>
            <p className="text-sm text-white/58">
              {t("common.settings.localeDescription")}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {(
                [
                  { value: "en", label: t("common.settings.localeEnglish") },
                  { value: "fr", label: t("common.settings.localeFrench") }
                ] as const
              ).map((locale) => (
                <label
                  key={locale.value}
                  className="flex items-center gap-3 rounded-[16px] bg-white/[0.04] px-3 py-3"
                >
                  <input
                    type="radio"
                    value={locale.value}
                    {...settingsForm.register("localePreference")}
                  />
                  <span className="text-white/72">{locale.label}</span>
                </label>
              ))}
            </div>

            <Button
              type="submit"
              pending={updateMutation.isPending}
              pendingLabel="Saving settings"
            >
              Save settings
            </Button>
          </Card>
        </form>

        {hasHealthyMobileCompanion ? (
          <MobileCompanionSettingsCard healthy />
        ) : null}

        <SecurityPostureCard
          integrityScore={settings.security.integrityScore}
          storageMode={settings.security.storageMode}
          lastAuditAt={settings.security.lastAuditAt}
        />
      </div>

      <ThemeCustomizerDialog
        open={themeEditorOpen}
        onOpenChange={setThemeEditorOpen}
        value={customTheme}
        onSave={(theme) => void saveThemeSelection("custom", theme)}
      />
    </div>
  );
}
