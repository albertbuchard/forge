import { describe, expect, it } from "vitest";
import { settingsFormSchema, settingsMutationSchema } from "./schemas";

const publicSettingsResponse = {
  profile: {
    operatorName: "Albert",
    operatorEmail: "albert@example.com",
    operatorTitle: "Operator"
  },
  notifications: {
    goalDriftAlerts: true,
    dailyQuestReminders: true,
    achievementCelebrations: true
  },
  execution: {
    maxActiveTasks: 2,
    timeAccountingMode: "split"
  },
  themePreference: "obsidian",
  gamificationTheme: "dramatic-smithie",
  customTheme: null,
  localePreference: "en",
  security: {
    integrityScore: 100,
    lastAuditAt: "2026-07-28T00:00:00.000Z",
    storageMode: "local-first",
    activeSessions: 1,
    tokenCount: 0
  },
  calendarProviders: {
    google: {
      clientId: "saved-client-id.apps.googleusercontent.com",
      storedClientId: "saved-client-id.apps.googleusercontent.com",
      hasStoredClientSecret: true,
      hasEffectiveClientSecret: true,
      clientSecretStorage: "encrypted",
      appBaseUrl: "http://127.0.0.1:4317",
      redirectUri:
        "http://127.0.0.1:4317/api/v1/calendar/oauth/google/callback",
      allowedOrigins: ["http://127.0.0.1:3027"],
      usesPkce: true,
      requiresServerClientSecret: false,
      oauthClientType: "desktop_app",
      authMode: "localhost_pkce",
      isConfigured: true,
      isReadyForPairing: true,
      isLocalOnly: true,
      runtimeOrigin: "http://127.0.0.1:4317",
      setupMessage: "Google Calendar is configured."
    }
  },
  modelSettings: {
    forgeAgent: {
      basicChat: {
        connectionId: null,
        model: ""
      },
      wiki: {
        connectionId: null,
        model: ""
      }
    }
  },
  agents: [],
  agentTokens: []
};

describe("settings form schema", () => {
  it("accepts a public settings response with a hidden stored Google secret", () => {
    const parsed = settingsFormSchema.parse(publicSettingsResponse);

    expect(parsed.profile.operatorName).toBe("Albert");
    expect("calendarProviders" in parsed).toBe(false);
    expect("modelSettings" in parsed).toBe(false);
    expect("security" in parsed).toBe(false);
  });

  it("keeps strict Google credential-pair validation on credential mutations", () => {
    const parsed = settingsMutationSchema.safeParse({
      ...publicSettingsResponse,
      calendarProviders: {
        google: {
          clientId: "only-client-id.apps.googleusercontent.com"
        }
      }
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["calendarProviders", "google", "clientSecret"]
          })
        ])
      );
    }
  });
});
