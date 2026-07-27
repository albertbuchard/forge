import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  ExternalLink,
  EyeOff,
  KeyRound,
  Link2,
  RefreshCcw,
  Trash2
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { CalendarConnectionFlowDialog } from "@/components/calendar/calendar-connection-flow-dialog";
import {
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import {
  SettingsSectionNav,
  SettingsStateFrame
} from "@/components/settings/settings-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/page-state";
import { invalidateForgeSnapshot } from "@/store/api/invalidate-forge-snapshot";
import {
  createCalendarConnection,
  deleteCalendarConnection,
  discoverExistingCalendarConnection,
  ensureOperatorSession,
  getSettings,
  listCalendarConnections,
  listCalendarResources,
  patchCalendarConnection,
  requestMacOSLocalCalendarAccess,
  syncCalendarConnection
} from "@/lib/api";
import {
  buildCalendarDisplayColorMap,
  readCalendarDisplayPreferences,
  writeCalendarDisplayPreferences
} from "@/lib/calendar-display-preferences";
import {
  dedupeCalendarResourcesWithConnections,
  readCalendarDisplayName
} from "@/lib/calendar-name-deduper";
import type {
  CalendarDiscoveryPayload,
  CalendarProvider,
  CalendarResource
} from "@/lib/types";

const SETTINGS_EYEBROW_CLASS =
  "text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]";
const SETTINGS_BODY_CLASS = "text-sm leading-6 text-[var(--ui-ink-soft)]";
const SETTINGS_STRONG_CLASS = "font-medium text-[var(--ui-ink-strong)]";
const SETTINGS_PANEL_CLASS =
  "min-w-0 max-w-full overflow-hidden rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)]";
const SETTINGS_MUTED_PANEL_CLASS =
  "min-w-0 max-w-full overflow-hidden rounded-[24px] border border-dashed border-[var(--ui-border-strong)] bg-[var(--ui-surface-1)]";
const SETTINGS_META_BADGE_CLASS =
  "bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]";
const SETTINGS_SUCCESS_BADGE_CLASS =
  "bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_74%,var(--ui-ink-strong)_26%)]";
const SETTINGS_INFO_BADGE_CLASS =
  "bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_76%,var(--ui-ink-strong)_24%)]";
const SETTINGS_TOGGLE_SELECTED_CLASS =
  "border border-[var(--ui-success-soft)] bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_74%,var(--ui-ink-strong)_26%)]";
const SETTINGS_TOGGLE_IDLE_CLASS =
  "border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)]";

function normalizeCalendarUrl(value: string) {
  try {
    const url = new URL(value);
    if (!url.pathname.endsWith("/")) {
      url.pathname = `${url.pathname}/`;
    }
    return url.toString();
  } catch {
    return value;
  }
}

function calendarProviderLabel(provider: CalendarProvider) {
  switch (provider) {
    case "google":
      return "Google Calendar";
    case "apple":
      return "Apple Calendar";
    case "microsoft":
      return "Exchange Online";
    case "macos_local":
      return "Calendars On This Mac";
    case "caldav":
    default:
      return "Custom CalDAV";
  }
}

function providerActionLabel(provider: CalendarProvider) {
  switch (provider) {
    case "google":
      return "Open Google guided flow";
    case "microsoft":
      return "Open Microsoft guided flow";
    case "macos_local":
      return "Open Mac calendar flow";
    default:
      return "Open guided setup";
  }
}

function providerConnectionIcon(provider: CalendarProvider) {
  switch (provider) {
    case "google":
    case "microsoft":
      return KeyRound;
    case "macos_local":
      return CalendarDays;
    case "apple":
      return CalendarDays;
    case "caldav":
    default:
      return Link2;
  }
}

function providerSyncLabel(provider: CalendarProvider) {
  switch (provider) {
    case "microsoft":
      return "Read only";
    case "macos_local":
      return "Read + write";
    default:
      return "Read + write";
  }
}

function providerAccessLabel(provider: CalendarProvider) {
  switch (provider) {
    case "google":
      return "Local PKCE";
    case "microsoft":
      return "Guided sign-in";
    case "macos_local":
      return "Host machine";
    case "apple":
      return "App password";
    case "caldav":
    default:
      return "CalDAV credentials";
  }
}

function providerConnectionSummary(provider: CalendarProvider) {
  switch (provider) {
    case "google":
      return "Sign in from the same machine running Forge. After connection, Forge can mirror the calendars you choose and reuse the current shared Forge write target, creating one only when the runtime does not already have one.";
    case "apple":
      return "Use your Apple ID email and app-specific password. Forge discovers your iCloud calendars before you choose what to mirror.";
    case "microsoft":
      return "Use the guided Microsoft sign-in flow. Forge mirrors the Exchange calendars you choose and keeps this provider read only.";
    case "macos_local":
      return "Use the calendars already configured in Calendar.app on this Mac. Forge requests Calendar access through macOS, discovers host calendars by account source, and replaces overlapping remote account connections instead of duplicating them.";
    case "caldav":
    default:
      return "Enter a CalDAV server URL and account credentials. Forge discovers the calendars on that account before you choose what to mirror.";
  }
}

function providerConnectionCountLabel(count: number) {
  return `${count} connection${count === 1 ? "" : "s"}`;
}

function connectionStatusLabel(
  status: "connected" | "needs_attention" | "error"
) {
  switch (status) {
    case "connected":
      return "Connected";
    case "needs_attention":
      return "Needs attention";
    case "error":
      return "Error";
  }
}

function readableCalendarConnectionError(value: string) {
  const trimmed = value.trim();
  const legacyHelperError =
    /^(?:invalidRequest|unavailable)\("([\s\S]*)"\)$/.exec(trimmed);
  return legacyHelperError?.[1]
    ? legacyHelperError[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\")
    : trimmed;
}

function effectiveCalendarConnectionStatus(input: {
  provider: CalendarProvider;
  status: "connected" | "needs_attention" | "error";
  lastSyncError: string | null;
}) {
  if (
    input.provider === "macos_local" &&
    input.status === "error" &&
    input.lastSyncError &&
    /calendar (?:full )?access|privacy & security > calendars/i.test(
      readableCalendarConnectionError(input.lastSyncError)
    )
  ) {
    return "needs_attention" as const;
  }
  return input.status;
}

function calendarAccessLabel(calendar: CalendarResource) {
  if (!calendar.forgeManaged) {
    return "Read-only mirror";
  }
  return calendar.canWrite ? "Writable" : "Read only";
}

export function SettingsCalendarPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [initialProvider, setInitialProvider] =
    useState<CalendarProvider>("google");
  const [dialogInitialStepId, setDialogInitialStepId] = useState<
    string | undefined
  >(undefined);
  const [manageConnectionId, setManageConnectionId] = useState<string | null>(
    null
  );
  const [managedCalendarUrls, setManagedCalendarUrls] = useState<string[]>([]);
  const [manageSelectionSeeded, setManageSelectionSeeded] = useState(false);
  const [removeConnectionId, setRemoveConnectionId] = useState<string | null>(
    null
  );
  const [macOSRepairMessage, setMacOSRepairMessage] = useState<{
    connectionId: string;
    message: string;
  } | null>(null);
  const [displayPreferences, setDisplayPreferences] = useState(() =>
    readCalendarDisplayPreferences()
  );

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

  const connectionsQuery = useQuery({
    queryKey: ["forge-calendar-connections"],
    queryFn: listCalendarConnections,
    enabled: operatorReady
  });

  const calendarsQuery = useQuery({
    queryKey: ["forge-calendar-resources"],
    queryFn: listCalendarResources,
    enabled: operatorReady
  });

  const invalidateCalendarSettings = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["forge-settings"] }),
      queryClient.invalidateQueries({
        queryKey: ["forge-calendar-connections"]
      }),
      queryClient.invalidateQueries({ queryKey: ["forge-calendar-resources"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-calendar-overview"] }),
      invalidateForgeSnapshot(queryClient)
    ]);
  };

  const connectMutation = useMutation({
    mutationFn: createCalendarConnection,
    onSuccess: invalidateCalendarSettings
  });

  const syncMutation = useMutation({
    mutationFn: (connectionId: string) => syncCalendarConnection(connectionId),
    onSuccess: invalidateCalendarSettings
  });

  const repairMacOSAccessMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      const result = await requestMacOSLocalCalendarAccess();
      if (result.granted && result.status === "full_access") {
        await syncCalendarConnection(connectionId);
      }
      return result;
    },
    onSuccess: async (result, connectionId) => {
      await invalidateCalendarSettings();
      setMacOSRepairMessage({
        connectionId,
        message:
          result.granted && result.status === "full_access"
            ? "Calendar access is repaired and this connection has been synced."
            : (result.message ??
              "Allow Forge full Calendar access in System Settings, then click Repair Calendar access again.")
      });
    },
    onError: (error, connectionId) => {
      setMacOSRepairMessage({
        connectionId,
        message:
          error instanceof Error
            ? error.message
            : "Forge could not repair Calendar access."
      });
    }
  });

  const patchConnectionMutation = useMutation({
    mutationFn: ({
      connectionId,
      patch
    }: {
      connectionId: string;
      patch: Partial<{ label: string; selectedCalendarUrls: string[] }>;
    }) => patchCalendarConnection(connectionId, patch),
    onSuccess: invalidateCalendarSettings
  });

  const deleteConnectionMutation = useMutation({
    mutationFn: (connectionId: string) =>
      deleteCalendarConnection(connectionId),
    onSuccess: invalidateCalendarSettings
  });

  useEffect(() => {
    if (!operatorReady) {
      return;
    }
    const intent = searchParams.get("intent");
    const provider = searchParams.get("provider");
    if (intent !== "connect") {
      return;
    }
    setInitialProvider(
      provider === "apple" ||
        provider === "caldav" ||
        provider === "google" ||
        provider === "microsoft" ||
        provider === "macos_local"
        ? provider
        : "google"
    );
    setDialogInitialStepId(
      provider === "microsoft" ? "credentials" : undefined
    );
    setDialogOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("intent");
    next.delete("provider");
    setSearchParams(next, { replace: true });
  }, [operatorReady, searchParams, setSearchParams]);

  const displayCalendars = useMemo(
    () =>
      dedupeCalendarResourcesWithConnections(
        calendarsQuery.data?.calendars ?? [],
        connectionsQuery.data?.connections ?? []
      ),
    [calendarsQuery.data?.calendars, connectionsQuery.data?.connections]
  );
  const calendarsByConnection = useMemo(() => {
    const grouped = new Map<string, CalendarResource[]>();
    for (const calendar of displayCalendars) {
      const bucket = grouped.get(calendar.connectionId) ?? [];
      bucket.push(calendar);
      grouped.set(calendar.connectionId, bucket);
    }
    return grouped;
  }, [displayCalendars]);
  const connectionHealthByProvider = useMemo(() => {
    const health: Partial<
      Record<
        CalendarProvider,
        { total: number; connected: number; needsAttention: number }
      >
    > = {};
    for (const connection of connectionsQuery.data?.connections ?? []) {
      const effectiveStatus = effectiveCalendarConnectionStatus(connection);
      const current = health[connection.provider] ?? {
        total: 0,
        connected: 0,
        needsAttention: 0
      };
      current.total += 1;
      if (effectiveStatus === "connected") {
        current.connected += 1;
      } else {
        current.needsAttention += 1;
      }
      health[connection.provider] = current;
    }
    return health;
  }, [connectionsQuery.data?.connections]);
  const calendarDisplayColors = useMemo(
    () =>
      buildCalendarDisplayColorMap(
        displayCalendars,
        displayPreferences.calendarColors
      ),
    [displayCalendars, displayPreferences.calendarColors]
  );
  const sharedForgeWriteTargetConnection = useMemo(
    () =>
      (connectionsQuery.data?.connections ?? []).find(
        (connection) =>
          connection.status === "connected" &&
          typeof connection.config?.forgeCalendarUrl === "string" &&
          connection.config.forgeCalendarUrl.trim().length > 0
      ) ?? null,
    [connectionsQuery.data?.connections]
  );

  const managedConnection = useMemo(
    () =>
      connectionsQuery.data?.connections.find(
        (connection) => connection.id === manageConnectionId
      ) ?? null,
    [connectionsQuery.data, manageConnectionId]
  );

  const removableConnection = useMemo(
    () =>
      connectionsQuery.data?.connections.find(
        (connection) => connection.id === removeConnectionId
      ) ?? null,
    [connectionsQuery.data, removeConnectionId]
  );

  const managedResources = useMemo(
    () =>
      manageConnectionId
        ? (calendarsByConnection.get(manageConnectionId) ?? [])
        : [],
    [calendarsByConnection, manageConnectionId]
  );

  const managedDiscoveryQuery = useQuery({
    queryKey: ["forge-calendar-connection-discovery", manageConnectionId],
    queryFn: () => discoverExistingCalendarConnection(manageConnectionId!),
    enabled: operatorReady && manageConnectionId !== null
  });

  useEffect(() => {
    if (!manageConnectionId) {
      setManagedCalendarUrls([]);
      setManageSelectionSeeded(false);
      return;
    }
    const selected = managedResources
      .filter((calendar) => calendar.selectedForSync)
      .map((calendar) => normalizeCalendarUrl(calendar.remoteId));
    setManagedCalendarUrls(selected);
    setManageSelectionSeeded(true);
  }, [manageConnectionId, managedResources]);

  useEffect(() => {
    writeCalendarDisplayPreferences(displayPreferences);
  }, [displayPreferences]);

  const manageMirrorSteps = useMemo<
    Array<QuestionFlowStep<{ selectedCalendarUrls: string[] }>>
  >(
    () => [
      {
        id: "mirrors",
        eyebrow: "Mirroring",
        title: "Choose which calendars Forge should mirror",
        description:
          "Unselected calendars stop showing up in Forge’s mirrored calendar views. The Forge write calendar stays available for work blocks and timeboxes.",
        render: (value, setValue) => {
          if (managedDiscoveryQuery.isLoading) {
            return (
              <div
                className={`${SETTINGS_MUTED_PANEL_CLASS} px-4 py-6 ${SETTINGS_BODY_CLASS}`}
              >
                Rediscovering calendars for this connection.
              </div>
            );
          }

          if (
            managedDiscoveryQuery.isError ||
            !managedDiscoveryQuery.data?.discovery
          ) {
            return (
              <div className="rounded-[24px] border border-[color-mix(in_srgb,var(--danger)_24%,var(--ui-border-subtle)_76%)] bg-[var(--ui-danger-soft)] px-4 py-6 text-sm leading-6 text-[var(--danger)]">
                {managedDiscoveryQuery.error instanceof Error
                  ? managedDiscoveryQuery.error.message
                  : "Forge could not rediscover calendars for this connection."}
              </div>
            );
          }

          const discovery: CalendarDiscoveryPayload =
            managedDiscoveryQuery.data.discovery;
          const readOnlyConnection =
            managedConnection?.provider === "microsoft";
          const writeTargetUrl =
            typeof managedConnection?.config?.forgeCalendarUrl === "string"
              ? normalizeCalendarUrl(managedConnection.config.forgeCalendarUrl)
              : null;

          return (
            <div className="grid gap-3">
              {discovery.calendars.map((calendar) => {
                const normalizedUrl = normalizeCalendarUrl(calendar.url);
                const isSelected = manageSelectionSeeded
                  ? value.selectedCalendarUrls.includes(normalizedUrl)
                  : managedResources.some(
                      (resource) =>
                        resource.selectedForSync &&
                        normalizeCalendarUrl(resource.remoteId) ===
                          normalizedUrl
                    );
                const isWriteTarget = writeTargetUrl === normalizedUrl;

                return (
                  <div
                    key={calendar.url}
                    className={`${SETTINGS_PANEL_CLASS} p-4`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className={SETTINGS_STRONG_CLASS}>
                          {readCalendarDisplayName(calendar)}
                        </div>
                        <div className="mt-1 break-all text-sm text-[var(--ui-ink-soft)]">
                          {calendar.timezone || "No timezone exposed"} ·{" "}
                          {calendar.url}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {isWriteTarget && !readOnlyConnection ? (
                          <Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">
                            Forge writes here
                          </Badge>
                        ) : null}
                        {readOnlyConnection ? (
                          <Badge className="bg-[var(--ui-info-soft)] text-[var(--info)]">
                            Read only
                          </Badge>
                        ) : null}
                        {calendar.isPrimary ? (
                          <Badge className={SETTINGS_META_BADGE_CLASS}>
                            Primary
                          </Badge>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={isWriteTarget && !readOnlyConnection}
                        onClick={() =>
                          setValue({
                            selectedCalendarUrls: isSelected
                              ? value.selectedCalendarUrls.filter(
                                  (entry) => entry !== normalizedUrl
                                )
                              : [...value.selectedCalendarUrls, normalizedUrl]
                          })
                        }
                        className={`rounded-full px-3 py-2 text-sm transition ${
                          isWriteTarget && !readOnlyConnection
                            ? "cursor-not-allowed border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-faint)]"
                            : isSelected
                              ? SETTINGS_TOGGLE_SELECTED_CLASS
                              : SETTINGS_TOGGLE_IDLE_CLASS
                        }`}
                      >
                        {isWriteTarget && !readOnlyConnection
                          ? "Always available for Forge writes"
                          : isSelected
                            ? "Mirrored into Forge"
                            : "Do not mirror"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        }
      }
    ],
    [
      managedConnection,
      managedDiscoveryQuery,
      managedResources,
      manageSelectionSeeded
    ]
  );

  if (
    operatorSessionQuery.isLoading ||
    settingsQuery.isLoading ||
    connectionsQuery.isLoading ||
    calendarsQuery.isLoading
  ) {
    return (
      <SettingsStateFrame>
        <SurfaceSkeleton
          eyebrow="Settings · Calendar"
          title="Loading calendar settings"
          description="Checking the operator session and loading provider connections."
          columns={2}
          blocks={6}
        />
      </SettingsStateFrame>
    );
  }

  if (operatorSessionQuery.isError) {
    return (
      <SettingsStateFrame>
        <ErrorState
          eyebrow="Settings · Calendar"
          error={operatorSessionQuery.error}
          onRetry={() => void operatorSessionQuery.refetch()}
        />
      </SettingsStateFrame>
    );
  }

  if (
    settingsQuery.isError ||
    connectionsQuery.isError ||
    calendarsQuery.isError ||
    !settingsQuery.data?.settings ||
    !connectionsQuery.data ||
    !calendarsQuery.data
  ) {
    return (
      <SettingsStateFrame>
        <ErrorState
          eyebrow="Settings · Calendar"
          error={
            settingsQuery.error ??
            connectionsQuery.error ??
            calendarsQuery.error ??
            new Error("Calendar settings are unavailable.")
          }
          onRetry={() => {
            void settingsQuery.refetch();
            void connectionsQuery.refetch();
            void calendarsQuery.refetch();
          }}
        />
      </SettingsStateFrame>
    );
  }

  const { providers, connections } = connectionsQuery.data;
  const googleSettings = settingsQuery.data.settings.calendarProviders.google;
  const microsoftSettings =
    settingsQuery.data.settings.calendarProviders.microsoft;

  return (
    <div className="mx-auto grid w-full max-w-[1220px] gap-5">
      <PageHero
        title="Calendar settings"
        description="Manage provider connections, review the shared Forge write target, and open guided setup only when you need to connect or reconfigure a provider."
        badge={`${connections.length} connection${connections.length === 1 ? "" : "s"}`}
      />

      <SettingsSectionNav />

      <div className="grid gap-5">
        <Card className="surface-section-panel grid gap-5 rounded-[30px] border">
          <div className="max-w-3xl">
            <div className={SETTINGS_EYEBROW_CLASS}>Provider connections</div>
            <p className={`mt-2 ${SETTINGS_BODY_CLASS}`}>
              Connect a provider here, then choose which calendars Forge should
              mirror. Writable providers publish work blocks and owned timeboxes
              through one shared{" "}
              <span className={SETTINGS_STRONG_CLASS}>Forge</span> write target,
              creating it only when the runtime does not already have one.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {providers.map((provider) => {
              const ProviderIcon = providerConnectionIcon(provider.provider);
              const providerHealth = connectionHealthByProvider[
                provider.provider
              ] ?? {
                total: 0,
                connected: 0,
                needsAttention: 0
              };
              const connectionCount = providerHealth.total;
              const hasConnections = connectionCount > 0;
              const hasConnectedConnections = providerHealth.connected > 0;
              const needsAttention = providerHealth.needsAttention > 0;

              return (
                <div
                  key={provider.provider}
                  className={`flex min-h-[248px] min-w-0 max-w-full flex-col overflow-hidden rounded-[26px] border p-5 shadow-[inset_0_1px_0_var(--ui-border-subtle)] ${
                    needsAttention
                      ? "border-[color-mix(in_srgb,var(--danger)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-danger-soft)]"
                      : hasConnectedConnections
                        ? "border-[var(--ui-success-soft)] bg-[var(--ui-success-soft)]"
                        : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)]"
                  }`}
                >
                  <div className="flex min-w-0 items-start gap-4">
                    <div
                      className={`shrink-0 rounded-[18px] p-3 ${
                        needsAttention
                          ? "bg-[var(--ui-danger-soft)] text-[var(--danger)]"
                          : hasConnectedConnections
                            ? SETTINGS_SUCCESS_BADGE_CLASS
                            : "bg-[var(--primary)]/14 text-[var(--primary)]"
                      }`}
                    >
                      <ProviderIcon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <div className="min-w-0 text-wrap font-medium text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]">
                          {provider.label}
                        </div>
                        {hasConnections ? (
                          <>
                            <Badge
                              className={
                                needsAttention
                                  ? "bg-[var(--ui-danger-soft)] text-[var(--danger)]"
                                  : SETTINGS_SUCCESS_BADGE_CLASS
                              }
                            >
                              {needsAttention ? "Needs attention" : "Connected"}
                            </Badge>
                            <Badge className={SETTINGS_META_BADGE_CLASS}>
                              {providerConnectionCountLabel(connectionCount)}
                            </Badge>
                          </>
                        ) : null}
                      </div>
                      <p className="mt-2 min-w-0 text-sm leading-6 text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
                        {providerConnectionSummary(provider.provider)}
                      </p>
                      {hasConnections ? (
                        <div
                          className={`mt-3 min-w-0 text-sm [overflow-wrap:anywhere] ${
                            needsAttention
                              ? "text-[var(--danger)]"
                              : "text-[color-mix(in_srgb,var(--success)_68%,var(--ui-ink-strong)_32%)]"
                          }`}
                        >
                          {needsAttention
                            ? "At least one configured connection needs attention. Use its repair action below."
                            : `Forge already has ${providerConnectionCountLabel(connectionCount)} for this provider. Open the guided flow again to add another account or reconfigure one.`}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-5 flex min-w-0 flex-wrap gap-2">
                    <Badge
                      tone="signal"
                      className="bg-[var(--ui-accent-soft)] text-[var(--primary)]"
                    >
                      {providerAccessLabel(provider.provider)}
                    </Badge>
                    <Badge
                      className={
                        provider.supportsDedicatedForgeCalendar
                          ? SETTINGS_SUCCESS_BADGE_CLASS
                          : SETTINGS_INFO_BADGE_CLASS
                      }
                    >
                      {providerSyncLabel(provider.provider)}
                    </Badge>
                  </div>

                  <div className="mt-auto pt-5">
                    <Button
                      variant="secondary"
                      className="w-full justify-center"
                      onClick={() => {
                        setInitialProvider(provider.provider);
                        setDialogInitialStepId(
                          provider.provider === "google" ||
                            provider.provider === "microsoft"
                            ? "credentials"
                            : undefined
                        );
                        setDialogOpen(true);
                      }}
                    >
                      <ExternalLink className="size-4" />
                      {providerActionLabel(provider.provider)}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="surface-section-panel grid gap-4 rounded-[30px] border">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className={SETTINGS_EYEBROW_CLASS}>Calendar colors</div>
              <p className={`mt-2 max-w-3xl ${SETTINGS_BODY_CLASS}`}>
                Calendar colors are on by default so each mirrored calendar
                stays legible in the week view. Adjust any display color here
                without changing the provider itself.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setDisplayPreferences((current) => ({
                  ...current,
                  useCalendarColors: !current.useCalendarColors
                }))
              }
              className={`min-w-0 rounded-full px-4 py-2 text-sm transition ${
                displayPreferences.useCalendarColors
                  ? "border border-[color-mix(in_srgb,var(--primary)_34%,var(--ui-border-subtle)_66%)] bg-[var(--ui-accent-soft)] text-[var(--primary)]"
                  : "border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)]"
              }`}
            >
              {displayPreferences.useCalendarColors
                ? "Colors on"
                : "Colors off"}
            </button>
          </div>

          {displayCalendars.length > 0 ? (
            <div className="grid gap-3">
              {displayCalendars.map((calendar) => {
                const calendarLabel = readCalendarDisplayName(calendar);
                return (
                  <div
                    key={calendar.id}
                    className="grid min-w-0 gap-3 overflow-hidden rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4 md:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          aria-hidden="true"
                          className="size-3 shrink-0 rounded-full"
                          style={{
                            backgroundColor: calendarDisplayColors[calendar.id]
                          }}
                        />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-[var(--ui-ink-strong)]">
                            {calendarLabel}
                          </div>
                          <div className="mt-1 min-w-0 text-sm text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
                            {calendarAccessLabel(calendar)} ·{" "}
                            {calendar.timezone}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
                      <input
                        aria-label={`Choose display color for ${calendarLabel}`}
                        type="color"
                        value={calendarDisplayColors[calendar.id]}
                        onChange={(event) =>
                          setDisplayPreferences((current) => ({
                            ...current,
                            calendarColors: {
                              ...current.calendarColors,
                              [calendar.id]: event.target.value
                            }
                          }))
                        }
                        className="h-10 w-12 cursor-pointer rounded-[14px] border border-[var(--ui-border-subtle)] bg-transparent p-1"
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          setDisplayPreferences((current) => {
                            const nextColors = { ...current.calendarColors };
                            delete nextColors[calendar.id];
                            return {
                              ...current,
                              calendarColors: nextColors
                            };
                          })
                        }
                      >
                        Reset palette
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[24px] border border-dashed border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-5 text-sm leading-6 text-[var(--ui-ink-soft)]">
              Connect a provider first, then Forge will let you tune the display
              color of each mirrored calendar here.
            </div>
          )}
        </Card>

        <Card className="surface-section-panel grid gap-4 rounded-[30px] border">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className={SETTINGS_EYEBROW_CLASS}>Connected providers</div>
              <p className={`mt-2 ${SETTINGS_BODY_CLASS}`}>
                Review connection health, confirm which provider calendars Forge
                can read or mirror, and see which connection currently owns the
                shared Forge write target.
              </p>
            </div>
          </div>

          {connections.length > 0 ? (
            <div className="grid gap-3">
              {connections.map((connection) => {
                const calendars =
                  calendarsByConnection.get(connection.id) ?? [];
                const effectiveStatus =
                  effectiveCalendarConnectionStatus(connection);
                const usesSharedWriteTargetElsewhere =
                  connection.provider !== "microsoft" &&
                  sharedForgeWriteTargetConnection !== null &&
                  sharedForgeWriteTargetConnection.id !== connection.id;
                return (
                  <div
                    key={connection.id}
                    className="min-w-0 max-w-full overflow-hidden rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="min-w-0 text-wrap font-medium text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]">
                          {connection.label}
                        </div>
                        <div className="mt-1 min-w-0 text-sm text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
                          {calendarProviderLabel(connection.provider)} ·{" "}
                          {connection.accountLabel || "No account label yet"}
                        </div>
                        {connection.lastSyncedAt ? (
                          <div className="mt-2 text-sm text-[var(--ui-ink-faint)]">
                            Last synced{" "}
                            {new Date(connection.lastSyncedAt).toLocaleString()}
                          </div>
                        ) : null}
                        {connection.lastSyncError ? (
                          <div className="mt-2 min-w-0 text-sm text-[var(--danger)] [overflow-wrap:anywhere]">
                            {readableCalendarConnectionError(
                              connection.lastSyncError
                            )}
                          </div>
                        ) : null}
                        {usesSharedWriteTargetElsewhere ? (
                          <div className="mt-2 min-w-0 text-sm text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
                            Forge writes through{" "}
                            <span className="font-medium text-[var(--ui-ink-strong)]">
                              {sharedForgeWriteTargetConnection.label}
                            </span>
                            {sharedForgeWriteTargetConnection.accountLabel
                              ? ` · ${sharedForgeWriteTargetConnection.accountLabel}`
                              : ""}
                            .
                          </div>
                        ) : null}
                      </div>
                      <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                        <Badge
                          className={
                            effectiveStatus === "connected"
                              ? SETTINGS_SUCCESS_BADGE_CLASS
                              : "bg-[var(--ui-danger-soft)] text-[var(--danger)]"
                          }
                        >
                          {connectionStatusLabel(effectiveStatus)}
                        </Badge>
                        {connection.config?.readOnly === true ? (
                          <Badge className={SETTINGS_INFO_BADGE_CLASS}>
                            Read only
                          </Badge>
                        ) : null}
                        <Button
                          size="sm"
                          variant="secondary"
                          pending={
                            syncMutation.isPending &&
                            syncMutation.variables === connection.id
                          }
                          pendingLabel="Syncing"
                          onClick={() =>
                            void syncMutation.mutateAsync(connection.id)
                          }
                        >
                          <RefreshCcw className="size-4" />
                          Sync
                        </Button>
                        {connection.provider === "macos_local" &&
                        connection.status !== "connected" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            pending={
                              repairMacOSAccessMutation.isPending &&
                              repairMacOSAccessMutation.variables ===
                                connection.id
                            }
                            pendingLabel="Waiting for macOS"
                            onClick={() => {
                              setMacOSRepairMessage(null);
                              repairMacOSAccessMutation.mutate(connection.id);
                            }}
                          >
                            <KeyRound className="size-4" />
                            Repair Calendar access
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            const selected = (
                              calendarsByConnection.get(connection.id) ?? []
                            )
                              .filter((calendar) => calendar.selectedForSync)
                              .map((calendar) =>
                                normalizeCalendarUrl(calendar.remoteId)
                              );
                            setManagedCalendarUrls(selected);
                            setManageSelectionSeeded(true);
                            setManageConnectionId(connection.id);
                          }}
                        >
                          <EyeOff className="size-4" />
                          Manage mirrored calendars
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setRemoveConnectionId(connection.id)}
                        >
                          <Trash2 className="size-4" />
                          Remove
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2">
                      {calendars.map((calendar) => (
                        <div
                          key={calendar.id}
                          className="flex min-w-0 flex-wrap items-center justify-between gap-3 overflow-hidden rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-[var(--ui-ink-strong)]">
                              {readCalendarDisplayName(calendar)}
                            </div>
                            <div className="mt-1 min-w-0 text-xs uppercase tracking-[0.16em] text-[var(--ui-ink-faint)] [overflow-wrap:anywhere]">
                              {calendarAccessLabel(calendar)} ·{" "}
                              {calendar.timezone}
                            </div>
                          </div>
                          {calendar.forgeManaged ? (
                            <Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">
                              Forge
                            </Badge>
                          ) : (
                            <Badge className={SETTINGS_META_BADGE_CLASS}>
                              <CalendarDays className="mr-1 size-3.5" />
                              Mirrored
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                    {connection.provider === "macos_local" &&
                    macOSRepairMessage?.connectionId === connection.id ? (
                      <div className="mt-3 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
                        {macOSRepairMessage.message}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              className={`${SETTINGS_MUTED_PANEL_CLASS} px-5 py-6 ${SETTINGS_BODY_CLASS}`}
            >
              No provider is connected yet. Open a guided setup flow above when
              you are ready. Forge will reuse one shared{" "}
              <span className={SETTINGS_STRONG_CLASS}>Forge</span> write target
              across writable providers when it already exists, create one only
              when none exists yet, and mirror selected calendars in read-only
              mode for providers like Exchange Online.
            </div>
          )}
        </Card>
      </div>

      <CalendarConnectionFlowDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setDialogInitialStepId(undefined);
          }
        }}
        initialProvider={initialProvider}
        initialStepId={dialogInitialStepId}
        googleSetup={googleSettings}
        microsoftSetup={microsoftSettings}
        existingConnections={connections.map((connection) => ({
          id: connection.id,
          label: connection.label,
          provider: connection.provider,
          status: connection.status,
          accountLabel: connection.accountLabel,
          forgeCalendarId: connection.forgeCalendarId,
          config: connection.config
        }))}
        onCalendarSettingsChanged={invalidateCalendarSettings}
        pending={connectMutation.isPending}
        onSubmit={async (input) => {
          await connectMutation.mutateAsync(input);
        }}
      />

      <QuestionFlowDialog
        open={manageConnectionId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setManageConnectionId(null);
          }
        }}
        eyebrow="Calendar settings"
        title="Manage mirrored calendars"
        description="Choose which calendars this connection should mirror into Forge."
        value={{ selectedCalendarUrls: managedCalendarUrls }}
        onChange={(next) => setManagedCalendarUrls(next.selectedCalendarUrls)}
        draftPersistenceKey={
          manageConnectionId
            ? `settings.calendar.manage.${manageConnectionId}`
            : "settings.calendar.manage"
        }
        steps={manageMirrorSteps}
        pending={patchConnectionMutation.isPending}
        pendingLabel="Saving"
        submitLabel="Save mirror selection"
        error={
          patchConnectionMutation.error instanceof Error
            ? patchConnectionMutation.error.message
            : null
        }
        onSubmit={async () => {
          if (!manageConnectionId) {
            return;
          }
          await patchConnectionMutation.mutateAsync({
            connectionId: manageConnectionId,
            patch: {
              selectedCalendarUrls:
                managedCalendarUrls.map(normalizeCalendarUrl)
            }
          });
          setManageSelectionSeeded(false);
          setManageConnectionId(null);
        }}
      />

      <QuestionFlowDialog
        open={removeConnectionId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveConnectionId(null);
          }
        }}
        eyebrow="Calendar settings"
        title="Remove calendar connection"
        description="This removes the provider connection, stops syncing its calendars, removes mirrored external events from Forge, and keeps Forge-native events local."
        value={{ acknowledgement: false }}
        onChange={() => undefined}
        draftPersistenceKey={
          removeConnectionId
            ? `settings.calendar.remove.${removeConnectionId}`
            : "settings.calendar.remove"
        }
        steps={[
          {
            id: "confirm",
            eyebrow: "Disconnect",
            title: removableConnection
              ? `Remove ${removableConnection.label}?`
              : "Remove this connection?",
            description:
              "Use this when you want to disconnect the account entirely. You can reconnect later with the guided setup flow.",
            render: () => (
              <div className="rounded-[24px] border border-[color-mix(in_srgb,var(--danger)_24%,var(--ui-border-subtle)_76%)] bg-[var(--ui-danger-soft)] p-4 text-sm leading-6 text-[var(--danger)]">
                {removableConnection ? (
                  <>
                    <div className={SETTINGS_STRONG_CLASS}>
                      {calendarProviderLabel(removableConnection.provider)} ·{" "}
                      {removableConnection.accountLabel || "No account label"}
                    </div>
                    <div className="mt-2">
                      Mirrored provider calendars and external mirrored events
                      from this connection will be removed. Forge-owned events,
                      work blocks, and timeboxes remain in Forge.
                    </div>
                  </>
                ) : (
                  "This connection will be removed from Forge."
                )}
              </div>
            )
          }
        ]}
        pending={deleteConnectionMutation.isPending}
        pendingLabel="Removing"
        submitLabel="Remove connection"
        error={
          deleteConnectionMutation.error instanceof Error
            ? deleteConnectionMutation.error.message
            : null
        }
        onSubmit={async () => {
          if (!removeConnectionId) {
            return;
          }
          await deleteConnectionMutation.mutateAsync(removeConnectionId);
          setRemoveConnectionId(null);
        }}
      />
    </div>
  );
}
