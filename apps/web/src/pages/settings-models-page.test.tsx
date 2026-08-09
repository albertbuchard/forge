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

const {
  getSettingsMock,
  getWikiSettingsMock,
  saveAiModelConnectionMock,
  testAiModelConnectionMock
} = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  getWikiSettingsMock: vi.fn(),
  saveAiModelConnectionMock: vi.fn(),
  testAiModelConnectionMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  getSettings: getSettingsMock,
  getWikiSettings: getWikiSettingsMock,
  testAiModelConnection: testAiModelConnectionMock,
  patchSettings: vi.fn(),
  saveAiModelConnection: saveAiModelConnectionMock,
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
    saveAiModelConnectionMock.mockResolvedValue({
      connection: { id: "model_local" }
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
      await screen.findByText(/Local endpoint is offline/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Forge did not switch to another connection/i)
    ).toBeInTheDocument();
    expect(screen.getAllByRole("combobox")[0]).toHaveValue("model_local");
  });

  it("does not attach a saved connection id when testing edited target details", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(
      await screen.findByText("Connection test succeeded: ok")
    ).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Base URL"), {
      target: { value: "https://changed.example.test/v1" }
    });

    const saveButton = screen.getByRole("button", { name: "Save connection" });
    const testButton = screen.getByRole("button", { name: "Test connection" });
    expect(saveButton).toBeDisabled();
    expect(testButton).toBeDisabled();
    expect(
      screen.getByText(/Enter a fresh API key before saving or testing/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Connection test succeeded: ok")
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Connection API key")).toHaveAttribute(
      "placeholder",
      "Enter a fresh API key"
    );

    fireEvent.change(screen.getByLabelText("Connection API key"), {
      target: { value: "fresh-test-key" }
    });
    expect(saveButton).toBeEnabled();
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

  it("clears saved-card health after updating the same connection", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Test" }));
    expect(await screen.findByText(/qwen3 responded: ok/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save connection" }));

    await waitFor(() =>
      expect(saveAiModelConnectionMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: "model_local" })
      )
    );
    expect(screen.queryByText(/qwen3 responded: ok/i)).not.toBeInTheDocument();
    expect(
      screen.getByText("Not health-checked in this browser session.")
    ).toBeInTheDocument();
  });

  it("explains missing keys and blank models before enabling an external connection", async () => {
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "OpenAI-compatible" })
    );
    const saveButton = screen.getByRole("button", { name: "Save connection" });
    const testButton = screen.getByRole("button", { name: "Test connection" });

    expect(saveButton).toBeDisabled();
    expect(testButton).toBeDisabled();
    expect(
      screen.getByText(/Enter an API key before saving or testing/i)
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Connection API key"), {
      target: { value: "fresh-test-key" }
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "Connection model" }),
      { target: { value: "" } }
    );

    expect(saveButton).toBeDisabled();
    expect(testButton).toBeDisabled();
    expect(
      screen.getByText(/Enter a model name before saving or testing/i)
    ).toBeInTheDocument();
  });

  it("names provider state and destructive controls with 44-pixel targets", async () => {
    getWikiSettingsMock.mockResolvedValueOnce({
      settings: {
        embeddingProfiles: [
          {
            id: "embedding_fast",
            label: "Fast wiki search",
            model: "text-embedding-3-small",
            baseUrl: "https://api.openai.com/v1",
            chunkSize: 1_200,
            chunkOverlap: 200,
            enabled: true
          }
        ]
      }
    });
    renderPage();

    const selectedProvider = await screen.findByRole("button", {
      name: "OpenAI API"
    });
    expect(selectedProvider).toHaveAttribute("aria-pressed", "true");
    expect(selectedProvider).toHaveClass("min-h-11");
    expect(
      screen.getByRole("button", {
        name: "Remove Fast wiki search embedding profile"
      })
    ).toHaveClass("min-h-11", "min-w-11");
    expect(
      screen.getByRole("button", { name: "Remove Local model connection" })
    ).toHaveClass("min-h-11", "min-w-11");
    expect(
      screen.getByRole("textbox", { name: "Connection model" })
    ).toHaveClass("min-h-11");
  });
});
