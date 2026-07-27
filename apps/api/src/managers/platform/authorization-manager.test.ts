import assert from "node:assert/strict";
import test from "node:test";
import type { AuthContext } from "../contracts.js";
import { AuthorizationManager } from "./authorization-manager.js";

function context(input: { scopes?: string[]; session?: boolean }): AuthContext {
  return {
    now: new Date("2026-07-15T12:00:00.000Z"),
    correlationId: null,
    requestId: null,
    origin: "https://forge.example",
    host: "forge.example",
    ip: "127.0.0.1",
    actor: "test",
    source: "agent",
    token:
      input.scopes === undefined
        ? null
        : {
            id: "token_1",
            agentId: "agent_1",
            agentLabel: "Test agent",
            scopes: input.scopes,
            trustLevel: "trusted",
            autonomyMode: "approval_required",
            approvalMode: "approval_by_default",
            bootstrapPolicy: {
              mode: "disabled",
              goalsLimit: 0,
              projectsLimit: 0,
              tasksLimit: 0,
              habitsLimit: 0,
              strategiesLimit: 0,
              peoplePageLimit: 0,
              includePeoplePages: false
            },
            scopePolicy: { userIds: [], projectIds: [], tagIds: [] }
          },
    scope: { userIds: [], projectIds: [], tagIds: [] },
    session: input.session
      ? {
          id: "session_1",
          actorLabel: "Operator",
          expiresAt: "2026-07-15T13:00:00.000Z"
        }
      : null
  };
}

test("all-scope authorization requires every token scope", () => {
  const manager = new AuthorizationManager();
  assert.doesNotThrow(() =>
    manager.requireAllTokenScopes(
      context({ scopes: ["people:write", "wiki:read"] }),
      ["people:write", "wiki:read"]
    )
  );
  assert.throws(
    () =>
      manager.requireAllTokenScopes(context({ scopes: ["people:write"] }), [
        "people:write",
        "wiki:read"
      ]),
    (error: unknown) => {
      assert.equal(
        (error as { details?: { missingScopes?: string[] } }).details
          ?.missingScopes?.[0],
        "wiki:read"
      );
      return true;
    }
  );
});

test("operator sessions satisfy all-scope authorization", () => {
  const manager = new AuthorizationManager();
  assert.doesNotThrow(() =>
    manager.requireAllTokenScopes(context({ session: true }), [
      "people:write",
      "wiki:read"
    ])
  );
});

test("the verified local-service wildcard satisfies token-scope checks", () => {
  const manager = new AuthorizationManager();
  const localService = context({ scopes: ["*"] });
  assert.doesNotThrow(() =>
    manager.requireTokenScope(localService, "read")
  );
  assert.doesNotThrow(() =>
    manager.requireAnyTokenScope(localService, ["read", "write"])
  );
  assert.doesNotThrow(() =>
    manager.requireAllTokenScopes(localService, [
      "people:write",
      "wiki:read"
    ])
  );
});
