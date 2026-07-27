import assert from "node:assert/strict";
import type { InjectOptions } from "light-my-request";

import {
  applicationSecurityRuntimeForTest,
  type buildServer
} from "../app.js";

type TestServer = Awaited<ReturnType<typeof buildServer>>;

const installedAuthority = new WeakMap<
  TestServer,
  { cookie: string; csrf: string }
>();

export function issueTestOperatorSessionCookie(app: TestServer) {
  const existing = installedAuthority.get(app);
  if (existing) return existing.cookie;

  const security = applicationSecurityRuntimeForTest(app);
  const ownerEpoch = security.store.readOwnerSecurityEpoch("user_operator");
  assert.ok(ownerEpoch);
  const issued = security.browserSessions.create({
    kind: "operator_session",
    subjectId: "user_operator",
    ownerId: "user_operator",
    clientId: null,
    installationId: null,
    audience: security.audience,
    scopes: ["*"],
    profile: "operator",
    ownerSecurityEpoch: ownerEpoch,
    clientSecurityEpoch: null,
    authenticatedAt: new Date().toISOString()
  });
  const authority = {
    cookie: `forge_session=${encodeURIComponent(issued.sessionToken)}`,
    csrf: issued.csrfToken
  };
  installedAuthority.set(app, authority);
  const inject = app.inject.bind(app);
  app.inject = ((request: string | InjectOptions) => {
    if (typeof request === "string") return inject(request);
    const headers = Object.fromEntries(
      Object.entries(request.headers ?? {}).map(([name, value]) => [
        name,
        String(value)
      ])
    );
    if (
      headers.cookie === authority.cookie &&
      !["GET", "HEAD", "OPTIONS"].includes(
        String(request.method ?? "GET").toUpperCase()
      )
    ) {
      headers["x-forge-csrf"] = authority.csrf;
    }
    return inject({ ...request, headers });
  }) as typeof app.inject;
  return authority.cookie;
}
