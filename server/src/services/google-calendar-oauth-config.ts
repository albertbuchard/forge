const GOOGLE_CALLBACK_PATH = "/api/v1/calendar/oauth/google/callback";
const DEFAULT_APP_PORT = "4317";
const DEFAULT_APP_URL = `http://127.0.0.1:${DEFAULT_APP_PORT}`;
const DEFAULT_DEV_WEB_ORIGIN = "http://127.0.0.1:3027";

export type GoogleCalendarOauthPublicConfig = {
  clientId: string;
  appUrl: string;
  redirectUri: string;
  allowedOrigins: string[];
  usesSharedAppCredentials: true;
  authMode: "shared_web_server_oauth";
  isConfigured: boolean;
  isReadyForPairing: boolean;
  runtimeOrigin: string;
  runtimeOriginMatchesAppUrl: boolean;
  setupMessage: string;
};

export type GoogleCalendarOauthPrivateConfig = GoogleCalendarOauthPublicConfig & {
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

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${fieldLabel} must use http or https.`);
  }

  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error(`${fieldLabel} must not include a path.`);
  }

  return url.origin;
}

function normalizeRedirectUri(value: string, appOrigin: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("GOOGLE_REDIRECT_URI must be a full URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("GOOGLE_REDIRECT_URI must use http or https.");
  }

  if (url.pathname !== GOOGLE_CALLBACK_PATH) {
    throw new Error(
      `GOOGLE_REDIRECT_URI must end with ${GOOGLE_CALLBACK_PATH}.`
    );
  }

  if (url.origin !== appOrigin) {
    throw new Error(
      `GOOGLE_REDIRECT_URI must use the same origin as APP_URL (${appOrigin}).`
    );
  }

  return url.toString();
}

function defaultAllowedOrigins(appOrigin: string) {
  if (appOrigin === DEFAULT_APP_URL) {
    return [appOrigin, DEFAULT_DEV_WEB_ORIGIN];
  }
  return [appOrigin];
}

function normalizeAllowedOrigins(
  value: string | undefined,
  appOrigin: string
) {
  const rawValues =
    value && value.trim().length > 0
      ? value
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      : defaultAllowedOrigins(appOrigin);
  const normalized = rawValues.map((entry) =>
    normalizeOrigin(entry, "GOOGLE_ALLOWED_ORIGINS")
  );
  return Array.from(new Set(normalized));
}

export function getGoogleCalendarOauthCallbackPath() {
  return GOOGLE_CALLBACK_PATH;
}

export function resolveGoogleCalendarOauthPublicConfig(
  env: NodeJS.ProcessEnv = process.env
): GoogleCalendarOauthPublicConfig {
  const runtimeOrigin = runtimeOriginFromEnv(env);
  const appUrl = normalizeOrigin(env.APP_URL?.trim() || runtimeOrigin, "APP_URL");
  const redirectUri = normalizeRedirectUri(
    env.GOOGLE_REDIRECT_URI?.trim() || `${appUrl}${GOOGLE_CALLBACK_PATH}`,
    appUrl
  );
  const allowedOrigins = normalizeAllowedOrigins(
    env.GOOGLE_ALLOWED_ORIGINS,
    appUrl
  );
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  const isConfigured = clientId.length > 0 && clientSecret.length > 0;
  const runtimeOriginMatchesAppUrl = runtimeOrigin === appUrl;

  let setupMessage = "";
  if (!isConfigured) {
    setupMessage =
      "Google Calendar pairing is not configured yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for the shared Forge app, then restart Forge.";
  } else if (!runtimeOriginMatchesAppUrl) {
    setupMessage = `Google Calendar pairing is configured for ${appUrl}. This backend currently looks local on ${runtimeOrigin}. Open Forge on the configured host or update APP_URL so the callback origin matches the running Forge runtime.`;
  } else {
    setupMessage =
      "Google Calendar pairing is configured for the shared Forge app. Users only sign in with their own Google accounts; they do not create their own OAuth clients.";
  }

  return {
    clientId,
    appUrl,
    redirectUri,
    allowedOrigins,
    usesSharedAppCredentials: true,
    authMode: "shared_web_server_oauth",
    isConfigured,
    isReadyForPairing: isConfigured,
    runtimeOrigin,
    runtimeOriginMatchesAppUrl,
    setupMessage
  };
}

export function resolveGoogleCalendarOauthPrivateConfig(
  env: NodeJS.ProcessEnv = process.env
): GoogleCalendarOauthPrivateConfig {
  const publicConfig = resolveGoogleCalendarOauthPublicConfig(env);
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  return {
    ...publicConfig,
    clientSecret
  };
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
