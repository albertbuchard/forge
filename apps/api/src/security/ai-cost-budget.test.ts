import assert from "node:assert/strict";
import test from "node:test";

import type { LlmManager } from "../managers/platform/llm-manager.js";
import {
  AiCostBudgetExceededError,
  createBudgetedTextPromptRunner
} from "./ai-cost-budget.js";
import type { ForgePrincipal } from "./contracts.js";
import { InMemorySecurityRateLimiter } from "./security-rate-limiter.js";

const principal: ForgePrincipal = {
  kind: "paired_client",
  subjectId: "subject_ai",
  ownerId: "owner_ai",
  clientId: "client_ai",
  installationId: "installation_ai",
  audience: "https://forge.test/api",
  scopes: ["profile:executor"],
  profile: "executor",
  ownerSecurityEpoch: 1,
  clientSecurityEpoch: 1,
  authenticatedAt: "2026-07-26T12:00:00.000Z"
};

function fakeLlm(totalTokens: number) {
  return {
    async runTextPrompt() {
      return {
        outputText: "ok",
        usage: {
          inputTokens: Math.max(0, totalTokens - 1),
          outputTokens: 1,
          totalTokens
        }
      };
    }
  } as unknown as LlmManager;
}

test("multi-step and parallel model calls stop at the request and principal budgets", async () => {
  const limiter = new InMemorySecurityRateLimiter({
    policies: {
      ai_cost: { capacity: 4_000, refillPerSecond: 1 }
    }
  });
  const runner = createBudgetedTextPromptRunner({
    llm: fakeLlm(2_000),
    limiter,
    principal,
    correlationId: "request_ai",
    maximumRequestTokens: 3_000,
    maximumOutputTokensPerCall: 500
  });
  const profile = {
    provider: "mock",
    baseUrl: "mock://budget",
    model: "mock",
    secretId: null,
    systemPrompt: "",
    metadata: {}
  };

  const results = await Promise.allSettled([
    runner.runTextPrompt(profile, { prompt: "A".repeat(1_000) }),
    runner.runTextPrompt(profile, { prompt: "B".repeat(1_000) }),
    runner.runTextPrompt(profile, { prompt: "C".repeat(1_000) }),
    runner.runTextPrompt(profile, { prompt: "D".repeat(1_000) })
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1
  );
  assert.ok(
    results
      .filter((result) => result.status === "rejected")
      .every(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof AiCostBudgetExceededError
      )
  );

  const nextRequest = createBudgetedTextPromptRunner({
    llm: fakeLlm(10),
    limiter,
    principal,
    correlationId: "request_ai_next",
    maximumRequestTokens: 3_000,
    maximumOutputTokensPerCall: 500
  });
  await assert.rejects(
    nextRequest.runTextPrompt(profile, { prompt: "next" }),
    AiCostBudgetExceededError
  );
});
