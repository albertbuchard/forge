import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { CalendarConnectionCredentialsStep } from "@/components/calendar/calendar-connection-credentials-step";
import {
  CalendarConnectionDiscoveryStep,
  CalendarConnectionProviderStep,
  CalendarConnectionReviewStep
} from "@/components/calendar/calendar-connection-flow-steps";
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
  MacOSCalendarAccessStatus,
  MacOSLocalCalendarDiscoveryPayload,
  CalendarProvider,
  GoogleCalendarAuthSettings,
  GoogleCalendarOauthSession,
  MicrosoftCalendarAuthSettings,
  MicrosoftCalendarOauthSession
} from "@/lib/types";
import {
  OAUTH_SESSION_POLL_INTERVAL_MS,
  buildGoogleClientIdMissingMessage,
  buildGoogleRouteErrorMessage,
  buildGoogleSettingsDraft,
  buildMicrosoftSettingsDraft,
  createDraft,
  describeGoogleRouteRequirement,
  isLoopbackHostname,
  normalizeGoogleSettingsDraft,
  normalizeLabel,
  normalizeMicrosoftSettingsDraft,
  sameGoogleSettingsDraft,
  sameMicrosoftSettingsDraft,
  sanitizeGoogleSetupMessage,
  validateGoogleSettingsDraft,
  validateMicrosoftSettingsDraft,
  type ConnectionDraft,
  type ExistingCalendarConnection,
  type GooglePopupMessage,
  type GoogleSettingsDraft,
  type MicrosoftPopupMessage,
  type MicrosoftSettingsDraft
} from "@/components/calendar/calendar-connection-flow-model";

export { describeGoogleRouteRequirement } from "@/components/calendar/calendar-connection-flow-model";

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
  const [draft, setDraft] = useState<ConnectionDraft>(() =>
    createDraft(initialProvider)
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<CalendarDiscoveryPayload | null>(
    null
  );
  const [macosStatus, setMacosStatus] =
    useState<MacOSCalendarAccessStatus>("not_determined");
  const [macosDiscovery, setMacosDiscovery] =
    useState<MacOSLocalCalendarDiscoveryPayload | null>(null);
  const [googleSession, setGoogleSession] =
    useState<GoogleCalendarOauthSession | null>(null);
  const [microsoftSession, setMicrosoftSession] =
    useState<MicrosoftCalendarOauthSession | null>(null);
  const [activeGoogleSetup, setActiveGoogleSetup] =
    useState<GoogleCalendarAuthSettings>(googleSetup);
  const [googleSettingsDraft, setGoogleSettingsDraft] =
    useState<GoogleSettingsDraft>(() => buildGoogleSettingsDraft(googleSetup));
  const [savedGoogleSettingsDraft, setSavedGoogleSettingsDraft] =
    useState<GoogleSettingsDraft>(() => buildGoogleSettingsDraft(googleSetup));
  const [googleClientIdEditing, setGoogleClientIdEditing] = useState(false);
  const [googleSetupMessage, setGoogleSetupMessage] = useState<string | null>(
    null
  );
  const [activeMicrosoftSetup, setActiveMicrosoftSetup] =
    useState<MicrosoftCalendarAuthSettings>(microsoftSetup);
  const [microsoftSettingsDraft, setMicrosoftSettingsDraft] =
    useState<MicrosoftSettingsDraft>(() =>
      buildMicrosoftSettingsDraft(microsoftSetup)
    );
  const [savedMicrosoftSettingsDraft, setSavedMicrosoftSettingsDraft] =
    useState<MicrosoftSettingsDraft>(() =>
      buildMicrosoftSettingsDraft(microsoftSetup)
    );
  const [microsoftSetupMessage, setMicrosoftSetupMessage] = useState<
    string | null
  >(null);
  const popupRef = useRef<Window | null>(null);

  const findSharedForgeWriteTarget = (excludeConnectionIds: string[] = []) => {
    const excluded = new Set(excludeConnectionIds);
    return (
      existingConnections.find((connection) => {
        if (excluded.has(connection.id)) {
          return false;
        }
        return (
          typeof connection.config?.forgeCalendarUrl === "string" &&
          connection.config.forgeCalendarUrl.trim().length > 0
        );
      }) ?? null
    );
  };

  const sharedForgeWriteTarget = useMemo(
    () =>
      draft.provider === "microsoft"
        ? null
        : findSharedForgeWriteTarget(draft.replaceConnectionIds),
    [draft.provider, draft.replaceConnectionIds, existingConnections]
  );
  const sharedForgeWriteTargetLabel = sharedForgeWriteTarget
    ? sharedForgeWriteTarget.accountLabel &&
      sharedForgeWriteTarget.accountLabel.trim().length > 0
      ? `${sharedForgeWriteTarget.label} · ${sharedForgeWriteTarget.accountLabel}`
      : sharedForgeWriteTarget.label
    : null;

  const applyServerSettings = (
    response: Awaited<ReturnType<typeof patchSettings>>
  ) => {
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
    const existingForge = payload.calendars.find(
      (calendar) => calendar.isForgeCandidate
    );
    setDraft((current) => {
      const sharedWriteTarget = findSharedForgeWriteTarget(
        current.replaceConnectionIds
      );
      return {
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
            : sharedWriteTarget
              ? null
              : (existingForge?.url ?? current.forgeCalendarUrl ?? null),
        createForgeCalendar:
          current.provider === "microsoft"
            ? false
            : sharedWriteTarget
              ? false
              : current.createForgeCalendar && !existingForge
      };
    });
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
    if (
      !open ||
      !discovery ||
      draft.provider === "microsoft" ||
      sharedForgeWriteTarget ||
      draft.forgeCalendarUrl ||
      draft.createForgeCalendar
    ) {
      return;
    }
    const existingForge = discovery.calendars.find(
      (calendar) => calendar.isForgeCandidate
    );
    if (!existingForge) {
      return;
    }
    setDraft((current) => {
      if (
        current.provider === "microsoft" ||
        current.forgeCalendarUrl ||
        current.createForgeCalendar ||
        findSharedForgeWriteTarget(current.replaceConnectionIds)
      ) {
        return current;
      }
      return {
        ...current,
        forgeCalendarUrl: existingForge.url
      };
    });
  }, [
    discovery,
    draft.createForgeCalendar,
    draft.forgeCalendarUrl,
    draft.provider,
    open,
    sharedForgeWriteTarget
  ]);

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
            discovery.sources.find(
              (source) => source.sourceId === draft.sourceId
            ) ??
            discovery.sources[0] ??
            null;
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
    onSuccess: ({ granted, status, message }) => {
      setMacosStatus(status);
      if (granted) {
        setSubmitError(null);
        return;
      }
      setSubmitError(
        message ??
          "Forge could not obtain Calendar access from macOS yet. Open System Settings > Privacy & Security > Calendars, allow Forge, then return here and click Check access."
      );
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
  }, [discoveryMutation, draft.provider, macosDiscovery, macosStatus, open]);

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
      const savedDraft = buildGoogleSettingsDraft(
        settings.calendarProviders.google
      );
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
  const googleWrongRouteMessage =
    currentBrowserOrigin && !googlePairingAllowedFromCurrentOrigin
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

    if (
      draft.provider === "google" &&
      (stepId === "credentials" || stepId === "discovery")
    ) {
      if (hasUnsavedGoogleSettings) {
        return "Save the Google OAuth credential change before starting sign-in.";
      }
      const googleBlockingMessages = [
        googleRouteError,
        googleSetupError
      ].filter((message): message is string => Boolean(message));
      if (googleBlockingMessages.length > 0) {
        return googleBlockingMessages.join("\n\n");
      }
    }

    if (draft.provider === "microsoft" && stepId === "credentials") {
      if (hasUnsavedMicrosoftSettings) {
        return "Save these Microsoft settings before starting sign-in.";
      }
      if (
        !hasUnsavedMicrosoftSettings &&
        !savedMicrosoftSettingsDraft.clientId &&
        !microsoftSetupMessage
      ) {
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
          <CalendarConnectionProviderStep
            value={value}
            onProviderChange={(provider) => {
              setDiscovery(null);
              setMacosDiscovery(null);
              setSubmitError(null);
              setMicrosoftSetupMessage(null);
              resetGoogleSession();
              resetMicrosoftSession();
              setValue(createDraft(provider));
            }}
          />
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
          <CalendarConnectionCredentialsStep
            value={value}
            setValue={setValue}
            macosStatus={macosStatus}
            macosDiscovery={macosDiscovery}
            requestMacosAccess={() => void macosAccessMutation.mutateAsync()}
            requestMacosAccessPending={macosAccessMutation.isPending}
            checkMacosStatus={() => void macosStatusMutation.mutateAsync()}
            checkMacosStatusPending={macosStatusMutation.isPending}
            runDiscovery={() => void discoveryMutation.mutateAsync()}
            discoveryPending={discoveryMutation.isPending}
            applyMacosSource={applyDiscoveryPayload}
            activeGoogleSetup={activeGoogleSetup}
            googleRedirectOrigin={googleRedirectOrigin}
            currentBrowserOrigin={currentBrowserOrigin}
            googleClientIdEditing={googleClientIdEditing}
            setGoogleClientIdEditing={setGoogleClientIdEditing}
            googleSettingsDraft={googleSettingsDraft}
            setGoogleSettingsDraft={setGoogleSettingsDraft}
            savedGoogleSettingsDraft={savedGoogleSettingsDraft}
            googleValidation={googleValidation}
            hasUnsavedGoogleSettings={hasUnsavedGoogleSettings}
            saveGoogleSettings={(nextDraft) =>
              void saveGoogleSettingsMutation.mutateAsync(nextDraft)
            }
            saveGoogleSettingsPending={saveGoogleSettingsMutation.isPending}
            googleSetupMessage={googleSetupMessage}
            setGoogleSetupMessage={setGoogleSetupMessage}
            startGoogleFlow={() => void startGoogleFlow()}
            googlePairingAllowedFromCurrentOrigin={
              googlePairingAllowedFromCurrentOrigin
            }
            googleSession={googleSession}
            microsoftSettingsDraft={microsoftSettingsDraft}
            setMicrosoftSettingsDraft={setMicrosoftSettingsDraft}
            microsoftValidation={microsoftValidation}
            hasUnsavedMicrosoftSettings={hasUnsavedMicrosoftSettings}
            saveMicrosoftSettings={(nextDraft) =>
              void saveMicrosoftSettingsMutation.mutateAsync(nextDraft)
            }
            saveMicrosoftSettingsPending={
              saveMicrosoftSettingsMutation.isPending
            }
            testMicrosoftSettings={(nextDraft) =>
              void testMicrosoftSettingsMutation.mutateAsync(nextDraft)
            }
            testMicrosoftSettingsPending={
              testMicrosoftSettingsMutation.isPending
            }
            microsoftSetupMessage={microsoftSetupMessage}
            setMicrosoftSetupMessage={setMicrosoftSetupMessage}
            startMicrosoftFlow={() => void startMicrosoftFlow()}
            microsoftSession={microsoftSession}
          />
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
              ? sharedForgeWriteTargetLabel
                ? `Select the host-machine calendars Forge should mirror into the Calendar page. Forge already writes work blocks and timeboxes through ${sharedForgeWriteTargetLabel}.`
                : "Select the host-machine calendars Forge should mirror into the Calendar page, then choose the host calendar Forge should write into for work blocks and timeboxes."
              : sharedForgeWriteTargetLabel
                ? `Select the calendars Forge should mirror into the Calendar page. Forge already writes work blocks and timeboxes through ${sharedForgeWriteTargetLabel}.`
                : "Select the calendars Forge should mirror into the Calendar page, then choose the calendar Forge should write into for work blocks and timeboxes.",
        render: (value, setValue) => (
          <CalendarConnectionDiscoveryStep
            value={value}
            setValue={setValue}
            discovery={discovery}
            startGoogleFlow={() => void startGoogleFlow()}
            startMicrosoftFlow={() => void startMicrosoftFlow()}
            activeGoogleSetup={activeGoogleSetup}
            googlePairingAllowedFromCurrentOrigin={
              googlePairingAllowedFromCurrentOrigin
            }
            googleSession={googleSession}
            microsoftValidation={microsoftValidation}
            hasUnsavedMicrosoftSettings={hasUnsavedMicrosoftSettings}
            saveMicrosoftSettingsPending={
              saveMicrosoftSettingsMutation.isPending
            }
            microsoftSession={microsoftSession}
            discoveryPending={discoveryMutation.isPending}
            runDiscovery={() => void discoveryMutation.mutateAsync()}
            macosStatus={macosStatus}
            sharedForgeWriteTargetLabel={sharedForgeWriteTargetLabel}
          />
        )
      },
      {
        id: "review",
        eyebrow: "Review",
        title: "Confirm what Forge will mirror and where it will write",
        description:
          "This keeps the sync model explicit before the provider connection is saved.",
        render: (value) => (
          <CalendarConnectionReviewStep
            value={value}
            macosDiscovery={macosDiscovery}
            existingConnections={existingConnections}
            sharedForgeWriteTargetLabel={sharedForgeWriteTargetLabel}
          />
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
      microsoftSession,
      sharedForgeWriteTarget,
      sharedForgeWriteTargetLabel
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
      description="Discover provider calendars first, choose which calendars Forge should mirror, and only choose a Forge write target when the runtime does not already have one."
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
      draftPersistenceKey="calendar.connection.new"
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
            setSubmitError(
              "Discover the available calendars before saving the connection."
            );
            return;
          }
          if (draft.selectedCalendarUrls.length === 0) {
            setSubmitError(
              "Select at least one calendar to mirror into Forge."
            );
            return;
          }
          if (
            draft.provider !== "microsoft" &&
            !draft.forgeCalendarUrl &&
            !draft.createForgeCalendar &&
            !sharedForgeWriteTarget
          ) {
            setSubmitError(
              "Choose the calendar Forge should write into, ask Forge to create one, or keep using the existing shared Forge write target."
            );
            return;
          }

          if (draft.provider === "google") {
            if (
              !googleSession?.sessionId ||
              googleSession.status !== "authorized"
            ) {
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
            if (
              !microsoftSession?.sessionId ||
              microsoftSession.status !== "authorized"
            ) {
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
            const response = (
              error as ForgeApiError & {
                response?: { overlappingConnectionIds?: unknown };
              }
            ).response;
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
