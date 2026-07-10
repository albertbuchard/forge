import type {
  CalendarConnectionStatus,
  CalendarProvider,
  GoogleCalendarAuthSettings,
  MicrosoftCalendarAuthSettings
} from "@/lib/types";

export type ConnectionDraft = {
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

export type ExistingCalendarConnection = {
  id: string;
  label: string;
  provider: CalendarProvider;
  status: CalendarConnectionStatus;
  accountLabel?: string;
  forgeCalendarId?: string | null;
  config?: Record<string, string | number | boolean | null>;
};

export type GooglePopupMessage = {
  type?: string;
  sessionId?: string;
  status?: string;
};

export type MicrosoftPopupMessage = {
  type?: string;
  sessionId?: string;
  status?: string;
};

export type MicrosoftSettingsDraft = {
  clientId: string;
  tenantId: string;
  redirectUri: string;
};

export type GoogleSettingsDraft = {
  clientId: string;
  clientSecret: string;
};

const MICROSOFT_CALLBACK_PATH = "/api/v1/calendar/oauth/microsoft/callback";
const MICROSOFT_CLIENT_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export const OAUTH_SESSION_POLL_INTERVAL_MS = 1000;

export const PROVIDER_DEFAULTS: Record<
  CalendarProvider,
  { label: string; serverUrl: string }
> = {
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

export function createDraft(provider: CalendarProvider): ConnectionDraft {
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

export function normalizeLabel(provider: CalendarProvider, label: string) {
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : PROVIDER_DEFAULTS[provider].label;
}

export function buildMicrosoftSettingsDraft(
  microsoftSetup: MicrosoftCalendarAuthSettings
): MicrosoftSettingsDraft {
  return {
    clientId: microsoftSetup.clientId,
    tenantId: microsoftSetup.tenantId,
    redirectUri: microsoftSetup.redirectUri
  };
}

export function buildGoogleSettingsDraft(
  googleSetup: GoogleCalendarAuthSettings
): GoogleSettingsDraft {
  return {
    clientId: googleSetup.storedClientId ?? "",
    clientSecret: googleSetup.storedClientSecret ?? ""
  };
}

export function sanitizeGoogleSetupMessage(message: string) {
  return message
    .replace(
      /\s*No GOOGLE_CLIENT_SECRET is used in this local PKCE flow\./gi,
      ""
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function buildGoogleClientIdMissingMessage() {
  return [
    "Google OAuth credentials are not set for this Forge install.",
    "- Save a Google desktop-app client ID and client secret below for this Forge install.",
    "- Or rely on the packaged or environment defaults for the Forge runtime."
  ].join("\n");
}

export function buildGoogleRouteErrorMessage(
  routeMessage: string,
  allowedOrigins: string[]
) {
  return [
    routeMessage,
    `- Open Forge from a local browser on the host running Forge.`,
    `- Use one of these local addresses: ${allowedOrigins.join(", ")}.`
  ].join("\n");
}

export function normalizeGoogleSettingsDraft(
  draft: GoogleSettingsDraft
): GoogleSettingsDraft {
  return {
    clientId: (draft.clientId ?? "").trim(),
    clientSecret: (draft.clientSecret ?? "").trim()
  };
}

export function sameGoogleSettingsDraft(
  left: GoogleSettingsDraft,
  right: GoogleSettingsDraft
) {
  return (
    left.clientId.trim() === right.clientId.trim() &&
    left.clientSecret.trim() === right.clientSecret.trim()
  );
}

export function validateGoogleSettingsDraft(draft: GoogleSettingsDraft) {
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

export function normalizeMicrosoftSettingsDraft(
  draft: MicrosoftSettingsDraft
): MicrosoftSettingsDraft {
  return {
    clientId: draft.clientId.trim(),
    tenantId: draft.tenantId.trim() || "common",
    redirectUri: draft.redirectUri.trim()
  };
}

export function validateMicrosoftSettingsDraft(
  draft: MicrosoftSettingsDraft
) {
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

export function sameMicrosoftSettingsDraft(
  left: MicrosoftSettingsDraft,
  right: MicrosoftSettingsDraft
) {
  return (
    left.clientId.trim() === right.clientId.trim() &&
    left.tenantId.trim() === right.tenantId.trim() &&
    left.redirectUri.trim() === right.redirectUri.trim()
  );
}

export function isLoopbackHostname(hostname: string) {
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
