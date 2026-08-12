import { createHmac, timingSafeEqual } from "node:crypto";

export function encodeDemoSessionToken(
  secret: string,
  id: string,
  createdAt: number
) {
  const value = `${id}.${createdAt}`;
  const signature = createHmac("sha256", secret)
    .update(value)
    .digest("base64url");
  return `${value}.${signature}`;
}

export function decodeDemoSessionToken(secret: string, raw: string | undefined) {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [id, rawCreatedAt, supplied] = parts;
  const createdAt = Number(rawCreatedAt);
  if (!id || !Number.isSafeInteger(createdAt) || createdAt <= 0 || !supplied) {
    return null;
  }
  const expected = createHmac("sha256", secret)
    .update(`${id}.${rawCreatedAt}`)
    .digest("base64url");
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (
    suppliedBytes.byteLength !== expectedBytes.byteLength ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    return null;
  }
  return { id, createdAt };
}

const BLOCKED_READ_PREFIXES = [
  "/api/v1/settings",
  "/api/v1/agents",
  "/api/v1/diagnostics",
  "/api/v1/doctor",
  "/api/v1/auth/clients",
  "/api/v1/auth/master-password",
  "/api/v1/auth/device",
  "/api/v1/mobile",
  "/api/v1/health/pairing-sessions",
  "/api/v1/calendar/oauth",
  "/api/v1/git",
  "/api/v1/artifacts/exports"
] as const;

export function demoRouteAllowed(method: string, url: URL, body: Buffer) {
  if (method === "GET" || method === "HEAD") {
    return (
      !BLOCKED_READ_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)) &&
      !url.pathname.endsWith("/download") &&
      !url.pathname.endsWith("/raw")
    );
  }
  if (
    method === "POST" &&
    [
      "/api/v1/auth/local/browser/begin",
      "/api/v1/auth/local/browser/exchange"
    ].includes(url.pathname)
  ) {
    return true;
  }
  if (method === "PATCH" && /^\/api\/v1\/tasks\/[^/]+$/u.test(url.pathname)) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
    } catch {
      return false;
    }
    const keys = Object.keys(payload);
    return (
      keys.length > 0 &&
      keys.every((key) =>
        [
          "status",
          "completedAt",
          "enforceTodayWorkLog",
          "completedTodayWorkSeconds"
        ].includes(key)
      ) &&
      typeof payload.status === "string" &&
      ["backlog", "focus", "ongoing", "blocked", "done"].includes(
        payload.status
      )
    );
  }
  return false;
}
