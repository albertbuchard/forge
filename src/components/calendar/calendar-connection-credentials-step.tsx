import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Pencil,
  RefreshCcw
} from "lucide-react";
import { FlowField } from "@/components/flows/question-flow-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Input } from "@/components/ui/input";
import type {
  CalendarDiscoveryPayload,
  GoogleCalendarAuthSettings,
  GoogleCalendarOauthSession,
  MacOSCalendarAccessStatus,
  MacOSLocalCalendarDiscoveryPayload,
  MicrosoftCalendarOauthSession
} from "@/lib/types";
import {
  PROVIDER_DEFAULTS,
  buildGoogleSettingsDraft,
  type ConnectionDraft,
  type GoogleSettingsDraft,
  type MicrosoftSettingsDraft
} from "@/components/calendar/calendar-connection-flow-model";

type SetConnectionDraft = (patch: Partial<ConnectionDraft>) => void;

type CalendarSettingsValidation<TDraft> = {
  issues: Partial<Record<keyof TDraft, string>>;
  isValid: boolean;
};

export function CalendarConnectionCredentialsStep({
  value,
  setValue,
  macosStatus,
  macosDiscovery,
  requestMacosAccess,
  requestMacosAccessPending,
  checkMacosStatus,
  checkMacosStatusPending,
  runDiscovery,
  discoveryPending,
  applyMacosSource,
  activeGoogleSetup,
  googleRedirectOrigin,
  currentBrowserOrigin,
  googleClientIdEditing,
  setGoogleClientIdEditing,
  googleSettingsDraft,
  setGoogleSettingsDraft,
  savedGoogleSettingsDraft,
  googleValidation,
  hasUnsavedGoogleSettings,
  saveGoogleSettings,
  saveGoogleSettingsPending,
  googleSetupMessage,
  setGoogleSetupMessage,
  startGoogleFlow,
  googlePairingAllowedFromCurrentOrigin,
  googleSession,
  microsoftSettingsDraft,
  setMicrosoftSettingsDraft,
  microsoftValidation,
  hasUnsavedMicrosoftSettings,
  saveMicrosoftSettings,
  saveMicrosoftSettingsPending,
  testMicrosoftSettings,
  testMicrosoftSettingsPending,
  microsoftSetupMessage,
  setMicrosoftSetupMessage,
  startMicrosoftFlow,
  microsoftSession
}: {
  value: ConnectionDraft;
  setValue: SetConnectionDraft;
  macosStatus: MacOSCalendarAccessStatus;
  macosDiscovery: MacOSLocalCalendarDiscoveryPayload | null;
  requestMacosAccess: () => void;
  requestMacosAccessPending: boolean;
  checkMacosStatus: () => void;
  checkMacosStatusPending: boolean;
  runDiscovery: () => void;
  discoveryPending: boolean;
  applyMacosSource: (payload: CalendarDiscoveryPayload) => void;
  activeGoogleSetup: GoogleCalendarAuthSettings;
  googleRedirectOrigin: string;
  currentBrowserOrigin: string;
  googleClientIdEditing: boolean;
  setGoogleClientIdEditing: (editing: boolean) => void;
  googleSettingsDraft: GoogleSettingsDraft;
  setGoogleSettingsDraft: (draft: GoogleSettingsDraft) => void;
  savedGoogleSettingsDraft: GoogleSettingsDraft;
  googleValidation: CalendarSettingsValidation<GoogleSettingsDraft>;
  hasUnsavedGoogleSettings: boolean;
  saveGoogleSettings: (draft: GoogleSettingsDraft) => void;
  saveGoogleSettingsPending: boolean;
  googleSetupMessage: string | null;
  setGoogleSetupMessage: (message: string | null) => void;
  startGoogleFlow: () => void;
  googlePairingAllowedFromCurrentOrigin: boolean;
  googleSession: GoogleCalendarOauthSession | null;
  microsoftSettingsDraft: MicrosoftSettingsDraft;
  setMicrosoftSettingsDraft: (draft: MicrosoftSettingsDraft) => void;
  microsoftValidation: CalendarSettingsValidation<MicrosoftSettingsDraft>;
  hasUnsavedMicrosoftSettings: boolean;
  saveMicrosoftSettings: (draft: MicrosoftSettingsDraft) => void;
  saveMicrosoftSettingsPending: boolean;
  testMicrosoftSettings: (draft: MicrosoftSettingsDraft) => void;
  testMicrosoftSettingsPending: boolean;
  microsoftSetupMessage: string | null;
  setMicrosoftSetupMessage: (message: string | null) => void;
  startMicrosoftFlow: () => void;
  microsoftSession: MicrosoftCalendarOauthSession | null;
}) {
  return (
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
        <MacOSLocalCredentialsPanel
          value={value}
          setValue={setValue}
          macosStatus={macosStatus}
          macosDiscovery={macosDiscovery}
          requestMacosAccess={requestMacosAccess}
          requestMacosAccessPending={requestMacosAccessPending}
          checkMacosStatus={checkMacosStatus}
          checkMacosStatusPending={checkMacosStatusPending}
          runDiscovery={runDiscovery}
          discoveryPending={discoveryPending}
          applyMacosSource={applyMacosSource}
        />
      ) : value.provider === "google" ? (
        <GoogleCredentialsPanel
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
          saveGoogleSettings={saveGoogleSettings}
          saveGoogleSettingsPending={saveGoogleSettingsPending}
          googleSetupMessage={googleSetupMessage}
          setGoogleSetupMessage={setGoogleSetupMessage}
          startGoogleFlow={startGoogleFlow}
          googlePairingAllowedFromCurrentOrigin={
            googlePairingAllowedFromCurrentOrigin
          }
          googleSession={googleSession}
        />
      ) : value.provider === "microsoft" ? (
        <MicrosoftCredentialsPanel
          microsoftSettingsDraft={microsoftSettingsDraft}
          setMicrosoftSettingsDraft={setMicrosoftSettingsDraft}
          microsoftValidation={microsoftValidation}
          hasUnsavedMicrosoftSettings={hasUnsavedMicrosoftSettings}
          saveMicrosoftSettings={saveMicrosoftSettings}
          saveMicrosoftSettingsPending={saveMicrosoftSettingsPending}
          testMicrosoftSettings={testMicrosoftSettings}
          testMicrosoftSettingsPending={testMicrosoftSettingsPending}
          microsoftSetupMessage={microsoftSetupMessage}
          setMicrosoftSetupMessage={setMicrosoftSetupMessage}
          startMicrosoftFlow={startMicrosoftFlow}
          microsoftSession={microsoftSession}
        />
      ) : (
        <CalDavCredentialsPanel value={value} setValue={setValue} />
      )}
    </div>
  );
}

function MacOSLocalCredentialsPanel({
  value,
  setValue,
  macosStatus,
  macosDiscovery,
  requestMacosAccess,
  requestMacosAccessPending,
  checkMacosStatus,
  checkMacosStatusPending,
  runDiscovery,
  discoveryPending,
  applyMacosSource
}: {
  value: ConnectionDraft;
  setValue: SetConnectionDraft;
  macosStatus: MacOSCalendarAccessStatus;
  macosDiscovery: MacOSLocalCalendarDiscoveryPayload | null;
  requestMacosAccess: () => void;
  requestMacosAccessPending: boolean;
  checkMacosStatus: () => void;
  checkMacosStatusPending: boolean;
  runDiscovery: () => void;
  discoveryPending: boolean;
  applyMacosSource: (payload: CalendarDiscoveryPayload) => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(20,32,48,0.98),rgba(11,18,30,0.98))] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-medium text-white">macOS Calendar access</div>
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
            onClick={requestMacosAccess}
            pending={requestMacosAccessPending}
            pendingLabel="Waiting for macOS"
          >
            <KeyRound className="size-4" />
            Request Calendar access
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={checkMacosStatus}
            pending={checkMacosStatusPending}
            pendingLabel="Checking"
          >
            <RefreshCcw className="size-4" />
            Check access
          </Button>
          <Button
            type="button"
            onClick={runDiscovery}
            disabled={macosStatus !== "full_access"}
            pending={discoveryPending}
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
                    applyMacosSource({
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
  );
}

function GoogleCredentialsPanel({
  activeGoogleSetup,
  googleRedirectOrigin,
  currentBrowserOrigin,
  googleClientIdEditing,
  setGoogleClientIdEditing,
  googleSettingsDraft,
  setGoogleSettingsDraft,
  savedGoogleSettingsDraft,
  googleValidation,
  hasUnsavedGoogleSettings,
  saveGoogleSettings,
  saveGoogleSettingsPending,
  googleSetupMessage,
  setGoogleSetupMessage,
  startGoogleFlow,
  googlePairingAllowedFromCurrentOrigin,
  googleSession
}: {
  activeGoogleSetup: GoogleCalendarAuthSettings;
  googleRedirectOrigin: string;
  currentBrowserOrigin: string;
  googleClientIdEditing: boolean;
  setGoogleClientIdEditing: (editing: boolean) => void;
  googleSettingsDraft: GoogleSettingsDraft;
  setGoogleSettingsDraft: (draft: GoogleSettingsDraft) => void;
  savedGoogleSettingsDraft: GoogleSettingsDraft;
  googleValidation: CalendarSettingsValidation<GoogleSettingsDraft>;
  hasUnsavedGoogleSettings: boolean;
  saveGoogleSettings: (draft: GoogleSettingsDraft) => void;
  saveGoogleSettingsPending: boolean;
  googleSetupMessage: string | null;
  setGoogleSetupMessage: (message: string | null) => void;
  startGoogleFlow: () => void;
  googlePairingAllowedFromCurrentOrigin: boolean;
  googleSession: GoogleCalendarOauthSession | null;
}) {
  const hasStoredGoogleOverride = Boolean(
    activeGoogleSetup.storedClientId || activeGoogleSetup.storedClientSecret
  );

  return (
    <div className="grid gap-4">
      <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(20,32,48,0.98),rgba(11,18,30,0.98))] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-medium text-white">
              How Google sign-in works
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
              Start the popup from the host running Forge. Google returns to
              Forge on localhost, Forge completes the PKCE exchange on the
              backend, then Forge discovers the calendars for that account.
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
                          hasStoredGoogleOverride
                            ? "bg-emerald-500/16 text-emerald-100"
                            : "bg-white/[0.08] text-white/72"
                        }
                      >
                        {hasStoredGoogleOverride
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
                    Save both the client ID and client secret only when this
                    Forge install should use a different Google desktop OAuth
                    app than the packaged default.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Done editing Google OAuth client"
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/72 transition hover:bg-white/[0.12] hover:text-white"
                  onClick={() => {
                    setGoogleSetupMessage(null);
                    setGoogleSettingsDraft(
                      buildGoogleSettingsDraft(activeGoogleSetup)
                    );
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
                  onClick={() => saveGoogleSettings(googleSettingsDraft)}
                  disabled={
                    !hasUnsavedGoogleSettings || !googleValidation.isValid
                  }
                  pending={saveGoogleSettingsPending}
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
                    saveGoogleSettingsPending ||
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
          If you open Forge on a phone or another remote route, Google redirects
          to localhost on that other device instead of back to Forge.
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={startGoogleFlow}
            disabled={
              !activeGoogleSetup.isReadyForPairing ||
              !googlePairingAllowedFromCurrentOrigin ||
              hasUnsavedGoogleSettings ||
              saveGoogleSettingsPending
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
  );
}

function MicrosoftCredentialsPanel({
  microsoftSettingsDraft,
  setMicrosoftSettingsDraft,
  microsoftValidation,
  hasUnsavedMicrosoftSettings,
  saveMicrosoftSettings,
  saveMicrosoftSettingsPending,
  testMicrosoftSettings,
  testMicrosoftSettingsPending,
  microsoftSetupMessage,
  setMicrosoftSetupMessage,
  startMicrosoftFlow,
  microsoftSession
}: {
  microsoftSettingsDraft: MicrosoftSettingsDraft;
  setMicrosoftSettingsDraft: (draft: MicrosoftSettingsDraft) => void;
  microsoftValidation: CalendarSettingsValidation<MicrosoftSettingsDraft>;
  hasUnsavedMicrosoftSettings: boolean;
  saveMicrosoftSettings: (draft: MicrosoftSettingsDraft) => void;
  saveMicrosoftSettingsPending: boolean;
  testMicrosoftSettings: (draft: MicrosoftSettingsDraft) => void;
  testMicrosoftSettingsPending: boolean;
  microsoftSetupMessage: string | null;
  setMicrosoftSetupMessage: (message: string | null) => void;
  startMicrosoftFlow: () => void;
  microsoftSession: MicrosoftCalendarOauthSession | null;
}) {
  return (
    <div className="grid gap-4">
      <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(20,32,48,0.98),rgba(11,18,30,0.98))] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-medium text-white">Guided Microsoft setup</div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
              Save the Microsoft app registration details for this Forge
              instance here, optionally test them, then continue into the
              Microsoft sign-in popup. Exchange Online stays read-only for now.
            </p>
          </div>
          <Badge className="bg-sky-400/12 text-sky-100">Read only</Badge>
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
                setMicrosoftSettingsDraft({
                  ...microsoftSettingsDraft,
                  clientId: event.target.value
                });
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
                setMicrosoftSettingsDraft({
                  ...microsoftSettingsDraft,
                  tenantId: event.target.value
                });
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
              setMicrosoftSettingsDraft({
                ...microsoftSettingsDraft,
                redirectUri: event.target.value
              });
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
          Forge saves the client ID, tenant, and redirect URI for this local
          instance, then handles Microsoft sign-in in a popup.
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={() => saveMicrosoftSettings(microsoftSettingsDraft)}
            disabled={!microsoftValidation.isValid}
            pending={saveMicrosoftSettingsPending}
            pendingLabel="Saving"
          >
            Save Microsoft settings
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => testMicrosoftSettings(microsoftSettingsDraft)}
            disabled={!microsoftValidation.isValid}
            pending={testMicrosoftSettingsPending}
            pendingLabel="Testing"
          >
            Test Microsoft configuration
          </Button>
          <Button
            type="button"
            onClick={startMicrosoftFlow}
            disabled={
              !microsoftValidation.isValid ||
              hasUnsavedMicrosoftSettings ||
              saveMicrosoftSettingsPending
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
            Save before sign-in. The Microsoft popup always uses the latest
            saved client ID, tenant, and redirect URI.
          </div>
          <div className="rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/68">
            After sign-in, Forge will let you choose which Exchange Online
            calendars to mirror into the Calendar page.
          </div>
        </div>

        {microsoftSetupMessage ? (
          <div className="mt-4 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/72">
            {microsoftSetupMessage}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CalDavCredentialsPanel({
  value,
  setValue
}: {
  value: ConnectionDraft;
  setValue: SetConnectionDraft;
}) {
  return (
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
        label={
          value.provider === "apple"
            ? "App-specific password"
            : "Password or app password"
        }
      >
        <Input
          type="password"
          value={value.password}
          onChange={(event) => setValue({ password: event.target.value })}
          placeholder="Password"
        />
      </FlowField>
    </>
  );
}
