import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  EyeOff,
  KeyRound,
  Link2,
  RefreshCcw,
  Settings2,
  Trash2
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { CalendarConnectionFlowDialog } from "@/components/calendar/calendar-connection-flow-dialog";
import { QuestionFlowDialog, type QuestionFlowStep } from "@/components/flows/question-flow-dialog";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { SettingsSectionNav } from "@/components/settings/settings-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/page-state";
import {
  createCalendarConnection,
  deleteCalendarConnection,
  discoverExistingCalendarConnection,
  ensureOperatorSession,
  getSettings,
  listCalendarConnections,
  listCalendarResources,
  patchCalendarConnection,
  patchSettings,
  syncCalendarConnection,
  testMicrosoftCalendarOauthConfiguration
} from "@/lib/api";
import {
  buildCalendarDisplayColorMap,
  readCalendarDisplayPreferences,
  writeCalendarDisplayPreferences
} from "@/lib/calendar-display-preferences";
import type { CalendarDiscoveryPayload, CalendarProvider, CalendarResource, SettingsPayload } from "@/lib/types";

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
    case "caldav":
    default:
      return "Custom CalDAV";
  }
}

type MicrosoftSettingsDraft = {
  clientId: string;
  tenantId: string;
  redirectUri: string;
};

const MICROSOFT_CALLBACK_PATH = "/api/v1/calendar/oauth/microsoft/callback";
const MICROSOFT_CLIENT_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function buildMicrosoftSettingsDraft(
  microsoft: SettingsPayload["calendarProviders"]["microsoft"]
): MicrosoftSettingsDraft {
  return {
    clientId: microsoft.clientId,
    tenantId: microsoft.tenantId,
    redirectUri: microsoft.redirectUri
  };
}

function validateMicrosoftSettingsDraft(draft: MicrosoftSettingsDraft) {
  const issues: Partial<Record<keyof MicrosoftSettingsDraft, string>> = {};

  if (!draft.clientId.trim()) {
    issues.clientId = "Microsoft client ID is required.";
  } else if (!MICROSOFT_CLIENT_ID_PATTERN.test(draft.clientId.trim())) {
    issues.clientId = "Use the Microsoft app registration client ID GUID.";
  }

  if (!draft.redirectUri.trim()) {
    issues.redirectUri = "Redirect URI is required.";
  } else {
    try {
      const url = new URL(draft.redirectUri.trim());
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        issues.redirectUri = "Redirect URI must use http or https.";
      } else if (url.pathname !== MICROSOFT_CALLBACK_PATH) {
        issues.redirectUri = `Redirect URI must end with ${MICROSOFT_CALLBACK_PATH}.`;
      }
    } catch {
      issues.redirectUri = "Redirect URI must be a full URL.";
    }
  }

  return {
    issues,
    isValid: Object.keys(issues).length === 0
  };
}

function sameMicrosoftSettingsDraft(
  left: MicrosoftSettingsDraft,
  right: MicrosoftSettingsDraft
) {
  return (
    left.clientId.trim() === right.clientId.trim() &&
    left.tenantId.trim() === right.tenantId.trim() &&
    left.redirectUri.trim() === right.redirectUri.trim()
  );
}

export function SettingsCalendarPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [initialProvider, setInitialProvider] = useState<CalendarProvider>("google");
  const [dialogInitialStepId, setDialogInitialStepId] = useState<string | undefined>(undefined);
  const [manageConnectionId, setManageConnectionId] = useState<string | null>(null);
  const [managedCalendarUrls, setManagedCalendarUrls] = useState<string[]>([]);
  const [manageSelectionSeeded, setManageSelectionSeeded] = useState(false);
  const [removeConnectionId, setRemoveConnectionId] = useState<string | null>(null);
  const [displayPreferences, setDisplayPreferences] = useState(() => readCalendarDisplayPreferences());
  const [microsoftSettingsDraft, setMicrosoftSettingsDraft] = useState<MicrosoftSettingsDraft>({
    clientId: "",
    tenantId: "common",
    redirectUri: ""
  });

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
      queryClient.invalidateQueries({ queryKey: ["forge-calendar-connections"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-calendar-resources"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-calendar-overview"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] })
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
    mutationFn: (connectionId: string) => deleteCalendarConnection(connectionId),
    onSuccess: invalidateCalendarSettings
  });

  const saveMicrosoftSettingsMutation = useMutation({
    mutationFn: (input: MicrosoftSettingsDraft) =>
      patchSettings({
        calendarProviders: {
          microsoft: input
        }
      }),
    onSuccess: invalidateCalendarSettings
  });

  const testMicrosoftSettingsMutation = useMutation({
    mutationFn: (input: MicrosoftSettingsDraft) =>
      testMicrosoftCalendarOauthConfiguration({
        clientId: input.clientId.trim(),
        tenantId: input.tenantId.trim() || "common",
        redirectUri: input.redirectUri.trim()
      })
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
      provider === "apple" || provider === "caldav" || provider === "google" || provider === "microsoft"
        ? provider
        : "google"
    );
    setDialogInitialStepId(provider === "microsoft" ? "credentials" : undefined);
    setDialogOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("intent");
    next.delete("provider");
    setSearchParams(next, { replace: true });
  }, [operatorReady, searchParams, setSearchParams]);

  useEffect(() => {
    const microsoft = settingsQuery.data?.settings.calendarProviders.microsoft;
    if (!microsoft) {
      return;
    }
    setMicrosoftSettingsDraft(buildMicrosoftSettingsDraft(microsoft));
  }, [settingsQuery.data]);

  const calendarsByConnection = useMemo(() => {
    const grouped = new Map<string, CalendarResource[]>();
    for (const calendar of calendarsQuery.data?.calendars ?? []) {
      const bucket = grouped.get(calendar.connectionId) ?? [];
      bucket.push(calendar);
      grouped.set(calendar.connectionId, bucket);
    }
    return grouped;
  }, [calendarsQuery.data]);
  const calendarDisplayColors = useMemo(
    () => buildCalendarDisplayColorMap(calendarsQuery.data?.calendars ?? [], displayPreferences.calendarColors),
    [calendarsQuery.data?.calendars, displayPreferences.calendarColors]
  );

  const managedConnection = useMemo(
    () => connectionsQuery.data?.connections.find((connection) => connection.id === manageConnectionId) ?? null,
    [connectionsQuery.data, manageConnectionId]
  );

  const removableConnection = useMemo(
    () => connectionsQuery.data?.connections.find((connection) => connection.id === removeConnectionId) ?? null,
    [connectionsQuery.data, removeConnectionId]
  );

  const managedResources = useMemo(
    () => (manageConnectionId ? calendarsByConnection.get(manageConnectionId) ?? [] : []),
    [calendarsByConnection, manageConnectionId]
  );

  const savedMicrosoftSettings = settingsQuery.data?.settings.calendarProviders.microsoft ?? null;
  const microsoftValidation = useMemo(
    () => validateMicrosoftSettingsDraft(microsoftSettingsDraft),
    [microsoftSettingsDraft]
  );
  const hasUnsavedMicrosoftSettings =
    savedMicrosoftSettings !== null &&
    !sameMicrosoftSettingsDraft(
      microsoftSettingsDraft,
      buildMicrosoftSettingsDraft(savedMicrosoftSettings)
    );
  const microsoftSignInDisabled =
    !savedMicrosoftSettings?.isReadyForSignIn ||
    !microsoftValidation.isValid ||
    hasUnsavedMicrosoftSettings ||
    saveMicrosoftSettingsMutation.isPending;

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

  const manageMirrorSteps = useMemo<Array<QuestionFlowStep<{ selectedCalendarUrls: string[] }>>>(
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
              <div className="rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-6 text-sm leading-6 text-white/58">
                Rediscovering calendars for this connection.
              </div>
            );
          }

          if (managedDiscoveryQuery.isError || !managedDiscoveryQuery.data?.discovery) {
            return (
              <div className="rounded-[24px] border border-rose-400/20 bg-rose-400/10 px-4 py-6 text-sm leading-6 text-rose-100">
                {managedDiscoveryQuery.error instanceof Error
                  ? managedDiscoveryQuery.error.message
                  : "Forge could not rediscover calendars for this connection."}
              </div>
            );
          }

          const discovery: CalendarDiscoveryPayload = managedDiscoveryQuery.data.discovery;
          const readOnlyConnection = managedConnection?.provider === "microsoft";
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
                        normalizeCalendarUrl(resource.remoteId) === normalizedUrl
                    );
                const isWriteTarget = writeTargetUrl === normalizedUrl;

                return (
                  <div
                    key={calendar.url}
                    className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-white">{calendar.displayName}</div>
                        <div className="mt-1 text-sm text-white/56">
                          {calendar.timezone || "No timezone exposed"} · {calendar.url}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {isWriteTarget && !readOnlyConnection ? (
                          <Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">Forge writes here</Badge>
                        ) : null}
                        {readOnlyConnection ? (
                          <Badge className="bg-sky-400/12 text-sky-100">Read only</Badge>
                        ) : null}
                        {calendar.isPrimary ? (
                          <Badge className="bg-white/[0.08] text-white/74">Primary</Badge>
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
                              ? value.selectedCalendarUrls.filter((entry) => entry !== normalizedUrl)
                              : [...value.selectedCalendarUrls, normalizedUrl]
                          })
                        }
                        className={`rounded-full px-3 py-2 text-sm transition ${
                          isWriteTarget && !readOnlyConnection
                            ? "cursor-not-allowed bg-white/[0.05] text-white/35"
                            : isSelected
                              ? "bg-emerald-500/18 text-emerald-100 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.28)]"
                              : "bg-white/[0.05] text-white/62 hover:bg-white/[0.08]"
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
    [managedConnection, managedDiscoveryQuery]
  );

  if (
    operatorSessionQuery.isLoading ||
    settingsQuery.isLoading ||
    connectionsQuery.isLoading ||
    calendarsQuery.isLoading
  ) {
    return (
      <SurfaceSkeleton
        eyebrow="Settings · Calendar"
        title="Loading calendar settings"
        description="Checking the operator session and loading provider connections."
        columns={2}
        blocks={6}
      />
    );
  }

  if (operatorSessionQuery.isError) {
    return (
      <ErrorState
        eyebrow="Settings · Calendar"
        error={operatorSessionQuery.error}
        onRetry={() => void operatorSessionQuery.refetch()}
      />
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
    );
  }

  const { providers, connections } = connectionsQuery.data;
  const microsoftSettings = settingsQuery.data.settings.calendarProviders.microsoft;

  return (
    <div className="mx-auto grid w-full max-w-[1220px] gap-5">
      <PageHero
        title="Calendar settings"
        description="Manage provider connections, review dedicated Forge write calendars where supported, and open guided setup only when you need to connect or reconfigure a provider."
        badge={`${connections.length} connection${connections.length === 1 ? "" : "s"}`}
      />

      <SettingsSectionNav />

      <div className="grid gap-5">
        <Card className="grid gap-5 rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(17,28,41,0.98),rgba(9,16,27,0.98))]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                Exchange Online local setup
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
                Self-hosted Forge uses a Microsoft public client with PKCE. Save the Microsoft app registration details here first, then continue to the guided sign-in flow to choose which Exchange calendars Forge should mirror.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-sky-400/12 text-sky-100">Read only</Badge>
              {microsoftSettings.isReadyForSignIn && !hasUnsavedMicrosoftSettings ? (
                <Badge className="bg-emerald-500/16 text-emerald-100">
                  <CheckCircle2 className="mr-1 size-3.5" />
                  Ready for sign-in
                </Badge>
              ) : (
                <Badge className="bg-white/[0.08] text-white/74">
                  <KeyRound className="mr-1 size-3.5" />
                  Setup required
                </Badge>
              )}
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <div className="grid gap-4">
              <label className="grid gap-2">
                <span className="text-sm font-medium text-white">Microsoft client ID</span>
                <span className="text-sm leading-6 text-white/54">
                  Use the Application (client) ID from the Microsoft Entra app registration for this local Forge instance.
                </span>
                <input
                  className="min-h-12 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-[var(--primary)]/40 focus:bg-white/[0.06]"
                  value={microsoftSettingsDraft.clientId}
                  onChange={(event) =>
                    setMicrosoftSettingsDraft((current) => ({
                      ...current,
                      clientId: event.target.value
                    }))
                  }
                  placeholder="00000000-0000-0000-0000-000000000000"
                />
                {microsoftValidation.issues.clientId ? (
                  <span className="text-sm text-rose-300">
                    {microsoftValidation.issues.clientId}
                  </span>
                ) : null}
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-white">Tenant / authority</span>
                  <span className="text-sm leading-6 text-white/54">
                    Use <span className="font-medium text-white">common</span> for a normal self-hosted delegated flow unless you need a tenant-specific authority.
                  </span>
                  <input
                    className="min-h-12 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-[var(--primary)]/40 focus:bg-white/[0.06]"
                    value={microsoftSettingsDraft.tenantId}
                    onChange={(event) =>
                      setMicrosoftSettingsDraft((current) => ({
                        ...current,
                        tenantId: event.target.value
                      }))
                    }
                    placeholder="common"
                  />
                </label>

                <div className="grid gap-2 rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
                  <div className="text-sm font-medium text-white">Microsoft access mode</div>
                  <p className="text-sm leading-6 text-white/54">
                    Forge currently requests delegated read access only. Exchange calendars are mirrored into Forge, but Forge does not publish work blocks or owned timeboxes back to Microsoft yet.
                  </p>
                  <Badge className="w-fit bg-sky-400/12 text-sky-100">Read-only mirroring</Badge>
                </div>
              </div>

              <label className="grid gap-2">
                <span className="text-sm font-medium text-white">Redirect URI</span>
                <span className="text-sm leading-6 text-white/54">
                  Register this exact Forge callback URI in the Microsoft app registration. The default works for the local backend on port 4317.
                </span>
                <input
                  className="min-h-12 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-[var(--primary)]/40 focus:bg-white/[0.06]"
                  value={microsoftSettingsDraft.redirectUri}
                  onChange={(event) =>
                    setMicrosoftSettingsDraft((current) => ({
                      ...current,
                      redirectUri: event.target.value
                    }))
                  }
                  placeholder="http://127.0.0.1:4317/api/v1/calendar/oauth/microsoft/callback"
                />
                {microsoftValidation.issues.redirectUri ? (
                  <span className="text-sm text-rose-300">
                    {microsoftValidation.issues.redirectUri}
                  </span>
                ) : null}
              </label>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() =>
                    void saveMicrosoftSettingsMutation.mutateAsync({
                      clientId: microsoftSettingsDraft.clientId.trim(),
                      tenantId: microsoftSettingsDraft.tenantId.trim() || "common",
                      redirectUri: microsoftSettingsDraft.redirectUri.trim()
                    })
                  }
                  disabled={!microsoftValidation.isValid}
                  pending={saveMicrosoftSettingsMutation.isPending}
                  pendingLabel="Saving"
                >
                  Save Microsoft settings
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void testMicrosoftSettingsMutation.mutateAsync(microsoftSettingsDraft)
                  }
                  disabled={!microsoftValidation.isValid}
                  pending={testMicrosoftSettingsMutation.isPending}
                  pendingLabel="Testing"
                >
                  Test Microsoft configuration
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setInitialProvider("microsoft");
                    setDialogInitialStepId("credentials");
                    setDialogOpen(true);
                  }}
                  disabled={microsoftSignInDisabled}
                >
                  <ExternalLink className="size-4" />
                  Sign in with Microsoft
                </Button>
              </div>

              {saveMicrosoftSettingsMutation.error instanceof Error ? (
                <div className="rounded-[18px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                  {saveMicrosoftSettingsMutation.error.message}
                </div>
              ) : null}

              {testMicrosoftSettingsMutation.isSuccess ? (
                <div className="rounded-[18px] border border-emerald-400/20 bg-emerald-500/[0.08] px-4 py-3 text-sm text-emerald-100">
                  {testMicrosoftSettingsMutation.data.result.message}
                </div>
              ) : null}

              {testMicrosoftSettingsMutation.error instanceof Error ? (
                <div className="rounded-[18px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                  {testMicrosoftSettingsMutation.error.message}
                </div>
              ) : null}
            </div>

            <div className="grid gap-3">
              <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
                <div className="text-sm font-medium text-white">What the user needs first</div>
                <p className="mt-2 text-sm leading-6 text-white/58">
                  Microsoft sign-in cannot work until this Forge instance has a registered Microsoft app client ID and callback URI. Forge no longer asks the user for a client secret or refresh token in local self-hosted mode.
                </p>
              </div>
              <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
                <div className="text-sm font-medium text-white">Current saved setup</div>
                <div className="mt-3 grid gap-2 text-sm text-white/66">
                  <div>
                    Client ID:{" "}
                    <span className="font-medium text-white">
                      {microsoftSettings.clientId || "Not saved yet"}
                    </span>
                  </div>
                  <div>
                    Tenant:{" "}
                    <span className="font-medium text-white">
                      {microsoftSettings.tenantId}
                    </span>
                  </div>
                  <div className="break-all">
                    Redirect URI:{" "}
                    <span className="font-medium text-white">
                      {microsoftSettings.redirectUri}
                    </span>
                  </div>
                </div>
              </div>
              <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4 text-sm leading-6 text-white/60">
                {hasUnsavedMicrosoftSettings
                  ? "Save these Microsoft settings before you try to sign in, otherwise the popup will still use the previous saved configuration."
                  : microsoftSettings.setupMessage}
              </div>
            </div>
          </div>
        </Card>

        <Card className="grid gap-4 rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,28,38,0.98),rgba(11,17,28,0.98))]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Provider connections</div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
                All provider setup lives here. Writable providers can publish work blocks and owned timeboxes into a dedicated calendar named <span className="font-medium text-white">Forge</span>, while read-only providers only mirror the calendars you select. Exact provider instructions appear only inside the guided setup flow.
              </p>
            </div>
            <Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">
              <Settings2 className="mr-1 size-3.5" />
              Settings-owned
            </Badge>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {providers.map((provider) => (
              <button
                key={provider.provider}
                type="button"
                onClick={() => {
                  setInitialProvider(provider.provider);
                  setDialogInitialStepId(
                    provider.provider === "microsoft" ? "credentials" : undefined
                  );
                  setDialogOpen(true);
                }}
                className="rounded-[26px] border border-white/8 bg-white/[0.04] p-5 text-left transition hover:bg-white/[0.06]"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-[18px] bg-[var(--primary)]/14 p-3 text-[var(--primary)]">
                    <Link2 className="size-4" />
                  </div>
                  <div>
                    <div className="font-medium text-white">{provider.label}</div>
                    <div className="mt-1 text-sm text-white/56">Connect and manage sync</div>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-white/60">{provider.connectionHelp}</p>
                <div className="mt-4 inline-flex rounded-full bg-white/[0.06] px-3 py-2 text-xs uppercase tracking-[0.16em] text-white/52">
                  Open guided setup
                </div>
              </button>
            ))}
          </div>
        </Card>

        <Card className="grid gap-4 rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,28,38,0.98),rgba(11,17,28,0.98))]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Calendar colors</div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
                Calendar colors are on by default so each mirrored calendar stays legible in the week view. Adjust any display color here without changing the provider itself.
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
              className={`rounded-full px-4 py-2 text-sm transition ${
                displayPreferences.useCalendarColors
                  ? "bg-[var(--primary)]/16 text-[var(--primary)] shadow-[inset_0_0_0_1px_rgba(192,193,255,0.2)]"
                  : "bg-white/[0.06] text-white/62 hover:bg-white/[0.08]"
              }`}
            >
              {displayPreferences.useCalendarColors ? "Colors on" : "Colors off"}
            </button>
          </div>

          {(calendarsQuery.data?.calendars ?? []).length > 0 ? (
            <div className="grid gap-3">
              {(calendarsQuery.data?.calendars ?? []).map((calendar) => (
                <div
                  key={calendar.id}
                  className="grid gap-3 rounded-[22px] border border-white/8 bg-white/[0.04] p-4 md:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="size-3 shrink-0 rounded-full"
                        style={{ backgroundColor: calendarDisplayColors[calendar.id] }}
                      />
                      <div className="min-w-0">
                        <div className="truncate font-medium text-white">{calendar.title}</div>
                        <div className="mt-1 text-sm text-white/56">
                          {calendar.canWrite ? "Writable" : "Read only"} · {calendar.timezone}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      aria-label={`Choose display color for ${calendar.title}`}
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
                      className="h-10 w-12 cursor-pointer rounded-[14px] border border-white/12 bg-transparent p-1"
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
              ))}
            </div>
          ) : (
            <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-4 py-5 text-sm leading-6 text-white/56">
              Connect a provider first, then Forge will let you tune the display color of each mirrored calendar here.
            </div>
          )}
        </Card>

        <Card className="grid gap-4 rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,28,38,0.98),rgba(11,17,28,0.98))]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Connected providers</div>
              <p className="mt-2 text-sm leading-6 text-white/60">
                Review connection health and confirm which provider calendars Forge can read, mirror, or write.
              </p>
            </div>
          </div>

          {connections.length > 0 ? (
            <div className="grid gap-3">
              {connections.map((connection) => {
                const calendars = calendarsByConnection.get(connection.id) ?? [];
                return (
                  <div key={connection.id} className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-white">{connection.label}</div>
                        <div className="mt-1 text-sm text-white/55">
                          {calendarProviderLabel(connection.provider)} · {connection.accountLabel || "No account label yet"}
                        </div>
                        {connection.lastSyncedAt ? (
                          <div className="mt-2 text-sm text-white/48">
                            Last synced {new Date(connection.lastSyncedAt).toLocaleString()}
                          </div>
                        ) : null}
                        {connection.lastSyncError ? (
                          <div className="mt-2 text-sm text-rose-200">{connection.lastSyncError}</div>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-white/[0.08] text-white/74">{connection.status}</Badge>
                        {connection.config?.readOnly === true ? (
                          <Badge className="bg-sky-400/12 text-sky-100">Read only</Badge>
                        ) : null}
                          <Button
                            size="sm"
                            variant="secondary"
                            pending={syncMutation.isPending && syncMutation.variables === connection.id}
                            pendingLabel="Syncing"
                            onClick={() => void syncMutation.mutateAsync(connection.id)}
                          >
                            <RefreshCcw className="size-4" />
                            Sync
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              const selected = (calendarsByConnection.get(connection.id) ?? [])
                                .filter((calendar) => calendar.selectedForSync)
                                .map((calendar) => normalizeCalendarUrl(calendar.remoteId));
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
                          className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-white/[0.04] px-4 py-3"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-white">{calendar.title}</div>
                            <div className="mt-1 text-xs uppercase tracking-[0.16em] text-white/45">
                              {calendar.canWrite ? "Writable" : "Read only"} · {calendar.timezone}
                            </div>
                          </div>
                          {calendar.forgeManaged ? (
                            <Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">Forge</Badge>
                          ) : (
                            <Badge className="bg-white/[0.08] text-white/74">
                              <CalendarDays className="mr-1 size-3.5" />
                              Mirrored
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[26px] border border-dashed border-white/10 bg-white/[0.03] px-5 py-6 text-sm leading-6 text-white/60">
              No provider is connected yet. Open a guided setup flow above when you are ready. Forge will either create or reuse a dedicated <span className="font-medium text-white">Forge</span> calendar for writable providers, or mirror selected calendars in read-only mode for providers like Exchange Online.
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
        microsoftSetup={microsoftSettings}
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
            patch: { selectedCalendarUrls: managedCalendarUrls.map(normalizeCalendarUrl) }
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
              <div className="rounded-[24px] border border-rose-400/20 bg-rose-400/10 p-4 text-sm leading-6 text-rose-100">
                {removableConnection ? (
                  <>
                    <div className="font-medium text-white">
                      {calendarProviderLabel(removableConnection.provider)} · {removableConnection.accountLabel || "No account label"}
                    </div>
                    <div className="mt-2">
                      Mirrored provider calendars and external mirrored events from this connection will be removed. Forge-owned events, work blocks, and timeboxes remain in Forge.
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
