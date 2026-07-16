import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SettingsModelsPage } from "@/pages/settings-models-page";

const { getSettingsMock, getWikiSettingsMock, testAiModelConnectionMock } =
  vi.hoisted(() => ({
    getSettingsMock: vi.fn(),
    getWikiSettingsMock: vi.fn(),
    testAiModelConnectionMock: vi.fn()
  }));

vi.mock("@/lib/api", () => ({
  getSettings: getSettingsMock,
  getWikiSettings: getWikiSettingsMock,
  testAiModelConnection: testAiModelConnectionMock,
  patchSettings: vi.fn(),
  saveAiModelConnection: vi.fn(),
  deleteAiModelConnection: vi.fn(),
  deleteWikiProfile: vi.fn(),
  createWikiEmbeddingProfile: vi.fn(),
  startOpenAiCodexOauth: vi.fn(),
  getOpenAiCodexOauthSession: vi.fn(),
  submitOpenAiCodexOauthManualCode: vi.fn()
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({ title }: { title: string }) => <h1>{title}</h1>
}));

vi.mock("@/components/settings/settings-section-nav", () => ({
  SettingsSectionNav: () => <div>Settings nav</div>,
  SettingsStateFrame: ({
    children
  }: {
    children: import("react").ReactNode;
  }) => (
    <>
      <div>Settings nav</div>
      {children}
    </>
  )
}));

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SettingsModelsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SettingsModelsPage", () => {
  beforeEach(() => {
    getSettingsMock.mockResolvedValue({
      settings: {
        modelSettings: {
          forgeAgent: {
            basicChat: {
              connectionId: "model_local",
              connectionLabel: "Local model",
              provider: "openai-compatible",
              baseUrl: "http://127.0.0.1:11434/v1",
              model: "qwen3"
            },
            wiki: {
              connectionId: null,
              connectionLabel: null,
              provider: null,
              baseUrl: null,
              model: "gpt-5.4-mini"
            }
          },
          connections: [
            {
              id: "model_local",
              label: "Local model",
              provider: "openai-compatible",
              authMode: "api_key",
              baseUrl: "http://127.0.0.1:11434/v1",
              model: "qwen3",
              accountLabel: null,
              enabled: true,
              status: "connected",
              hasStoredCredential: true,
              usesOAuth: false,
              supportsCustomBaseUrl: true,
              agentId: "agent_local",
              agentLabel: "Local model",
              createdAt: "2026-07-11T00:00:00.000Z",
              updatedAt: "2026-07-11T00:00:00.000Z"
            }
          ],
          oauth: {
            openAiCodex: {
              authorizeUrl: "https://example.test/authorize",
              callbackUrl: "http://127.0.0.1/callback",
              setupMessage: "Ready"
            }
          }
        }
      }
    });
    getWikiSettingsMock.mockResolvedValue({
      settings: { embeddingProfiles: [] }
    });
    testAiModelConnectionMock.mockResolvedValue({
      result: {
        provider: "openai-compatible",
        model: "qwen3",
        baseUrl: "http://127.0.0.1:11434/v1",
        reasoningEffort: null,
        verbosity: null,
        usingStoredKey: true,
        outputPreview: "ok"
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("health-checks a saved provider with its stored credential", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Test" }));

    await waitFor(() =>
      expect(testAiModelConnectionMock).toHaveBeenCalledWith({
        connectionId: "model_local",
        model: "qwen3"
      })
    );
    expect(await screen.findByText(/qwen3 responded: ok/i)).toBeInTheDocument();
  });

  it("shows local-offline failures without changing the configured default", async () => {
    testAiModelConnectionMock.mockRejectedValue(
      new Error("Local endpoint is offline")
    );
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Test" }));

    expect(
      await screen.findByText("Local endpoint is offline")
    ).toBeInTheDocument();
    expect(screen.getAllByRole("combobox")[0]).toHaveValue("model_local");
  });

  it("does not attach a saved connection id when testing edited target details", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByPlaceholderText("Base URL"), {
      target: { value: "https://changed.example.test/v1" }
    });

    const testButton = screen.getByRole("button", { name: "Test connection" });
    expect(testButton).toBeDisabled();

    fireEvent.change(
      screen.getByPlaceholderText("Leave blank to keep the stored key"),
      { target: { value: "fresh-test-key" } }
    );
    expect(testButton).toBeEnabled();
    fireEvent.click(testButton);

    await waitFor(() =>
      expect(testAiModelConnectionMock).toHaveBeenCalledWith({
        provider: "openai-compatible",
        baseUrl: "https://changed.example.test/v1",
        model: "qwen3",
        apiKey: "fresh-test-key"
      })
    );
  });
});
