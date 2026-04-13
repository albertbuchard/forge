import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Cloud,
  Pencil,
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
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Input } from "@/components/ui/input";
import { readCalendarDisplayName } from "@/lib/calendar-name-deduper";
import { ForgeApiError } from "@/lib/api-error";
import {
  discoverCalendarConnection,
  discoverMacOSLocalCalendarSources,
  getGoogleCalendarOauthSession,
  getMacOSLocalCalendarStatus,
  getMicrosoftCalendarOauthSession,
  patchSettings,
  requestMacOSLocalCalendarAccess,
  startGoogleCalendarOauth,
  startMicrosoftCalendarOauth,
  testMicrosoftCalendarOauthConfiguration
} from "@/lib/api";
import type {
  CalendarDiscoveryPayload,
  CalendarConnectionStatus,
  MacOSCalendarAccessStatus,
  MacOSLocalCalendarDiscoveryPayload,
  CalendarProvider,
  GoogleCalendarAuthSettings,
  GoogleCalendarOauthSession,
  MicrosoftCalendarAuthSettings,
  MicrosoftCalendarOauthSession
} from "@/lib/types";

type ConnectionDraft = {
  provider: CalendarProvider;
  label: string;
  serverUrl: string;
  username: string;
  password: string;
  selectedCalendarUrls: string[];
  forgeCalendarUrl: string | null;
  createForgeCalendar: boolean;
  sourceId: string | null;
  replaceConnectionIds: string[];
};

type ExistingCalendarConnection = {
  id: string;
  label: string;
  provider: CalendarProvider;
  status: CalendarConnectionStatus;
};

type GooglePopupMessage = {
  type?: string;
  sessionId?: string;
  status?: string;
};

type MicrosoftPopupMessage = {
  type?: string;
  sessionId?: string;
  status?: string;
};

type MicrosoftSettingsDraft = {
  clientId: string;
  tenantId: string;
  redirectUri: string;
};

type GoogleSettingsDraft = {
  clientId: string;
  clientSecret: string;
};

const MICROSOFT_CALLBACK_PATH = "/api/v1/calendar/oauth/microsoft/callback";
const MICROSOFT_CLIENT_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const OAUTH_SESSION_POLL_INTERVAL_MS = 1000;

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
  macos_local: {
    label: "Calendars On This Mac",
    serverUrl: "forge-macos-local://eventkit/"
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
    selectedCalendarUrls: [],
    forgeCalendarUrl: null,
    createForgeCalendar: false,
    sourceId: null,
    replaceConnectionIds: []
  };
}

function normalizeLabel(provider: CalendarProvider, label: string) {
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : PROVIDER_DEFAULTS[provider].label;
}

function buildMicrosoftSettingsDraft(
  microsoftSetup: MicrosoftCalendarAuthSettings
): MicrosoftSettingsDraft {
  return {
    clientId: microsoftSetup.clientId,
    tenantId: microsoftSetup.tenantId,
    redirectUri: microsoftSetup.redirectUri
  };
}

function buildGoogleSettingsDraft(
  googleSetup: GoogleCalendarAuthSettings
): GoogleSettingsDraft {
  return {
    clientId: googleSetup.storedClientId ?? "",
    clientSecret: googleSetup.storedClientSecret ?? ""
  };
}

function sanitizeGoogleSetupMessage(message: string) {
  return message
    .replace(/\s*No GOOGLE_CLIENT_SECRET is used in this local PKCE flow\./gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildGoogleClientIdMissingMessage() {
  return [
    "Google OAuth credentials are not set for this Forge install.",
    "- Save a Google desktop-app client ID and client secret below for this Forge install.",
    "- Or rely on the packaged or environment defaults for the Forge runtime."
  ].join("\n");
}

function buildGoogleRouteErrorMessage(routeMessage: string, allowedOrigins: string[]) {
  return [
    routeMessage,
    `- Open Forge from a local browser on the host running Forge.`,
    `- Use one of these local addresses: ${allowedOrigins.join(", ")}.`
  ].join("\n");
}

function normalizeGoogleSettingsDraft(
  draft: GoogleSettingsDraft
): GoogleSettingsDraft {
  return {
    clientId: (draft.clientId ?? "").trim(),
    clientSecret: (draft.clientSecret ?? "").trim()
  };
}

function sameGoogleSettingsDraft(
  left: GoogleSettingsDraft,
  right: GoogleSettingsDraft
) {
  return (
    left.clientId.trim() === right.clientId.trim() &&
    left.clientSecret.trim() === right.clientSecret.trim()
  );
}

function validateGoogleSettingsDraft(draft: GoogleSettingsDraft) {
  const normalized = normalizeGoogleSettingsDraft(draft);
  const issues: Partial<Record<keyof GoogleSettingsDraft, string>> = {};
  const hasClientId = normalized.clientId.length > 0;
  const hasClientSecret = normalized.clientSecret.length > 0;

  if (hasClientId !== hasClientSecret) {
    const message =
      "When overriding Google OAuth credentials, save the client ID and client secret together, or clear both to use the bundled defaults.";
    if (!hasClientId) {
      issues.clientId = message;
    }
    if (!hasClientSecret) {
      issues.clientSecret = message;
    }
  }

  return {
    normalized,
    issues,
    isValid: Object.keys(issues).length === 0
  };
}

function normalizeMicrosoftSettingsDraft(
  draft: MicrosoftSettingsDraft
): MicrosoftSettingsDraft {
  return {
    clientId: draft.clientId.trim(),
    tenantId: draft.tenantId.trim() || "common",
    redirectUri: draft.redirectUri.trim()
  };
}

function validateMicrosoftSettingsDraft(draft: MicrosoftSettingsDraft) {
  const normalized = normalizeMicrosoftSettingsDraft(draft);
  const issues: Partial<Record<keyof MicrosoftSettingsDraft, string>> = {};

  if (!normalized.clientId) {
    issues.clientId = "Microsoft client ID is required.";
  } else if (!MICROSOFT_CLIENT_ID_PATTERN.test(normalized.clientId)) {
    issues.clientId = "Use the Microsoft app registration client ID GUID.";
  }

  if (!normalized.redirectUri) {
    issues.redirectUri = "Redirect URI is required.";
  } else {
    try {
      const url = new URL(normalized.redirectUri);
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
    normalized,
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

function isLoopbackHostname(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

function isTailscaleHostname(hostname: string) {
  return hostname.endsWith(".ts.net");
}

export function describeGoogleRouteRequirement(input: {
  currentOrigin: string;
  appBaseUrl: string;
  redirectUri: string;
  allowedOrigins: string[];
  isLocalOnly: boolean;
}) {
  const allowedLocalOrigins = input.allowedOrigins.filter((origin) => {
    try {
      return isLoopbackHostname(new URL(origin).hostname);
    } catch {
      return false;
    }
  });

  const redirectHostname = (() => {
    try {
      return new URL(input.redirectUri).hostname;
    } catch {
      return "";
    }
  })();
  let currentHostname = "";
  try {
    currentHostname = new URL(input.currentOrigin).hostname;
  } catch {
    currentHostname = "";
  }

  if (
    isTailscaleHostname(currentHostname) &&
    isLoopbackHostname(redirectHostname)
  ) {
    return `Google sign-in has to start from a local browser on the host running Forge. Forge is currently open through Tailscale at ${input.currentOrigin}, but Google sends the callback to localhost on the device that opens the popup. On a phone or another computer, that callback goes to that device instead of the Forge host.`;
  }

  if (input.isLocalOnly) {
    return `Google sign-in has to start from a local browser on the host running Forge. Google sends the callback to localhost, so if Forge is opened remotely, the callback goes to the other device instead of the Forge host.`;
  }

  return `Google sign-in is only enabled from the configured Forge host for this deployment. Open Forge on ${input.appBaseUrl}. Current browser origin: ${input.currentOrigin}.`;
}

export function CalendarConnectionFlowDialog({
  open,
  onOpenChange,
  initialProvider = "google",
  initialStepId,
  googleSetup,
  microsoftSetup,
  onCalendarSettingsChanged,
  existingConnections = [],
  onSubmit,
  pending = false
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialProvider?: CalendarProvider;
  initialStepId?: string;
  googleSetup: GoogleCalendarAuthSettings;
  microsoftSetup: MicrosoftCalendarAuthSettings;
  onCalendarSettingsChanged?: () => Promise<void>;
  existingConnections?: ExistingCalendarConnection[];
  onSubmit: (
    input:
      | {
          provider: "google";
          label: string;
          authSessionId: string;
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
      | {
          provider: "macos_local";
          label: string;
          sourceId: string;
          selectedCalendarUrls: string[];
          forgeCalendarUrl?: string | null;
          createForgeCalendar?: boolean;
          replaceConnectionIds?: string[];
        }
  ) => Promise<void>;
  pending?: boolean;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ConnectionDraft>(() => createDraft(initialProvider));
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<CalendarDiscoveryPayload | null>(null);
  const [macosStatus, setMacosStatus] =
    useState<MacOSCalendarAccessStatus>("not_determined");
  const [macosDiscovery, setMacosDiscovery] =
    useState<MacOSLocalCalendarDiscoveryPayload | null>(null);
  const [googleSession, setGoogleSession] = useState<GoogleCalendarOauthSession | null>(null);
  const [microsoftSession, setMicrosoftSession] = useState<MicrosoftCalendarOauthSession | null>(null);
  const [activeGoogleSetup, setActiveGoogleSetup] =
    useState<GoogleCalendarAuthSettings>(googleSetup);
  const [googleSettingsDraft, setGoogleSettingsDraft] = useState<GoogleSettingsDraft>(() =>
    buildGoogleSettingsDraft(googleSetup)
  );
  const [savedGoogleSettingsDraft, setSavedGoogleSettingsDraft] =
    useState<GoogleSettingsDraft>(() => buildGoogleSettingsDraft(googleSetup));
  const [googleClientIdEditing, setGoogleClientIdEditing] = useState(false);
  const [googleSetupMessage, setGoogleSetupMessage] = useState<string | null>(null);
  const [activeMicrosoftSetup, setActiveMicrosoftSetup] =
    useState<MicrosoftCalendarAuthSettings>(microsoftSetup);
  const [microsoftSettingsDraft, setMicrosoftSettingsDraft] = useState<MicrosoftSettingsDraft>(() =>
    buildMicrosoftSettingsDraft(microsoftSetup)
  );
  const [savedMicrosoftSettingsDraft, setSavedMicrosoftSettingsDraft] =
    useState<MicrosoftSettingsDraft>(() => buildMicrosoftSettingsDraft(microsoftSetup));
  const [microsoftSetupMessage, setMicrosoftSetupMessage] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);

  const applyServerSettings = (response: Awaited<ReturnType<typeof patchSettings>>) => {
    queryClient.setQueryData(["forge-settings"], response);
    return response.settings;
  };

  const resetGoogleSession = () => {
    setGoogleSession(null);
    popupRef.current = null;
  };

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
    resetGoogleSession();
    resetMicrosoftSession();
    setMacosDiscovery(null);
    setMacosStatus("not_determined");
    setGoogleClientIdEditing(false);
    setGoogleSetupMessage(null);
    setMicrosoftSetupMessage(null);
  }, [initialProvider, open]);

  useEffect(() => {
    if (!open || draft.provider !== "macos_local") {
      return;
    }
    void macosStatusMutation.mutateAsync();
  }, [draft.provider, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setActiveGoogleSetup(googleSetup);
    const savedDraft = buildGoogleSettingsDraft(googleSetup);
    setGoogleSettingsDraft(savedDraft);
    setSavedGoogleSettingsDraft(savedDraft);
    setGoogleClientIdEditing(false);
    setGoogleSetupMessage(null);
  }, [googleSetup, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setActiveMicrosoftSetup(microsoftSetup);
    const savedDraft = buildMicrosoftSettingsDraft(microsoftSetup);
    setMicrosoftSettingsDraft(savedDraft);
    setSavedMicrosoftSettingsDraft(savedDraft);
    setMicrosoftSetupMessage(null);
  }, [microsoftSetup, open]);

  useEffect(() => {
    if (!open || !googleSession || googleSession.status !== "pending") {
      return;
    }

    const callbackOrigin = new URL(activeGoogleSetup.redirectUri).origin;
    let requestInFlight = false;
    const refreshSession = () => {
      if (requestInFlight) {
        return;
      }
      requestInFlight = true;
      void loadGoogleSession(googleSession.sessionId).finally(() => {
        requestInFlight = false;
      });
    };
    const handleMessage = (event: MessageEvent<GooglePopupMessage>) => {
      if (event.origin !== callbackOrigin) {
        return;
      }
      if (
        event.data?.type !== "forge:google-calendar-auth" ||
          event.data?.sessionId !== googleSession.sessionId
      ) {
        return;
      }
      refreshSession();
    };
    const handleFocus = () => {
      refreshSession();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshSession();
      }
    };

    const interval = window.setInterval(
      refreshSession,
      OAUTH_SESSION_POLL_INTERVAL_MS
    );

    window.addEventListener("message", handleMessage);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(interval);
    };
  }, [activeGoogleSetup.redirectUri, googleSession, open]);

  useEffect(() => {
    if (!open || !microsoftSession || microsoftSession.status !== "pending") {
      return;
    }

    const callbackOrigin = new URL(activeMicrosoftSetup.redirectUri).origin;
    let requestInFlight = false;
    const refreshSession = () => {
      if (requestInFlight) {
        return;
      }
      requestInFlight = true;
      void loadMicrosoftSession(microsoftSession.sessionId).finally(() => {
        requestInFlight = false;
      });
    };
    const handleMessage = (event: MessageEvent<MicrosoftPopupMessage>) => {
      if (event.origin !== callbackOrigin) {
        return;
      }
      if (
        event.data?.type !== "forge:microsoft-calendar-auth" ||
          event.data?.sessionId !== microsoftSession.sessionId
      ) {
        return;
      }
      refreshSession();
    };
    const handleFocus = () => {
      refreshSession();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshSession();
      }
    };

    const interval = window.setInterval(
      refreshSession,
      OAUTH_SESSION_POLL_INTERVAL_MS
    );

    window.addEventListener("message", handleMessage);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(interval);
    };
  }, [activeMicrosoftSetup.redirectUri, microsoftSession, open]);

  const discoveryMutation = useMutation<{
    discovery: CalendarDiscoveryPayload | null;
  }>({
    mutationFn: () => {
      if (draft.provider === "macos_local") {
        return discoverMacOSLocalCalendarSources().then(({ discovery }) => {
          setMacosDiscovery(discovery);
          setMacosStatus(discovery.status);
          const preferredSource =
            discovery.sources.find((source) =>
              source.sourceId === draft.sourceId
            ) ?? discovery.sources[0] ?? null;
          if (preferredSource) {
            applyDiscoveryPayload({
              provider: "macos_local",
              accountLabel: preferredSource.accountLabel,
              serverUrl: draft.serverUrl,
              principalUrl: null,
              homeUrl: null,
              calendars: preferredSource.calendars
            });
            setDraft((current) => ({
              ...current,
              sourceId: preferredSource.sourceId
            }));
          }
          return { discovery: null };
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
      if (payload) {
        applyDiscoveryPayload(payload);
      }
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

  const macosStatusMutation = useMutation({
    mutationFn: getMacOSLocalCalendarStatus,
    onSuccess: ({ status }) => {
      setMacosStatus(status);
      if (status !== "full_access") {
        setMacosDiscovery(null);
        setDiscovery(null);
      }
    }
  });

  const macosAccessMutation = useMutation({
    mutationFn: requestMacOSLocalCalendarAccess,
    onSuccess: ({ status }) => {
      setMacosStatus(status);
    },
    onError: (error) => {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Forge could not request Calendar access from macOS."
      );
    }
  });

  useEffect(() => {
    if (
      !open ||
      draft.provider !== "macos_local" ||
      macosStatus !== "full_access" ||
      macosDiscovery !== null ||
      discoveryMutation.isPending
    ) {
      return;
    }
    void discoveryMutation.mutateAsync();
  }, [
    discoveryMutation,
    draft.provider,
    macosDiscovery,
    macosStatus,
    open
  ]);

  const saveMicrosoftSettingsMutation = useMutation({
    mutationFn: async (input: MicrosoftSettingsDraft) => {
      const normalized = normalizeMicrosoftSettingsDraft(input);
      const response = await patchSettings({
        calendarProviders: {
          microsoft: normalized
        }
      });
      return {
        normalized,
        settings: applyServerSettings(response)
      };
    },
    onSuccess: async ({ settings }) => {
      setActiveMicrosoftSetup(settings.calendarProviders.microsoft);
      const savedDraft = buildMicrosoftSettingsDraft(
        settings.calendarProviders.microsoft
      );
      setSavedMicrosoftSettingsDraft(savedDraft);
      setMicrosoftSettingsDraft(savedDraft);
      setMicrosoftSetupMessage(
        "Microsoft settings saved. Start the guided Microsoft sign-in when you are ready."
      );
      void onCalendarSettingsChanged?.();
    },
    onError: (error) => {
      setMicrosoftSetupMessage(
        error instanceof Error
          ? error.message
          : "Forge could not save the Microsoft settings."
      );
    }
  });

  const saveGoogleSettingsMutation = useMutation({
    mutationFn: async (input: GoogleSettingsDraft) => {
      const normalized = normalizeGoogleSettingsDraft(input);
      const response = await patchSettings({
        calendarProviders: {
          google: normalized
        }
      });
      return {
        normalized,
        settings: applyServerSettings(response)
      };
    },
    onSuccess: async ({ normalized, settings }) => {
      setActiveGoogleSetup(settings.calendarProviders.google);
      const savedDraft = buildGoogleSettingsDraft(settings.calendarProviders.google);
      setSavedGoogleSettingsDraft(savedDraft);
      setGoogleSettingsDraft(savedDraft);
      setGoogleClientIdEditing(false);
      setGoogleSetupMessage(
        normalized.clientId || normalized.clientSecret
          ? "Google OAuth credentials saved on the Forge server for this install."
          : "Google OAuth override cleared. Forge will use the packaged or environment default again."
      );
      void onCalendarSettingsChanged?.();
    },
    onError: (error) => {
      setGoogleSetupMessage(
        error instanceof Error
          ? error.message
          : "Forge could not save the Google OAuth credentials."
      );
    }
  });

  const testMicrosoftSettingsMutation = useMutation({
    mutationFn: (input: MicrosoftSettingsDraft) => {
      const normalized = normalizeMicrosoftSettingsDraft(input);
      return testMicrosoftCalendarOauthConfiguration(normalized);
    },
    onSuccess: ({ result }) => {
      setMicrosoftSetupMessage(result.message);
    },
    onError: (error) => {
      setMicrosoftSetupMessage(
        error instanceof Error
          ? error.message
          : "Forge could not validate the Microsoft configuration."
      );
    }
  });

  const microsoftValidation = useMemo(
    () => validateMicrosoftSettingsDraft(microsoftSettingsDraft),
    [microsoftSettingsDraft]
  );
  const googleValidation = useMemo(
    () => validateGoogleSettingsDraft(googleSettingsDraft),
    [googleSettingsDraft]
  );
  const hasUnsavedGoogleSettings = !sameGoogleSettingsDraft(
    googleSettingsDraft,
    savedGoogleSettingsDraft
  );
  const hasUnsavedMicrosoftSettings = !sameMicrosoftSettingsDraft(
    microsoftSettingsDraft,
    savedMicrosoftSettingsDraft
  );
  const currentBrowserOrigin =
    typeof window === "undefined" ? "" : window.location.origin;
  const googleRedirectOrigin = useMemo(() => {
    try {
      return new URL(activeGoogleSetup.redirectUri).origin;
    } catch {
      return "";
    }
  }, [activeGoogleSetup.redirectUri]);
  const googlePairingAllowedFromCurrentOrigin =
    currentBrowserOrigin.length > 0 &&
    activeGoogleSetup.allowedOrigins.includes(currentBrowserOrigin) &&
    (!activeGoogleSetup.isLocalOnly ||
      isLoopbackHostname(new URL(currentBrowserOrigin).hostname));
  const googleWrongRouteMessage = currentBrowserOrigin &&
    !googlePairingAllowedFromCurrentOrigin
      ? describeGoogleRouteRequirement({
          currentOrigin: currentBrowserOrigin,
          appBaseUrl: activeGoogleSetup.appBaseUrl,
          redirectUri: activeGoogleSetup.redirectUri,
          allowedOrigins: activeGoogleSetup.allowedOrigins,
          isLocalOnly: activeGoogleSetup.isLocalOnly
        })
      : null;
  const googleSetupError = !activeGoogleSetup.isReadyForPairing
    ? sanitizeGoogleSetupMessage(activeGoogleSetup.setupMessage) ||
      buildGoogleClientIdMissingMessage()
    : null;
  const googleRouteError = googleWrongRouteMessage
    ? buildGoogleRouteErrorMessage(
        googleWrongRouteMessage,
        activeGoogleSetup.allowedOrigins
      )
    : null;
  const inlineStepError = (stepId: string) => {
    if (submitError) {
      return submitError;
    }

    if (draft.provider === "google" && (stepId === "credentials" || stepId === "discovery")) {
      if (hasUnsavedGoogleSettings) {
        return "Save the Google OAuth credential change before starting sign-in.";
      }
      const googleBlockingMessages = [googleRouteError, googleSetupError].filter(
        (message): message is string => Boolean(message)
      );
      if (googleBlockingMessages.length > 0) {
        return googleBlockingMessages.join("\n\n");
      }
    }

    if (draft.provider === "microsoft" && stepId === "credentials") {
      if (hasUnsavedMicrosoftSettings) {
        return "Save these Microsoft settings before starting sign-in.";
      }
      if (!hasUnsavedMicrosoftSettings && !savedMicrosoftSettingsDraft.clientId && !microsoftSetupMessage) {
        return activeMicrosoftSetup.setupMessage;
      }
    }

    if (
      draft.provider === "macos_local" &&
      (stepId === "credentials" || stepId === "discovery") &&
      macosStatus !== "full_access"
    ) {
      if (macosStatus === "unavailable") {
        return "This provider is only available on macOS, because Forge uses EventKit to access the host machine's calendar store.";
      }
      return "Grant Calendar full access for Forge on this Mac before discovering host calendars.";
    }

    return undefined;
  };

  const loadGoogleSession = async (
    sessionId: string,
    options?: { afterPopupClose?: boolean }
  ) => {
    try {
      const { session } = await getGoogleCalendarOauthSession(sessionId);
      setGoogleSession(session);
      if (session.status === "authorized" && session.discovery) {
        applyDiscoveryPayload(session.discovery);
        setSubmitError(null);
        return;
      }
      if (session.status === "error" || session.status === "expired") {
        setSubmitError(
          session.error ??
            "Google sign-in did not complete. Start the guided sign-in again."
        );
        return;
      }
      if (options?.afterPopupClose) {
        setSubmitError(
          `The Google sign-in window closed before Forge received permission. If Google showed redirect_uri_mismatch, register exactly ${activeGoogleSetup.redirectUri} in Google Cloud Console and reopen Forge on a browser route that can really receive that callback.`
        );
      }
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Forge could not confirm the Google sign-in session."
      );
    }
  };

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

  const startGoogleFlow = async () => {
    try {
      if (googleWrongRouteMessage) {
        throw new Error(
          buildGoogleRouteErrorMessage(
            googleWrongRouteMessage,
            activeGoogleSetup.allowedOrigins
          )
        );
      }
      if (!activeGoogleSetup.isReadyForPairing) {
        throw new Error(buildGoogleClientIdMissingMessage());
      }
      setSubmitError(null);
      setDiscovery(null);
      const { session } = await startGoogleCalendarOauth({
        label: normalizeLabel("google", draft.label),
        browserOrigin: currentBrowserOrigin || undefined
      });
      if (!session.authUrl) {
        throw new Error("Forge could not prepare the Google sign-in URL.");
      }
      setGoogleSession(session);
      popupRef.current?.close();
      popupRef.current = window.open(
        session.authUrl,
        "forge-google-calendar-auth",
        "popup=yes,width=520,height=720,resizable=yes,scrollbars=yes"
      );
      if (!popupRef.current) {
        throw new Error(
          "The Google sign-in popup was blocked. Allow popups for Forge and try again."
        );
      }
      popupRef.current.focus();
    } catch (error) {
      resetGoogleSession();
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Forge could not start the Google sign-in flow."
      );
    }
  };

  const startMicrosoftFlow = async () => {
    try {
      if (!microsoftValidation.isValid) {
        throw new Error(
          "Enter a valid Microsoft client ID and redirect URI before starting sign-in."
        );
      }
      if (hasUnsavedMicrosoftSettings) {
        throw new Error(
          "Save the Microsoft settings in this guided flow before starting sign-in."
        );
      }
      if (saveMicrosoftSettingsMutation.isPending) {
        throw new Error(
          "Wait for Forge to finish saving the Microsoft settings before starting sign-in."
        );
      }
      setSubmitError(null);
      setMicrosoftSetupMessage(null);
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
          "macOS local uses EventKit to access the calendars already configured on this Mac, Apple uses autodiscovery from caldav.icloud.com, Google uses a localhost Authorization Code + PKCE flow, Exchange Online uses guided Microsoft sign-in in read-only mode, and custom CalDAV stays available for everything else.",
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
                  setMacosDiscovery(null);
                  setSubmitError(null);
                  setMicrosoftSetupMessage(null);
                  resetGoogleSession();
                  resetMicrosoftSession();
                  setValue(createDraft(next as CalendarProvider));
                }}
                options={[
                  {
                    value: "google",
                    label: "Google Calendar",
                    description: "Use Google sign-in with Authorization Code + PKCE, let Forge exchange the code on the backend, and store a per-user refresh token server-side."
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
                    value: "macos_local",
                    label: "Calendars On This Mac",
                    description: "Use EventKit to access the calendars already configured in Calendar.app on this host machine and avoid reconnecting those same accounts manually."
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
                  {value.provider === "google"
                    ? "Forge opens a Google sign-in popup, exchanges the authorization code on the backend, stores a per-user refresh token, and then discovers the writable calendars for that account."
                    : value.provider === "macos_local"
                    ? "Forge asks macOS for Calendar access, discovers the host calendars grouped by account source, and replaces overlapping remote connections instead of keeping two copies."
                    : value.provider === "microsoft"
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
            ? "Sign in with Google"
            : draft.provider === "macos_local"
              ? "Use the calendars already configured on this Mac"
            : draft.provider === "apple"
              ? "Provide the Apple account email and app-specific password"
              : draft.provider === "microsoft"
              ? "Sign in with Microsoft"
              : "Provide the custom CalDAV base URL and credentials",
        description:
          draft.provider === "google"
            ? "Review the Google desktop OAuth client, save a local override only if you need one, then start the popup and let Forge finish the PKCE exchange on the backend."
            : draft.provider === "macos_local"
            ? "Forge requests Calendar access through EventKit, discovers sources from Calendar.app, then lets you choose which host calendars to mirror and where Forge should write."
            : draft.provider === "apple"
            ? "Apple discovery starts from https://caldav.icloud.com, so you only need the Apple ID email and app password here."
            : draft.provider === "microsoft"
              ? "Forge uses the Microsoft client ID, tenant, and redirect URI saved in Settings -> Calendar, then runs a guided popup sign-in."
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

            {value.provider === "macos_local" ? (
              <div className="grid gap-4">
                <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(20,32,48,0.98),rgba(11,18,30,0.98))] p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-white">
                        macOS Calendar access
                      </div>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
                        Forge uses EventKit to read and write the calendars already
                        configured in Calendar.app on this Mac. Grant Calendar full
                        access, then discover the available account sources.
                      </p>
                    </div>
                    <Badge
                      className={
                        macosStatus === "full_access"
                          ? "bg-emerald-500/16 text-emerald-100"
                          : "bg-white/[0.08] text-white/72"
                      }
                    >
                      {macosStatus === "full_access"
                        ? "Full access"
                        : macosStatus.replaceAll("_", " ")}
                    </Badge>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      onClick={() => void macosAccessMutation.mutateAsync()}
                      pending={macosAccessMutation.isPending}
                      pendingLabel="Waiting for macOS"
                    >
                      <KeyRound className="size-4" />
                      Request Calendar access
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void macosStatusMutation.mutateAsync()}
                      pending={macosStatusMutation.isPending}
                      pendingLabel="Checking"
                    >
                      <RefreshCcw className="size-4" />
                      Check access
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void discoveryMutation.mutateAsync()}
                      disabled={macosStatus !== "full_access"}
                      pending={discoveryMutation.isPending}
                      pendingLabel="Discovering"
                    >
                      <RefreshCcw className="size-4" />
                      Discover host calendars
                    </Button>
                  </div>

                  {macosDiscovery?.sources?.length ? (
                    <div className="mt-5 grid gap-3">
                      <div className="text-sm font-medium text-white">
                        Host calendar sources
                      </div>
                      {macosDiscovery.sources.map((source) => {
                        const selected = value.sourceId === source.sourceId;
                        return (
                          <button
                            key={source.sourceId}
                            type="button"
                            className={`rounded-[20px] border px-4 py-3 text-left transition ${
                              selected
                                ? "border-[var(--primary)]/40 bg-[var(--primary)]/12 text-white"
                                : "border-white/8 bg-white/[0.04] text-white/72 hover:bg-white/[0.07]"
                            }`}
                            onClick={() => {
                              setValue({ sourceId: source.sourceId });
                              applyDiscoveryPayload({
                                provider: "macos_local",
                                accountLabel: source.accountLabel,
                                serverUrl: value.serverUrl,
                                principalUrl: null,
                                homeUrl: null,
                                calendars: source.calendars
                              });
                            }}
                          >
                            <div className="font-medium">
                              {source.accountLabel || source.sourceTitle}
                            </div>
                            <div className="mt-1 text-sm text-white/56">
                              {source.sourceType} · {source.calendars.length} calendars
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : value.provider === "google" ? (
              <div className="grid gap-4">
                <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(20,32,48,0.98),rgba(11,18,30,0.98))] p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-white">
                        How Google sign-in works
                      </div>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
                        Start the popup from the host running Forge. Google
                        returns to Forge on localhost, Forge completes the PKCE
                        exchange on the backend, then Forge discovers the
                        calendars for that account.
                      </p>
                    </div>
                    <Badge className="bg-emerald-500/16 text-emerald-100">
                      Auth code + PKCE
                    </Badge>
                  </div>

                  <div className="mt-4 rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/68">
                    <div>
                      Forge runtime:{" "}
                      <span className="font-medium text-white">
                        {activeGoogleSetup.appBaseUrl}
                      </span>
                    </div>
                    <div className="break-all">
                      Redirect URI:{" "}
                      <span className="font-medium text-white">
                        {activeGoogleSetup.redirectUri}
                      </span>
                    </div>
                    <div className="break-all">
                      Redirect origin:{" "}
                      <span className="font-medium text-white">
                        {googleRedirectOrigin || "Unavailable"}
                      </span>
                    </div>
                    <div>
                      Allowed local browser origins:{" "}
                      <span className="font-medium text-white">
                        {activeGoogleSetup.allowedOrigins.join(", ")}
                      </span>
                    </div>
                    <div className="break-all">
                      Detected browser origin:{" "}
                      <span className="font-medium text-white">
                        {currentBrowserOrigin || "Unavailable"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 rounded-[18px] bg-white/[0.04] p-4">
                    {!googleClientIdEditing ? (
                      <div className="grid gap-3">
                        <div className="grid min-w-0 gap-3">
                          <div className="flex min-w-0 items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="truncate font-medium text-white">
                                  Google OAuth client
                                </span>
                                <Badge
                                  className={
                                    (activeGoogleSetup.storedClientId || "") ||
                                    (activeGoogleSetup.storedClientSecret || "")
                                      ? "bg-emerald-500/16 text-emerald-100"
                                      : "bg-white/[0.08] text-white/72"
                                  }
                                >
                                  {(activeGoogleSetup.storedClientId || "") ||
                                  (activeGoogleSetup.storedClientSecret || "")
                                    ? "Stored on server"
                                    : "Using packaged default"}
                                </Badge>
                                <InfoTooltip
                                  content="Forge ships with a packaged Google desktop OAuth client by default. Save both fields only when this Forge install should use a different client ID and client secret pair."
                                  label="Explain Google OAuth client"
                                  className="shrink-0"
                                />
                              </div>
                            </div>
                            <button
                              type="button"
                              aria-label="Edit Google OAuth client"
                              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/72 transition hover:bg-white/[0.12] hover:text-white"
                              onClick={() => {
                                setGoogleSetupMessage(null);
                                setGoogleClientIdEditing(true);
                              }}
                            >
                              <Pencil className="size-4" />
                            </button>
                          </div>
                        </div>

                        <FlowField
                          label="Effective client ID"
                          description="This is the Google desktop-app client ID Forge will use right now."
                        >
                          <div className="flex min-h-11 min-w-0 items-center overflow-hidden rounded-[18px] border border-white/8 bg-black/20 px-4 text-sm text-white/38">
                            <span
                              className="block min-w-0 truncate"
                              title={activeGoogleSetup.clientId}
                            >
                              {activeGoogleSetup.clientId}
                            </span>
                          </div>
                        </FlowField>

                        <FlowField
                          label="Effective client secret"
                          description="Forge uses this value on the local backend when exchanging and refreshing Google tokens."
                        >
                          <div className="flex min-h-11 min-w-0 items-center overflow-hidden rounded-[18px] border border-white/8 bg-black/20 px-4 text-sm text-white/38">
                            <span
                              className="block min-w-0 truncate"
                              title={activeGoogleSetup.clientSecret || ""}
                            >
                              {activeGoogleSetup.clientSecret || ""}
                            </span>
                          </div>
                        </FlowField>
                      </div>
                    ) : (
                      <div className="grid gap-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium text-white">
                              Google OAuth override
                            </div>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
                              Save both the client ID and client secret only when
                              this Forge install should use a different Google
                              desktop OAuth app than the packaged default.
                            </p>
                          </div>
                          <button
                            type="button"
                            aria-label="Done editing Google OAuth client"
                            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/72 transition hover:bg-white/[0.12] hover:text-white"
                            onClick={() => {
                              setGoogleSetupMessage(null);
                              const savedDraft =
                                buildGoogleSettingsDraft(activeGoogleSetup);
                              setGoogleSettingsDraft(savedDraft);
                              setGoogleClientIdEditing(false);
                            }}
                          >
                            <CheckCircle2 className="size-4" />
                          </button>
                        </div>

                        <FlowField
                          label="Client ID"
                          description="Override the packaged Google desktop-app client ID for this Forge install."
                        >
                          <Input
                            aria-label="Client ID"
                            value={googleSettingsDraft.clientId}
                            onChange={(event) => {
                              setGoogleSetupMessage(null);
                              setGoogleSettingsDraft({
                                ...googleSettingsDraft,
                                clientId: event.target.value
                              });
                            }}
                            placeholder="1234567890-abcdef.apps.googleusercontent.com"
                          />
                          {googleValidation.issues.clientId ? (
                            <p className="mt-2 text-sm text-rose-200">
                              {googleValidation.issues.clientId}
                            </p>
                          ) : null}
                        </FlowField>

                        <FlowField
                          label="Client secret"
                          description="Override the packaged Google desktop-app client secret for this Forge install."
                        >
                          <Input
                            aria-label="Client secret"
                            value={googleSettingsDraft.clientSecret}
                            onChange={(event) => {
                              setGoogleSetupMessage(null);
                              setGoogleSettingsDraft({
                                ...googleSettingsDraft,
                                clientSecret: event.target.value
                              });
                            }}
                            placeholder="GOCSPX-..."
                          />
                          {googleValidation.issues.clientSecret ? (
                            <p className="mt-2 text-sm text-rose-200">
                              {googleValidation.issues.clientSecret}
                            </p>
                          ) : null}
                        </FlowField>

                        <div className="flex flex-wrap items-center gap-3">
                          <Button
                            type="button"
                            onClick={() =>
                              void saveGoogleSettingsMutation.mutateAsync(
                                googleSettingsDraft
                              )
                            }
                            disabled={
                              !hasUnsavedGoogleSettings || !googleValidation.isValid
                            }
                            pending={saveGoogleSettingsMutation.isPending}
                            pendingLabel="Saving"
                          >
                            Save Google OAuth override
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                              setGoogleSetupMessage(null);
                              setGoogleSettingsDraft({
                                clientId: "",
                                clientSecret: ""
                              });
                            }}
                            disabled={
                              saveGoogleSettingsMutation.isPending ||
                              (!savedGoogleSettingsDraft.clientId &&
                                !savedGoogleSettingsDraft.clientSecret &&
                                googleSettingsDraft.clientId.length === 0 &&
                                googleSettingsDraft.clientSecret.length === 0)
                            }
                          >
                            {savedGoogleSettingsDraft.clientId ||
                            savedGoogleSettingsDraft.clientSecret
                              ? "Clear override"
                              : "Use packaged default"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {googleSetupMessage ? (
                    <div className="mt-4 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/72">
                      {googleSetupMessage}
                    </div>
                  ) : null}

                  <div className="mt-4 rounded-[18px] border border-sky-400/20 bg-sky-400/10 px-4 py-3 text-sm leading-6 text-sky-50">
                    If you open Forge on a phone or another remote route,
                    Google redirects to localhost on that other device instead of
                    back to Forge.
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      onClick={() => void startGoogleFlow()}
                      disabled={
                        !activeGoogleSetup.isReadyForPairing ||
                        !googlePairingAllowedFromCurrentOrigin ||
                        hasUnsavedGoogleSettings ||
                        saveGoogleSettingsMutation.isPending
                      }
                      pending={googleSession?.status === "pending"}
                      pendingLabel="Waiting for Google"
                    >
                      <ExternalLink className="size-4" />
                      {googleSession?.status === "authorized"
                        ? "Sign in again"
                        : "Sign in with Google"}
                    </Button>
                    {googleSession?.accountLabel ? (
                      <Badge className="bg-emerald-500/16 text-emerald-100">
                        <CheckCircle2 className="mr-1 size-3.5" />
                        {googleSession.accountLabel}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : value.provider === "microsoft" ? (
              <div className="grid gap-4">
                <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(20,32,48,0.98),rgba(11,18,30,0.98))] p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-white">
                        Guided Microsoft setup
                      </div>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
                        Save the Microsoft app registration details for this
                        Forge instance here, optionally test them, then continue
                        into the Microsoft sign-in popup. Exchange Online stays
                        read-only for now.
                      </p>
                    </div>
                    <Badge className="bg-sky-400/12 text-sky-100">
                      Read only
                    </Badge>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <FlowField
                      label="Microsoft client ID"
                      description="Use the Application (client) ID from the Microsoft Entra app registration for this Forge instance."
                    >
                      <Input
                        value={microsoftSettingsDraft.clientId}
                        onChange={(event) => {
                          setMicrosoftSetupMessage(null);
                          setMicrosoftSettingsDraft((current) => ({
                            ...current,
                            clientId: event.target.value
                          }));
                        }}
                        placeholder="00000000-0000-0000-0000-000000000000"
                      />
                      {microsoftValidation.issues.clientId ? (
                        <div className="text-sm text-rose-300">
                          {microsoftValidation.issues.clientId}
                        </div>
                      ) : null}
                    </FlowField>

                    <FlowField
                      label="Tenant / authority"
                      description="Use common unless you need a tenant-specific authority."
                    >
                      <Input
                        value={microsoftSettingsDraft.tenantId}
                        onChange={(event) => {
                          setMicrosoftSetupMessage(null);
                          setMicrosoftSettingsDraft((current) => ({
                            ...current,
                            tenantId: event.target.value
                          }));
                        }}
                        placeholder="common"
                      />
                    </FlowField>
                  </div>

                  <FlowField
                    label="Redirect URI"
                    description="Register this exact Forge callback URI in the Microsoft app registration."
                  >
                    <Input
                      value={microsoftSettingsDraft.redirectUri}
                      onChange={(event) => {
                        setMicrosoftSetupMessage(null);
                        setMicrosoftSettingsDraft((current) => ({
                          ...current,
                          redirectUri: event.target.value
                        }));
                      }}
                      placeholder="http://127.0.0.1:4317/api/v1/calendar/oauth/microsoft/callback"
                    />
                    {microsoftValidation.issues.redirectUri ? (
                      <div className="text-sm text-rose-300">
                        {microsoftValidation.issues.redirectUri}
                      </div>
                    ) : null}
                  </FlowField>

                  <div className="mt-4 rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/68">
                    Forge saves the client ID, tenant, and redirect URI for this
                    local instance, then handles Microsoft sign-in in a popup.
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      onClick={() =>
                        void saveMicrosoftSettingsMutation.mutateAsync(
                          microsoftSettingsDraft
                        )
                      }
                      disabled={!microsoftValidation.isValid}
                      pending={saveMicrosoftSettingsMutation.isPending}
                      pendingLabel="Saving"
                    >
                      Save Microsoft settings
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        void testMicrosoftSettingsMutation.mutateAsync(
                          microsoftSettingsDraft
                        )
                      }
                      disabled={!microsoftValidation.isValid}
                      pending={testMicrosoftSettingsMutation.isPending}
                      pendingLabel="Testing"
                    >
                      Test Microsoft configuration
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void startMicrosoftFlow()}
                      disabled={
                        !microsoftValidation.isValid ||
                        hasUnsavedMicrosoftSettings ||
                        saveMicrosoftSettingsMutation.isPending
                      }
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
                      Save before sign-in. The Microsoft popup always uses the
                      latest saved client ID, tenant, and redirect URI.
                    </div>
                    <div className="rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/68">
                      After sign-in, Forge will let you choose which Exchange
                      Online calendars to mirror into the Calendar page.
                    </div>
                  </div>

                  {microsoftSetupMessage ? (
                    <div className="mt-4 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/72">
                      {microsoftSetupMessage}
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
            : draft.provider === "macos_local"
            ? "Select the host-machine calendars Forge should mirror into the Calendar page, then choose the host calendar Forge should write into for work blocks and timeboxes."
            : "Select the calendars Forge should mirror into the Calendar page, then choose the calendar Forge should write into for work blocks and timeboxes.",
        render: (value, setValue) => (
          <div className="grid gap-4">
            {value.provider === "google" ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  onClick={() => void startGoogleFlow()}
                  disabled={
                    !activeGoogleSetup.isReadyForPairing ||
                    !googlePairingAllowedFromCurrentOrigin
                  }
                  pending={googleSession?.status === "pending"}
                  pendingLabel="Waiting for Google"
                >
                  <ExternalLink className="size-4" />
                  {googleSession?.status === "authorized"
                    ? "Reconnect Google"
                    : "Sign in with Google"}
                </Button>
                {discovery ? (
                  <Badge className="bg-white/[0.08] text-white/74">
                    {discovery.calendars.length} discovered
                  </Badge>
                ) : null}
              </div>
            ) : value.provider === "microsoft" ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  onClick={() => void startMicrosoftFlow()}
                  disabled={
                    !microsoftValidation.isValid ||
                    hasUnsavedMicrosoftSettings ||
                    saveMicrosoftSettingsMutation.isPending
                  }
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
                  disabled={
                    value.provider === "macos_local" &&
                    macosStatus !== "full_access"
                  }
                >
                  <RefreshCcw className="size-4" />
                  {value.provider === "macos_local"
                    ? "Discover host calendars"
                    : "Discover calendars"}
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
                  {value.provider === "macos_local" ? "Discovered through the host calendar store" : "Discovered through"}{" "}
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
                              {readCalendarDisplayName(calendar)}
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
                {value.provider === "google" ? (
                  <>
                    Start the guided Google sign-in first. Forge will bring the
                    discovered Google calendars back here as soon as the popup
                    completes.
                  </>
                ) : value.provider === "microsoft" ? (
                  <>
                    Start the guided Microsoft sign-in first. Forge will bring the
                    discovered Exchange Online calendars back here as soon as the
                    popup completes.
                  </>
                ) : (
                  <>
                    {value.provider === "macos_local"
                      ? "Grant macOS Calendar access and discover the host calendars first. If Calendar.app already aggregates Google, Exchange, or iCloud for this Mac, Forge will pick them up here without reconnecting those accounts."
                      : (
                          <>
                            Discover calendars after entering the credentials. For Apple,
                            Forge starts from{" "}
                            <span className="font-medium text-white">
                              https://caldav.icloud.com
                            </span>{" "}
                            and resolves the principal plus calendar home automatically.
                          </>
                        )}
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
            {value.provider === "macos_local" && value.sourceId ? (
              <div className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/70">
                Selected host source:{" "}
                <span className="font-medium text-white">
                  {macosDiscovery?.sources.find((source) => source.sourceId === value.sourceId)?.accountLabel ??
                    macosDiscovery?.sources.find((source) => source.sourceId === value.sourceId)?.sourceTitle ??
                    value.sourceId}
                </span>
              </div>
            ) : null}
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
                      : value.provider === "macos_local"
                        ? "Calendars On This Mac"
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
              {value.replaceConnectionIds.length > 0 ? (
                <div className="mt-4 rounded-[20px] border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm leading-6 text-amber-50">
                  Forge will replace {value.replaceConnectionIds.length} older overlapping
                  connection{value.replaceConnectionIds.length === 1 ? "" : "s"} for this
                  same calendar account so only one visible copy remains.
                  {existingConnections
                    .filter((connection) => value.replaceConnectionIds.includes(connection.id))
                    .map((connection) => connection.label)
                    .join(", ")
                    ? ` ${existingConnections
                        .filter((connection) => value.replaceConnectionIds.includes(connection.id))
                        .map((connection) => connection.label)
                        .join(", ")}.`
                    : ""}
                </div>
              ) : null}
            </div>
          </div>
        )
      }
    ],
    [
      discovery,
      discoveryMutation.isPending,
      draft.provider,
      googleClientIdEditing,
      googleSettingsDraft,
      googleSession,
      activeGoogleSetup.clientId,
      googleSetupMessage,
      activeGoogleSetup.allowedOrigins,
      activeGoogleSetup.appBaseUrl,
      activeGoogleSetup.isLocalOnly,
      activeGoogleSetup.isReadyForPairing,
      activeGoogleSetup.redirectUri,
      googleRedirectOrigin,
      hasUnsavedGoogleSettings,
      googlePairingAllowedFromCurrentOrigin,
      googleWrongRouteMessage,
      hasUnsavedMicrosoftSettings,
      microsoftSettingsDraft,
      activeMicrosoftSetup.setupMessage,
      microsoftSetupMessage,
      microsoftValidation,
      saveGoogleSettingsMutation.isPending,
      saveMicrosoftSettingsMutation.isPending,
      savedMicrosoftSettingsDraft,
      testMicrosoftSettingsMutation.isPending,
      activeMicrosoftSetup.isReadyForSignIn,
      activeMicrosoftSetup.redirectUri,
      macosDiscovery,
      microsoftSession
    ]
  );

  const submitLabel =
    draft.provider === "macos_local" && draft.replaceConnectionIds.length > 0
      ? "Replace and connect"
      : "Connect provider";

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
        if (next.provider !== "macos_local") {
          setMacosDiscovery(null);
        }
      }}
      steps={steps}
      submitLabel={submitLabel}
      pending={pending}
      pendingLabel="Connecting"
      error={submitError}
      resolveError={inlineStepError}
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
            if (!googleSession?.sessionId || googleSession.status !== "authorized") {
              setSubmitError(
                "Complete the Google sign-in flow before saving this connection."
              );
              return;
            }
            await onSubmit({
              provider: "google",
              label: normalizeLabel("google", draft.label),
              authSessionId: googleSession.sessionId,
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
          } else if (draft.provider === "macos_local") {
            if (!draft.sourceId) {
              setSubmitError(
                "Choose which host calendar source Forge should connect before saving."
              );
              return;
            }
            await onSubmit({
              provider: "macos_local",
              label: normalizeLabel("macos_local", draft.label),
              sourceId: draft.sourceId,
              selectedCalendarUrls: draft.selectedCalendarUrls,
              forgeCalendarUrl: draft.forgeCalendarUrl,
              createForgeCalendar: draft.createForgeCalendar,
              replaceConnectionIds: draft.replaceConnectionIds
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
          if (
            error instanceof ForgeApiError &&
            error.code === "calendar_connection_overlap"
          ) {
            const response = (error as ForgeApiError & {
              response?: { overlappingConnectionIds?: unknown };
            }).response;
            const overlappingConnectionIds = Array.isArray(
              response?.overlappingConnectionIds
            )
              ? response?.overlappingConnectionIds.filter(
                  (entry): entry is string => typeof entry === "string"
                )
              : [];
            setDraft((current) => ({
              ...current,
              replaceConnectionIds: overlappingConnectionIds
            }));
            setSubmitError(
              `${error.message} Submit again to replace the older overlapping connection${overlappingConnectionIds.length === 1 ? "" : "s"}.`
            );
            return;
          }
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
