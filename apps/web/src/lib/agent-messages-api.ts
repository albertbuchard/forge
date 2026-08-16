import { requestForgeBrowserJson } from "@/lib/api";

export type AgentMessageStatus =
  | "delivered"
  | "claimed"
  | "in_progress"
  | "acknowledged"
  | "handled"
  | "failed"
  | "forwarded";

export type ConnectedAgent = {
  id: string;
  label: string;
  provider: string | null;
  agentType: string;
  connected: boolean;
  lastSeenAt: string | null;
};

export type AgentMessage = {
  id: string;
  sender: {
    kind: "human_user" | "agent" | "system";
    userId: string | null;
    agentId: string | null;
    label: string;
  };
  initialRecipient: { agentId: string; label: string };
  recipient: { agentId: string; label: string };
  forwardedFromMessageId: string | null;
  retriedFromMessageId: string | null;
  bodyText: string;
  voiceArtifact: {
    id: string;
    mimeType: string;
    byteSize: number;
    declaredDurationMs: number;
    verifiedDurationMs: number;
    sensitivity: "sensitive_media";
  } | null;
  status: AgentMessageStatus;
  revision: number;
  progressSummary: string;
  resultMarkdown: string;
  transcript: {
    text: string;
    provider: string;
    disclosure: string;
  } | null;
  failure: { code: string; message: string } | null;
  claim: {
    agentId: string;
    generation: number;
    claimedAt: string;
    renewedAt: string | null;
    expiresAt: string;
  } | null;
  unreadInboxEventSequence: number | null;
  retentionUntil: string;
  deliveredAt: string;
  acknowledgedAt: string | null;
  handledAt: string | null;
  failedAt: string | null;
  forwardedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentMessageEvent = {
  id: string;
  sequence: number;
  event_kind: string;
  actor_kind: string;
  actor_id: string | null;
  actor_label: string;
  prior_status: AgentMessageStatus | null;
  next_status: AgentMessageStatus | null;
  occurred_at: string;
  metadata: Record<string, unknown>;
};

export type AgentMessageSettings = {
  defaultAgent: { id: string; label: string } | null;
  retentionDays: number;
  voice: {
    maximumBytes: number;
    maximumDurationMs: number;
    cellularThresholdBytes: number;
    supportedMimeTypes: string[];
  };
  backgroundDelivery: string;
};

export type AgentMessageList = {
  box: "inbox" | "outbox";
  items: AgentMessage[];
  unreadThreadCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type AgentMessageDetail = {
  message: AgentMessage;
  events: AgentMessageEvent[];
  relatedMessages: AgentMessage[];
};

function json<T>(path: string, init?: RequestInit) {
  return requestForgeBrowserJson(path, init) as Promise<T>;
}

export function listConnectedMessageAgents() {
  return json<{ agents: ConnectedAgent[] }>("/api/v1/agent-messages/agents");
}

export function getAgentMessageSettings() {
  return json<AgentMessageSettings>("/api/v1/agent-messages/settings");
}

export function updateDefaultMessageAgent(defaultAgentId: string) {
  return json<AgentMessageSettings>("/api/v1/agent-messages/settings", {
    method: "PATCH",
    body: JSON.stringify({ defaultAgentId })
  });
}

export function listAgentMessages(input: {
  box: "inbox" | "outbox";
  status?: AgentMessageStatus;
  limit?: number;
  offset?: number;
}) {
  const query = new URLSearchParams({
    box: input.box,
    limit: String(input.limit ?? 40),
    offset: String(input.offset ?? 0)
  });
  if (input.status) query.set("status", input.status);
  return json<AgentMessageList>(`/api/v1/agent-messages?${query.toString()}`);
}

export function getAgentMessage(id: string) {
  return json<AgentMessageDetail>(
    `/api/v1/agent-messages/${encodeURIComponent(id)}`
  );
}

export function createVoiceReservation(input: {
  idempotencyKey: string;
  originalFileName: string;
  declaredMimeType: string;
  declaredDurationMs: number;
}) {
  return json<{ reservation: { id: string }; replayed: boolean }>(
    "/api/v1/agent-messages/voice-reservations",
    { method: "POST", body: JSON.stringify(input) }
  );
}

export function activateVoiceReservation(
  id: string,
  input: {
    idempotencyKey: string;
    contentBase64: string;
    declaredMimeType: string;
    declaredDurationMs: number;
  }
) {
  return json<{ reservation: { id: string; status: "active" }; replayed: boolean }>(
    `/api/v1/agent-messages/voice-reservations/${encodeURIComponent(id)}`,
    { method: "PUT", body: JSON.stringify(input) }
  );
}

export function createAgentMessage(input: {
  idempotencyKey: string;
  recipientAgentId?: string;
  bodyText: string;
  voiceReservationId?: string;
  retentionDays?: number;
}) {
  return json<{ message: AgentMessage; replayed: boolean }>(
    "/api/v1/agent-messages",
    { method: "POST", body: JSON.stringify(input) }
  );
}

export function markAgentMessageRead(input: {
  messageId: string;
  operationKey: string;
  expectedInboxEventSequence: number;
}) {
  return json<{ messageId: string; readThroughEventSequence: number }>(
    `/api/v1/agent-messages/${encodeURIComponent(input.messageId)}/read`,
    {
      method: "POST",
      body: JSON.stringify({
        operationKey: input.operationKey,
        expectedInboxEventSequence: input.expectedInboxEventSequence
      })
    }
  );
}

export function reassignAgentMessage(input: {
  messageId: string;
  operationKey: string;
  expectedRevision: number;
  recipientAgentId: string;
  revokeActiveLease: boolean;
  reason: string;
}) {
  return json<{ message: AgentMessage }>(
    `/api/v1/agent-messages/${encodeURIComponent(input.messageId)}/reassign`,
    { method: "POST", body: JSON.stringify(input) }
  );
}

export function retryAgentMessage(input: {
  messageId: string;
  operationKey: string;
  recipientAgentId?: string;
}) {
  return json<{ message: AgentMessage; replayed: boolean }>(
    `/api/v1/agent-messages/${encodeURIComponent(input.messageId)}/retry`,
    {
      method: "POST",
      body: JSON.stringify({
        operationKey: input.operationKey,
        recipientAgentId: input.recipientAgentId
      })
    }
  );
}

export function deleteAgentMessage(messageId: string, reason: string) {
  return json<{ messageId: string; deletedAt: string }>(
    `/api/v1/agent-messages/${encodeURIComponent(messageId)}`,
    { method: "DELETE", body: JSON.stringify({ reason }) }
  );
}

export function createAgentMessageOperationKey(prefix: string) {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

export async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const block = 32_768;
  for (let offset = 0; offset < bytes.length; offset += block) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + block));
  }
  bytes.fill(0);
  return btoa(binary);
}
