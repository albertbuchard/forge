import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
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
  getSettings,
  patchSettings,
  revokeOperatorSession
} from "@/lib/api";
import {
  settingsMutationSchema,
  type SettingsMutationInput
} from "@/lib/schemas";
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
    <div className="mt-4 grid grid-cols-4 gap-2">
      {[theme.primary, theme.secondary, theme.tertiary, theme.panelHigh].map(
        (color) => (
          <div
            key={color}
            className="h-10 rounded-[14px] border border-black/10"
            style={{ background: color }}
          />
        )
      )}
    </div>
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
  const customTheme = settingsForm.watch("customTheme") ?? defaultCustomTheme;

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
        badge={`${settings.security.integrityScore}% integrity`}
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

      <div className="grid gap-5">
        <Card>
          <form
            className="grid gap-4"
            onSubmit={settingsForm.handleSubmit(async (values) => {
              await updateMutation.mutateAsync(values);
            })}
          >
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Operator profile
            </div>
            <div className="grid gap-4 md:grid-cols-2">
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
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
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
                <div className="grid gap-3 md:grid-cols-3">
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
                      className="grid gap-2 rounded-[18px] bg-white/[0.04] px-4 py-4"
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
                      <span className="text-sm leading-6 text-white/56">
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
            <label className="flex items-center justify-between rounded-[18px] bg-white/[0.04] px-4 py-3">
              <span className="text-white/72">Goal drift alerts</span>
              <input
                type="checkbox"
                {...settingsForm.register("notifications.goalDriftAlerts")}
              />
            </label>
            <label className="flex items-center justify-between rounded-[18px] bg-white/[0.04] px-4 py-3">
              <span className="text-white/72">Daily quest reminders</span>
              <input
                type="checkbox"
                {...settingsForm.register("notifications.dailyQuestReminders")}
              />
            </label>
            <label className="flex items-center justify-between rounded-[18px] bg-white/[0.04] px-4 py-3">
              <span className="text-white/72">Achievement celebrations</span>
              <input
                type="checkbox"
                {...settingsForm.register(
                  "notifications.achievementCelebrations"
                )}
              />
            </label>

            <div className="mt-2 font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Theme calibration
            </div>
            <p className="text-sm text-white/58">
              Switch between Forge dark and light presets, follow the system
              palette, or save your own shell theme.
            </p>
            <div className="grid gap-3 xl:grid-cols-3">
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
                    className={`rounded-[24px] border px-4 py-4 text-left transition ${
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
                        <div className="mt-2 text-sm leading-6 text-white/58">
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
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-white/[0.04] px-4 py-4">
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

            <div className="mt-2 font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
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
                  className="flex items-center gap-3 rounded-[18px] bg-white/[0.04] px-4 py-4"
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
          </form>
        </Card>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                Mobile companion
              </div>
              <div className="mt-2 text-lg text-white">
                Pair the native iPhone bridge for HealthKit, background sync,
                and future watch or location signals.
              </div>
            </div>
            <Link
              to="/settings/mobile"
              className="inline-flex min-h-11 items-center rounded-[16px] bg-white/[0.08] px-4 py-3 text-sm text-white transition hover:bg-white/[0.12]"
            >
              Open mobile settings
            </Link>
          </div>
        </Card>

        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Security posture
          </div>
          <div className="mt-4 grid gap-3">
            <div className="rounded-[18px] bg-white/[0.04] p-4">
              <div className="text-sm text-white/58">Storage mode</div>
              <div className="mt-2 font-display text-2xl text-white">
                {settings.security.storageMode}
              </div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] p-4">
              <div className="text-sm text-white/58">Last audit</div>
              <div className="mt-2 text-white">
                {new Date(settings.security.lastAuditAt).toLocaleString()}
              </div>
            </div>
          </div>
        </Card>
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
