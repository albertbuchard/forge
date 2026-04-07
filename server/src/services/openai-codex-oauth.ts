import { randomUUID } from "node:crypto";
import {
  loginOpenAICodex,
  type OAuthCredentials
} from "@mariozechner/pi-ai/oauth";
import {
  openAiCodexOauthSessionSchema,
  type OpenAiCodexOauthSession
} from "../types.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

type SessionRecord = {
  publicSession: OpenAiCodexOauthSession;
  manualInput: Deferred<string>;
  credentials: OAuthCredentials | null;
};

const sessions = new Map<string, SessionRecord>();
const SESSION_TTL_MS = 15 * 60 * 1000;

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function updateSession(
  sessionId: string,
  patch: Partial<OpenAiCodexOauthSession>
) {
  const existing = sessions.get(sessionId);
  if (!existing) {
    throw new Error(`Unknown OpenAI Codex OAuth session ${sessionId}`);
  }
  existing.publicSession = openAiCodexOauthSessionSchema.parse({
    ...existing.publicSession,
    ...patch
  });
  return existing.publicSession;
}

function requireRecord(sessionId: string) {
  const record = sessions.get(sessionId);
  if (!record) {
    throw new Error(`Unknown OpenAI Codex OAuth session ${sessionId}`);
  }
  const expiresAt = new Date(record.publicSession.expiresAt).getTime();
  if (Date.now() >= expiresAt && record.publicSession.status !== "authorized") {
    record.publicSession = openAiCodexOauthSessionSchema.parse({
      ...record.publicSession,
      status: "expired"
    });
  }
  return record;
}

function parseError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function startOpenAiCodexOauthSession() {
  const id = `ocx_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const now = new Date();
  const record: SessionRecord = {
    publicSession: openAiCodexOauthSessionSchema.parse({
      id,
      status: "starting",
      authUrl: null,
      accountLabel: null,
      error: null,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
      credentialExpiresAt: null
    }),
    manualInput: createDeferred<string>(),
    credentials: null
  };
  sessions.set(id, record);

  void loginOpenAICodex({
    onAuth: ({ url }) => {
      updateSession(id, {
        status: "awaiting_browser",
        authUrl: url,
        error: null
      });
    },
    onPrompt: async () => {
      updateSession(id, {
        status: "awaiting_manual_input"
      });
      return await record.manualInput.promise;
    },
    onManualCodeInput: async () => {
      updateSession(id, {
        status: "awaiting_manual_input"
      });
      return await record.manualInput.promise;
    }
  })
    .then((credentials) => {
      record.credentials = credentials;
      updateSession(id, {
        status: "authorized",
        accountLabel:
          typeof credentials.accountId === "string"
            ? credentials.accountId
            : null,
        credentialExpiresAt:
          typeof credentials.expires === "number"
            ? new Date(credentials.expires).toISOString()
            : null
      });
    })
    .catch((error) => {
      updateSession(id, {
        status: "error",
        error: parseError(error)
      });
    });

  return record.publicSession;
}

export function getOpenAiCodexOauthSession(sessionId: string) {
  return requireRecord(sessionId).publicSession;
}

export function submitOpenAiCodexOauthManualInput(
  sessionId: string,
  codeOrUrl: string
) {
  const record = requireRecord(sessionId);
  if (
    record.publicSession.status !== "awaiting_browser" &&
    record.publicSession.status !== "awaiting_manual_input" &&
    record.publicSession.status !== "starting"
  ) {
    throw new Error("OpenAI Codex OAuth session is not waiting for input.");
  }
  record.manualInput.resolve(codeOrUrl);
  return updateSession(sessionId, {
    status: "awaiting_manual_input"
  });
}

export function consumeOpenAiCodexOauthCredentials(sessionId: string) {
  const record = requireRecord(sessionId);
  if (record.publicSession.status !== "authorized" || !record.credentials) {
    throw new Error("OpenAI Codex OAuth session is not authorized yet.");
  }
  updateSession(sessionId, {
    status: "consumed"
  });
  return {
    kind: "oauth" as const,
    provider: "openai-codex" as const,
    access: String(record.credentials.access),
    refresh: String(record.credentials.refresh),
    expires: Number(record.credentials.expires),
    accountId:
      typeof record.credentials.accountId === "string"
        ? record.credentials.accountId
        : ""
  };
}
