import { createHash, randomBytes, randomUUID } from "node:crypto";
import { CryptoProvider, PublicClientApplication } from "@azure/msal-node";
import ical from "node-ical";
import {
  getGoogleCalendarOauthCallbackPath,
  isGoogleCalendarOriginAllowed,
  resolveGoogleCalendarOauthPrivateConfig
} from "./google-calendar-oauth-config.js";
import {
  createDAVClient,
  DAVNamespaceShort,
  type DAVCalendar,
  type DAVCalendarObject
} from "tsdav";
import { SecretsManager } from "../managers/platform/secrets-manager.js";
import { getSettings } from "../repositories/settings.js";
import {
  createCalendarConnectionRecord,
  deleteCalendarConnectionRecord,
  deleteEncryptedSecret,
  deleteExternalEventsForConnection,
  detachConnectionFromForgeEvents,
  getCalendarById,
  getCalendarConnectionById,
  getCalendarEventStorageRecord,
  getPrimaryCalendarEventSource,
  getCalendarOverview,
  listCalendarConnections,
  listCalendarEventSources,
  listCalendars,
  listTaskTimeboxes,
  markCalendarEventSourcesSyncState,
  readEncryptedSecret,
  registerCalendarEventSourceProjection,
  recordCalendarActivity,
  storeEncryptedSecret,
  updateCalendarEvent,
  updateCalendarConnectionRecord,
  updateTaskTimebox,
  upsertCalendarEventRecord,
  upsertCalendarRecord,
  type CalendarConnectionCredentialsRecord,
  type CalendarSyncCalendarInput,
  type CalendarSyncEventInput
} from "../repositories/calendar.js";
import type {
  ActivitySource,
  CalendarConnection,
  CalendarDiscoveryPayload,
  GoogleCalendarOauthSession,
  MicrosoftCalendarOauthSession,
  CalendarOverviewPayload,
  CreateCalendarConnectionInput,
  DiscoverCalendarConnectionInput,
  StartGoogleCalendarOauthInput,
  StartMicrosoftCalendarOauthInput,
  TestMicrosoftCalendarOauthConfigurationInput
} from "../types.js";

type ActivityContext = {
  source: ActivitySource;
  actor?: string | null;
};

type GoogleCredentials = {
  provider: "google";
  serverUrl: string;
  username: string;
  refreshToken: string;
  accessTokenExpiresAt: string | null;
  grantedScopes: string[];
  selectedCalendarUrls: string[];
  forgeCalendarUrl: string;
};

type LegacyGoogleCredentials = GoogleCredentials & {
  clientId?: string;
  clientSecret?: string;
};

type AppleCredentials = {
  provider: "apple";
  serverUrl: string;
  username: string;
  password: string;
  selectedCalendarUrls: string[];
  forgeCalendarUrl: string;
};

type CustomCaldavCredentials = {
  provider: "caldav";
  serverUrl: string;
  username: string;
  password: string;
  selectedCalendarUrls: string[];
  forgeCalendarUrl: string;
};

type MicrosoftCredentials = {
  provider: "microsoft";
  serverUrl: string;
  username: string;
  clientId: string;
  tenantId: string;
  authority: string;
  homeAccountId: string;
  tokenCache: string;
  selectedCalendarUrls: string[];
};

type StoredCalendarCredentials =
  | LegacyGoogleCredentials
  | AppleCredentials
  | CustomCaldavCredentials
  | MicrosoftCredentials;

type WritableCalendarCredentials =
  | GoogleCredentials
  | AppleCredentials
  | CustomCaldavCredentials;

type DiscoverableCredentials =
  | Omit<GoogleCredentials, "selectedCalendarUrls" | "forgeCalendarUrl">
  | Omit<AppleCredentials, "selectedCalendarUrls" | "forgeCalendarUrl">
  | Omit<CustomCaldavCredentials, "selectedCalendarUrls" | "forgeCalendarUrl">;

type MicrosoftGraphCalendar = {
  id: string;
  name: string;
  color?: string | null;
  canEdit?: boolean;
  owner?: {
    name?: string | null;
    address?: string | null;
  };
};

type MicrosoftGraphEvent = {
  id: string;
  subject?: string | null;
  bodyPreview?: string | null;
  location?: {
    displayName?: string | null;
  } | null;
  start?: {
    dateTime?: string | null;
    timeZone?: string | null;
  } | null;
  end?: {
    dateTime?: string | null;
    timeZone?: string | null;
  } | null;
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string | null;
  categories?: string[] | null;
  iCalUId?: string | null;
  lastModifiedDateTime?: string | null;
};

type DavProviderState = {
  mode: "dav";
  client: Awaited<ReturnType<typeof createDAVClient>>;
  account: {
    serverUrl: string;
    principalUrl?: string;
    homeUrl?: string;
  };
  calendars: DAVCalendar[];
  accountLabel: string;
  serverUrl: string;
};

type MicrosoftProviderState = {
  mode: "microsoft";
  accessToken: string;
  accountLabel: string;
  serverUrl: string;
  principalUrl?: string | null;
  homeUrl?: string | null;
  calendars: MicrosoftGraphCalendar[];
  primaryCalendarId: string | null;
  credentials: MicrosoftCredentials;
};

type ProviderState = DavProviderState | MicrosoftProviderState;

function isWritableCalendarCredentials(
  credentials: StoredCalendarCredentials
): credentials is WritableCalendarCredentials {
  return credentials.provider !== "microsoft";
}

const GOOGLE_CALDAV_URL = "https://apidata.googleusercontent.com/caldav/v2/";
const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_CALLBACK_PATH = getGoogleCalendarOauthCallbackPath();
const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar"
];
const APPLE_CALDAV_URL = "https://caldav.icloud.com";
const MICROSOFT_GRAPH_URL = "https://graph.microsoft.com/v1.0";
const MICROSOFT_LOGIN_URL = "https://login.microsoftonline.com";
const MICROSOFT_CALLBACK_PATH = "/api/v1/calendar/oauth/microsoft/callback";
const MICROSOFT_GRAPH_SCOPES = ["User.Read", "Calendars.Read", "offline_access"];
const MICROSOFT_CLIENT_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const FORGE_CALENDAR_NAME = "Forge";
const FORGE_CALENDAR_COLOR = "#7dd3fc";

type MicrosoftOauthPendingSession = {
  sessionId: string;
  state: string;
  label: string | null;
  origin: string;
  redirectUri: string;
  clientId: string;
  authority: string;
  tenantId: string;
  codeVerifier: string | null;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "authorized" | "error" | "consumed" | "expired";
  authUrl: string | null;
  accountLabel: string | null;
  error: string | null;
  discovery: CalendarDiscoveryPayload | null;
  credentials: MicrosoftCredentials | null;
};

const microsoftOauthSessions = new Map<string, MicrosoftOauthPendingSession>();

type GoogleOauthPendingSession = {
  sessionId: string;
  state: string;
  label: string | null;
  openerOrigin: string;
  requestBaseOrigin: string;
  redirectUri: string;
  appUrl: string;
  clientId: string;
  codeVerifier: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "authorized" | "error" | "consumed" | "expired";
  authUrl: string | null;
  accountLabel: string | null;
  error: string | null;
  discovery: CalendarDiscoveryPayload | null;
  credentials: Omit<GoogleCredentials, "selectedCalendarUrls" | "forgeCalendarUrl"> | null;
};

const googleOauthSessions = new Map<string, GoogleOauthPendingSession>();

type MicrosoftOauthConfig = {
  clientId: string;
  tenantId: string;
  redirectUri: string;
  authority: string;
  source: "settings" | "env";
};

export class CalendarConnectionConflictError extends Error {
  connectionId: string;

  constructor(message: string, connectionId: string) {
    super(message);
    this.name = "CalendarConnectionConflictError";
    this.connectionId = connectionId;
  }
}

function requireSecretRecord<T extends CalendarConnectionCredentialsRecord>(
  secrets: SecretsManager,
  secretId: string
) {
  const cipherText = readEncryptedSecret(secretId);
  if (!cipherText) {
    throw new Error(`Missing stored secret ${secretId}`);
  }
  return secrets.openJson<T>(cipherText);
}

function microsoftAuthority(tenantId: string) {
  return `${MICROSOFT_LOGIN_URL}/${encodeURIComponent(tenantId || "common")}`;
}

function defaultMicrosoftRedirectUri() {
  const port = process.env.PORT?.trim() || "4317";
  return `http://127.0.0.1:${port}${MICROSOFT_CALLBACK_PATH}`;
}

function validateMicrosoftRedirectUri(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Microsoft redirect URI must be a full URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Microsoft redirect URI must use http or https.");
  }

  if (url.pathname !== MICROSOFT_CALLBACK_PATH) {
    throw new Error(
      `Microsoft redirect URI must end with ${MICROSOFT_CALLBACK_PATH}.`
    );
  }

  return url.toString();
}

function normalizeMicrosoftRedirectUri(value: string | null | undefined) {
  const trimmed = value?.trim();
  return validateMicrosoftRedirectUri(
    trimmed && trimmed.length > 0 ? trimmed : defaultMicrosoftRedirectUri()
  );
}

function normalizeMicrosoftTenantId(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "common";
}

function validateMicrosoftClientId(value: string) {
  const trimmed = value.trim();
  if (!MICROSOFT_CLIENT_ID_PATTERN.test(trimmed)) {
    throw new Error(
      "Microsoft client IDs must use the standard app registration GUID format."
    );
  }
  return trimmed;
}

function resolveStoredMicrosoftOAuthSettings() {
  return getSettings().calendarProviders.microsoft;
}

function resolveMicrosoftOAuthConfig(
  override?: Pick<TestMicrosoftCalendarOauthConfigurationInput, "clientId" | "tenantId" | "redirectUri">
) {
  const fromSettings = resolveStoredMicrosoftOAuthSettings();
  const rawSettingsClientId = override?.clientId?.trim() ?? fromSettings.clientId.trim();
  const settingsTenantId = normalizeMicrosoftTenantId(
    override?.tenantId ?? fromSettings.tenantId
  );
  const settingsRedirectUri = normalizeMicrosoftRedirectUri(
    override?.redirectUri ?? fromSettings.redirectUri
  );

  if (rawSettingsClientId.length > 0) {
    const settingsClientId = validateMicrosoftClientId(rawSettingsClientId);
    return {
      clientId: settingsClientId,
      tenantId: settingsTenantId,
      redirectUri: settingsRedirectUri,
      authority: microsoftAuthority(settingsTenantId),
      source: "settings"
    } satisfies MicrosoftOauthConfig;
  }

  const envClientId = process.env.FORGE_MICROSOFT_CLIENT_ID?.trim() ?? "";
  const envTenantId = normalizeMicrosoftTenantId(process.env.FORGE_MICROSOFT_TENANT_ID);
  const envRedirectUri = normalizeMicrosoftRedirectUri(process.env.FORGE_MICROSOFT_REDIRECT_URI);
  if (envClientId.length > 0) {
    const normalizedEnvClientId = validateMicrosoftClientId(envClientId);
    return {
      clientId: normalizedEnvClientId,
      tenantId: envTenantId,
      redirectUri: envRedirectUri,
      authority: microsoftAuthority(envTenantId),
      source: "env"
    } satisfies MicrosoftOauthConfig;
  }

  throw new Error(
    "Microsoft sign-in is not configured yet. Open Settings -> Calendar, save the Microsoft client ID and redirect URI for this Forge runtime, then try again."
  );
}

function createMicrosoftPublicClient(config: Pick<MicrosoftOauthConfig, "clientId" | "authority">) {
  return new PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: config.authority
    }
  });
}

function pruneMicrosoftOauthSessions() {
  const now = Date.now();
  for (const [sessionId, session] of microsoftOauthSessions.entries()) {
    if (new Date(session.expiresAt).getTime() <= now) {
      microsoftOauthSessions.set(sessionId, { ...session, status: "expired" });
    }
    if (
      session.status === "expired" ||
      session.status === "consumed" ||
      new Date(session.expiresAt).getTime() <= now - 5 * 60 * 1000
    ) {
      microsoftOauthSessions.delete(sessionId);
    }
  }
}

function pruneGoogleOauthSessions() {
  const now = Date.now();
  for (const [sessionId, session] of googleOauthSessions.entries()) {
    if (new Date(session.expiresAt).getTime() <= now) {
      googleOauthSessions.set(sessionId, { ...session, status: "expired" });
    }
    if (
      session.status === "expired" ||
      session.status === "consumed" ||
      new Date(session.expiresAt).getTime() <= now - 5 * 60 * 1000
    ) {
      googleOauthSessions.delete(sessionId);
    }
  }
}

function encodeBase64Url(value: Buffer | string) {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function buildPkcePair() {
  const verifier = encodeBase64Url(randomBytes(32));
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function normalizeRequestOrigin(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function googleOauthStartRejectionMessage(config: {
  appUrl: string;
  allowedOrigins: string[];
}) {
  const allowed = config.allowedOrigins.join(", ");
  return `Google Calendar pairing is only available from the configured host: ${config.appUrl}. Open Forge on the main machine or use one of the allowed browser origins (${allowed}) so Google can redirect back correctly.`;
}

function ensureGoogleOauthStartAllowed(input: {
  openerOrigin: string | null;
  requestBaseOrigin: string;
}) {
  const config = resolveGoogleCalendarOauthPrivateConfig();
  const openerOrigin = normalizeRequestOrigin(input.openerOrigin);
  const requestBaseOrigin = normalizeRequestOrigin(input.requestBaseOrigin);
  const baseMatchesApp = requestBaseOrigin === config.appUrl;
  const openerAllowed =
    openerOrigin !== null &&
    isGoogleCalendarOriginAllowed(openerOrigin, config.allowedOrigins);
  const pairingAllowed = config.isConfigured && baseMatchesApp && openerAllowed;

  recordCalendarActivity(
    "calendar_google_oauth_start_checked",
    "calendar_connection",
    "google_oauth",
    "Google OAuth start checked",
    pairingAllowed
      ? "Forge accepted a Google OAuth start request."
      : "Forge rejected a Google OAuth start request.",
    { source: "system", actor: null },
    {
      configured: config.isConfigured,
      pairingAllowed,
      openerOrigin,
      requestBaseOrigin,
      appUrl: config.appUrl,
      redirectUri: config.redirectUri
    }
  );

  if (!config.isConfigured) {
    throw new Error(config.setupMessage);
  }

  if (!baseMatchesApp || !openerAllowed) {
    throw new Error(googleOauthStartRejectionMessage(config));
  }

  return {
    config,
    openerOrigin: openerOrigin!,
    requestBaseOrigin: requestBaseOrigin!
  };
}

function toGoogleOauthSessionPayload(
  session: GoogleOauthPendingSession
): GoogleCalendarOauthSession {
  return {
    sessionId: session.sessionId,
    status: session.status,
    authUrl: session.authUrl,
    accountLabel: session.accountLabel,
    error: session.error,
    discovery: session.discovery
  };
}

function explainGoogleOauthError(input: {
  error?: string | null;
  errorDescription?: string | null;
  redirectUri: string;
  appUrl: string;
}) {
  const raw = `${input.error ?? ""} ${input.errorDescription ?? ""}`.toLowerCase();

  if (raw.includes("redirect_uri_mismatch")) {
    return `Google rejected the redirect URI. Register exactly ${input.redirectUri} in Google Cloud Console, then open Forge on ${input.appUrl} or one of the allowed local browser origins before trying again.`;
  }
  if (raw.includes("access_denied") || raw.includes("cancel")) {
    return "Google consent was denied or cancelled. Retry the Google sign-in and grant the requested calendar access.";
  }
  if (raw.includes("invalid_scope")) {
    return "Google rejected the requested calendar scopes. Confirm the Calendar API is enabled and the consent screen includes the requested Calendar scopes.";
  }
  return input.errorDescription?.trim() || input.error?.trim() || "Google sign-in could not be completed.";
}

function mapGoogleRuntimeError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Google calendar sync failed.";
  const raw = message.toLowerCase();

  if (raw.includes("invalid_grant")) {
    return new Error(
      "The stored Google refresh token is missing, expired, or revoked. Reconnect Google Calendar from Settings so Forge can keep syncing."
    );
  }
  if (raw.includes("invalid_client") || raw.includes("unauthorized_client")) {
    return new Error(
      "The shared Google OAuth app credentials were rejected. Check GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and the registered redirect URI."
    );
  }
  if (raw.includes("redirect_uri_mismatch")) {
    return new Error(
      "Google rejected the configured redirect URI. Register the exact Forge callback URI in Google Cloud Console and reconnect Google Calendar."
    );
  }
  return error instanceof Error ? error : new Error(message);
}

function normalizeUrl(value: string) {
  const url = new URL(value);
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  return url.toString();
}

function normalizeAccountIdentity(value: string) {
  return value.trim().toLowerCase();
}

function safeDisplayName(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
}

function isForgeName(value: string) {
  return value.trim().toLowerCase() === FORGE_CALENDAR_NAME.toLowerCase();
}

function normalizeTimezone(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : "UTC";
}

function buildEventIcs(payload: {
  uid: string;
  title: string;
  startsAt: string;
  endsAt: string;
  description?: string;
}) {
  const dt = (value: string) =>
    value.replaceAll(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Forge//Calendar//EN",
    "BEGIN:VEVENT",
    `UID:${payload.uid}`,
    `DTSTAMP:${dt(new Date().toISOString())}`,
    `DTSTART:${dt(payload.startsAt)}`,
    `DTEND:${dt(payload.endsAt)}`,
    `SUMMARY:${payload.title}`,
    `DESCRIPTION:${payload.description ?? ""}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}

function microsoftCalendarUrl(calendarId: string) {
  return `${MICROSOFT_GRAPH_URL}/me/calendars/${encodeURIComponent(calendarId)}`;
}

function microsoftEventUrl(calendarId: string, eventId: string) {
  return `${MICROSOFT_GRAPH_URL}/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
}

function microsoftColorToHex(color: string | null | undefined) {
  switch ((color ?? "").toLowerCase()) {
    case "lightblue":
      return "#7dd3fc";
    case "lightgreen":
      return "#86efac";
    case "lightorange":
      return "#fdba74";
    case "lightgray":
      return "#cbd5e1";
    case "lightyellow":
      return "#fde68a";
    case "lightteal":
      return "#5eead4";
    case "lightpink":
      return "#f9a8d4";
    case "lightbrown":
      return "#d6a77a";
    case "lightred":
      return "#fca5a5";
    case "maxcolor":
      return "#60a5fa";
    case "autocolor":
    default:
      return FORGE_CALENDAR_COLOR;
  }
}

function microsoftGraphError(
  statusCode: number,
  payload: unknown,
  fallback: string
) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "object" &&
    payload.error !== null &&
    "message" in payload.error &&
    typeof payload.error.message === "string" &&
    payload.error.message.trim().length > 0
  ) {
    return new Error(payload.error.message);
  }
  return new Error(`${fallback} (HTTP ${statusCode})`);
}

async function fetchMicrosoftCollection<T>(
  accessToken: string,
  initialUrl: string
): Promise<T[]> {
  const values: T[] = [];
  let nextUrl: string | null = initialUrl;

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });
    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw microsoftGraphError(response.status, payload, "Microsoft Graph request failed");
    }
    const pageValues = Array.isArray(payload.value) ? (payload.value as T[]) : [];
    values.push(...pageValues);
    nextUrl = typeof payload["@odata.nextLink"] === "string" ? payload["@odata.nextLink"] : null;
  }

  return values;
}

function parseMicrosoftDateTime(
  value: { dateTime?: string | null; timeZone?: string | null } | null | undefined
) {
  if (!value?.dateTime || value.dateTime.trim().length === 0) {
    return null;
  }
  const candidate = new Date(value.dateTime);
  if (!Number.isNaN(candidate.getTime())) {
    return candidate.toISOString();
  }
  return null;
}

function mapMicrosoftEventToSyncInput(
  calendarId: string,
  event: MicrosoftGraphEvent
): CalendarSyncEventInput | null {
  const startAt = parseMicrosoftDateTime(event.start);
  const endAt = parseMicrosoftDateTime(event.end);
  if (!startAt || !endAt) {
    return null;
  }

  return {
    calendarRemoteId: microsoftCalendarUrl(calendarId),
    remoteId: event.id,
    remoteHref: microsoftEventUrl(calendarId, event.id),
    remoteEtag: null,
    ownership: "external",
    status: event.isCancelled ? "cancelled" : "confirmed",
    title:
      typeof event.subject === "string" && event.subject.trim().length > 0
        ? event.subject
        : "(untitled event)",
    description:
      typeof event.bodyPreview === "string" ? event.bodyPreview : "",
    location:
      typeof event.location?.displayName === "string" ? event.location.displayName : "",
    startAt,
    endAt,
    isAllDay: Boolean(event.isAllDay),
    availability: event.showAs === "free" ? "free" : "busy",
    eventType: "",
    categories: Array.isArray(event.categories) ? event.categories.filter((value) => typeof value === "string") : [],
    rawPayload: event as Record<string, unknown>,
    remoteUpdatedAt:
      typeof event.lastModifiedDateTime === "string" ? event.lastModifiedDateTime : null,
    deletedAt: event.isCancelled ? new Date().toISOString() : null
  };
}

async function createProviderClient(
  credentials: DiscoverableCredentials | StoredCalendarCredentials
): Promise<ProviderState> {
  if (credentials.provider === "microsoft") {
    const client = createMicrosoftPublicClient({
      clientId: credentials.clientId,
      authority: credentials.authority
    });
    await client.getTokenCache().deserialize(credentials.tokenCache);
    const account =
      (await client.getTokenCache().getAccountByHomeId(credentials.homeAccountId)) ??
      (await client.getTokenCache().getAllAccounts())[0] ??
      null;
    if (!account) {
      throw new Error(
        "Forge could not restore the Microsoft sign-in session. Reconnect Exchange Online from Settings."
      );
    }
    const token = await client.acquireTokenSilent({
      account,
      scopes: MICROSOFT_GRAPH_SCOPES
    });
    if (!token?.accessToken) {
      throw new Error(
        "Forge could not refresh the Microsoft session silently. Reconnect Exchange Online from Settings."
      );
    }
    const [profileResponse, primaryResponse] = await Promise.all([
      fetch(`${MICROSOFT_GRAPH_URL}/me?$select=mail,userPrincipalName,displayName`, {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: "application/json"
        }
      }),
      fetch(`${MICROSOFT_GRAPH_URL}/me/calendar?$select=id`, {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: "application/json"
        }
      })
    ]);

    const profilePayload = (await profileResponse.json()) as Record<string, unknown>;
    if (!profileResponse.ok) {
      throw microsoftGraphError(profileResponse.status, profilePayload, "Microsoft Graph profile lookup failed");
    }
    const primaryPayload = (await primaryResponse.json()) as Record<string, unknown>;
    if (!primaryResponse.ok) {
      throw microsoftGraphError(primaryResponse.status, primaryPayload, "Microsoft Graph primary calendar lookup failed");
    }

    const calendars = await fetchMicrosoftCollection<MicrosoftGraphCalendar>(
      token.accessToken,
      `${MICROSOFT_GRAPH_URL}/me/calendars?$select=id,name,color,canEdit,owner`
    );

    return {
      mode: "microsoft",
      accessToken: token.accessToken,
      accountLabel:
        safeDisplayName(profilePayload.mail, "") ||
        safeDisplayName(profilePayload.userPrincipalName, "") ||
        safeDisplayName(profilePayload.displayName, credentials.username),
      serverUrl: MICROSOFT_GRAPH_URL,
      principalUrl: `${MICROSOFT_GRAPH_URL}/me`,
      homeUrl: null,
      calendars,
      primaryCalendarId:
        typeof primaryPayload.id === "string" && primaryPayload.id.trim().length > 0
          ? primaryPayload.id
          : null,
      credentials: {
        ...credentials,
        username:
          safeDisplayName(profilePayload.mail, "") ||
          safeDisplayName(profilePayload.userPrincipalName, "") ||
          account.username ||
          credentials.username,
        tokenCache: client.getTokenCache().serialize()
      }
    };
  }

  const client =
    credentials.provider === "google"
      ? await (async () => {
          try {
            const googleConfig = resolveGoogleCalendarOauthPrivateConfig();
            const legacyGoogle = credentials as LegacyGoogleCredentials;
            return await createDAVClient({
              serverUrl: credentials.serverUrl,
              credentials: {
                username: credentials.username,
                tokenUrl: GOOGLE_TOKEN_URL,
                refreshToken: credentials.refreshToken,
                clientId:
                  googleConfig.clientId ||
                  legacyGoogle.clientId ||
                  "",
                clientSecret:
                  googleConfig.clientSecret ||
                  legacyGoogle.clientSecret ||
                  ""
              },
              authMethod: "Oauth",
              defaultAccountType: "caldav"
            });
          } catch (error) {
            throw mapGoogleRuntimeError(error);
          }
        })()
      : await createDAVClient({
          serverUrl: credentials.serverUrl,
          credentials: {
            username: credentials.username,
            password: credentials.password
          },
          authMethod: "Basic",
          defaultAccountType: "caldav"
        });

  let account;
  let calendars;
  try {
    account = await client.createAccount({
      account: {
        accountType: "caldav"
      }
    });

    calendars = await client.fetchCalendars({ account });
  } catch (error) {
    if (credentials.provider === "google") {
      throw mapGoogleRuntimeError(error);
    }
    throw error;
  }

  return {
    mode: "dav",
    client,
    account,
    calendars,
    accountLabel: credentials.username,
    serverUrl: credentials.serverUrl
  };
}

function mapDiscoveryPayload(
  provider: CalendarConnection["provider"],
  state: ProviderState
): CalendarDiscoveryPayload {
  if (state.mode === "microsoft") {
    return {
      provider,
      accountLabel: state.accountLabel,
      serverUrl: state.serverUrl,
      principalUrl: state.principalUrl ?? null,
      homeUrl: state.homeUrl ?? null,
      calendars: state.calendars.map((calendar) => ({
        url: microsoftCalendarUrl(calendar.id),
        displayName: safeDisplayName(calendar.name, "Calendar"),
        description:
          typeof calendar.owner?.name === "string" && calendar.owner.name.trim().length > 0
            ? `Owned by ${calendar.owner.name}`
            : "Exchange Online calendar",
        color: microsoftColorToHex(calendar.color),
        timezone: "UTC",
        isPrimary: state.primaryCalendarId === calendar.id,
        canWrite: false,
        selectedByDefault: true,
        isForgeCandidate: false
      }))
    };
  }

  return {
    provider,
    accountLabel: state.accountLabel,
    serverUrl: state.serverUrl,
    principalUrl: state.account.principalUrl ?? null,
    homeUrl: state.account.homeUrl ?? null,
    calendars: state.calendars.map((calendar, index) => {
      const displayName = safeDisplayName(calendar.displayName, `Calendar ${index + 1}`);
      return {
        url: normalizeUrl(calendar.url),
        displayName,
        description:
          typeof calendar.description === "string" ? calendar.description : "",
        color: calendar.calendarColor ?? FORGE_CALENDAR_COLOR,
        timezone: normalizeTimezone(calendar.timezone),
        isPrimary: false,
        canWrite: true,
        selectedByDefault: !isForgeName(displayName),
        isForgeCandidate: isForgeName(displayName)
      };
    })
  };
}

function toMicrosoftOauthSessionPayload(
  session: MicrosoftOauthPendingSession
): MicrosoftCalendarOauthSession {
  return {
    sessionId: session.sessionId,
    status: session.status,
    authUrl: session.authUrl,
    accountLabel: session.accountLabel,
    error: session.error,
    discovery: session.discovery
  };
}

function explainMicrosoftOauthError(input: {
  error?: string | null;
  errorDescription?: string | null;
}) {
  const raw = `${input.error ?? ""} ${input.errorDescription ?? ""}`.toLowerCase();

  if (raw.includes("aadsts50011") || raw.includes("redirect_uri")) {
    return "Microsoft rejected the redirect URI. Add the exact Forge callback URI shown in Settings -> Calendar to your app registration, save the settings again, and retry sign-in.";
  }
  if (raw.includes("access_denied") || raw.includes("consent")) {
    return "Microsoft consent was denied or cancelled. Review the requested Graph permissions, then retry the guided sign-in.";
  }
  if (raw.includes("aadsts700016") || raw.includes("application") && raw.includes("not found")) {
    return "Microsoft could not find this client ID in the selected tenant. Check the client ID, supported account type, and tenant setting in Settings -> Calendar.";
  }
  if (raw.includes("aadsts50020") || raw.includes("aadsts50194") || raw.includes("tenant")) {
    return "This account cannot sign in with the current tenant or supported-account setup. Use `common` for a broad self-hosted flow, or change the app registration to match this account type.";
  }
  return input.errorDescription?.trim() || input.error?.trim() || "Microsoft sign-in could not be completed.";
}

export async function testMicrosoftCalendarOauthConfiguration(
  input: TestMicrosoftCalendarOauthConfigurationInput | null = null
) {
  const config = resolveMicrosoftOAuthConfig(input ?? undefined);
  const client = createMicrosoftPublicClient(config);
  const crypto = new CryptoProvider();
  const pkce = await crypto.generatePkceCodes();

  await client.getAuthCodeUrl({
    redirectUri: config.redirectUri,
    scopes: MICROSOFT_GRAPH_SCOPES,
    state: `forge-microsoft-test-${randomUUID()}`,
    codeChallenge: pkce.challenge,
    codeChallengeMethod: "S256",
    prompt: "select_account"
  });

  return {
    ok: true as const,
    message:
      "Forge can open a local Microsoft sign-in with this client ID and redirect URI. Final verification happens when you complete the Microsoft popup and consent.",
    normalizedConfig: {
      clientId: config.clientId,
      tenantId: config.tenantId,
      redirectUri: config.redirectUri,
      usesClientSecret: false as const,
      readOnly: true as const
    }
  };
}

export async function startMicrosoftCalendarOauth(
  input: StartMicrosoftCalendarOauthInput,
  origin: string
) {
  pruneMicrosoftOauthSessions();
  const config = resolveMicrosoftOAuthConfig();
  const sessionId = randomUUID();
  const redirectUri = config.redirectUri;
  const authority = config.authority;
  const client = createMicrosoftPublicClient(config);
  const crypto = new CryptoProvider();
  const pkce = await crypto.generatePkceCodes();
  const authUrl = await client.getAuthCodeUrl({
    redirectUri,
    scopes: MICROSOFT_GRAPH_SCOPES,
    state: sessionId,
    codeChallenge: pkce.challenge,
    codeChallengeMethod: "S256",
    prompt: "select_account"
  });
  const now = new Date();
  microsoftOauthSessions.set(sessionId, {
    sessionId,
    state: sessionId,
    label: input.label?.trim() || null,
    origin,
    redirectUri,
    clientId: config.clientId,
    authority,
    tenantId: config.tenantId,
    codeVerifier: pkce.verifier,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    status: "pending",
    authUrl,
    accountLabel: null,
    error: null,
    discovery: null,
    credentials: null
  });
  return {
    session: toMicrosoftOauthSessionPayload(microsoftOauthSessions.get(sessionId)!)
  };
}

export function getMicrosoftCalendarOauthSession(sessionId: string) {
  pruneMicrosoftOauthSessions();
  const session = microsoftOauthSessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown Microsoft calendar auth session ${sessionId}`);
  }
  return {
    session: toMicrosoftOauthSessionPayload(session)
  };
}

export async function completeMicrosoftCalendarOauth(input: {
  state?: string | null;
  code?: string | null;
  error?: string | null;
  errorDescription?: string | null;
}) {
  pruneMicrosoftOauthSessions();
  const sessionId = input.state?.trim() || "";
  const session = microsoftOauthSessions.get(sessionId);
  if (!session) {
    throw new Error("Unknown Microsoft calendar auth session.");
  }
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    session.status = "expired";
    session.error = "The Microsoft sign-in session expired. Start the guided sign-in again.";
    return { session: toMicrosoftOauthSessionPayload(session) };
  }
  if (input.error) {
    session.status = "error";
    session.error = explainMicrosoftOauthError(input);
    return { session: toMicrosoftOauthSessionPayload(session) };
  }
  if (!input.code) {
    session.status = "error";
    session.error = "Microsoft did not return an authorization code.";
    return { session: toMicrosoftOauthSessionPayload(session) };
  }

  try {
    const client = createMicrosoftPublicClient({
      clientId: session.clientId,
      authority: session.authority
    });
    if (!session.codeVerifier) {
      throw new Error("The Microsoft sign-in session is missing its PKCE verifier. Start the sign-in again.");
    }
    const result = await client.acquireTokenByCode({
      code: input.code,
      redirectUri: session.redirectUri,
      scopes: MICROSOFT_GRAPH_SCOPES,
      codeVerifier: session.codeVerifier
    });
    const account = result?.account;
    if (!account) {
      throw new Error("Microsoft sign-in completed without an account profile.");
    }

    const provisionalCredentials: MicrosoftCredentials = {
      provider: "microsoft",
      serverUrl: MICROSOFT_GRAPH_URL,
      username: account.username || "microsoft-account",
      clientId: session.clientId,
      tenantId: session.tenantId,
      authority: session.authority,
      homeAccountId: account.homeAccountId,
      tokenCache: client.getTokenCache().serialize(),
      selectedCalendarUrls: []
    };
    const state = await createProviderClient(provisionalCredentials);
    if (state.mode !== "microsoft") {
      throw new Error("Forge resolved a DAV provider state for a Microsoft calendar session.");
    }
    const discovery = mapDiscoveryPayload("microsoft", state);
    session.status = "authorized";
    session.accountLabel = state.accountLabel;
    session.discovery = discovery;
    session.credentials = {
      ...provisionalCredentials,
      username: state.credentials.username,
      tokenCache: state.credentials.tokenCache
    };
    session.codeVerifier = null;
    session.error = null;
  } catch (error) {
    session.status = "error";
    session.error =
      error instanceof Error ? error.message : "Microsoft sign-in failed.";
  }

  return { session: toMicrosoftOauthSessionPayload(session), openerOrigin: session.origin };
}

export async function startGoogleCalendarOauth(
  input: StartGoogleCalendarOauthInput,
  requestContext: {
    openerOrigin: string | null;
    requestBaseOrigin: string;
  }
) {
  pruneGoogleOauthSessions();
  const { config, openerOrigin, requestBaseOrigin } =
    ensureGoogleOauthStartAllowed(requestContext);
  const sessionId = randomUUID();
  const pkce = buildPkcePair();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    scope: GOOGLE_OAUTH_SCOPES.join(" "),
    state: sessionId,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256"
  });
  const authUrl = `${GOOGLE_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
  const now = new Date();
  googleOauthSessions.set(sessionId, {
    sessionId,
    state: sessionId,
    label: input.label?.trim() || null,
    openerOrigin,
    requestBaseOrigin,
    redirectUri: config.redirectUri,
    appUrl: config.appUrl,
    clientId: config.clientId,
    codeVerifier: pkce.verifier,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    status: "pending",
    authUrl,
    accountLabel: null,
    error: null,
    discovery: null,
    credentials: null
  });
  return {
    session: toGoogleOauthSessionPayload(googleOauthSessions.get(sessionId)!)
  };
}

export function getGoogleCalendarOauthSession(sessionId: string) {
  pruneGoogleOauthSessions();
  const session = googleOauthSessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown Google calendar auth session ${sessionId}`);
  }
  return {
    session: toGoogleOauthSessionPayload(session)
  };
}

export async function completeGoogleCalendarOauth(input: {
  state?: string | null;
  code?: string | null;
  error?: string | null;
  errorDescription?: string | null;
}) {
  pruneGoogleOauthSessions();
  const sessionId = input.state?.trim() || "";
  const session = googleOauthSessions.get(sessionId);
  if (!session) {
    throw new Error("Unknown Google calendar auth session.");
  }
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    session.status = "expired";
    session.error = "The Google sign-in session expired. Start the guided sign-in again.";
    return { session: toGoogleOauthSessionPayload(session) };
  }
  if (input.error) {
    session.status = "error";
    session.error = explainGoogleOauthError({
      error: input.error,
      errorDescription: input.errorDescription,
      redirectUri: session.redirectUri,
      appUrl: session.appUrl
    });
    return { session: toGoogleOauthSessionPayload(session), openerOrigin: session.openerOrigin };
  }
  if (!input.code) {
    session.status = "error";
    session.error = "Google did not return an authorization code.";
    return { session: toGoogleOauthSessionPayload(session), openerOrigin: session.openerOrigin };
  }

  try {
    const config = resolveGoogleCalendarOauthPrivateConfig();
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: new URLSearchParams({
        code: input.code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: session.redirectUri,
        grant_type: "authorization_code",
        code_verifier: session.codeVerifier
      }).toString()
    });
    const tokenPayload = (await tokenResponse.json()) as Record<string, unknown>;
    if (!tokenResponse.ok) {
      throw new Error(
        explainGoogleOauthError({
          error:
            typeof tokenPayload.error === "string" ? tokenPayload.error : null,
          errorDescription:
            typeof tokenPayload.error_description === "string"
              ? tokenPayload.error_description
              : null,
          redirectUri: session.redirectUri,
          appUrl: session.appUrl
        })
      );
    }

    const accessToken =
      typeof tokenPayload.access_token === "string"
        ? tokenPayload.access_token
        : "";
    const refreshToken =
      typeof tokenPayload.refresh_token === "string"
        ? tokenPayload.refresh_token
        : "";
    if (!accessToken) {
      throw new Error("Google sign-in completed without an access token.");
    }
    if (!refreshToken) {
      throw new Error(
        "Google did not return a refresh token. Revoke the existing Forge access for this Google account or retry consent so Forge can keep syncing in the background."
      );
    }

    const scopeText =
      typeof tokenPayload.scope === "string" ? tokenPayload.scope : "";
    const grantedScopes = scopeText
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    const expiresInSeconds =
      typeof tokenPayload.expires_in === "number"
        ? tokenPayload.expires_in
        : Number(tokenPayload.expires_in ?? 0);
    const accessTokenExpiresAt =
      Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
        ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
        : null;

    const profileResponse = await fetch(GOOGLE_USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });
    const profilePayload = (await profileResponse.json()) as Record<string, unknown>;
    if (!profileResponse.ok) {
      throw new Error("Google sign-in completed, but Forge could not read the account profile.");
    }
    const email =
      typeof profilePayload.email === "string" && profilePayload.email.trim().length > 0
        ? profilePayload.email.trim()
        : "";
    if (!email) {
      throw new Error("Google sign-in completed without an account email.");
    }

    const provisionalCredentials: Omit<
      GoogleCredentials,
      "selectedCalendarUrls" | "forgeCalendarUrl"
    > = {
      provider: "google",
      serverUrl: GOOGLE_CALDAV_URL,
      username: email,
      refreshToken,
      accessTokenExpiresAt,
      grantedScopes
    };
    const state = await createProviderClient(provisionalCredentials);
    const discovery = mapDiscoveryPayload("google", state);
    session.status = "authorized";
    session.accountLabel = discovery.accountLabel;
    session.discovery = discovery;
    session.credentials = provisionalCredentials;
    session.codeVerifier = "";
    session.error = null;
  } catch (error) {
    session.status = "error";
    session.error =
      error instanceof Error ? error.message : "Google sign-in failed.";
  }

  return {
    session: toGoogleOauthSessionPayload(session),
    openerOrigin: session.openerOrigin
  };
}

async function ensureForgeCalendar(
  state: ProviderState
): Promise<{ forgeCalendarUrl: string; calendars: DAVCalendar[] }> {
  if (state.mode !== "dav") {
    throw new Error("This calendar provider is read-only, so Forge cannot create a dedicated write calendar there.");
  }
  const existingForge = state.calendars.find((calendar) =>
    isForgeName(safeDisplayName(calendar.displayName, ""))
  );
  if (existingForge) {
    return {
      forgeCalendarUrl: normalizeUrl(existingForge.url),
      calendars: state.calendars
    };
  }

  if (!state.account.homeUrl) {
    throw new Error(
      "The provider did not expose a calendar home set, so Forge could not create a dedicated calendar automatically."
    );
  }

  const existingUrls = new Set(state.calendars.map((calendar) => normalizeUrl(calendar.url)));
  let slug = "forge";
  let attempt = 2;
  let nextUrl = normalizeUrl(new URL(`${slug}/`, state.account.homeUrl).toString());
  while (existingUrls.has(nextUrl)) {
    slug = `forge-${attempt++}`;
    nextUrl = normalizeUrl(new URL(`${slug}/`, state.account.homeUrl).toString());
  }

  await state.client.makeCalendar({
    url: nextUrl,
    props: {
      [`${DAVNamespaceShort.DAV}:displayname`]: {
        _cdata: FORGE_CALENDAR_NAME
      },
      [`${DAVNamespaceShort.CALDAV}:calendar-description`]: {
        _cdata: "Forge-owned work blocks and task timeboxes"
      },
      [`${DAVNamespaceShort.CALDAV_APPLE}:calendar-color`]: {
        _cdata: FORGE_CALENDAR_COLOR
      }
    }
  });

  const calendars = await state.client.fetchCalendars({ account: state.account as never });
  return {
    forgeCalendarUrl: nextUrl,
    calendars
  };
}

function inferRemoteId(object: DAVCalendarObject, parsed: Record<string, unknown>) {
  const uid = typeof parsed.uid === "string" ? parsed.uid : null;
  if (uid) {
    return uid;
  }
  return object.url;
}

function mapDavObjectToEvents(
  calendarUrl: string,
  object: DAVCalendarObject,
  ownership: "external" | "forge"
) {
  const payload = typeof object.data === "string" ? object.data : "";
  const parsed = ical.sync.parseICS(payload) as Record<string, Record<string, unknown>>;
  const events: CalendarSyncEventInput[] = [];

  for (const entry of Object.values(parsed)) {
    if (entry.type !== "VEVENT") {
      continue;
    }
    const start = entry.start instanceof Date ? entry.start.toISOString() : null;
    const end = entry.end instanceof Date ? entry.end.toISOString() : null;
    if (!start || !end) {
      continue;
    }
    events.push({
      calendarRemoteId: calendarUrl,
      remoteId: inferRemoteId(object, entry),
      remoteHref: object.url,
      remoteEtag: object.etag ?? null,
      ownership,
      status:
        entry.status === "CANCELLED"
          ? "cancelled"
          : entry.status === "TENTATIVE"
            ? "tentative"
            : "confirmed",
      title:
        typeof entry.summary === "string" ? entry.summary : "(untitled event)",
      description:
        typeof entry.description === "string" ? entry.description : "",
      location: typeof entry.location === "string" ? entry.location : "",
      startAt: start,
      endAt: end,
      isAllDay: false,
      availability: entry.transparency === "TRANSPARENT" ? "free" : "busy",
      eventType: "",
      categories: Array.isArray(entry.categories)
        ? entry.categories.map((value) => String(value))
        : typeof entry.categories === "string"
          ? [entry.categories]
          : [],
      rawPayload: entry,
      remoteUpdatedAt:
        entry.lastmodified instanceof Date
          ? entry.lastmodified.toISOString()
          : null,
      deletedAt: entry.status === "CANCELLED" ? new Date().toISOString() : null
    });
  }

  return events;
}

function mapCalendarRecord(
  calendar: DAVCalendar | MicrosoftGraphCalendar,
  options: { forgeCalendarUrl?: string | null; primaryCalendarId?: string | null }
): CalendarSyncCalendarInput {
  if ("url" in calendar) {
    const forgeCalendarUrl = options.forgeCalendarUrl ? normalizeUrl(options.forgeCalendarUrl) : null;
    const title = safeDisplayName(calendar.displayName, "Calendar");
    const remoteUrl = normalizeUrl(calendar.url);
    return {
      remoteId: remoteUrl,
      title,
      description:
        typeof calendar.description === "string" ? calendar.description : "",
      color: calendar.calendarColor ?? FORGE_CALENDAR_COLOR,
      timezone: normalizeTimezone(calendar.timezone),
      isPrimary: false,
      canWrite: true,
      selectedForSync: forgeCalendarUrl ? remoteUrl !== forgeCalendarUrl : true,
      forgeManaged: forgeCalendarUrl ? remoteUrl === forgeCalendarUrl : false
    };
  }

  return {
    remoteId: microsoftCalendarUrl(calendar.id),
    title: safeDisplayName(calendar.name, "Calendar"),
    description:
      typeof calendar.owner?.name === "string" && calendar.owner.name.trim().length > 0
        ? `Owned by ${calendar.owner.name}`
        : "Exchange Online calendar",
    color: microsoftColorToHex(calendar.color),
    timezone: "UTC",
    isPrimary: options.primaryCalendarId === calendar.id,
    canWrite: false,
    selectedForSync: true,
    forgeManaged: false
  };
}

async function publishTaskTimeboxes(
  state: ProviderState,
  forgeCalendarUrl: string | null,
  connectionId: string
) {
  if (state.mode !== "dav" || !forgeCalendarUrl) {
    return;
  }
  const forgeCalendar = state.calendars.find(
    (calendar) => normalizeUrl(calendar.url) === normalizeUrl(forgeCalendarUrl)
  );
  if (!forgeCalendar) {
    return;
  }

  const horizon = {
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    to: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString()
  };
  const timeboxes = listTaskTimeboxes(horizon);

  for (const timebox of timeboxes) {
    const remoteEventId = timebox.remoteEventId ?? `forge-${timebox.id}`;
    const iCalString = buildEventIcs({
      uid: remoteEventId,
      title: timebox.title,
      startsAt: timebox.startsAt,
      endsAt: timebox.endsAt,
      description: timebox.overrideReason ?? ""
    });

    if (timebox.remoteEventId) {
      await state.client.updateCalendarObject({
        calendarObject: {
          url: new URL(`${remoteEventId}.ics`, forgeCalendar.url).toString(),
          data: iCalString
        }
      });
    } else {
      await state.client.createCalendarObject({
        calendar: forgeCalendar,
        iCalString,
        filename: `${remoteEventId}.ics`
      });
    }

    const localForgeCalendar = listCalendars(connectionId).find(
      (entry) => normalizeUrl(entry.remoteId) === normalizeUrl(forgeCalendar.url)
    );
    updateTaskTimebox(timebox.id, {
      connectionId,
      calendarId: localForgeCalendar?.id ?? null,
      remoteEventId
    });
  }
}

async function syncDiscoveredState(
  connectionId: string,
  credentials: StoredCalendarCredentials
) {
  const state = await createProviderClient(credentials);
  if (!isWritableCalendarCredentials(credentials)) {
    if (state.mode !== "microsoft") {
      throw new Error("Forge expected a Microsoft provider state for this calendar connection.");
    }
    const selected = new Set(
      credentials.selectedCalendarUrls.map((value) => normalizeUrl(value))
    );

    for (const calendar of state.calendars) {
      const remoteId = normalizeUrl(microsoftCalendarUrl(calendar.id));
      upsertCalendarRecord(
        connectionId,
        {
          ...mapCalendarRecord(calendar, { primaryCalendarId: state.primaryCalendarId }),
          selectedForSync: selected.has(remoteId)
        }
      );
    }

    const now = new Date();
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const end = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString();

    const selectedCalendars = state.calendars.filter((calendar) =>
      selected.has(normalizeUrl(microsoftCalendarUrl(calendar.id)))
    );

    for (const calendar of selectedCalendars) {
      const events = await fetchMicrosoftCollection<MicrosoftGraphEvent>(
        state.accessToken,
        `${MICROSOFT_GRAPH_URL}/me/calendars/${encodeURIComponent(calendar.id)}/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}`
      );

      for (const event of events) {
        const mapped = mapMicrosoftEventToSyncInput(calendar.id, event);
        if (!mapped) {
          continue;
        }
        upsertCalendarEventRecord(connectionId, mapped);
      }
    }

    return {
      state,
      forgeCalendarUrl: null
    };
  }

  if (state.mode !== "dav") {
    throw new Error("Forge expected a DAV provider state for this writable calendar connection.");
  }

  const selected = new Set(
    credentials.selectedCalendarUrls.map((value) => normalizeUrl(value))
  );
  const forgeCalendarUrl = normalizeUrl(credentials.forgeCalendarUrl);
  const calendarsToSync = state.calendars.filter((calendar) => {
    const normalized = normalizeUrl(calendar.url);
    return selected.has(normalized) || normalized === forgeCalendarUrl;
  });

  for (const calendar of state.calendars) {
    const normalized = normalizeUrl(calendar.url);
    upsertCalendarRecord(
      connectionId,
      {
        ...mapCalendarRecord(calendar, { forgeCalendarUrl }),
        selectedForSync: selected.has(normalized)
      }
    );
  }

  const now = new Date();
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const end = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString();

  for (const calendar of calendarsToSync) {
    const ownership =
      normalizeUrl(calendar.url) === forgeCalendarUrl ? "forge" : "external";
    const objects = await state.client.fetchCalendarObjects({
      calendar,
      timeRange: {
        start,
        end
      }
    });

    for (const object of objects) {
      const mapped = mapDavObjectToEvents(normalizeUrl(calendar.url), object, ownership);
      for (const event of mapped) {
        upsertCalendarEventRecord(connectionId, event);
      }
    }
  }

  return {
    state,
    forgeCalendarUrl
  };
}

function toStoredCredentials(
  input: CreateCalendarConnectionInput,
  forgeCalendarUrl: string | null
): WritableCalendarCredentials {
  if (input.provider === "microsoft" || input.provider === "google") {
    throw new Error(
      `${input.provider === "google" ? "Google Calendar" : "Exchange Online"} connections must be created from a completed OAuth sign-in session.`
    );
  }

  if (input.provider === "apple") {
    return {
      provider: "apple",
      serverUrl: APPLE_CALDAV_URL,
      username: input.username,
      password: input.password,
      selectedCalendarUrls: input.selectedCalendarUrls.map(normalizeUrl),
      forgeCalendarUrl: normalizeUrl(forgeCalendarUrl!)
    };
  }

  return {
    provider: "caldav",
    serverUrl: normalizeUrl(input.serverUrl),
    username: input.username,
    password: input.password,
    selectedCalendarUrls: input.selectedCalendarUrls.map(normalizeUrl),
    forgeCalendarUrl: normalizeUrl(forgeCalendarUrl!)
  };
}

function credentialsMatch(
  existing: StoredCalendarCredentials,
  incoming: DiscoverableCredentials
) {
  if (existing.provider !== incoming.provider) {
    return false;
  }

  if (existing.provider === "google" && incoming.provider === "google") {
    return (
      normalizeAccountIdentity(existing.username) === normalizeAccountIdentity(incoming.username) &&
      normalizeUrl(existing.serverUrl) === normalizeUrl(incoming.serverUrl)
    );
  }

  if (existing.provider === "apple" && incoming.provider === "apple") {
    return normalizeAccountIdentity(existing.username) === normalizeAccountIdentity(incoming.username);
  }

  if (existing.provider === "caldav" && incoming.provider === "caldav") {
    return (
      normalizeAccountIdentity(existing.username) === normalizeAccountIdentity(incoming.username) &&
      normalizeUrl(existing.serverUrl) === normalizeUrl(incoming.serverUrl)
    );
  }

  return false;
}

function findExistingCalendarConnection(
  incoming: DiscoverableCredentials,
  secrets: SecretsManager
) {
  return listCalendarConnections().find((connection) => {
    try {
      const existing = requireSecretRecord<StoredCalendarCredentials>(
        secrets,
        connection.credentialsSecretId
      );
      return credentialsMatch(existing, incoming);
    } catch {
      return false;
    }
  });
}

function toDiscoveryCredentials(
  input: DiscoverCalendarConnectionInput | CreateCalendarConnectionInput
): DiscoverableCredentials {
  if (input.provider === "microsoft" || input.provider === "google") {
    throw new Error(
      `${input.provider === "google" ? "Google Calendar" : "Exchange Online"} discovery now uses the guided OAuth sign-in flow.`
    );
  }

  if (input.provider === "apple") {
    return {
      provider: "apple",
      serverUrl: APPLE_CALDAV_URL,
      username: input.username,
      password: input.password
    };
  }

  return {
    provider: "caldav",
    serverUrl: normalizeUrl(input.serverUrl),
    username: input.username,
    password: input.password
  };
}

export async function discoverCalendarConnection(
  input: DiscoverCalendarConnectionInput
): Promise<CalendarDiscoveryPayload> {
  const state = await createProviderClient(toDiscoveryCredentials(input));
  return mapDiscoveryPayload(input.provider, state);
}

export async function discoverExistingCalendarConnection(
  connectionId: string,
  secrets: SecretsManager
): Promise<CalendarDiscoveryPayload> {
  const connection = getCalendarConnectionById(connectionId);
  if (!connection) {
    throw new Error(`Unknown calendar connection ${connectionId}`);
  }
  const credentials = requireSecretRecord<StoredCalendarCredentials>(
    secrets,
    connection.credentialsSecretId
  );
  const state = await createProviderClient(credentials);
  return mapDiscoveryPayload(connection.provider, state);
}

export async function createCalendarConnection(
  input: CreateCalendarConnectionInput,
  secrets: SecretsManager,
  activity: ActivityContext = { source: "ui" }
) {
  if (input.provider === "google") {
    pruneGoogleOauthSessions();
    const session = googleOauthSessions.get(input.authSessionId);
    if (!session || session.status !== "authorized" || !session.discovery || !session.credentials) {
      throw new Error(
        "Complete the Google sign-in flow before saving this Google Calendar connection."
      );
    }

    const existingConnection = listCalendarConnections().find((connection) => {
      try {
        const existing = requireSecretRecord<StoredCalendarCredentials>(
          secrets,
          connection.credentialsSecretId
        );
        return (
          existing.provider === "google" &&
          normalizeAccountIdentity(existing.username) ===
            normalizeAccountIdentity(session.credentials?.username ?? "")
        );
      } catch {
        return false;
      }
    });
    if (existingConnection) {
      throw new CalendarConnectionConflictError(
        `${existingConnection.label} is already connected for ${existingConnection.accountLabel || "this account"}. Remove it first if you want to reconnect with different settings.`,
        existingConnection.id
      );
    }

    const state = await createProviderClient(session.credentials);
    if (state.mode !== "dav") {
      throw new Error("Forge expected a writable DAV provider state for this Google Calendar connection.");
    }

    let forgeCalendarUrl: string | null =
      input.forgeCalendarUrl?.trim() ||
      session.discovery.calendars.find((calendar) => calendar.isForgeCandidate)?.url ||
      null;

    if (!forgeCalendarUrl && input.createForgeCalendar) {
      const created = await ensureForgeCalendar(state);
      forgeCalendarUrl = created.forgeCalendarUrl;
    }

    if (!forgeCalendarUrl) {
      throw new Error(
        "Select the calendar Forge should write into, or create a new calendar named Forge."
      );
    }

    const secretId = `calendar_secret_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const storedCredentials: GoogleCredentials = {
      ...session.credentials,
      selectedCalendarUrls: input.selectedCalendarUrls.map(normalizeUrl),
      forgeCalendarUrl: normalizeUrl(forgeCalendarUrl)
    };
    // The app credentials belong to Forge itself. Only user-specific OAuth tokens
    // are stored per calendar connection.
    storeEncryptedSecret(
      secretId,
      secrets.sealJson(storedCredentials),
      `${input.label} google calendar credentials`
    );

    const connection = createCalendarConnectionRecord({
      provider: "google",
      label: input.label,
      accountLabel: session.accountLabel ?? session.discovery.accountLabel,
      config: {
        serverUrl: session.discovery.serverUrl,
        selectedCalendarCount: storedCredentials.selectedCalendarUrls.length,
        forgeCalendarUrl: normalizeUrl(storedCredentials.forgeCalendarUrl)
      },
      credentialsSecretId: secretId
    });

    await syncCalendarConnection(connection.id, secrets, activity);
    session.status = "consumed";

    recordCalendarActivity(
      "calendar_connection_created",
      "calendar_connection",
      connection.id,
      `Calendar connection created: ${connection.label}`,
      "Google Calendar is now connected to Forge through the shared app-owned OAuth flow.",
      activity,
      { provider: input.provider }
    );

    return getCalendarConnectionById(connection.id)!;
  }

  if (input.provider === "microsoft") {
    pruneMicrosoftOauthSessions();
    const session = microsoftOauthSessions.get(input.authSessionId);
    if (!session || session.status !== "authorized" || !session.discovery || !session.credentials) {
      throw new Error(
        "Complete the Microsoft sign-in flow before saving this Exchange Online connection."
      );
    }

    const existingConnection = listCalendarConnections().find((connection) => {
      try {
        const existing = requireSecretRecord<StoredCalendarCredentials>(
          secrets,
          connection.credentialsSecretId
        );
        return (
          existing.provider === "microsoft" &&
          normalizeAccountIdentity(existing.username) ===
            normalizeAccountIdentity(session.credentials?.username ?? "")
        );
      } catch {
        return false;
      }
    });
    if (existingConnection) {
      throw new CalendarConnectionConflictError(
        `${existingConnection.label} is already connected for ${existingConnection.accountLabel || "this account"}. Remove it first if you want to reconnect with different settings.`,
        existingConnection.id
      );
    }

    const secretId = `calendar_secret_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const storedCredentials: MicrosoftCredentials = {
      ...session.credentials,
      selectedCalendarUrls: input.selectedCalendarUrls.map(normalizeUrl)
    };
    storeEncryptedSecret(
      secretId,
      secrets.sealJson(storedCredentials),
      `${input.label} ${input.provider} calendar credentials`
    );

    const connection = createCalendarConnectionRecord({
      provider: "microsoft",
      label: input.label,
      accountLabel: session.accountLabel ?? session.discovery.accountLabel,
      config: {
        serverUrl: session.discovery.serverUrl,
        selectedCalendarCount: storedCredentials.selectedCalendarUrls.length,
        readOnly: true,
        writeMode: "read_only"
      },
      credentialsSecretId: secretId
    });

    await syncCalendarConnection(connection.id, secrets, activity);
    session.status = "consumed";

    recordCalendarActivity(
      "calendar_connection_created",
      "calendar_connection",
      connection.id,
      `Calendar connection created: ${connection.label}`,
      "Exchange Online is now connected to Forge through Microsoft sign-in in read-only mode.",
      activity,
      { provider: input.provider }
    );

    return getCalendarConnectionById(connection.id)!;
  }

  const discoveryCredentials = toDiscoveryCredentials(input);
  const existingConnection = findExistingCalendarConnection(discoveryCredentials, secrets);
  if (existingConnection) {
    throw new CalendarConnectionConflictError(
      `${existingConnection.label} is already connected for ${existingConnection.accountLabel || "this account"}. Remove it first if you want to reconnect with different settings.`,
      existingConnection.id
    );
  }
  const state = await createProviderClient(discoveryCredentials);
  if (state.mode !== "dav") {
    throw new Error("Forge expected a writable DAV provider state for this calendar connection.");
  }
  const discovery = mapDiscoveryPayload(input.provider, state);

  let forgeCalendarUrl: string | null = null;
  forgeCalendarUrl =
    input.forgeCalendarUrl?.trim() ||
    discovery.calendars.find((calendar) => calendar.isForgeCandidate)?.url ||
    null;

  if (!forgeCalendarUrl && input.createForgeCalendar) {
    const created = await ensureForgeCalendar(state);
    forgeCalendarUrl = created.forgeCalendarUrl;
  }

  if (!forgeCalendarUrl) {
    throw new Error(
      "Select the calendar Forge should write into, or create a new calendar named Forge."
    );
  }

  const secretId = `calendar_secret_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const storedCredentials = toStoredCredentials(input, forgeCalendarUrl);

  storeEncryptedSecret(
    secretId,
    secrets.sealJson(storedCredentials),
    `${input.label} ${input.provider} calendar credentials`
  );

  const connection = createCalendarConnectionRecord({
    provider: input.provider,
    label: input.label,
    accountLabel: discovery.accountLabel,
    config: {
      serverUrl: discovery.serverUrl,
      selectedCalendarCount: storedCredentials.selectedCalendarUrls.length,
      forgeCalendarUrl: normalizeUrl(storedCredentials.forgeCalendarUrl)
    },
    credentialsSecretId: secretId
  });

  await syncCalendarConnection(connection.id, secrets, activity);

  recordCalendarActivity(
    "calendar_connection_created",
    "calendar_connection",
    connection.id,
    `Calendar connection created: ${connection.label}`,
    `${input.provider === "apple" ? "Apple Calendar" : input.provider === "google" ? "Google Calendar" : "Custom CalDAV"} is now connected to Forge.`,
    activity,
    { provider: input.provider }
  );

  return getCalendarConnectionById(connection.id)!;
}

export async function removeCalendarConnection(
  connectionId: string,
  secrets: SecretsManager,
  activity: ActivityContext = { source: "ui" }
) {
  const connection = getCalendarConnectionById(connectionId);
  if (!connection) {
    return undefined;
  }

  deleteExternalEventsForConnection(connectionId);
  detachConnectionFromForgeEvents(connectionId);
  deleteCalendarConnectionRecord(connectionId);
  deleteEncryptedSecret(connection.credentialsSecretId);

  recordCalendarActivity(
    "calendar_connection_deleted",
    "calendar_connection",
    connectionId,
    `Calendar connection removed: ${connection.label}`,
    "The provider connection was removed. Mirrored external events were removed, while Forge-native calendar records stayed local.",
    activity,
    { provider: connection.provider }
  );

  return connection;
}

export async function syncCalendarConnection(
  connectionId: string,
  secrets: SecretsManager,
  activity: ActivityContext = { source: "system" }
) {
  const connection = getCalendarConnectionById(connectionId);
  if (!connection) {
    throw new Error(`Unknown calendar connection ${connectionId}`);
  }

  try {
    const credentials = requireSecretRecord<StoredCalendarCredentials>(
      secrets,
      connection.credentialsSecretId
    );
    const { state, forgeCalendarUrl } = await syncDiscoveredState(
      connectionId,
      credentials
    );
    if (state.mode === "microsoft") {
      storeEncryptedSecret(
        connection.credentialsSecretId,
        secrets.sealJson(state.credentials),
        `${connection.label} ${connection.provider} calendar credentials`
      );
    }
    const forgeCalendar = forgeCalendarUrl
      ? listCalendars(connectionId).find(
          (entry) => normalizeUrl(entry.remoteId) === normalizeUrl(forgeCalendarUrl)
        )
      : null;

    updateCalendarConnectionRecord(connectionId, {
      accountLabel: state.accountLabel,
      forgeCalendarId: forgeCalendar?.id ?? null,
      status: "connected",
      config: {
        serverUrl: credentials.serverUrl,
        selectedCalendarCount: credentials.selectedCalendarUrls.length,
        ...(credentials.provider === "microsoft"
          ? {
              readOnly: true,
              tenantId: credentials.tenantId,
              writeMode: "read_only"
            }
          : {
              forgeCalendarUrl: normalizeUrl(credentials.forgeCalendarUrl)
            })
      },
      lastSyncedAt: new Date().toISOString(),
      lastSyncError: null
    });

    await publishTaskTimeboxes(state, forgeCalendarUrl, connectionId);

    recordCalendarActivity(
      "calendar_connection_synced",
      "calendar_connection",
      connectionId,
      `Calendar synced: ${connection.label}`,
      credentials.provider === "microsoft"
        ? "Exchange Online calendars were mirrored into Forge in read-only mode."
        : "Provider events and Forge timeboxes were synchronized.",
      activity
    );

    return getCalendarConnectionById(connectionId)!;
  } catch (error) {
    updateCalendarConnectionRecord(connectionId, {
      status: "error",
      lastSyncError:
        error instanceof Error ? error.message : "Calendar sync failed"
    });
    throw error;
  }
}

export async function updateCalendarConnectionSelection(
  connectionId: string,
  input: {
    label?: string;
    selectedCalendarUrls?: string[];
  },
  secrets: SecretsManager,
  activity: ActivityContext = { source: "ui" }
) {
  const connection = getCalendarConnectionById(connectionId);
  if (!connection) {
    throw new Error(`Unknown calendar connection ${connectionId}`);
  }

  const credentials = requireSecretRecord<StoredCalendarCredentials>(
    secrets,
    connection.credentialsSecretId
  );

  if (input.selectedCalendarUrls) {
    const state = await createProviderClient(credentials);
    const discoveredUrls = new Set(
      state.mode === "microsoft"
        ? state.calendars.map((calendar) => normalizeUrl(microsoftCalendarUrl(calendar.id)))
        : state.calendars.map((calendar) => normalizeUrl(calendar.url))
    );
    const nextSelectedCalendarUrls = Array.from(
      new Set(input.selectedCalendarUrls.map((value) => normalizeUrl(value)))
    );
    for (const url of nextSelectedCalendarUrls) {
      if (!discoveredUrls.has(url)) {
        throw new Error(`Calendar ${url} is not available for this connection.`);
      }
    }
    credentials.selectedCalendarUrls = nextSelectedCalendarUrls;
    storeEncryptedSecret(
      connection.credentialsSecretId,
      secrets.sealJson(credentials),
      `${input.label ?? connection.label} ${connection.provider} calendar credentials`
    );
  }

  if (input.label) {
    updateCalendarConnectionRecord(connectionId, { label: input.label });
  }

  if (input.selectedCalendarUrls) {
    await syncCalendarConnection(connectionId, secrets, activity);
  }

  recordCalendarActivity(
    "calendar_connection_updated",
    "calendar_connection",
    connectionId,
    `Calendar connection updated: ${input.label ?? connection.label}`,
    input.selectedCalendarUrls
      ? "Calendar mirroring preferences were updated."
      : "Calendar connection details were updated.",
    activity,
    {
      provider: connection.provider,
      selectedCalendarCount:
        input.selectedCalendarUrls?.length ?? credentials.selectedCalendarUrls.length
    }
  );

  return getCalendarConnectionById(connectionId)!;
}

export function readCalendarOverview(query: {
  from: string;
  to: string;
  userIds?: string[];
}): CalendarOverviewPayload {
  return getCalendarOverview(query);
}

async function resolveProviderStateForConnection(
  connectionId: string,
  secrets: SecretsManager
) {
  const connection = getCalendarConnectionById(connectionId);
  if (!connection) {
    throw new Error(`Unknown calendar connection ${connectionId}`);
  }
  const credentials = requireSecretRecord<StoredCalendarCredentials>(
    secrets,
    connection.credentialsSecretId
  );
  const state = await createProviderClient(credentials);
  return { connection, state };
}

function resolveDavCalendarFromLocalId(
  state: ProviderState,
  localCalendarId: string | null | undefined,
  connectionId: string
) {
  if (state.mode !== "dav") {
    return null;
  }
  if (!localCalendarId) {
    return null;
  }
  const localCalendar = getCalendarById(localCalendarId);
  if (!localCalendar || localCalendar.connectionId !== connectionId) {
    return null;
  }
  return (
    state.calendars.find(
      (entry) => normalizeUrl(entry.url) === normalizeUrl(localCalendar.remoteId)
    ) ?? null
  );
}

export async function syncForgeCalendarEvent(
  eventId: string,
  secrets: SecretsManager
) {
  const event = getCalendarEventStorageRecord(eventId);
  if (!event || event.deleted_at) {
    throw new Error(`Unknown calendar event ${eventId}`);
  }

  const sourceMappings = listCalendarEventSources(eventId).filter(
    (source) => source.connectionId && source.calendarId && source.syncState !== "deleted"
  );

  if (sourceMappings.length > 0) {
    for (const source of sourceMappings) {
      if (!source.calendarId) {
        continue;
      }
      const { connection, state } = await resolveProviderStateForConnection(
        source.connectionId!,
        secrets
      );
      if (state.mode !== "dav") {
        continue;
      }
      const calendar = resolveDavCalendarFromLocalId(
        state,
        source.calendarId,
        connection.id
      );
      const localCalendar = getCalendarById(source.calendarId);
      if (!calendar || localCalendar?.canWrite === false) {
        continue;
      }
      const remoteUrl =
        source.remoteHref ??
        new URL(`${source.remoteEventId}.ics`, calendar.url).toString();
      await state.client.updateCalendarObject({
        calendarObject: {
          url: remoteUrl,
          etag: source.remoteEtag ?? undefined,
          data: buildEventIcs({
            uid: source.remoteUid ?? event.id,
            title: event.title,
            startsAt: event.start_at,
            endsAt: event.end_at,
            description: event.description
          })
        }
      });
      registerCalendarEventSourceProjection({
        forgeEventId: eventId,
        provider: connection.provider,
        connectionId: connection.id,
        calendarId: source.calendarId,
        remoteCalendarId: getCalendarById(source.calendarId!)?.remoteId ?? null,
        remoteEventId: source.remoteEventId,
        remoteUid: source.remoteUid ?? event.id,
        recurrenceInstanceId: source.recurrenceInstanceId,
        isMasterRecurring: source.isMasterRecurring,
        remoteHref: remoteUrl,
        remoteEtag: source.remoteEtag,
        syncState: "synced",
        rawPayloadJson: JSON.stringify({ uid: source.remoteUid ?? event.id }),
        lastSyncedAt: new Date().toISOString()
      });
    }
    return;
  }

  if (!event.preferred_connection_id || !event.preferred_calendar_id) {
    return;
  }

  const { connection, state } = await resolveProviderStateForConnection(
    event.preferred_connection_id,
    secrets
  );
  if (state.mode !== "dav") {
    throw new Error(`Connection ${connection.id} is read-only, so Forge cannot publish this event there.`);
  }
  const calendar = resolveDavCalendarFromLocalId(
    state,
    event.preferred_calendar_id,
    connection.id
  );
  const localCalendar = getCalendarById(event.preferred_calendar_id);
  if (!calendar || localCalendar?.canWrite === false) {
    throw new Error(`Unknown remote calendar for event ${eventId}`);
  }

  const filename = `${event.id}.ics`;
  const remoteUrl = new URL(filename, calendar.url).toString();
  await state.client.createCalendarObject({
    calendar,
    iCalString: buildEventIcs({
      uid: event.id,
      title: event.title,
      startsAt: event.start_at,
      endsAt: event.end_at,
      description: event.description
    }),
    filename
  });
  registerCalendarEventSourceProjection({
    forgeEventId: eventId,
    provider: connection.provider,
    connectionId: connection.id,
    calendarId: event.preferred_calendar_id,
    remoteCalendarId: getCalendarById(event.preferred_calendar_id)?.remoteId ?? null,
    remoteEventId: event.id,
    remoteUid: event.id,
    remoteHref: remoteUrl,
    syncState: "synced",
    rawPayloadJson: JSON.stringify({ uid: event.id }),
    lastSyncedAt: new Date().toISOString()
  });
}

export async function pushCalendarEventUpdate(
  eventId: string,
  secrets: SecretsManager
) {
  await syncForgeCalendarEvent(eventId, secrets);
}

export async function deleteCalendarEventProjection(
  eventId: string,
  secrets: SecretsManager
) {
  const sources = listCalendarEventSources(eventId).filter(
    (source) => source.connectionId && source.calendarId && source.syncState !== "deleted"
  );
  for (const source of sources) {
    if (!source.calendarId) {
      continue;
    }
    const { connection, state } = await resolveProviderStateForConnection(
      source.connectionId!,
      secrets
    );
    if (state.mode !== "dav") {
      continue;
    }
    const calendar = resolveDavCalendarFromLocalId(
      state,
      source.calendarId,
      connection.id
    );
    const localCalendar = source.calendarId ? getCalendarById(source.calendarId) : null;
    if (!calendar || localCalendar?.canWrite === false) {
      continue;
    }
    const remoteUrl =
      source.remoteHref ??
      new URL(`${source.remoteEventId}.ics`, calendar.url).toString();
    await state.client.deleteCalendarObject({
      calendarObject: {
        url: remoteUrl,
        etag: source.remoteEtag ?? undefined
      }
    });
  }
  markCalendarEventSourcesSyncState(eventId, "deleted");
}

export function listCalendarProviderMetadata() {
  return [
    {
      provider: "google" as const,
      label: "Google Calendar",
      supportsDedicatedForgeCalendar: true,
      connectionHelp:
        "Forge uses one shared Google OAuth web app for everyone. Users sign in with Google, Forge stores a per-user refresh token, and the redirect only works from the configured Forge host and allowed local browser origins."
    },
    {
      provider: "apple" as const,
      label: "Apple Calendar",
      supportsDedicatedForgeCalendar: true,
      connectionHelp:
        "Use your Apple ID email and an app-specific password. Forge starts from https://caldav.icloud.com and discovers the calendars for you."
    },
    {
      provider: "microsoft" as const,
      label: "Exchange Online",
      supportsDedicatedForgeCalendar: false,
      connectionHelp:
        "Configure the Microsoft client ID and redirect URI in Settings first, then use the guided Microsoft sign-in flow. Forge mirrors the selected Exchange calendars in read-only mode for now."
    },
    {
      provider: "caldav" as const,
      label: "Custom CalDAV",
      supportsDedicatedForgeCalendar: true,
      connectionHelp:
        "Use a CalDAV base server URL plus account credentials. Forge discovers the calendars available under that account before you pick what to sync."
    }
  ];
}

export function listConnectedCalendarConnections() {
  return listCalendarConnections().map(
    ({ credentialsSecretId: _secret, ...connection }) => connection
  );
}
