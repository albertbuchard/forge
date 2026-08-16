import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AgentMessagesPage } from "./agent-messages-page";
import type { AgentMessage } from "@/lib/agent-messages-api";

const apiMocks = vi.hoisted(() => ({
  activateVoiceReservation: vi.fn(),
  blobToBase64: vi.fn(),
  createAgentMessage: vi.fn(),
  createAgentMessageOperationKey: vi.fn(),
  createVoiceReservation: vi.fn(),
  deleteAgentMessage: vi.fn(),
  getAgentMessage: vi.fn(),
  getAgentMessageSettings: vi.fn(),
  listAgentMessages: vi.fn(),
  listConnectedMessageAgents: vi.fn(),
  markAgentMessageRead: vi.fn(),
  reassignAgentMessage: vi.fn(),
  retryAgentMessage: vi.fn(),
  updateDefaultMessageAgent: vi.fn()
}));

vi.mock("@/lib/agent-messages-api", () => apiMocks);

const createObjectURL = vi.fn(() => "blob:agent-message-voice");
const revokeObjectURL = vi.fn();
Object.defineProperty(URL, "createObjectURL", {
  configurable: true,
  value: createObjectURL
});
Object.defineProperty(URL, "revokeObjectURL", {
  configurable: true,
  value: revokeObjectURL
});

const agent = {
  id: "agent_primary",
  label: "Primary agent",
  provider: "codex",
  agentType: "assistant",
  connected: true,
  lastSeenAt: "2026-08-16T12:00:00.000Z"
};

const message: AgentMessage = {
  id: "message_1",
  sender: {
    kind: "human_user",
    userId: "user_operator",
    agentId: null,
    label: "Albert"
  },
  initialRecipient: { agentId: agent.id, label: agent.label },
  recipient: { agentId: agent.id, label: agent.label },
  forwardedFromMessageId: null,
  retriedFromMessageId: null,
  bodyText: "Prepare the asynchronous result.",
  voiceArtifact: null,
  status: "delivered",
  revision: 1,
  progressSummary: "",
  resultMarkdown: "",
  transcript: null,
  failure: null,
  claim: null,
  unreadInboxEventSequence: null,
  retentionUntil: "2027-08-16T12:00:00.000Z",
  deliveredAt: "2026-08-16T12:00:00.000Z",
  acknowledgedAt: null,
  handledAt: null,
  failedAt: null,
  forwardedAt: null,
  createdAt: "2026-08-16T12:00:00.000Z",
  updatedAt: "2026-08-16T12:00:00.000Z"
};

function resetApi() {
  apiMocks.listConnectedMessageAgents.mockResolvedValue({ agents: [agent] });
  apiMocks.getAgentMessageSettings.mockResolvedValue({
    defaultAgent: { id: agent.id, label: agent.label },
    retentionDays: 365,
    voice: {
      maximumBytes: 25 * 1024 * 1024,
      maximumDurationMs: 600_000,
      cellularThresholdBytes: 5 * 1024 * 1024,
      supportedMimeTypes: ["audio/wav"]
    },
    backgroundDelivery: "iOS schedules delivery when system execution is available."
  });
  apiMocks.listAgentMessages.mockResolvedValue({
    box: "outbox",
    items: [message],
    unreadThreadCount: 0,
    limit: 40,
    offset: 0,
    hasMore: false
  });
  apiMocks.getAgentMessage.mockResolvedValue({
    message,
    events: [],
    relatedMessages: []
  });
  apiMocks.createVoiceReservation.mockResolvedValue({
    reservation: { id: "reservation_1" },
    replayed: false
  });
  apiMocks.activateVoiceReservation.mockResolvedValue({
    reservation: { id: "reservation_1", status: "active" },
    replayed: false
  });
  apiMocks.createAgentMessage.mockResolvedValue({ message, replayed: false });
  apiMocks.blobToBase64.mockResolvedValue("UklGRg==");
  let sequence = 0;
  apiMocks.createAgentMessageOperationKey.mockImplementation(
    (prefix: string) => `${prefix}-stable-${++sequence}`
  );
}

function renderMessages(route = "/messages") {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/messages" element={<AgentMessagesPage />} />
          <Route path="/messages/:messageId" element={<AgentMessagesPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AgentMessagesPage", () => {
  it("truthfully falls back to text when immediate microphone capture is unavailable", async () => {
    resetApi();
    vi.stubGlobal("MediaRecorder", undefined);
    renderMessages("/messages?compose=voice");

    expect(
      await screen.findByRole("heading", { name: "Agent Messages" })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("alert")
    ).toHaveTextContent("Voice recording is not available in this browser");
    expect(screen.getByText(/slow, asynchronous mail/i)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /message/i })).toBeEnabled();
    expect(screen.getByText(/not live chat/i)).toBeInTheDocument();
  });

  it("sends text to the configured default agent", async () => {
    resetApi();
    renderMessages();
    const composer = await screen.findByRole("textbox", { name: /message/i });
    fireEvent.change(composer, {
      target: { value: "Handle this when you next poll the mailbox." }
    });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(apiMocks.createAgentMessage).toHaveBeenCalledTimes(1));
    expect(apiMocks.createAgentMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientAgentId: agent.id,
        bodyText: "Handle this when you next poll the mailbox."
      })
    );
    expect(await screen.findByText("Delivered to the agent inbox.")).toBeInTheDocument();
  });

  it("uses one stable upload identity for voice reservation and activation", async () => {
    resetApi();
    renderMessages();
    await screen.findByRole("heading", { name: "Agent Messages" });
    const file = new File([new Uint8Array([82, 73, 70, 70])], "voice.wav", {
      type: "audio/wav"
    });
    fireEvent.change(screen.getByLabelText(/choose audio/i), {
      target: { files: [file] }
    });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() =>
      expect(apiMocks.activateVoiceReservation).toHaveBeenCalledTimes(1)
    );
    const reservationInput = apiMocks.createVoiceReservation.mock.calls[0]?.[0] as {
      idempotencyKey: string;
    };
    const activationInput = apiMocks.activateVoiceReservation.mock.calls[0]?.[1] as {
      idempotencyKey: string;
    };
    expect(activationInput.idempotencyKey).toBe(reservationInput.idempotencyKey);
    expect(apiMocks.createAgentMessage).toHaveBeenCalledWith(
      expect.objectContaining({ voiceReservationId: "reservation_1" })
    );
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith(
      "blob:agent-message-voice"
    ));
  });

  it("renders immutable detail history and the sensitive-media boundary", async () => {
    resetApi();
    apiMocks.getAgentMessage.mockResolvedValue({
      message: {
        ...message,
        status: "acknowledged",
        voiceArtifact: {
          id: "artifact_voice",
          mimeType: "audio/wav",
          byteSize: 8_044,
          declaredDurationMs: 1_000,
          verifiedDurationMs: 1_000,
          sensitivity: "sensitive_media"
        },
        progressSummary: "The agent acknowledged the request."
      },
      events: [
        {
          id: "event_1",
          sequence: 1,
          event_kind: "acknowledgement",
          actor_kind: "agent",
          actor_id: agent.id,
          actor_label: agent.label,
          prior_status: "claimed",
          next_status: "acknowledged",
          occurred_at: "2026-08-16T12:01:00.000Z",
          metadata: {}
        }
      ],
      relatedMessages: []
    });
    renderMessages("/messages/message_1");

    expect(
      await screen.findByText("Original voice Artifact preserved")
    ).toBeInTheDocument();
    expect(screen.getByText(/not silently sent for transcription/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Audit history" })).toBeInTheDocument();
    expect(screen.getByText("acknowledgement")).toBeInTheDocument();
  });
});
