import { Cloud, ExternalLink, KeyRound, Link2, RefreshCcw } from "lucide-react";
import {
  FlowChoiceGrid,
  FlowField
} from "@/components/flows/question-flow-dialog";
import { CalendarSetupGuide } from "@/components/calendar/calendar-setup-guide";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { readCalendarDisplayName } from "@/lib/calendar-name-deduper";
import type {
  CalendarDiscoveryPayload,
  CalendarProvider,
  GoogleCalendarAuthSettings,
  GoogleCalendarOauthSession,
  MacOSCalendarAccessStatus,
  MacOSLocalCalendarDiscoveryPayload,
  MicrosoftCalendarOauthSession
} from "@/lib/types";
import {
  normalizeLabel,
  type ConnectionDraft,
  type ExistingCalendarConnection
} from "@/components/calendar/calendar-connection-flow-model";

type SetConnectionDraft = (patch: Partial<ConnectionDraft>) => void;

const PANEL_CLASS =
  "rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)]";
const MUTED_PANEL_CLASS =
  "rounded-[24px] border border-dashed border-[var(--ui-border-strong)] bg-[var(--ui-surface-1)]";
const REVIEW_PANEL_CLASS =
  "rounded-[26px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]";
const SOFT_CELL_CLASS =
  "rounded-[20px] bg-[var(--ui-surface-2)] px-4 py-3 text-sm text-[var(--ui-ink-soft)]";
const EYEBROW_CLASS =
  "text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]";
const BODY_TEXT_CLASS = "text-sm leading-6 text-[var(--ui-ink-soft)]";
const STRONG_TEXT_CLASS = "font-medium text-[var(--ui-ink-strong)]";
const META_BADGE_CLASS = "bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]";
const SUCCESS_BADGE_CLASS =
  "bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_74%,var(--ui-ink-strong)_26%)]";
const INFO_BADGE_CLASS =
  "bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_76%,var(--ui-ink-strong)_24%)]";
const WARNING_CALLOUT_CLASS =
  "rounded-[20px] border border-[var(--ui-warning-soft)] bg-[var(--ui-warning-soft)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-strong)]";
const INFO_CALLOUT_CLASS =
  "rounded-[24px] border border-[var(--ui-info-soft)] bg-[var(--ui-info-soft)] p-4 text-sm leading-6 text-[var(--ui-ink-strong)]";
const SUCCESS_CALLOUT_CLASS =
  "rounded-[24px] border border-[var(--ui-success-soft)] bg-[var(--ui-success-soft)] p-4 text-sm leading-6 text-[var(--ui-ink-strong)]";
const TOGGLE_SELECTED_CLASS =
  "border border-[color-mix(in_srgb,var(--primary)_34%,var(--ui-border-subtle)_66%)] bg-[var(--ui-accent-soft)] text-[var(--primary)]";
const TOGGLE_SUCCESS_CLASS =
  "border border-[var(--ui-success-soft)] bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_74%,var(--ui-ink-strong)_26%)]";
const TOGGLE_IDLE_CLASS =
  "border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)]";

export function CalendarConnectionProviderStep({
  value,
  onProviderChange
}: {
  value: ConnectionDraft;
  onProviderChange: (provider: CalendarProvider) => void;
}) {
  return (
    <div className="grid gap-5">
      <FlowField
        label="Provider"
        description="Each setup path is guided. Forge discovers calendars before anything is saved."
      >
        <FlowChoiceGrid
          value={value.provider}
          onChange={(next) => onProviderChange(next as CalendarProvider)}
          options={[
            {
              value: "google",
              label: "Google Calendar",
              description:
                "Use Google sign-in with Authorization Code + PKCE, let Forge exchange the code on the backend, and store a per-user refresh token server-side."
            },
            {
              value: "apple",
              label: "Apple Calendar",
              description:
                "Start from https://caldav.icloud.com and autodiscover calendars with your app password."
            },
            {
              value: "microsoft",
              label: "Exchange Online",
              description:
                "Save the Microsoft app registration fields in Settings, then sign in with Microsoft and mirror selected Exchange Online calendars in read-only mode."
            },
            {
              value: "macos_local",
              label: "Calendars On This Mac",
              description:
                "Use EventKit to access the calendars already configured in Calendar.app on this host machine and avoid reconnecting those same accounts manually."
            },
            {
              value: "caldav",
              label: "Custom CalDAV",
              description:
                "Use a CalDAV base URL for Nextcloud, Fastmail, Baikal, and other compatible providers."
            }
          ]}
        />
      </FlowField>

      <div className="grid gap-3 md:grid-cols-2">
        <div className={`${PANEL_CLASS} p-4`}>
          <div className="flex items-center gap-3 text-[var(--ui-ink-strong)]">
            <Cloud className="size-4 text-[var(--primary)]" />
            <div className="font-medium">Dedicated write calendar</div>
          </div>
          <p className={`mt-3 ${BODY_TEXT_CLASS}`}>
            {value.provider === "microsoft" ? (
              "Exchange Online is read-only for now. Forge mirrors selected calendars into Forge, but it does not publish work blocks or owned timeboxes back to Microsoft."
            ) : (
              <>
                Forge writes work blocks and owned timeboxes into a dedicated
                calendar named <span className={STRONG_TEXT_CLASS}>Forge</span>.
              </>
            )}
          </p>
        </div>
        <div className={`${PANEL_CLASS} p-4`}>
          <div className="flex items-center gap-3 text-[var(--ui-ink-strong)]">
            <KeyRound className="size-4 text-[var(--primary)]" />
            <div className="font-medium">Discovery first</div>
          </div>
          <p className={`mt-3 ${BODY_TEXT_CLASS}`}>
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

      <div className={`${PANEL_CLASS} p-4`}>
        <div className={EYEBROW_CLASS}>Setup guide</div>
        <p className={`mt-2 ${BODY_TEXT_CLASS}`}>
          These are the exact setup steps for the selected provider. They stay
          inside this guided flow so Settings can stay focused on connection
          health and actions.
        </p>
        <div className="mt-4">
          <CalendarSetupGuide provider={value.provider} compact />
        </div>
      </div>
    </div>
  );
}

export function CalendarConnectionDiscoveryStep({
  value,
  setValue,
  discovery,
  startGoogleFlow,
  startMicrosoftFlow,
  activeGoogleSetup,
  googlePairingAllowedFromCurrentOrigin,
  googleSession,
  microsoftValidation,
  hasUnsavedMicrosoftSettings,
  saveMicrosoftSettingsPending,
  microsoftSession,
  discoveryPending,
  runDiscovery,
  macosStatus,
  sharedForgeWriteTargetLabel
}: {
  value: ConnectionDraft;
  setValue: SetConnectionDraft;
  discovery: CalendarDiscoveryPayload | null;
  startGoogleFlow: () => void;
  startMicrosoftFlow: () => void;
  activeGoogleSetup: GoogleCalendarAuthSettings;
  googlePairingAllowedFromCurrentOrigin: boolean;
  googleSession: GoogleCalendarOauthSession | null;
  microsoftValidation: { isValid: boolean };
  hasUnsavedMicrosoftSettings: boolean;
  saveMicrosoftSettingsPending: boolean;
  microsoftSession: MicrosoftCalendarOauthSession | null;
  discoveryPending: boolean;
  runDiscovery: () => void;
  macosStatus: MacOSCalendarAccessStatus;
  sharedForgeWriteTargetLabel: string | null;
}) {
  return (
    <div className="grid gap-4">
      <CalendarConnectionDiscoveryActions
        value={value}
        discovery={discovery}
        startGoogleFlow={startGoogleFlow}
        startMicrosoftFlow={startMicrosoftFlow}
        activeGoogleSetup={activeGoogleSetup}
        googlePairingAllowedFromCurrentOrigin={
          googlePairingAllowedFromCurrentOrigin
        }
        googleSession={googleSession}
        microsoftValidation={microsoftValidation}
        hasUnsavedMicrosoftSettings={hasUnsavedMicrosoftSettings}
        saveMicrosoftSettingsPending={saveMicrosoftSettingsPending}
        microsoftSession={microsoftSession}
        discoveryPending={discoveryPending}
        runDiscovery={runDiscovery}
        macosStatus={macosStatus}
      />

      {discovery ? (
        <>
          <div className={`${PANEL_CLASS} p-4 ${BODY_TEXT_CLASS}`}>
            {value.provider === "macos_local"
              ? "Discovered through the host calendar store"
              : "Discovered through"}{" "}
            <span className={STRONG_TEXT_CLASS}>{discovery.serverUrl}</span>
            {discovery.homeUrl ? (
              <>
                {" "}
                · home set{" "}
                <span className={STRONG_TEXT_CLASS}>{discovery.homeUrl}</span>
              </>
            ) : null}
          </div>

          {value.provider !== "microsoft" && sharedForgeWriteTargetLabel ? (
            <div className={SUCCESS_CALLOUT_CLASS}>
              Forge already writes work blocks and owned timeboxes through{" "}
              <span className={STRONG_TEXT_CLASS}>
                {sharedForgeWriteTargetLabel}
              </span>
              . This connection only needs a mirror selection.
            </div>
          ) : null}

          <div className="grid gap-3">
            {discovery.calendars.map((calendar) => {
              const selected = value.selectedCalendarUrls.includes(
                calendar.url
              );
              const isWriteTarget = value.forgeCalendarUrl === calendar.url;
              return (
                <div key={calendar.url} className={`${PANEL_CLASS} p-4`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className={STRONG_TEXT_CLASS}>
                        {readCalendarDisplayName(calendar)}
                      </div>
                      <div className="mt-1 break-all text-sm text-[var(--ui-ink-soft)]">
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
                        <Badge className={META_BADGE_CLASS}>Primary</Badge>
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
                        selected ? TOGGLE_SELECTED_CLASS : TOGGLE_IDLE_CLASS
                      }`}
                    >
                      {selected ? "Mirrored" : "Mirror into Forge"}
                    </button>
                    {value.provider !== "microsoft" &&
                    !sharedForgeWriteTargetLabel ? (
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
                            ? TOGGLE_SUCCESS_CLASS
                            : TOGGLE_IDLE_CLASS
                        }`}
                      >
                        {isWriteTarget
                          ? "Forge writes here"
                          : "Use for Forge writes"}
                      </button>
                    ) : (
                      <Badge
                        className={
                          value.provider === "microsoft"
                            ? INFO_BADGE_CLASS
                            : META_BADGE_CLASS
                        }
                      >
                        {value.provider === "microsoft"
                          ? "Read only"
                          : "Shared target elsewhere"}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <CalendarConnectionDiscoveryWriteTarget
            value={value}
            setValue={setValue}
            sharedForgeWriteTargetLabel={sharedForgeWriteTargetLabel}
          />
        </>
      ) : (
        <CalendarConnectionDiscoveryEmptyState value={value} />
      )}
    </div>
  );
}

function CalendarConnectionDiscoveryActions({
  value,
  discovery,
  startGoogleFlow,
  startMicrosoftFlow,
  activeGoogleSetup,
  googlePairingAllowedFromCurrentOrigin,
  googleSession,
  microsoftValidation,
  hasUnsavedMicrosoftSettings,
  saveMicrosoftSettingsPending,
  microsoftSession,
  discoveryPending,
  runDiscovery,
  macosStatus
}: {
  value: ConnectionDraft;
  discovery: CalendarDiscoveryPayload | null;
  startGoogleFlow: () => void;
  startMicrosoftFlow: () => void;
  activeGoogleSetup: GoogleCalendarAuthSettings;
  googlePairingAllowedFromCurrentOrigin: boolean;
  googleSession: GoogleCalendarOauthSession | null;
  microsoftValidation: { isValid: boolean };
  hasUnsavedMicrosoftSettings: boolean;
  saveMicrosoftSettingsPending: boolean;
  microsoftSession: MicrosoftCalendarOauthSession | null;
  discoveryPending: boolean;
  runDiscovery: () => void;
  macosStatus: MacOSCalendarAccessStatus;
}) {
  if (value.provider === "google") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={startGoogleFlow}
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
          <Badge className={META_BADGE_CLASS}>
            {discovery.calendars.length} discovered
          </Badge>
        ) : null}
      </div>
    );
  }

  if (value.provider === "microsoft") {
    return (
      <div className="flex flex-wrap items-center gap-3">
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
            ? "Reconnect Microsoft"
            : "Sign in with Microsoft"}
        </Button>
        {discovery ? (
          <Badge className={META_BADGE_CLASS}>
            {discovery.calendars.length} discovered
          </Badge>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        pending={discoveryPending}
        pendingLabel="Discovering"
        onClick={runDiscovery}
        disabled={
          value.provider === "macos_local" && macosStatus !== "full_access"
        }
      >
        <RefreshCcw className="size-4" />
        {value.provider === "macos_local"
          ? "Discover host calendars"
          : "Discover calendars"}
      </Button>
      {discovery ? (
        <Badge className={META_BADGE_CLASS}>
          {discovery.calendars.length} discovered
        </Badge>
      ) : null}
    </div>
  );
}

function CalendarConnectionDiscoveryWriteTarget({
  value,
  setValue,
  sharedForgeWriteTargetLabel
}: {
  value: ConnectionDraft;
  setValue: SetConnectionDraft;
  sharedForgeWriteTargetLabel: string | null;
}) {
  if (value.provider !== "microsoft" && !sharedForgeWriteTargetLabel) {
    return (
      <div className={`${MUTED_PANEL_CLASS} p-4`}>
        <div className={STRONG_TEXT_CLASS}>No Forge calendar yet?</div>
        <p className={`mt-2 ${BODY_TEXT_CLASS}`}>
          If none of the discovered calendars should receive Forge-owned work
          blocks and timeboxes, let Forge create a dedicated calendar named{" "}
          <span className={STRONG_TEXT_CLASS}>Forge</span>.
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
                ? TOGGLE_SUCCESS_CLASS
                : TOGGLE_IDLE_CLASS
            }`}
          >
            {value.createForgeCalendar
              ? "Forge will create one"
              : "Create a new Forge calendar"}
          </button>
        </div>
      </div>
    );
  }

  if (value.provider === "microsoft") {
    return (
      <div className={INFO_CALLOUT_CLASS}>
        Exchange Online is connected through Microsoft Graph in read-only mode.
        Forge will mirror the calendars you select here, but it will keep work
        blocks and owned timeboxes local or publish them through another
        writable provider.
      </div>
    );
  }

  return (
    <div className={`${MUTED_PANEL_CLASS} p-4 ${BODY_TEXT_CLASS}`}>
      Forge will keep{" "}
      <span className={STRONG_TEXT_CLASS}>{sharedForgeWriteTargetLabel}</span>{" "}
      as the canonical write target instead of creating another Forge calendar
      on this connection.
    </div>
  );
}

function CalendarConnectionDiscoveryEmptyState({
  value
}: {
  value: ConnectionDraft;
}) {
  return (
    <div className={`${MUTED_PANEL_CLASS} px-4 py-6 ${BODY_TEXT_CLASS}`}>
      {value.provider === "google" ? (
        <>
          Start the guided Google sign-in first. Forge will bring the discovered
          Google calendars back here as soon as the popup completes.
        </>
      ) : value.provider === "microsoft" ? (
        <>
          Start the guided Microsoft sign-in first. Forge will bring the
          discovered Exchange Online calendars back here as soon as the popup
          completes.
        </>
      ) : (
        <>
          {value.provider === "macos_local" ? (
            "Grant macOS Calendar access and discover the host calendars first. If Calendar.app already aggregates Google, Exchange, or iCloud for this Mac, Forge will pick them up here without reconnecting those accounts."
          ) : (
            <>
              Discover calendars after entering the credentials. For Apple,
              Forge starts from{" "}
              <span className={STRONG_TEXT_CLASS}>
                https://caldav.icloud.com
              </span>{" "}
              and resolves the principal plus calendar home automatically.
            </>
          )}
        </>
      )}
    </div>
  );
}

export function CalendarConnectionReviewStep({
  value,
  macosDiscovery,
  existingConnections,
  sharedForgeWriteTargetLabel
}: {
  value: ConnectionDraft;
  macosDiscovery: MacOSLocalCalendarDiscoveryPayload | null;
  existingConnections: ExistingCalendarConnection[];
  sharedForgeWriteTargetLabel: string | null;
}) {
  return (
    <div className="grid gap-4">
      {value.provider === "macos_local" && value.sourceId ? (
        <div className={`${PANEL_CLASS} px-4 py-3 ${BODY_TEXT_CLASS}`}>
          Selected host source:{" "}
          <span className={STRONG_TEXT_CLASS}>
            {macosDiscovery?.sources.find(
              (source) => source.sourceId === value.sourceId
            )?.accountLabel ??
              macosDiscovery?.sources.find(
                (source) => source.sourceId === value.sourceId
              )?.sourceTitle ??
              value.sourceId}
          </span>
        </div>
      ) : null}
      <div className={`${REVIEW_PANEL_CLASS} p-5`}>
        <div className="flex items-center gap-3">
          <div className="rounded-[18px] bg-[var(--primary)]/14 p-3 text-[var(--primary)]">
            <Link2 className="size-4" />
          </div>
          <div>
            <div className="font-display text-xl text-[var(--ui-ink-strong)]">
              {normalizeLabel(value.provider, value.label)}
            </div>
            <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
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
          <div className={SOFT_CELL_CLASS}>
            Mirrored calendars:{" "}
            <span className={STRONG_TEXT_CLASS}>
              {value.selectedCalendarUrls.length}
            </span>
          </div>
          <div className={SOFT_CELL_CLASS}>
            Forge writes:{" "}
            <span className={STRONG_TEXT_CLASS}>
              {value.provider === "microsoft"
                ? "read only"
                : value.forgeCalendarUrl
                  ? "existing calendar"
                  : value.createForgeCalendar
                    ? "new Forge calendar"
                    : sharedForgeWriteTargetLabel
                      ? `shared target via ${sharedForgeWriteTargetLabel}`
                      : "not selected"}
            </span>
          </div>
        </div>
        {value.replaceConnectionIds.length > 0 ? (
          <div className={`mt-4 ${WARNING_CALLOUT_CLASS}`}>
            Forge will replace {value.replaceConnectionIds.length} older
            overlapping connection
            {value.replaceConnectionIds.length === 1 ? "" : "s"} for this same
            calendar account so only one visible copy remains.
            {existingConnections
              .filter((connection) =>
                value.replaceConnectionIds.includes(connection.id)
              )
              .map((connection) => connection.label)
              .join(", ")
              ? ` ${existingConnections
                  .filter((connection) =>
                    value.replaceConnectionIds.includes(connection.id)
                  )
                  .map((connection) => connection.label)
                  .join(", ")}.`
              : ""}
          </div>
        ) : null}
      </div>
    </div>
  );
}
