import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  CheckCircle2,
  Cloud,
  ExternalLink,
  KeyRound,
  Link2,
  RefreshCcw
} from "lucide-react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { CalendarSetupGuide } from "@/components/calendar/calendar-setup-guide";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  discoverCalendarConnection,
  getMicrosoftCalendarOauthSession,
  startMicrosoftCalendarOauth
} from "@/lib/api";
import type {
  CalendarDiscoveryPayload,
  CalendarProvider,
  MicrosoftCalendarAuthSettings,
  MicrosoftCalendarOauthSession
} from "@/lib/types";

type ConnectionDraft = {
  provider: CalendarProvider;
  label: string;
  serverUrl: string;
  username: string;
  password: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  selectedCalendarUrls: string[];
  forgeCalendarUrl: string | null;
  createForgeCalendar: boolean;
};

type MicrosoftPopupMessage = {
  type?: string;
  sessionId?: string;
  status?: string;
};

const PROVIDER_DEFAULTS: Record<CalendarProvider, { label: string; serverUrl: string }> = {
  google: {
    label: "Primary Google",
    serverUrl: ""
  },
  apple: {
    label: "Primary Apple",
    serverUrl: "https://caldav.icloud.com"
  },
  microsoft: {
    label: "Primary Exchange Online",
    serverUrl: ""
  },
  caldav: {
    label: "Primary CalDAV",
    serverUrl: "https://caldav.example.com"
  }
};

function createDraft(provider: CalendarProvider): ConnectionDraft {
  return {
    provider,
    label: PROVIDER_DEFAULTS[provider].label,
    serverUrl: PROVIDER_DEFAULTS[provider].serverUrl,
    username: "",
    password: "",
    clientId: "",
    clientSecret: "",
    refreshToken: "",
    selectedCalendarUrls: [],
    forgeCalendarUrl: null,
    createForgeCalendar: false
  };
}

function normalizeLabel(provider: CalendarProvider, label: string) {
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : PROVIDER_DEFAULTS[provider].label;
}

export function CalendarConnectionFlowDialog({
  open,
  onOpenChange,
  initialProvider = "google",
  initialStepId,
  microsoftSetup,
  onSubmit,
  pending = false
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialProvider?: CalendarProvider;
  initialStepId?: string;
  microsoftSetup: MicrosoftCalendarAuthSettings;
  onSubmit: (
    input:
      | {
          provider: "google";
          label: string;
          username: string;
          clientId: string;
          clientSecret: string;
          refreshToken: string;
          selectedCalendarUrls: string[];
          forgeCalendarUrl?: string | null;
          createForgeCalendar?: boolean;
        }
      | {
          provider: "apple";
          label: string;
          username: string;
          password: string;
          selectedCalendarUrls: string[];
          forgeCalendarUrl?: string | null;
          createForgeCalendar?: boolean;
        }
      | {
          provider: "caldav";
          label: string;
          serverUrl: string;
          username: string;
          password: string;
          selectedCalendarUrls: string[];
          forgeCalendarUrl?: string | null;
          createForgeCalendar?: boolean;
        }
      | {
          provider: "microsoft";
          label: string;
          authSessionId: string;
          selectedCalendarUrls: string[];
        }
  ) => Promise<void>;
  pending?: boolean;
}) {
  const [draft, setDraft] = useState<ConnectionDraft>(() => createDraft(initialProvider));
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<CalendarDiscoveryPayload | null>(null);
  const [microsoftSession, setMicrosoftSession] = useState<MicrosoftCalendarOauthSession | null>(null);
  const popupRef = useRef<Window | null>(null);

  const resetMicrosoftSession = () => {
    setMicrosoftSession(null);
    popupRef.current = null;
  };

  const applyDiscoveryPayload = (payload: CalendarDiscoveryPayload) => {
    setDiscovery(payload);
    const syncSelection = payload.calendars
      .filter((calendar) => calendar.selectedByDefault)
      .map((calendar) => calendar.url);
    const existingForge = payload.calendars.find((calendar) => calendar.isForgeCandidate);
    setDraft((current) => ({
      ...current,
      selectedCalendarUrls:
        current.selectedCalendarUrls.length > 0
          ? current.selectedCalendarUrls.filter((url) =>
              payload.calendars.some((calendar) => calendar.url === url)
            )
          : syncSelection,
      forgeCalendarUrl:
        current.provider === "microsoft"
          ? null
          : existingForge?.url ?? current.forgeCalendarUrl ?? null,
      createForgeCalendar:
        current.provider === "microsoft"
          ? false
          : current.createForgeCalendar && !existingForge
    }));
    setSubmitError(null);
  };

  useEffect(() => {
    if (!open) {
      popupRef.current?.close();
      popupRef.current = null;
      return;
    }
    setSubmitError(null);
    setDiscovery(null);
    setDraft(createDraft(initialProvider));
    resetMicrosoftSession();
  }, [initialProvider, open]);

  useEffect(() => {
    if (!open || !microsoftSession || microsoftSession.status !== "pending") {
      return;
    }

    const handleMessage = (event: MessageEvent<MicrosoftPopupMessage>) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (
        event.data?.type !== "forge:microsoft-calendar-auth" ||
        event.data?.sessionId !== microsoftSession.sessionId
      ) {
        return;
      }
      void loadMicrosoftSession(microsoftSession.sessionId);
    };

    const interval = window.setInterval(() => {
      if (!popupRef.current || !popupRef.current.closed) {
        return;
      }
      popupRef.current = null;
      void loadMicrosoftSession(microsoftSession.sessionId, { afterPopupClose: true });
    }, 400);

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      window.clearInterval(interval);
    };
  }, [microsoftSession, open]);

  const discoveryMutation = useMutation({
    mutationFn: () => {
      if (draft.provider === "google") {
        return discoverCalendarConnection({
          provider: "google",
          username: draft.username,
          clientId: draft.clientId,
          clientSecret: draft.clientSecret,
          refreshToken: draft.refreshToken
        });
      }
      if (draft.provider === "apple") {
        return discoverCalendarConnection({
          provider: "apple",
          username: draft.username,
          password: draft.password
        });
      }
      return discoverCalendarConnection({
        provider: "caldav",
        serverUrl: draft.serverUrl,
        username: draft.username,
        password: draft.password
      });
    },
    onSuccess: ({ discovery: payload }) => {
      applyDiscoveryPayload(payload);
    },
    onError: (error) => {
      setDiscovery(null);
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Forge could not discover calendars with these credentials."
      );
    }
  });

  const loadMicrosoftSession = async (
    sessionId: string,
    options?: { afterPopupClose?: boolean }
  ) => {
    try {
      const { session } = await getMicrosoftCalendarOauthSession(sessionId);
      setMicrosoftSession(session);
      if (session.status === "authorized" && session.discovery) {
        applyDiscoveryPayload(session.discovery);
        setSubmitError(null);
        return;
      }
      if (session.status === "error" || session.status === "expired") {
        setSubmitError(
          session.error ??
            "Microsoft sign-in did not complete. Start the guided sign-in again."
        );
        return;
      }
      if (options?.afterPopupClose) {
        setSubmitError(
          "The Microsoft sign-in window closed before Forge received permission."
        );
      }
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Forge could not confirm the Microsoft sign-in session."
      );
    }
  };

  const startMicrosoftFlow = async () => {
    try {
      if (!microsoftSetup.isReadyForSignIn) {
        throw new Error(
          "Finish the Microsoft setup in Settings -> Calendar before starting sign-in."
        );
      }
      setSubmitError(null);
      setDiscovery(null);
      const { session } = await startMicrosoftCalendarOauth({
        label: normalizeLabel("microsoft", draft.label)
      });
      if (!session.authUrl) {
        throw new Error("Forge could not prepare the Microsoft sign-in URL.");
      }
      setMicrosoftSession(session);
      popupRef.current?.close();
      popupRef.current = window.open(
        session.authUrl,
        "forge-microsoft-calendar-auth",
        "popup=yes,width=520,height=720,resizable=yes,scrollbars=yes"
      );
      if (!popupRef.current) {
        throw new Error(
          "The Microsoft sign-in popup was blocked. Allow popups for Forge and try again."
        );
      }
      popupRef.current.focus();
    } catch (error) {
      resetMicrosoftSession();
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Forge could not start the Microsoft sign-in flow."
      );
    }
  };

  const steps = useMemo<Array<QuestionFlowStep<ConnectionDraft>>>(
    () => [
      {
        id: "provider",
        eyebrow: "Connection",
        title: "Choose the calendar provider Forge should connect to",
        description:
          "Apple uses autodiscovery from caldav.icloud.com, Google uses CalDAV over OAuth, Exchange Online uses guided Microsoft sign-in in read-only mode, and custom CalDAV stays available for everything else.",
        render: (value, setValue) => (
          <div className="grid gap-5">
            <FlowField
              label="Provider"
              description="Each setup path is guided. Forge discovers calendars before anything is saved."
            >
              <FlowChoiceGrid
                value={value.provider}
                onChange={(next) => {
                  setDiscovery(null);
                  setSubmitError(null);
                  resetMicrosoftSession();
                  setValue(createDraft(next as CalendarProvider));
                }}
                options={[
                  {
                    value: "google",
                    label: "Google Calendar",
                    description: "Discover calendars from Google CalDAV using your OAuth refresh token."
                  },
                  {
                    value: "apple",
                    label: "Apple Calendar",
                    description: "Start from https://caldav.icloud.com and autodiscover calendars with your app password."
                  },
                  {
                    value: "microsoft",
                    label: "Exchange Online",
                    description: "Save the Microsoft app registration fields in Settings, then sign in with Microsoft and mirror selected Exchange Online calendars in read-only mode."
                  },
                  {
                    value: "caldav",
                    label: "Custom CalDAV",
                    description: "Use a CalDAV base URL for Nextcloud, Fastmail, Baikal, and other compatible providers."
                  }
                ]}
              />
            </FlowField>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
                <div className="flex items-center gap-3 text-white">
                  <Cloud className="size-4 text-[var(--primary)]" />
                  <div className="font-medium">Dedicated write calendar</div>
                </div>
                <p className="mt-3 text-sm leading-6 text-white/60">
                  {value.provider === "microsoft"
                    ? "Exchange Online is read-only for now. Forge mirrors selected calendars into Forge, but it does not publish work blocks or owned timeboxes back to Microsoft."
                    : (
                        <>
                          Forge writes work blocks and owned timeboxes into a dedicated
                          calendar named <span className="font-medium text-white">Forge</span>.
                        </>
                      )}
                </p>
              </div>
              <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
                <div className="flex items-center gap-3 text-white">
                  <KeyRound className="size-4 text-[var(--primary)]" />
                  <div className="font-medium">Discovery first</div>
                </div>
                <p className="mt-3 text-sm leading-6 text-white/60">
                  {value.provider === "microsoft"
                    ? "Forge starts a Microsoft sign-in popup, then discovers the calendars available to that account before you choose what to mirror."
                    : "Forge discovers the actual calendar collections before you choose which ones to mirror and which one should receive owned timeboxes."}
                </p>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                Setup guide
              </div>
              <p className="mt-2 text-sm leading-6 text-white/60">
                These are the exact setup steps for the selected provider. They stay
                inside this guided flow so Settings can stay focused on connection
                health and actions.
              </p>
              <div className="mt-4">
                <CalendarSetupGuide provider={value.provider} compact />
              </div>
            </div>
          </div>
        )
      },
      {
        id: "credentials",
        eyebrow: "Credentials",
        title:
          draft.provider === "google"
            ? "Provide the Google CalDAV credentials"
            : draft.provider === "apple"
              ? "Provide the Apple account email and app-specific password"
              : draft.provider === "microsoft"
              ? "Sign in with Microsoft"
              : "Provide the custom CalDAV base URL and credentials",
        description:
          draft.provider === "apple"
            ? "Apple discovery starts from https://caldav.icloud.com, so you only need the Apple ID email and app password here."
            : draft.provider === "microsoft"
              ? "Forge uses the Microsoft client ID, tenant, and redirect URI saved in Settings -> Calendar, then runs a guided popup sign-in. No client secret is required in the user-facing setup."
              : "Forge stores the secrets securely, then discovers the available calendars before anything is saved.",
        render: (value, setValue) => (
          <div className="grid gap-4">
            <FlowField
              label="Connection label"
              description="This is the readable label Forge shows in settings and the calendar health cards."
            >
              <Input
                value={value.label}
                onChange={(event) => setValue({ label: event.target.value })}
                placeholder={PROVIDER_DEFAULTS[value.provider].label}
              />
            </FlowField>

            {value.provider === "microsoft" ? (
              <div className="grid gap-4">
                <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(20,32,48,0.98),rgba(11,18,30,0.98))] p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-white">
                        Guided Microsoft sign-in
                      </div>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
                        Forge uses the Microsoft client ID and redirect URI saved
                        in Calendar Settings, opens a Microsoft login popup,
                        completes a local MSAL public-client authorization-code
                        flow with PKCE, and then brings the discovered calendars
                        back here for selection.
                      </p>
                    </div>
                    <Badge className="bg-sky-400/12 text-sky-100">
                      Read only
                    </Badge>
                  </div>

                  <div className="mt-4 rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/68">
                    <div>
                      Saved client ID:{" "}
                      <span className="font-medium text-white">
                        {microsoftSetup.clientId || "Not configured yet"}
                      </span>
                    </div>
                    <div>
                      Tenant:{" "}
                      <span className="font-medium text-white">
                        {microsoftSetup.tenantId}
                      </span>
                    </div>
                    <div className="break-all">
                      Redirect URI:{" "}
                      <span className="font-medium text-white">
                        {microsoftSetup.redirectUri}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      onClick={() => void startMicrosoftFlow()}
                      disabled={!microsoftSetup.isReadyForSignIn}
                      pending={microsoftSession?.status === "pending"}
                      pendingLabel="Waiting for Microsoft"
                    >
                      <ExternalLink className="size-4" />
                      {microsoftSession?.status === "authorized"
                        ? "Sign in again"
                        : "Sign in with Microsoft"}
                    </Button>
                    {microsoftSession?.accountLabel ? (
                      <Badge className="bg-emerald-500/16 text-emerald-100">
                        <CheckCircle2 className="mr-1 size-3.5" />
                        {microsoftSession.accountLabel}
                      </Badge>
                    ) : null}
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/68">
                      Users do not paste client secrets or refresh tokens here.
                    </div>
                    <div className="rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/68">
                      After sign-in, Forge will let you choose which Exchange
                      Online calendars to mirror into the Calendar page.
                    </div>
                  </div>

                  {!microsoftSetup.isReadyForSignIn ? (
                    <div className="mt-4 rounded-[18px] border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm leading-6 text-amber-100">
                      {microsoftSetup.setupMessage}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                {value.provider === "caldav" ? (
                  <FlowField
                    label="CalDAV base URL"
                    description="Use the account-level CalDAV server URL, not an individual calendar collection URL."
                  >
                    <Input
                      value={value.serverUrl}
                      onChange={(event) => setValue({ serverUrl: event.target.value })}
                      placeholder="https://caldav.example.com"
                    />
                  </FlowField>
                ) : null}

                {value.provider === "apple" ? (
                  <FlowField label="Apple CalDAV base URL">
                    <Input value="https://caldav.icloud.com" disabled />
                  </FlowField>
                ) : null}

                <FlowField label="Account email or username">
                  <Input
                    value={value.username}
                    onChange={(event) => setValue({ username: event.target.value })}
                    placeholder="operator@example.com"
                  />
                </FlowField>

                {value.provider === "google" ? (
                  <>
                    <FlowField label="Google client ID">
                      <Input
                        value={value.clientId}
                        onChange={(event) => setValue({ clientId: event.target.value })}
                        placeholder="1234567890-abcdef.apps.googleusercontent.com"
                      />
                    </FlowField>
                    <FlowField label="Google client secret">
                      <Input
                        type="password"
                        value={value.clientSecret}
                        onChange={(event) => setValue({ clientSecret: event.target.value })}
                        placeholder="GOCSPX-..."
                      />
                    </FlowField>
                    <FlowField label="Refresh token">
                      <Input
                        type="password"
                        value={value.refreshToken}
                        onChange={(event) => setValue({ refreshToken: event.target.value })}
                        placeholder="1//0g..."
                      />
                    </FlowField>
                  </>
                ) : (
                  <FlowField
                    label={value.provider === "apple" ? "App-specific password" : "Password or app password"}
                  >
                    <Input
                      type="password"
                      value={value.password}
                      onChange={(event) => setValue({ password: event.target.value })}
                      placeholder="Password"
                    />
                  </FlowField>
                )}
              </>
            )}
          </div>
        )
      },
      {
        id: "discovery",
        eyebrow: "Discovery",
        title: "Discover the calendars and choose what Forge should sync",
        description:
          draft.provider === "microsoft"
            ? "Select the Exchange Online calendars Forge should mirror into the Calendar page. This connection stays read-only for now."
            : "Select the calendars Forge should mirror into the Calendar page, then choose the calendar Forge should write into for work blocks and timeboxes.",
        render: (value, setValue) => (
          <div className="grid gap-4">
            {value.provider === "microsoft" ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  onClick={() => void startMicrosoftFlow()}
                  pending={microsoftSession?.status === "pending"}
                  pendingLabel="Waiting for Microsoft"
                >
                  <ExternalLink className="size-4" />
                  {microsoftSession?.status === "authorized"
                    ? "Reconnect Microsoft"
                    : "Sign in with Microsoft"}
                </Button>
                {discovery ? (
                  <Badge className="bg-white/[0.08] text-white/74">
                    {discovery.calendars.length} discovered
                  </Badge>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  pending={discoveryMutation.isPending}
                  pendingLabel="Discovering"
                  onClick={() => void discoveryMutation.mutateAsync()}
                >
                  <RefreshCcw className="size-4" />
                  Discover calendars
                </Button>
                {discovery ? (
                  <Badge className="bg-white/[0.08] text-white/74">
                    {discovery.calendars.length} discovered
                  </Badge>
                ) : null}
              </div>
            )}

            {discovery ? (
              <>
                <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4 text-sm leading-6 text-white/64">
                  Discovered through{" "}
                  <span className="font-medium text-white">{discovery.serverUrl}</span>
                  {discovery.homeUrl ? (
                    <>
                      {" "}
                      · home set{" "}
                      <span className="font-medium text-white">{discovery.homeUrl}</span>
                    </>
                  ) : null}
                </div>

                <div className="grid gap-3">
                  {discovery.calendars.map((calendar) => {
                    const selected = value.selectedCalendarUrls.includes(calendar.url);
                    const isWriteTarget = value.forgeCalendarUrl === calendar.url;
                    return (
                      <div
                        key={calendar.url}
                        className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="font-medium text-white">
                              {calendar.displayName}
                            </div>
                            <div className="mt-1 text-sm text-white/56">
                              {calendar.timezone || "No timezone exposed"} ·{" "}
                              {calendar.url}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {calendar.isForgeCandidate ? (
                              <Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">
                                Forge match
                              </Badge>
                            ) : null}
                            {calendar.isPrimary ? (
                              <Badge className="bg-white/[0.08] text-white/74">
                                Primary
                              </Badge>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setValue({
                                selectedCalendarUrls: selected
                                  ? value.selectedCalendarUrls.filter(
                                      (entry) => entry !== calendar.url
                                    )
                                  : [...value.selectedCalendarUrls, calendar.url]
                              })
                            }
                            className={`rounded-full px-3 py-2 text-sm transition ${
                              selected
                                ? "bg-[var(--primary)]/18 text-[var(--primary)] shadow-[inset_0_0_0_1px_rgba(192,193,255,0.24)]"
                                : "bg-white/[0.05] text-white/62 hover:bg-white/[0.08]"
                            }`}
                          >
                            {selected ? "Mirrored" : "Mirror into Forge"}
                          </button>
                          {value.provider !== "microsoft" ? (
                            <button
                              type="button"
                              onClick={() =>
                                setValue({
                                  forgeCalendarUrl: calendar.url,
                                  createForgeCalendar: false
                                })
                              }
                              className={`rounded-full px-3 py-2 text-sm transition ${
                                isWriteTarget
                                  ? "bg-emerald-500/18 text-emerald-100 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.28)]"
                                  : "bg-white/[0.05] text-white/62 hover:bg-white/[0.08]"
                              }`}
                            >
                              {isWriteTarget
                                ? "Forge writes here"
                                : "Use for Forge writes"}
                            </button>
                          ) : (
                            <Badge className="bg-sky-400/12 text-sky-100">
                              Read only
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {value.provider !== "microsoft" ? (
                  <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] p-4">
                    <div className="font-medium text-white">No Forge calendar yet?</div>
                    <p className="mt-2 text-sm leading-6 text-white/60">
                      If none of the discovered calendars should receive Forge-owned
                      work blocks and timeboxes, let Forge create a dedicated
                      calendar named{" "}
                      <span className="font-medium text-white">Forge</span>.
                    </p>
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={() =>
                          setValue({
                            forgeCalendarUrl: null,
                            createForgeCalendar: !value.createForgeCalendar
                          })
                        }
                        className={`rounded-full px-3 py-2 text-sm transition ${
                          value.createForgeCalendar
                            ? "bg-emerald-500/18 text-emerald-100 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.28)]"
                            : "bg-white/[0.05] text-white/62 hover:bg-white/[0.08]"
                        }`}
                      >
                        {value.createForgeCalendar
                          ? "Forge will create one"
                          : "Create a new Forge calendar"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[24px] border border-sky-400/20 bg-sky-400/10 p-4 text-sm leading-6 text-sky-50">
                    Exchange Online is connected through Microsoft Graph in read-only
                    mode. Forge will mirror the calendars you select here, but it
                    will keep work blocks and owned timeboxes local or publish them
                    through another writable provider.
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-sm leading-6 text-white/58">
                {value.provider === "microsoft" ? (
                  <>
                    Start the guided Microsoft sign-in first. Forge will bring the
                    discovered Exchange Online calendars back here as soon as the
                    popup completes.
                  </>
                ) : (
                  <>
                    Discover calendars after entering the credentials. For Apple,
                    Forge starts from{" "}
                    <span className="font-medium text-white">
                      https://caldav.icloud.com
                    </span>{" "}
                    and resolves the principal plus calendar home automatically.
                  </>
                )}
              </div>
            )}
          </div>
        )
      },
      {
        id: "review",
        eyebrow: "Review",
        title: "Confirm what Forge will mirror and where it will write",
        description:
          "This keeps the sync model explicit before the provider connection is saved.",
        render: (value) => (
          <div className="grid gap-4">
            <div className="rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(21,31,42,0.96),rgba(10,16,26,0.96))] p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-[18px] bg-[var(--primary)]/14 p-3 text-[var(--primary)]">
                  <Link2 className="size-4" />
                </div>
                <div>
                  <div className="font-display text-xl text-white">
                    {normalizeLabel(value.provider, value.label)}
                  </div>
                  <div className="mt-1 text-sm text-white/58">
                    {value.provider === "google"
                      ? "Google Calendar"
                      : value.provider === "apple"
                        ? "Apple Calendar"
                        : value.provider === "microsoft"
                          ? "Exchange Online"
                          : "Custom CalDAV"}
                  </div>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-[20px] bg-white/[0.04] px-4 py-3 text-sm text-white/72">
                  Mirrored calendars:{" "}
                  <span className="font-medium text-white">
                    {value.selectedCalendarUrls.length}
                  </span>
                </div>
                <div className="rounded-[20px] bg-white/[0.04] px-4 py-3 text-sm text-white/72">
                  Forge writes:{" "}
                  <span className="font-medium text-white">
                    {value.provider === "microsoft"
                      ? "read only"
                      : value.forgeCalendarUrl
                        ? "existing calendar"
                        : value.createForgeCalendar
                          ? "new Forge calendar"
                          : "not selected"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )
      }
    ],
    [
      discovery,
      discoveryMutation.isPending,
      draft.provider,
      microsoftSession
    ]
  );

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Calendar settings"
      title="Connect a calendar provider"
      description="Discover provider calendars first, then choose which calendars Forge should mirror and, for writable providers, which calendar Forge should write into."
      value={draft}
      onChange={(next) => {
        setDraft(next);
        if (discovery && next.provider !== discovery.provider) {
          setDiscovery(null);
        }
      }}
      steps={steps}
      submitLabel="Connect provider"
      pending={pending}
      pendingLabel="Connecting"
      error={submitError}
      initialStepId={initialStepId}
      onSubmit={async () => {
        try {
          setSubmitError(null);
          if (!discovery) {
            setSubmitError("Discover the available calendars before saving the connection.");
            return;
          }
          if (draft.selectedCalendarUrls.length === 0) {
            setSubmitError("Select at least one calendar to mirror into Forge.");
            return;
          }
          if (
            draft.provider !== "microsoft" &&
            !draft.forgeCalendarUrl &&
            !draft.createForgeCalendar
          ) {
            setSubmitError(
              "Choose the calendar Forge should write into, or ask Forge to create one."
            );
            return;
          }

          if (draft.provider === "google") {
            await onSubmit({
              provider: "google",
              label: normalizeLabel("google", draft.label),
              username: draft.username.trim(),
              clientId: draft.clientId.trim(),
              clientSecret: draft.clientSecret.trim(),
              refreshToken: draft.refreshToken.trim(),
              selectedCalendarUrls: draft.selectedCalendarUrls,
              forgeCalendarUrl: draft.forgeCalendarUrl,
              createForgeCalendar: draft.createForgeCalendar
            });
          } else if (draft.provider === "apple") {
            await onSubmit({
              provider: "apple",
              label: normalizeLabel("apple", draft.label),
              username: draft.username.trim(),
              password: draft.password.trim(),
              selectedCalendarUrls: draft.selectedCalendarUrls,
              forgeCalendarUrl: draft.forgeCalendarUrl,
              createForgeCalendar: draft.createForgeCalendar
            });
          } else if (draft.provider === "microsoft") {
            if (!microsoftSession?.sessionId || microsoftSession.status !== "authorized") {
              setSubmitError(
                "Complete the Microsoft sign-in flow before saving this connection."
              );
              return;
            }
            await onSubmit({
              provider: "microsoft",
              label: normalizeLabel("microsoft", draft.label),
              authSessionId: microsoftSession.sessionId,
              selectedCalendarUrls: draft.selectedCalendarUrls
            });
          } else {
            await onSubmit({
              provider: "caldav",
              label: normalizeLabel("caldav", draft.label),
              serverUrl: draft.serverUrl.trim(),
              username: draft.username.trim(),
              password: draft.password.trim(),
              selectedCalendarUrls: draft.selectedCalendarUrls,
              forgeCalendarUrl: draft.forgeCalendarUrl,
              createForgeCalendar: draft.createForgeCalendar
            });
          }
          onOpenChange(false);
        } catch (error) {
          setSubmitError(
            error instanceof Error
              ? error.message
              : "Forge could not create this calendar connection."
          );
        }
      }}
    />
  );
}
