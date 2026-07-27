import type {
  LlmManager,
  TextPromptRunner
} from "../managers/platform/llm-manager.js";
import type { ForgePrincipal } from "./contracts.js";
import type { SecurityRateLimiter } from "./security-observability.js";

export class AiCostBudgetExceededError extends Error {
  readonly code = "ai_cost_budget_exceeded";
}

function estimatedTokens(value: string) {
  return Math.max(1, Math.ceil(value.length / 4));
}

export function createBudgetedTextPromptRunner(input: {
  llm: LlmManager;
  limiter: SecurityRateLimiter;
  principal: ForgePrincipal;
  correlationId: string;
  maximumRequestTokens?: number;
  maximumOutputTokensPerCall?: number;
}): TextPromptRunner {
  const maximumRequestTokens = input.maximumRequestTokens ?? 100_000;
  const maximumOutputTokensPerCall =
    input.maximumOutputTokensPerCall ?? 1_200;
  let reservedRequestTokens = 0;
  let actualRequestTokens = 0;

  return {
    async runTextPrompt(
      profile,
      promptInput,
      logger
    ): ReturnType<LlmManager["runTextPrompt"]> {
      const estimatedInputTokens =
        estimatedTokens(promptInput.prompt) +
        estimatedTokens(promptInput.systemPrompt ?? "");
      const reservation =
        estimatedInputTokens + maximumOutputTokensPerCall;
      if (reservedRequestTokens + reservation > maximumRequestTokens) {
        throw new AiCostBudgetExceededError(
          "This Forge AI request reached its bounded model-usage budget."
        );
      }
      const admission = input.limiter.admit({
        bucket: "ai_cost",
        principalId: input.principal.subjectId,
        clientId: input.principal.clientId,
        installationId: input.principal.installationId,
        networkId: null,
        action: "model.reserve",
        cost: reservation,
        now: new Date()
      });
      if (!admission.allowed) {
        throw new AiCostBudgetExceededError(
          "Forge temporarily limited model usage for this identity."
        );
      }
      reservedRequestTokens += reservation;
      const result = await input.llm.runTextPrompt(profile, promptInput, logger);
      const actualTokens =
        result.usage?.totalTokens ??
        estimatedInputTokens + estimatedTokens(result.outputText);
      actualRequestTokens += actualTokens;
      if (actualTokens > reservation) {
        const overage = input.limiter.admit({
          bucket: "ai_cost",
          principalId: input.principal.subjectId,
          clientId: input.principal.clientId,
          installationId: input.principal.installationId,
          networkId: null,
          action: "model.reserve",
          cost: actualTokens - reservation,
          now: new Date()
        });
        if (!overage.allowed) {
          throw new AiCostBudgetExceededError(
            "This Forge AI request exceeded its reserved model-usage budget."
          );
        }
      }
      if (actualRequestTokens > maximumRequestTokens) {
        throw new AiCostBudgetExceededError(
          "This Forge AI request reached its bounded model-usage budget."
        );
      }
      return result;
    }
  };
}
