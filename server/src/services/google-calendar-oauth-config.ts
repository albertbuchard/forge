const GOOGLE_CALLBACK_PATH = "/api/v1/calendar/oauth/google/callback";
const DEFAULT_APP_PORT = "4317";
const DEFAULT_APP_BASE_URL = `http://127.0.0.1:${DEFAULT_APP_PORT}`;
const PACKAGED_DEFAULT_GOOGLE_CLIENT_ID =
  "208661368905-bc5v9t1h4uek8c550526k7d5ol0tk0rj.apps.googleusercontent.com";
const PACKAGED_DEFAULT_GOOGLE_CLIENT_SECRET =
  "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";
const DEFAULT_DEV_WEB_ORIGINS = [
  "http://127.0.0.1:3027",
  "http://localhost:3027"
];

export type GoogleCalendarOauthPublicConfig = {
  clientId: string;
  clientSecret: string;
  storedClientId: string;
  storedClientSecret: string;
  appBaseUrl: string;
  redirectUri: string;
  allowedOrigins: string[];
  usesPkce: true;
  requiresServerClientSecret: false;
  oauthClientType: "desktop_app";
  authMode: "localhost_pkce";
  isConfigured: boolean;
  isReadyForPairing: boolean;
  isLocalOnly: true;
  runtimeOrigin: string;
  setupMessage: string;
};

export type GoogleCalendarOauthPrivateConfig =
  GoogleCalendarOauthPublicConfig & {
    clientSecret: string;
  };

function runtimeOriginFromEnv(env: NodeJS.ProcessEnv) {
  const port = env.PORT?.trim() || DEFAULT_APP_PORT;
  return `http://127.0.0.1:${port}`;
}

function normalizeOrigin(value: string, fieldLabel: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${fieldLabel} must be a full URL.`);
  }

  if (url.protocol !== "http:") {
    throw new Error(`${fieldLabel} must use http in local Forge mode.`);
  }

  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error(`${fieldLabel} must not include a path.`);
  }

  return url.origin;
}

function isLoopbackHostname(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

function normalizeLoopbackOrigin(value: string, fieldLabel: string) {
  const origin = normalizeOrigin(value, fieldLabel);
  const url = new URL(origin);
  if (!isLoopbackHostname(url.hostname)) {
    throw new Error(
      `${fieldLabel} must use localhost or 127.0.0.1 in local Forge mode.`
    );
  }
  return origin;
}

function normalizeRedirectUri(value: string, appBaseUrl: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("GOOGLE_REDIRECT_URI must be a full URL.");
  }

  if (url.protocol !== "http:") {
    throw new Error("GOOGLE_REDIRECT_URI must use http in local Forge mode.");
  }

  if (!isLoopbackHostname(url.hostname)) {
    throw new Error(
      "GOOGLE_REDIRECT_URI must use localhost or 127.0.0.1 in local Forge mode."
    );
  }

  if (url.pathname !== GOOGLE_CALLBACK_PATH) {
    throw new Error(
      `GOOGLE_REDIRECT_URI must end with ${GOOGLE_CALLBACK_PATH}.`
    );
  }

  if (url.origin !== appBaseUrl) {
    throw new Error(
      `GOOGLE_REDIRECT_URI must use the same origin as APP_BASE_URL (${appBaseUrl}).`
    );
  }

  return url.toString();
}

function normalizeAllowedOrigins(
  value: string | undefined,
  appBaseUrl: string
) {
  const rawValues =
    value && value.trim().length > 0
      ? value
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      : [appBaseUrl, ...DEFAULT_DEV_WEB_ORIGINS];
  const normalized = rawValues.map((entry) =>
    normalizeLoopbackOrigin(entry, "GOOGLE_ALLOWED_ORIGINS")
  );
  return Array.from(new Set(normalized));
}

export function getGoogleCalendarOauthCallbackPath() {
  return GOOGLE_CALLBACK_PATH;
}

export function resolveGoogleCalendarOauthPublicConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides?: {
    clientId?: string | null;
    clientSecret?: string | null;
  }
): GoogleCalendarOauthPublicConfig {
  const runtimeOrigin = runtimeOriginFromEnv(env);
  const appBaseUrl = normalizeLoopbackOrigin(
    env.APP_BASE_URL?.trim() ||
      env.APP_URL?.trim() ||
      DEFAULT_APP_BASE_URL,
    env.APP_BASE_URL?.trim() ? "APP_BASE_URL" : "APP_URL"
  );
  const redirectUri = normalizeRedirectUri(
    env.GOOGLE_REDIRECT_URI?.trim() || `${appBaseUrl}${GOOGLE_CALLBACK_PATH}`,
    appBaseUrl
  );
  const allowedOrigins = normalizeAllowedOrigins(
    env.GOOGLE_ALLOWED_ORIGINS,
    appBaseUrl
  );
  const storedClientId = overrides?.clientId?.trim() || "";
  const storedClientSecret = overrides?.clientSecret?.trim() || "";
  const envClientId = env.GOOGLE_CLIENT_ID?.trim() || "";
  const envClientSecret = env.GOOGLE_CLIENT_SECRET?.trim() || "";
  const hasStoredOverride = storedClientId.length > 0 || storedClientSecret.length > 0;
  const hasEnvOverride = envClientId.length > 0 || envClientSecret.length > 0;
  const clientId = hasStoredOverride
    ? storedClientId
    : hasEnvOverride
      ? envClientId
      : PACKAGED_DEFAULT_GOOGLE_CLIENT_ID.trim();
  const clientSecret = hasStoredOverride
    ? storedClientSecret
    : hasEnvOverride
      ? envClientSecret
      : PACKAGED_DEFAULT_GOOGLE_CLIENT_SECRET.trim();
  const isConfigured = clientId.length > 0;
  const hasIncompleteStoredOverride =
    storedClientId.length > 0 !== storedClientSecret.length > 0;

  const setupMessage = hasIncompleteStoredOverride
    ? "Google OAuth override is incomplete for this Forge install. Save both the client ID and client secret together, or clear both fields to use the packaged default."
    : isConfigured
      ? "Google Calendar sign-in is configured for local Forge. Open Forge on localhost or 127.0.0.1 on the same machine that is running Forge, because Google will redirect back to the local callback on that machine."
      : "Google client ID is not set for this Forge install.";

  return {
    clientId,
    clientSecret,
    storedClientId,
    storedClientSecret,
    appBaseUrl,
    redirectUri,
    allowedOrigins,
    usesPkce: true,
    requiresServerClientSecret: false,
    oauthClientType: "desktop_app",
    authMode: "localhost_pkce",
    isConfigured,
    isReadyForPairing: isConfigured && !hasIncompleteStoredOverride,
    isLocalOnly: true,
    runtimeOrigin,
    setupMessage
  };
}

export function resolveGoogleCalendarOauthPrivateConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides?: {
    clientId?: string | null;
    clientSecret?: string | null;
  }
): GoogleCalendarOauthPrivateConfig {
  return resolveGoogleCalendarOauthPublicConfig(env, overrides);
}

export function isGoogleCalendarOriginAllowed(
  origin: string,
  allowedOrigins: string[]
) {
  try {
    return allowedOrigins.includes(new URL(origin).origin);
  } catch {
    return false;
  }
}

export function isGoogleCalendarLoopbackOrigin(origin: string) {
  try {
    return isLoopbackHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}
