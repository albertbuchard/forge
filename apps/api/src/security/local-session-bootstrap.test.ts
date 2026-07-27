import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyReply } from "fastify";

import { AuthRequiredError } from "../managers/contracts.js";
import { SessionManager } from "../managers/platform/session-manager.js";

test("network, proxy, origin, and actor headers never bootstrap an operator session", () => {
  const manager = new SessionManager(
    {
      getConnection: () => {
        throw new Error("A denied bootstrap must not reach the database.");
      }
    } as never,
    {
      createSecret: () => {
        throw new Error("A denied bootstrap must not create a secret.");
      }
    } as never,
    {
      readRuntimeConfig: () => {
        throw new Error("A denied bootstrap must not inspect cookie settings.");
      }
    } as never,
    {
      record: () => {
        throw new Error("A denied bootstrap must not mint audit authority.");
      }
    } as never
  );

  assert.throws(
    () =>
      manager.ensureLocalOperatorSession(
        {
          host: "127.0.0.1:4317",
          origin: "http://localhost:3027",
          "x-forwarded-for": "127.0.0.1",
          "x-forwarded-host": "localhost:4317",
          "x-forge-actor": "Local Operator",
          "x-forge-source": "system"
        },
        {} as FastifyReply
      ),
    (error: unknown) =>
      error instanceof AuthRequiredError &&
      error.code === "auth_required" &&
      error.statusCode === 401
  );
});
