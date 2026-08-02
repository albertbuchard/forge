import {
  browserDiagnosticAuthorizationKey,
  forgeBrowserRequestHeaders,
  noteBrowserSessionRejected
} from "./browser-request-security";
import { resolveForgePath } from "./runtime-paths";
import type { DiagnosticLogLevel, DiagnosticLogSource } from "./types";

export type PublishDiagnosticLogInput = {
  level: DiagnosticLogLevel;
  scope: string;
  eventKey: string;
  message: string;
  route?: string | null;
  functionName?: string | null;
  requestId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  jobId?: string | null;
  details?: Record<string, unknown>;
  source?: DiagnosticLogSource;
};

type DiagnosticPublicationStatus =
  | "unknown"
  | "allowed"
  | "pending"
  | "cooldown"
  | "disabled";

type DiagnosticPublicationState = {
  status: DiagnosticPublicationStatus;
  cooldownUntil: number;
};

type DiagnosticPublicationHost = typeof globalThis & {
  __forgeUiDiagnosticPublicationState?: DiagnosticPublicationState;
};

const DIAGNOSTIC_PUBLICATION_COOLDOWN_MS = 30_000;

function publicationState() {
  const host = globalThis as DiagnosticPublicationHost;
  host.__forgeUiDiagnosticPublicationState ??= {
    status: "unknown",
    cooldownUntil: 0
  };
  return host.__forgeUiDiagnosticPublicationState;
}

export function resetUiDiagnosticPublicationStateForTest() {
  delete (globalThis as DiagnosticPublicationHost)
    .__forgeUiDiagnosticPublicationState;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ?? null
    };
  }
  if (Array.isArray(value)) {
    if (depth >= 3) {
      return `[Array(${value.length})]`;
    }
    return value.slice(0, 20).map((entry) => sanitizeValue(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    if (depth >= 3) {
      return "[Object]";
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 30)
        .map(([key, entry]) => [key, sanitizeValue(entry, depth + 1)])
    );
  }
  return String(value);
}

function sanitizeDetails(
  details: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!details) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [key, sanitizeValue(value)])
  );
}

export async function publishUiDiagnosticLog(input: PublishDiagnosticLogInput) {
  const authorizationKey = browserDiagnosticAuthorizationKey();
  if (!authorizationKey) {
    return;
  }
  const state = publicationState();
  if (state.status === "disabled" || state.status === "pending") {
    return;
  }
  if (state.status === "cooldown") {
    if (Date.now() < state.cooldownUntil) {
      return;
    }
    state.status = "unknown";
    state.cooldownUntil = 0;
  }
  state.status = "pending";
  try {
    const response = await fetch(resolveForgePath("/api/v1/diagnostics/logs"), {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: forgeBrowserRequestHeaders({
        "content-type": "application/json",
        "x-forge-source": "ui"
      }),
      body: JSON.stringify({
        ...input,
        source: input.source ?? "ui",
        details: sanitizeDetails(input.details)
      })
    });
    if (response.status === 401 || response.status === 403) {
      state.status = "disabled";
      state.cooldownUntil = 0;
      noteBrowserSessionRejected();
      return;
    }
    if (response.ok) {
      state.status = "allowed";
      state.cooldownUntil = 0;
      return;
    }
    state.status = "cooldown";
    state.cooldownUntil = Date.now() + DIAGNOSTIC_PUBLICATION_COOLDOWN_MS;
  } catch {
    state.status = "cooldown";
    state.cooldownUntil = Date.now() + DIAGNOSTIC_PUBLICATION_COOLDOWN_MS;
    // Diagnostics should never break the user flow.
  }
}

export function createUiDiagnosticLogger(
  defaults: Pick<PublishDiagnosticLogInput, "scope"> &
    Partial<
      Omit<
        PublishDiagnosticLogInput,
        "scope" | "level" | "eventKey" | "message"
      >
    >
) {
  return (
    input: Omit<PublishDiagnosticLogInput, "scope"> &
      Partial<Pick<PublishDiagnosticLogInput, "scope">>
  ) =>
    publishUiDiagnosticLog({
      ...defaults,
      ...input
    });
}
