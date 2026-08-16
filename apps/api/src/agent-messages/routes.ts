import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { HttpError } from "../errors.js";
import type { AuthContext } from "../managers/contracts.js";
import type { AuthorizationManager } from "../managers/platform/authorization-manager.js";
import { getDefaultUser } from "../repositories/users.js";
import { requireGatewayPrincipal } from "../security/access-gateway.js";
import {
  acknowledgeAgentMessage,
  activateVoiceReservation,
  claimAgentMessage,
  createAgentMessage,
  createVoiceReservation,
  deleteAgentMessage,
  failAgentMessage,
  forwardAgentMessage,
  getAgentMessageDetail,
  getAgentMessageSettings,
  handleAgentMessage,
  listAgentMessages,
  listConnectedAgents,
  markAgentMessageRead,
  pollAgentMessages,
  progressAgentMessage,
  readAgentMessageVoice,
  reassignAgentMessage,
  renewAgentMessageLease,
  retryAgentMessage,
  updateAgentMessageSettings,
  type AgentMessageActor
} from "./repository.js";
import {
  acknowledgeAgentMessageSchema,
  activateVoiceReservationSchema,
  agentMessageSettingsPatchSchema,
  claimAgentMessageSchema,
  createAgentMessageSchema,
  createVoiceReservationSchema,
  deleteAgentMessageSchema,
  failAgentMessageSchema,
  forwardAgentMessageSchema,
  handleAgentMessageSchema,
  leaseSecretSchema,
  listAgentMessagesQuerySchema,
  markAgentMessageReadSchema,
  progressAgentMessageSchema,
  reassignAgentMessageSchema,
  renewAgentMessageLeaseSchema,
  retryAgentMessageSchema
} from "./types.js";

const idParamsSchema = z.object({ id: z.string().trim().min(1).max(200) });
const reservationParamsSchema = z.object({
  id: z.string().trim().min(1).max(200)
});
const pollQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20)
});
const voiceReadSchema = z
  .object({
    leaseSecret: leaseSecretSchema,
    claimGeneration: z.number().int().min(1)
  })
  .strict();

type AgentMessageRouteDependencies = {
  authenticate(headers: Record<string, unknown>): AuthContext;
  authorization: AuthorizationManager;
  leaseDigestKey: Buffer;
};

function operatorActor(auth: AuthContext): {
  ownerUserId: string;
  senderUserId: string;
  senderLabel: string;
  actor: AgentMessageActor;
} {
  const user = getDefaultUser();
  return {
    ownerUserId: user.id,
    senderUserId: user.id,
    senderLabel: user.displayName,
    actor: {
      kind: "human_user",
      id: user.id,
      label: auth.session?.actorLabel ?? user.displayName,
      source: "ui"
    }
  };
}

function requireOperator(
  dependencies: AgentMessageRouteDependencies,
  request: FastifyRequest
) {
  const auth = dependencies.authenticate(
    request.headers as Record<string, unknown>
  );
  dependencies.authorization.requireAuthenticatedOperator(auth, {
    route: request.routeOptions.url
  });
  return operatorActor(auth);
}

function requireCompanion(request: FastifyRequest) {
  const principal = requireGatewayPrincipal(request);
  if (principal.kind !== "companion_session" || !principal.ownerId) {
    throw new HttpError(
      403,
      "agent_messages_companion_required",
      "A verified Forge companion session is required."
    );
  }
  return {
    ownerUserId: principal.ownerId,
    senderUserId: principal.ownerId,
    senderLabel: "Forge Companion",
    actor: {
      kind: "human_user" as const,
      id: principal.ownerId,
      label: "Forge Companion",
      source: "ui" as const
    }
  };
}

function requireAgent(
  dependencies: AgentMessageRouteDependencies,
  request: FastifyRequest,
  scopes: string[]
) {
  const auth = dependencies.authenticate(
    request.headers as Record<string, unknown>
  );
  dependencies.authorization.requireAuthenticatedActor(auth, {
    route: request.routeOptions.url
  });
  if (auth.session || !auth.token?.agentId) {
    throw new HttpError(
      403,
      "agent_messages_agent_required",
      "This Agent Messages operation requires a stable authenticated agent identity."
    );
  }
  dependencies.authorization.requireAllTokenScopes(auth, scopes, {
    route: request.routeOptions.url
  });
  return {
    auth,
    agentId: auth.token.agentId,
    ownerUserIds: auth.token.scopePolicy.userIds,
    actor: {
      kind: "agent" as const,
      id: auth.token.agentId,
      label: auth.token.agentLabel ?? auth.actor ?? "Forge agent",
      source: auth.source === "openclaw" ? ("openclaw" as const) : ("agent" as const)
    }
  };
}

function registerOwnerRoutes(
  app: FastifyInstance,
  dependencies: AgentMessageRouteDependencies,
  prefix: "/api/v1/agent-messages" | "/api/v1/mobile/agent-messages",
  owner: (request: FastifyRequest) => ReturnType<typeof operatorActor>
) {
  app.get(`${prefix}/agents`, async (request) => {
    const context = owner(request);
    return { agents: listConnectedAgents(context.ownerUserId) };
  });

  app.get(`${prefix}/settings`, async (request) => {
    const context = owner(request);
    return getAgentMessageSettings(context.ownerUserId);
  });

  app.patch(`${prefix}/settings`, async (request) => {
    const context = owner(request);
    const body = agentMessageSettingsPatchSchema.parse(request.body ?? {});
    return updateAgentMessageSettings({
      ownerUserId: context.ownerUserId,
      defaultAgentId: body.defaultAgentId,
      actor: context.actor
    });
  });

  app.get(prefix, async (request) => {
    const context = owner(request);
    const query = listAgentMessagesQuerySchema.parse(request.query ?? {});
    return listAgentMessages({ ownerUserId: context.ownerUserId, ...query });
  });

  app.get(`${prefix}/:id`, async (request) => {
    const context = owner(request);
    const params = idParamsSchema.parse(request.params ?? {});
    return getAgentMessageDetail(context.ownerUserId, params.id);
  });

  app.post(`${prefix}/:id/read`, async (request) => {
    const context = owner(request);
    const params = idParamsSchema.parse(request.params ?? {});
    const body = markAgentMessageReadSchema.parse(request.body ?? {});
    return markAgentMessageRead({
      ownerUserId: context.ownerUserId,
      messageId: params.id,
      operationKey: body.operationKey,
      expectedInboxEventSequence: body.expectedInboxEventSequence,
      actor: context.actor
    });
  });

  app.post(`${prefix}/voice-reservations`, async (request, reply) => {
    const context = owner(request);
    const body = createVoiceReservationSchema.parse(request.body ?? {});
    const result = createVoiceReservation({
      ownerUserId: context.ownerUserId,
      ...body
    });
    reply.code(result.replayed ? 200 : 201);
    reply.header("Idempotency-Replayed", String(result.replayed));
    return result;
  });

  app.put(
    `${prefix}/voice-reservations/:id`,
    { bodyLimit: 35 * 1024 * 1024 },
    async (request, reply) => {
      const context = owner(request);
      const params = reservationParamsSchema.parse(request.params ?? {});
      const body = activateVoiceReservationSchema.parse(request.body ?? {});
      const result = await activateVoiceReservation({
        ownerUserId: context.ownerUserId,
        reservationId: params.id,
        actor: context.actor,
        ...body
      });
      reply.header("Idempotency-Replayed", String(result.replayed));
      return result;
    }
  );

  app.post(prefix, async (request, reply) => {
    const context = owner(request);
    const body = createAgentMessageSchema.parse(request.body ?? {});
    const result = createAgentMessage({
      ownerUserId: context.ownerUserId,
      senderUserId: context.senderUserId,
      senderLabel: context.senderLabel,
      actor: context.actor,
      ...body
    });
    reply.code(result.replayed ? 200 : 201);
    reply.header("Idempotency-Replayed", String(result.replayed));
    return result;
  });

  app.post(`${prefix}/:id/reassign`, async (request) => {
    const context = owner(request);
    const params = idParamsSchema.parse(request.params ?? {});
    const body = reassignAgentMessageSchema.parse(request.body ?? {});
    return reassignAgentMessage({
      ownerUserId: context.ownerUserId,
      messageId: params.id,
      actor: context.actor,
      ...body
    });
  });

  app.post(`${prefix}/:id/retry`, async (request, reply) => {
    const context = owner(request);
    const params = idParamsSchema.parse(request.params ?? {});
    const body = retryAgentMessageSchema.parse(request.body ?? {});
    const result = retryAgentMessage({
      ownerUserId: context.ownerUserId,
      messageId: params.id,
      actor: context.actor,
      ...body
    });
    reply.code(result.replayed ? 200 : 201);
    reply.header("Idempotency-Replayed", String(result.replayed));
    return result;
  });

  app.delete(`${prefix}/:id`, async (request) => {
    const context = owner(request);
    const params = idParamsSchema.parse(request.params ?? {});
    const body = deleteAgentMessageSchema.parse(request.body ?? {});
    return deleteAgentMessage({
      ownerUserId: context.ownerUserId,
      messageId: params.id,
      reason: body.reason,
      actor: context.actor
    });
  });
}

export async function registerAgentMessageRoutes(
  app: FastifyInstance,
  dependencies: AgentMessageRouteDependencies
) {
  registerOwnerRoutes(app, dependencies, "/api/v1/agent-messages", (request) =>
    requireOperator(dependencies, request)
  );
  registerOwnerRoutes(
    app,
    dependencies,
    "/api/v1/mobile/agent-messages",
    requireCompanion
  );

  app.get("/api/v1/agent-messages/poll", async (request) => {
    const agent = requireAgent(dependencies, request, ["agentMessages.poll"]);
    const query = pollQuerySchema.parse(request.query ?? {});
    return pollAgentMessages({
      agentId: agent.agentId,
      ownerUserIds: agent.ownerUserIds,
      limit: query.limit
    });
  });

  app.post("/api/v1/agent-messages/:id/claim", async (request) => {
    const agent = requireAgent(dependencies, request, ["agentMessages.claim"]);
    const params = idParamsSchema.parse(request.params ?? {});
    const body = claimAgentMessageSchema.parse(request.body ?? {});
    return claimAgentMessage({
      messageId: params.id,
      agentId: agent.agentId,
      actor: agent.actor,
      leaseDigestKey: dependencies.leaseDigestKey,
      ...body
    });
  });

  app.post("/api/v1/agent-messages/:id/lease", async (request) => {
    const agent = requireAgent(dependencies, request, ["agentMessages.claim"]);
    const params = idParamsSchema.parse(request.params ?? {});
    const body = renewAgentMessageLeaseSchema.parse(request.body ?? {});
    return renewAgentMessageLease({
      messageId: params.id,
      agentId: agent.agentId,
      actor: agent.actor,
      leaseDigestKey: dependencies.leaseDigestKey,
      ...body
    });
  });

  app.post("/api/v1/agent-messages/:id/progress", async (request) => {
    const agent = requireAgent(dependencies, request, ["agentMessages.progress"]);
    const params = idParamsSchema.parse(request.params ?? {});
    const body = progressAgentMessageSchema.parse(request.body ?? {});
    return progressAgentMessage({
      messageId: params.id,
      agentId: agent.agentId,
      actor: agent.actor,
      leaseDigestKey: dependencies.leaseDigestKey,
      ...body
    });
  });

  app.post("/api/v1/agent-messages/:id/acknowledge", async (request) => {
    const agent = requireAgent(dependencies, request, ["agentMessages.progress"]);
    const params = idParamsSchema.parse(request.params ?? {});
    const body = acknowledgeAgentMessageSchema.parse(request.body ?? {});
    return acknowledgeAgentMessage({
      messageId: params.id,
      agentId: agent.agentId,
      actor: agent.actor,
      leaseDigestKey: dependencies.leaseDigestKey,
      ...body
    });
  });

  app.post("/api/v1/agent-messages/:id/handle", async (request) => {
    const agent = requireAgent(dependencies, request, ["agentMessages.complete"]);
    const params = idParamsSchema.parse(request.params ?? {});
    const body = handleAgentMessageSchema.parse(request.body ?? {});
    return handleAgentMessage({
      messageId: params.id,
      agentId: agent.agentId,
      actor: agent.actor,
      leaseDigestKey: dependencies.leaseDigestKey,
      ...body
    });
  });

  app.post("/api/v1/agent-messages/:id/fail", async (request) => {
    const agent = requireAgent(dependencies, request, ["agentMessages.complete"]);
    const params = idParamsSchema.parse(request.params ?? {});
    const body = failAgentMessageSchema.parse(request.body ?? {});
    return failAgentMessage({
      messageId: params.id,
      agentId: agent.agentId,
      actor: agent.actor,
      leaseDigestKey: dependencies.leaseDigestKey,
      ...body
    });
  });

  app.post("/api/v1/agent-messages/:id/forward", async (request) => {
    const agent = requireAgent(dependencies, request, ["agentMessages.forward"]);
    const params = idParamsSchema.parse(request.params ?? {});
    const body = forwardAgentMessageSchema.parse(request.body ?? {});
    return forwardAgentMessage({
      messageId: params.id,
      agentId: agent.agentId,
      actor: agent.actor,
      leaseDigestKey: dependencies.leaseDigestKey,
      ...body
    });
  });

  app.post("/api/v1/agent-messages/:id/voice", async (request, reply) => {
    const agent = requireAgent(dependencies, request, [
      "agentMessages.voice.read"
    ]);
    const params = idParamsSchema.parse(request.params ?? {});
    const body = voiceReadSchema.parse(request.body ?? {});
    const voice = await readAgentMessageVoice({
      messageId: params.id,
      agentId: agent.agentId,
      ownerUserIds: agent.ownerUserIds,
      leaseDigestKey: dependencies.leaseDigestKey,
      ...body
    });
    reply.header("Content-Type", voice.mimeType);
    reply.header("Content-Length", String(voice.byteSize));
    reply.header("ETag", `"sha256:${voice.contentSha256}"`);
    reply.header("X-Forge-Artifact-Id", voice.artifactId);
    reply.header("X-Forge-Content-Sha256", voice.contentSha256);
    reply.header("Cache-Control", "private, no-store");
    return reply.send(voice.bytes);
  });
}
