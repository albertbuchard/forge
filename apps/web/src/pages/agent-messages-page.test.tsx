import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import {
  AgentMessagesPage,
  agentMessageNotification
} from "./agent-messages-page";
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
    backgroundDelivery:
      "iOS schedules delivery when system execution is available."
  });
  apiMocks.listAgentMessages.mockResolvedValue({
    box: "outbox",
    items: [message],
    unreadThreadCount: 0,
    limit: 20,
    cursor: null,
    nextCursor: null,
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
  apiMocks.markAgentMessageRead.mockResolvedValue({
    messageId: message.id,
    replayed: false
  });
  apiMocks.reassignAgentMessage.mockResolvedValue({
    messageId: message.id,
    status: "delivered",
    revision: 2,
    replayed: false
  });
  apiMocks.retryAgentMessage.mockResolvedValue({
    sourceMessageId: message.id,
    resultingMessageId: "message_retry",
    status: "delivered",
    revision: 1,
    claimGeneration: 0,
    eventSequence: 1,
    replayed: false
  });
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
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Voice recording is not available in this browser"
    );
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

    await waitFor(() =>
      expect(apiMocks.createAgentMessage).toHaveBeenCalledTimes(1)
    );
    expect(apiMocks.createAgentMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientAgentId: agent.id,
        bodyText: "Handle this when you next poll the mailbox."
      })
    );
    expect(
      await screen.findByText("Delivered to the agent inbox.")
    ).toBeInTheDocument();
  });

  it("uses one stable upload identity for voice reservation and activation", async () => {
    resetApi();
    renderMessages();
    await screen.findByRole("heading", { name: "Agent Messages" });
    const file = new File([new Uint8Array([82, 73, 70, 70])], "voice.wav", {
      type: "audio/aac"
    });
    fireEvent.change(screen.getByLabelText(/choose audio/i), {
      target: { files: [file] }
    });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() =>
      expect(apiMocks.activateVoiceReservation).toHaveBeenCalledTimes(1)
    );
    const reservationInput = apiMocks.createVoiceReservation.mock
      .calls[0]?.[0] as {
      idempotencyKey: string;
    };
    const activationInput = apiMocks.activateVoiceReservation.mock
      .calls[0]?.[1] as {
      idempotencyKey: string;
    };
    expect(activationInput.idempotencyKey).toBe(
      reservationInput.idempotencyKey
    );
    expect(
      apiMocks.createVoiceReservation.mock.calls[0]?.[0].originalFileName
    ).toMatch(/\.aac$/u);
    expect(apiMocks.createAgentMessage).toHaveBeenCalledWith(
      expect.objectContaining({ voiceReservationId: "reservation_1" })
    );
    await waitFor(() =>
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:agent-message-voice")
    );
  });

  it("reuses the message identity after an ambiguous text-send response loss", async () => {
    resetApi();
    apiMocks.createAgentMessage
      .mockRejectedValueOnce(new Error("The response was lost."))
      .mockResolvedValueOnce({ message, replayed: true });
    renderMessages();
    fireEvent.change(await screen.findByRole("textbox", { name: /message/i }), {
      target: { value: "Retry this exact text safely." }
    });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    expect(
      await screen.findByText("The response was lost.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    await waitFor(() =>
      expect(apiMocks.createAgentMessage).toHaveBeenCalledTimes(2)
    );
    expect(apiMocks.createAgentMessage.mock.calls[1]?.[0].idempotencyKey).toBe(
      apiMocks.createAgentMessage.mock.calls[0]?.[0].idempotencyKey
    );
    expect(apiMocks.createAgentMessage.mock.calls[1]?.[0].bodyText).toBe(
      "Retry this exact text safely."
    );
  });

  it.each(["reservation", "activation", "message"] as const)(
    "reuses every voice identity after an ambiguous %s response loss",
    async (phase) => {
      resetApi();
      if (phase === "reservation") {
        apiMocks.createVoiceReservation
          .mockRejectedValueOnce(new Error("Reservation response lost."))
          .mockResolvedValue({
            reservation: { id: "reservation_1" },
            replayed: true
          });
      } else if (phase === "activation") {
        apiMocks.activateVoiceReservation
          .mockRejectedValueOnce(new Error("Activation response lost."))
          .mockResolvedValue({
            reservation: { id: "reservation_1", status: "active" },
            replayed: true
          });
      } else {
        apiMocks.createAgentMessage
          .mockRejectedValueOnce(new Error("Message response lost."))
          .mockResolvedValue({ message, replayed: true });
      }
      renderMessages();
      await screen.findByRole("heading", { name: "Agent Messages" });
      const file = new File([new Uint8Array([82, 73, 70, 70])], "voice.wav", {
        type: "audio/wav"
      });
      fireEvent.change(screen.getByLabelText(/choose audio/i), {
        target: { files: [file] }
      });
      fireEvent.click(screen.getByRole("button", { name: /send message/i }));
      expect(
        await screen.findByText(new RegExp(`${phase} response lost`, "i"))
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /send message/i }));
      await waitFor(() =>
        expect(apiMocks.createAgentMessage).toHaveBeenCalled()
      );
      const reservationCalls = apiMocks.createVoiceReservation.mock.calls;
      expect(reservationCalls.at(-1)?.[0].idempotencyKey).toBe(
        reservationCalls[0]?.[0].idempotencyKey
      );
      const activationCalls = apiMocks.activateVoiceReservation.mock.calls;
      if (activationCalls.length > 1) {
        expect(activationCalls.at(-1)?.[1]).toEqual(activationCalls[0]?.[1]);
      }
      const messageCalls = apiMocks.createAgentMessage.mock.calls;
      if (messageCalls.length > 1) {
        expect(messageCalls.at(-1)?.[0].idempotencyKey).toBe(
          messageCalls[0]?.[0].idempotencyKey
        );
        expect(messageCalls.at(-1)?.[0].voiceReservationId).toBe(
          messageCalls[0]?.[0].voiceReservationId
        );
      }
    }
  );

  it("keeps owner operation identity stable and consumes the flat retry receipt", async () => {
    resetApi();
    const unreadFailed = {
      ...message,
      status: "failed" as const,
      unreadInboxEventSequence: 3,
      failure: { code: "provider_missing", message: "No provider configured." }
    };
    apiMocks.getAgentMessage.mockImplementation(async (id: string) => ({
      message: id === "message_retry" ? { ...message, id } : unreadFailed,
      events: [],
      relatedMessages: [
        id === "message_retry" ? { ...message, id } : unreadFailed
      ]
    }));
    apiMocks.markAgentMessageRead
      .mockRejectedValueOnce(new Error("Read response lost."))
      .mockResolvedValue({ messageId: message.id, replayed: true });
    renderMessages("/messages/message_1");
    const readButton = await screen.findByRole("button", {
      name: /mark agent activity read/i
    });
    fireEvent.click(readButton);
    await waitFor(() =>
      expect(apiMocks.markAgentMessageRead).toHaveBeenCalledTimes(1)
    );
    fireEvent.click(readButton);
    await waitFor(() =>
      expect(apiMocks.markAgentMessageRead).toHaveBeenCalledTimes(2)
    );
    expect(apiMocks.markAgentMessageRead.mock.calls[1]?.[0].operationKey).toBe(
      apiMocks.markAgentMessageRead.mock.calls[0]?.[0].operationKey
    );
    fireEvent.click(
      screen.getByRole("button", { name: /retry as new message/i })
    );
    await waitFor(() =>
      expect(apiMocks.getAgentMessage).toHaveBeenCalledWith("message_retry")
    );
  });

  it("provides status filters and cursor paging on a phone-width mailbox", async () => {
    resetApi();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390
    });
    apiMocks.listAgentMessages.mockImplementation(
      async (input: {
        box: "inbox" | "outbox";
        status?: string;
        cursor?: string;
        limit: number;
      }) => ({
        box: input.box,
        items: [message],
        unreadThreadCount: 0,
        limit: input.limit,
        cursor: input.cursor ?? null,
        nextCursor: input.cursor ? null : "cursor-page-two",
        hasMore: !input.cursor
      })
    );
    renderMessages();
    await screen.findByRole("heading", { name: "Agent Messages" });
    fireEvent.click(screen.getByRole("button", { name: "Delivered" }));
    await waitFor(() =>
      expect(apiMocks.listAgentMessages).toHaveBeenCalledWith(
        expect.objectContaining({ status: "delivered", limit: 20 })
      )
    );
    const older = await screen.findByRole("button", {
      name: /older messages/i
    });
    expect(older).toBeEnabled();
    fireEvent.click(older);
    await waitFor(() =>
      expect(apiMocks.listAgentMessages).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "delivered",
          cursor: "cursor-page-two"
        })
      )
    );
    expect(
      await screen.findByRole("button", { name: /newer messages/i })
    ).toBeEnabled();
  });

  it("keeps notification metadata generic even when message content is sensitive", () => {
    const sentinel = "PRIVATE_PROGRESS_SENTINEL";
    const sensitive = {
      ...message,
      bodyText: sentinel,
      progressSummary: sentinel,
      resultMarkdown: sentinel,
      status: "in_progress" as const,
      failure: { code: sentinel, message: sentinel }
    };
    const notification = agentMessageNotification(
      sensitive.recipient.label,
      sensitive.status
    );
    expect(JSON.stringify(notification)).not.toContain(sentinel);
    expect(notification.options.body).toBe(
      "Agent Message status: In progress."
    );
    expect(notification.options.tag).toBe("forge-agent-message-update");
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
      relatedMessages: [
        message,
        {
          ...message,
          id: "message_2",
          sender: {
            kind: "agent",
            userId: null,
            agentId: agent.id,
            label: agent.label
          },
          forwardedFromMessageId: message.id,
          status: "acknowledged"
        }
      ]
    });
    renderMessages("/messages/message_1");

    expect(
      await screen.findByText("Original voice Artifact preserved")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/not silently sent for transcription/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Audit history" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Message thread" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/forwarded · primary agent to primary agent/i)
    ).toBeInTheDocument();
    expect(screen.getByText("acknowledgement")).toBeInTheDocument();
  });
});
