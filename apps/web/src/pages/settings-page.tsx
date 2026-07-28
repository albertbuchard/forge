import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import {
  Check,
  Download,
  Info,
  RefreshCw,
  Sparkles,
  Stethoscope
} from "lucide-react";
import { ThemeCustomizerDialog } from "@/components/settings/theme-customizer-dialog";
import {
  SettingsSectionNav,
  SettingsStateFrame
} from "@/components/settings/settings-section-nav";
import { SettingsOwnerBoundary } from "@/components/settings/settings-owner-boundary";
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
  patchSettings
} from "@/lib/api";
import {
  settingsFormSchema,
  type SettingsFormInput,
  type SettingsMutationInput
} from "@/lib/schemas";
import {
  gamificationThemeOptions,
  gamificationPreviewItemKeys,
  getGamificationThemePreviewItemUrl,
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
import {
  forgeApi,
  useApplyForgeDoctorFixesMutation,
  useGetForgeDoctorQuery,
  useRevokeOperatorSessionMutation
} from "@/store/api/forge-api";
import { setSelectedUserIds as setSelectedUserIdsAction } from "@/store/slices/shell-slice";
import { useAppDispatch } from "@/store/typed-hooks";
import type { DoctorIssue, ForgeDoctorReport } from "@/lib/types";

const settingsEyebrowClass =
  "font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]";
const settingsSoftTextClass = "text-sm leading-6 text-[var(--ui-ink-soft)]";
const settingsSubtleTextClass = "text-xs leading-5 text-[var(--ui-ink-faint)]";
const settingsPanelClass =
  "rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)]";
const settingsTileClass =
  "rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)]";

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
            className="h-6 rounded-[10px] border border-[var(--ui-border-subtle)]"
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
    <div className="relative min-h-[138px] overflow-hidden rounded-[18px] border border-[var(--ui-border-subtle)] bg-[linear-gradient(145deg,var(--ui-surface-2),var(--ui-surface-1))]">
      <div className="absolute inset-x-0 bottom-0 h-16 bg-[linear-gradient(0deg,color-mix(in_srgb,var(--ui-surface-3)_82%,transparent),transparent)]" />
      <img
        src={getGamificationThemePreviewUrl(theme)}
        alt={`${theme} neutral Forge Smith mascot preview`}
        className="absolute bottom-1 left-1/2 h-[124px] w-[124px] -translate-x-1/2 object-contain drop-shadow-[0_18px_30px_color-mix(in_srgb,var(--ui-shadow-color)_30%,transparent)]"
      />
      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-glass)] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--ui-ink-medium)] backdrop-blur-md">
        <Sparkles className="size-3 text-[var(--warning)]" />
        Live rewards
      </div>
      <div className="absolute bottom-3 left-3 flex items-center gap-1.5">
        {gamificationPreviewItemKeys.map((assetKey) => (
          <span
            key={assetKey}
            className="grid size-11 place-items-center overflow-hidden rounded-[12px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-glass)] p-1 shadow-[var(--ui-shadow-soft)] backdrop-blur-md"
          >
            <img
              src={getGamificationThemePreviewItemUrl(theme, assetKey)}
              alt={`${theme} reward thumbnail`}
              className="size-full object-contain"
            />
          </span>
        ))}
      </div>
      <span
        className={`absolute right-3 top-3 grid size-7 place-items-center rounded-full border ${
          selected
            ? "border-[color-mix(in_srgb,var(--success)_42%,var(--ui-border-subtle)_58%)] bg-[var(--ui-success-soft)] text-[var(--success)]"
            : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-glass)] text-[var(--ui-ink-faint)]"
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
          <div className={settingsEyebrowClass}>Mobile companion</div>
          <div className="mt-1 text-base font-medium text-[var(--ui-ink-strong)]">
            {healthy ? "iPhone bridge is syncing" : "Connect the iPhone bridge"}
          </div>
          <div className={`mt-1 max-w-3xl ${settingsSoftTextClass}`}>
            {healthy
              ? "Review HealthKit, movement, and background sync permissions."
              : "Pair or refresh the native companion before relying on HealthKit, movement, or watch signals."}
          </div>
        </div>
        <Link
          to="/settings/mobile"
          className="inline-flex min-h-10 items-center rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-2 text-sm text-[var(--ui-ink-strong)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
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
  lastAuditAt,
  doctor
}: {
  integrityScore: number;
  storageMode: string;
  lastAuditAt: string;
  doctor?: ForgeDoctorReport;
}) {
  if (doctor) {
    return [
      doctor.integrity.headline,
      doctor.integrity.topIssues.length > 0
        ? doctor.integrity.topIssues[0].summary
        : "No active Doctor warnings are holding back integrity.",
      `Storage mode: ${storageMode}. Latest Doctor run: ${formatAuditDate(doctor.integrity.lastCheckedAt)}.`
    ];
  }

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
  lastAuditAt,
  doctor
}: {
  integrityScore: number;
  storageMode: string;
  lastAuditAt: string;
  doctor?: ForgeDoctorReport;
}) {
  const score = doctor?.integrity.score ?? integrityScore;
  const explanation = getIntegrityExplanation({
    integrityScore,
    storageMode,
    lastAuditAt,
    doctor
  });

  return (
    <details className="group relative inline-flex">
      <summary
        className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-2.5 py-1 text-[11px] font-medium normal-case tracking-normal text-[var(--ui-ink-soft)] transition marker:hidden hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_32%,transparent)] [&::-webkit-details-marker]:hidden"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.currentTarget.parentElement?.removeAttribute("open");
          }
        }}
      >
        <Info className="size-3.5" aria-hidden="true" />
        {score}% integrity
      </summary>
      <span
        role="tooltip"
        className="surface-modal-panel absolute right-0 top-[calc(100%+0.55rem)] z-50 hidden w-[min(19rem,calc(100vw-2rem))] rounded-[16px] border px-3 py-2.5 text-left text-xs leading-5 tracking-normal text-[var(--ui-ink-soft)] normal-case shadow-[var(--ui-shadow-strong)] group-open:block"
      >
        <span className="block font-medium text-[var(--ui-ink-strong)]">
          {score >= 100 ? "Integrity is complete" : `Why this is ${score}%`}
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
  lastAuditAt,
  doctor,
  doctorLoading,
  onRefreshDoctor,
  onApplyFix,
  applyingFixId
}: {
  integrityScore: number;
  storageMode: string;
  lastAuditAt: string;
  doctor?: ForgeDoctorReport;
  doctorLoading: boolean;
  onRefreshDoctor: () => void;
  onApplyFix: (fixId: string) => void;
  applyingFixId?: string;
}) {
  const score = doctor?.integrity.score ?? integrityScore;
  const checkedAt = doctor?.integrity.lastCheckedAt ?? lastAuditAt;
  const topIssues =
    doctor?.issues.filter((issue) => issue.severity !== "info").slice(0, 4) ??
    [];
  const [primaryExplanation] = getIntegrityExplanation({
    integrityScore,
    storageMode,
    lastAuditAt,
    doctor
  });

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className={settingsEyebrowClass}>Security posture</div>
          <div className={`mt-1 ${settingsSoftTextClass}`}>
            Local-first means Forge stores its runtime data on this machine.
            Integrity is the latest internal consistency score from settings and
            data checks.
          </div>
          <div className={`mt-2 ${settingsSubtleTextClass}`}>
            {primaryExplanation}
          </div>
        </div>
        <IntegrityHelpPill
          integrityScore={integrityScore}
          storageMode={storageMode}
          lastAuditAt={lastAuditAt}
          doctor={doctor}
        />
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className={`${settingsTileClass} px-3 py-3`}>
          <div className="text-xs text-[var(--ui-ink-soft)]">Storage mode</div>
          <div className="mt-1 text-base font-medium text-[var(--ui-ink-strong)]">
            {storageMode}
          </div>
        </div>
        <div className={`${settingsTileClass} px-3 py-3`}>
          <div className="text-xs text-[var(--ui-ink-soft)]">
            Last Doctor run
          </div>
          <div className="mt-1 text-base font-medium text-[var(--ui-ink-strong)]">
            {formatAuditDate(checkedAt)}
          </div>
        </div>
      </div>
      <div className={`mt-3 ${settingsTileClass} p-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--ui-ink-strong)]">
            <Stethoscope className="size-4 text-[var(--info)]" />
            Forge Doctor
          </div>
          <Button
            type="button"
            variant="secondary"
            pending={doctorLoading}
            onClick={onRefreshDoctor}
          >
            <RefreshCw className="size-4" />
            Run
          </Button>
        </div>
        <div className={`mt-2 ${settingsSoftTextClass}`}>
          {doctor
            ? `${score}% integrity. ${doctor.integrity.headline}`
            : "Run Doctor to check settings, storage, entities, rewards, and runtime consistency."}
        </div>
        {topIssues.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {topIssues.map((issue) => (
              <DoctorIssueRow
                key={issue.id}
                issue={issue}
                applying={applyingFixId === issue.fix?.id}
                onApplyFix={onApplyFix}
              />
            ))}
          </div>
        ) : doctor ? (
          <div className="mt-3 rounded-[12px] border border-[color-mix(in_srgb,var(--success)_24%,var(--ui-border-subtle)_76%)] bg-[var(--ui-success-soft)] px-3 py-2 text-sm text-[var(--success)]">
            No active consistency warnings.
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function DoctorIssueRow({
  issue,
  applying,
  onApplyFix
}: {
  issue: DoctorIssue;
  applying: boolean;
  onApplyFix: (fixId: string) => void;
}) {
  return (
    <div className={`${settingsTileClass} px-3 py-2`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
            {issue.group} / {issue.severity}
          </div>
          <div className="mt-1 text-sm text-[var(--ui-ink-medium)]">
            {issue.summary}
          </div>
        </div>
        {issue.fix?.kind === "safe_auto_fix" ? (
          <Button
            type="button"
            variant="secondary"
            pending={applying}
            onClick={() => onApplyFix(issue.fix!.id)}
          >
            Apply fix
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { t } = useI18n();
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);

  const operatorSessionQuery = useQuery({
    queryKey: ["forge-operator-session"],
    queryFn: ensureOperatorSession
  });
  const sessionReady = operatorSessionQuery.isSuccess;
  const isOperatorSession =
    operatorSessionQuery.data?.session.profile === "operator";

  const settingsQuery = useQuery({
    queryKey: ["forge-settings"],
    queryFn: getSettings,
    enabled: sessionReady
  });
  const doctorQuery = useGetForgeDoctorQuery(undefined, {
    skip: !isOperatorSession
  });
  const companionOverviewQuery = useQuery({
    queryKey: ["forge-companion-overview"],
    queryFn: async () => (await getCompanionOverview()).overview,
    enabled: isOperatorSession,
    staleTime: 30_000
  });
  const gamificationAssetsQuery = useQuery({
    queryKey: ["forge-gamification-assets"],
    queryFn: getGamificationAssetStatus,
    enabled: isOperatorSession,
    staleTime: 30_000
  });

  const settingsForm = useForm<SettingsFormInput>({
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
    mutationFn: (input: SettingsFormInput) => patchSettings(input),
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
        queryClient.invalidateQueries({
          queryKey: ["forge-gamification-assets"]
        })
      ]);
    }
  });

  const [revokeOperatorSessionMutation, revokeSessionMutation] =
    useRevokeOperatorSessionMutation();
  const [applyDoctorFixMutation, applyDoctorFixState] =
    useApplyForgeDoctorFixesMutation();
  const [applyingDoctorFixId, setApplyingDoctorFixId] = useState<string>();
  const resetOperatorSession = async () => {
    await revokeOperatorSessionMutation().unwrap();
    dispatch(setSelectedUserIdsAction([]));
    dispatch(forgeApi.util.resetApiState());
    queryClient.removeQueries({
      predicate: (query) => {
        const [root] = query.queryKey;
        return typeof root === "string" && root.startsWith("forge-");
      }
    });
    await Promise.all([invalidateSettings(), operatorSessionQuery.refetch()]);
  };

  useEffect(() => {
    if (!settingsQuery.data?.settings) return;
    settingsForm.reset(settingsFormSchema.parse(settingsQuery.data.settings));
  }, [settingsQuery.data, settingsForm]);

  const settings = settingsQuery.data?.settings;
  const doctor = doctorQuery.data?.doctor;
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

  const applyDoctorFix = async (fixId: string) => {
    if (
      !window.confirm(
        "Apply this Forge Doctor fix? Forge will only run the selected safe repair."
      )
    ) {
      return;
    }
    setApplyingDoctorFixId(fixId);
    try {
      await applyDoctorFixMutation({ fixIds: [fixId] }).unwrap();
      await Promise.all([settingsQuery.refetch(), doctorQuery.refetch()]);
    } finally {
      setApplyingDoctorFixId(undefined);
    }
  };

  const saveThemeSelection = async (
    themePreference: ForgeThemePreference,
    nextCustomTheme: SettingsMutationInput["customTheme"] = customTheme
  ) => {
    themeMutation.reset();
    const previousThemePreference = settingsForm.getValues("themePreference");
    const previousCustomTheme = settingsForm.getValues("customTheme");
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
    try {
      await themeMutation.mutateAsync({
        themePreference,
        customTheme: nextCustomTheme ?? defaultCustomTheme
      });
    } catch {
      settingsForm.setValue("themePreference", previousThemePreference);
      settingsForm.setValue("customTheme", previousCustomTheme);
    }
  };

  const saveGamificationThemeSelection = async (
    gamificationTheme: GamificationThemePreference
  ) => {
    gamificationThemeMutation.reset();
    const previousGamificationTheme =
      settingsForm.getValues("gamificationTheme");
    settingsForm.setValue("gamificationTheme", gamificationTheme, {
      shouldDirty: true
    });
    try {
      await gamificationThemeMutation.mutateAsync({ gamificationTheme });
    } catch {
      settingsForm.setValue("gamificationTheme", previousGamificationTheme);
    }
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
      <SettingsStateFrame>
        <div role="status" aria-live="polite">
          <span className="sr-only">Loading runtime settings.</span>
          <SurfaceSkeleton
            eyebrow="Settings"
            title="Loading settings"
            description="Establishing the operator session and fetching current configuration."
            columns={2}
            blocks={6}
          />
        </div>
      </SettingsStateFrame>
    );
  }

  if (operatorSessionQuery.isError) {
    return (
      <SettingsStateFrame>
        <ErrorState
          eyebrow="Settings"
          error={operatorSessionQuery.error}
          onRetry={() => void operatorSessionQuery.refetch()}
        />
      </SettingsStateFrame>
    );
  }

  if (settingsQuery.isError || !settings) {
    return (
      <SettingsStateFrame>
        <ErrorState
          eyebrow="Settings"
          error={
            settingsQuery.error ??
            new Error("Forge returned an empty settings payload.")
          }
          onRetry={() => void settingsQuery.refetch()}
        />
      </SettingsStateFrame>
    );
  }

  if (!isOperatorSession) {
    return (
      <SettingsOwnerBoundary
        title="Global settings stay on the Forge host"
        description="Your paired browser can use Forge normally, but runtime policy, appearance, language, downloads, and Doctor repairs affect every client. Change them from Forge on the host machine."
      />
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-[1220px] gap-5">
      <PageHero
        title="Settings"
        description="Manage the operator session, execution policy, appearance, language, and Doctor-backed runtime integrity."
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
          <span className="rounded-full border border-[color-mix(in_srgb,var(--warning)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-warning-soft)] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--warning)]">
            Dev frontend
          </span>
          <span className="text-sm text-[var(--ui-ink-soft)]">
            Forge UI is currently being served by the Vite dev server.
          </span>
        </div>
      ) : null}

      <SettingsSectionNav />

      {operatorSessionQuery.data?.session ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-[color-mix(in_srgb,var(--success)_26%,var(--ui-border-subtle)_74%)] bg-[var(--ui-success-soft)] px-4 py-3 text-sm text-[var(--ui-ink-medium)]">
          <div>
            Operator session active as{" "}
            <span className="font-medium text-[var(--ui-ink-strong)]">
              {operatorSessionQuery.data.session.actorLabel}
            </span>
            .
          </div>
          <Button
            variant="secondary"
            size="sm"
            pending={revokeSessionMutation.isLoading}
            pendingLabel="Resetting session"
            onClick={() => void resetOperatorSession()}
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
            <div className={settingsEyebrowClass}>Operator profile</div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm text-[var(--ui-ink-soft)]">Name</span>
                <Input {...settingsForm.register("profile.operatorName")} />
              </label>
              <label className="grid gap-2">
                <span className="text-sm text-[var(--ui-ink-soft)]">Email</span>
                <Input {...settingsForm.register("profile.operatorEmail")} />
              </label>
            </div>
            <label className="grid gap-2">
              <span className="text-sm text-[var(--ui-ink-soft)]">Title</span>
              <Input {...settingsForm.register("profile.operatorTitle")} />
            </label>

            <div className={`mt-2 ${settingsEyebrowClass}`}>
              Execution policy
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
              <label className="grid gap-2">
                <span className="text-sm text-[var(--ui-ink-soft)]">
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
                <div className="text-sm text-[var(--ui-ink-soft)]">
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
                      className={`grid gap-2 ${settingsPanelClass} px-3 py-3`}
                    >
                      <span className="flex items-center gap-3">
                        <input
                          type="radio"
                          value={mode.value}
                          {...settingsForm.register(
                            "execution.timeAccountingMode"
                          )}
                        />
                        <span className="text-[var(--ui-ink-strong)]">
                          {mode.label}
                        </span>
                      </span>
                      <span className={settingsSubtleTextClass}>
                        {mode.description}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className={`mt-2 ${settingsEyebrowClass}`}>
              Notification rules
            </div>
            <label
              className={`flex items-center justify-between ${settingsPanelClass} px-3 py-2.5`}
            >
              <span className="text-[var(--ui-ink-medium)]">
                Goal drift alerts
              </span>
              <input
                type="checkbox"
                {...settingsForm.register("notifications.goalDriftAlerts")}
              />
            </label>
            <label
              className={`flex items-center justify-between ${settingsPanelClass} px-3 py-2.5`}
            >
              <span className="text-[var(--ui-ink-medium)]">
                Daily quest reminders
              </span>
              <input
                type="checkbox"
                {...settingsForm.register("notifications.dailyQuestReminders")}
              />
            </label>
            <label
              className={`flex items-center justify-between ${settingsPanelClass} px-3 py-2.5`}
            >
              <span className="text-[var(--ui-ink-medium)]">
                Achievement celebrations
              </span>
              <input
                type="checkbox"
                {...settingsForm.register(
                  "notifications.achievementCelebrations"
                )}
              />
            </label>
          </Card>

          <Card className="p-4">
            <div className={settingsEyebrowClass}>Theme calibration</div>
            <p className={settingsSoftTextClass}>
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
                const themeLabel =
                  themeOption.value === "custom"
                    ? customTheme.label
                    : themeOption.label;
                return (
                  <button
                    key={themeOption.value}
                    type="button"
                    aria-label={`Select ${themeLabel} theme`}
                    aria-pressed={selected}
                    disabled={themeMutation.isPending}
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
                        ? "border-[color-mix(in_srgb,var(--primary)_34%,var(--ui-border-subtle)_66%)] bg-[var(--ui-accent-soft)] shadow-[var(--ui-shadow-soft)]"
                        : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-[var(--ui-ink-strong)]">
                          {themeLabel}
                        </div>
                        <div className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--ui-ink-soft)]">
                          {themeOption.description}
                        </div>
                      </div>
                      <div
                        className={`mt-1 size-4 rounded-full border ${
                          selected
                            ? "border-[color-mix(in_srgb,var(--primary)_65%,var(--ui-border-subtle)_35%)] bg-[var(--primary)]"
                            : "border-[var(--ui-border-strong)]"
                        }`}
                      />
                    </div>
                    <ThemePreviewSwatches theme={preview} />
                  </button>
                );
              })}
            </div>
            {themeMutation.isError ? (
              <div
                role="alert"
                className="mt-3 rounded-[14px] border border-[color-mix(in_srgb,var(--danger)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-danger-soft)] px-3 py-2 text-sm text-[var(--danger)]"
              >
                {themeMutation.error instanceof Error
                  ? themeMutation.error.message
                  : "Could not save the selected Forge theme."}
              </div>
            ) : null}
            <div
              className={`mt-3 flex flex-wrap items-center justify-between gap-3 ${settingsPanelClass} px-3 py-3`}
            >
              <div>
                <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                  Custom theme editor
                </div>
                <div className={`mt-1 ${settingsSoftTextClass}`}>
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
                <div className={settingsEyebrowClass}>Gamification style</div>
                <p className={settingsSoftTextClass}>
                  Choose the reward art style and download its optional trophy,
                  unlock, and mascot sprites.
                </p>
              </div>
              {selectedGamificationAssetStatus?.installed ? (
                <span className="inline-flex rounded-full border border-[color-mix(in_srgb,var(--success)_26%,var(--ui-border-subtle)_74%)] bg-[var(--ui-success-soft)] px-3 py-1 text-xs font-medium text-[var(--success)]">
                  Selected style downloaded
                </span>
              ) : (
                <span className="inline-flex rounded-full border border-[color-mix(in_srgb,var(--warning)_26%,var(--ui-border-subtle)_74%)] bg-[var(--ui-warning-soft)] px-3 py-1 text-xs font-medium text-[var(--warning)]">
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
                  gamificationAssetInstallMutation.variables ===
                    themeOption.value;
                return (
                  <div
                    key={themeOption.value}
                    className={`grid gap-2 rounded-[18px] border p-2.5 text-left transition ${
                      selected
                        ? "border-[color-mix(in_srgb,var(--warning)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-warning-soft)] shadow-[var(--ui-shadow-soft)]"
                        : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
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
                      disabled={gamificationThemeMutation.isPending}
                    >
                      <GamificationStylePreview
                        selected={selected}
                        theme={themeOption.value}
                      />
                    </button>
                    <span className="grid gap-1 px-1 pb-1">
                      <span className="text-sm font-semibold text-[var(--ui-ink-strong)]">
                        {themeOption.label}
                      </span>
                      <span className="line-clamp-2 text-xs leading-5 text-[var(--ui-ink-soft)]">
                        {themeOption.description}
                      </span>
                      <span className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                        {installed
                          ? `Downloaded ${assetStatus?.spriteCount ?? 0}/${assetStatus?.expectedSpriteCount ?? 0}`
                          : "Not downloaded"}
                      </span>
                      <Button
                        type="button"
                        variant={installed ? "secondary" : "primary"}
                        pending={installing}
                        disabled={
                          installed ||
                          gamificationAssetInstallMutation.isPending
                        }
                        onClick={() =>
                          gamificationAssetInstallMutation.mutate(
                            themeOption.value
                          )
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
              <div className="text-sm text-[var(--ui-ink-faint)]">
                Saving reward style…
              </div>
            ) : null}
            {gamificationThemeMutation.isError ? (
              <div
                role="alert"
                className="mt-3 rounded-[14px] border border-[color-mix(in_srgb,var(--danger)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-danger-soft)] px-3 py-2 text-sm text-[var(--danger)]"
              >
                {gamificationThemeMutation.error instanceof Error
                  ? gamificationThemeMutation.error.message
                  : "Could not save the selected reward style."}
              </div>
            ) : null}
            {gamificationAssetInstallMutation.isError ? (
              <div className="mt-3 rounded-[14px] border border-[color-mix(in_srgb,var(--danger)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
                {gamificationAssetInstallMutation.error instanceof Error
                  ? gamificationAssetInstallMutation.error.message
                  : "Could not download the selected reward art."}
              </div>
            ) : null}
          </Card>

          <Card className="p-4">
            <div className={settingsEyebrowClass}>
              {t("common.settings.localeLabel")}
            </div>
            <p className={settingsSoftTextClass}>
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
                  className={`flex items-center gap-3 ${settingsPanelClass} px-3 py-3`}
                >
                  <input
                    type="radio"
                    value={locale.value}
                    {...settingsForm.register("localePreference")}
                  />
                  <span className="text-[var(--ui-ink-medium)]">
                    {locale.label}
                  </span>
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
          doctor={doctor}
          doctorLoading={
            doctorQuery.isFetching || applyDoctorFixState.isLoading
          }
          onRefreshDoctor={() => void doctorQuery.refetch()}
          onApplyFix={(fixId) => void applyDoctorFix(fixId)}
          applyingFixId={applyingDoctorFixId}
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
