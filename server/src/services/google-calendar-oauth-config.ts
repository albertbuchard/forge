import { createDecipheriv, createHash } from "node:crypto";

const GOOGLE_CALLBACK_PATH = "/api/v1/calendar/oauth/google/callback";
const DEFAULT_APP_PORT = "4317";
const DEFAULT_APP_BASE_URL = `http://127.0.0.1:${DEFAULT_APP_PORT}`;
const PACKAGED_DEFAULT_GOOGLE_CREDENTIAL_KEY_MATERIAL = [
  "forge",
  "desktop",
  "oauth",
  "default",
  "google",
  "bundle",
  "2026",
  "local"
] as const;
const PACKAGED_DEFAULT_GOOGLE_CLIENT_ID_ENCRYPTED = {
  iv: "2fc1a6723312a10b7d176f13",
  data: "9fbdf9dfcd1cc8674fa46150dd0f4678df8ce1ba52cdf0ceb4d4a76c9c5df01b3d8a21f194201c827524a6e06b0d4a55c7002edb3fa20b76b67f540e46ba28f506a73edaf6559a1d",
  tag: "1965dfe1213ecd888e46ea59241d03a9"
} as const;
const PACKAGED_DEFAULT_GOOGLE_CLIENT_SECRET_ENCRYPTED = {
  iv: "5a6ca66625e0ff5559b34f99",
  data: "b80dec231f029d92a13426ad3f0b851e20a5b35ec6691e517744fd65349144e75005f1",
  tag: "9d2cfd8a153d91f60d8c628bbe1c2f25"
} as const;
const DEFAULT_DEV_WEB_ORIGINS = [
  "http://127.0.0.1:3027",
  "http://localhost:3027"
];

function decryptPackagedGoogleOauthValue(payload: {
  iv: string;
  data: string;
  tag: string;
}) {
  const key = createHash("sha256")
    .update(PACKAGED_DEFAULT_GOOGLE_CREDENTIAL_KEY_MATERIAL.join(":"))
    .digest();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(payload.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.data, "hex")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}

const PACKAGED_DEFAULT_GOOGLE_CLIENT_ID = decryptPackagedGoogleOauthValue(
  PACKAGED_DEFAULT_GOOGLE_CLIENT_ID_ENCRYPTED
);
const PACKAGED_DEFAULT_GOOGLE_CLIENT_SECRET = decryptPackagedGoogleOauthValue(
  PACKAGED_DEFAULT_GOOGLE_CLIENT_SECRET_ENCRYPTED
);

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
