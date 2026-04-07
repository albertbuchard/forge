import { AbstractManager } from "../base.js";
import { refreshOpenAICodexToken } from "@mariozechner/pi-ai/oauth";
import type { SecretsManager } from "./secrets-manager.js";
import {
  readEncryptedSecret,
  storeEncryptedSecret
} from "../../repositories/calendar.js";

export type WikiCompileInput = {
  titleHint: string;
  rawText: string;
  binary: Buffer | null;
  mimeType: string;
  parseStrategy: "auto" | "text_only" | "multimodal";
};

export type WikiLlmDiagnosticLogger = (input: {
  level: "debug" | "info" | "warning" | "error";
  message: string;
  details?: Record<string, unknown>;
}) => void;

export type WikiCompileResult = {
  title: string;
  summary: string;
  markdown: string;
  tags: string[];
  entityProposals: Array<Record<string, unknown>>;
  pageUpdateSuggestions: Array<Record<string, unknown>>;
  articleCandidates: Array<Record<string, unknown>>;
};

export type WikiLlmProfileLike = {
  provider: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  secretId: string | null;
  metadata: Record<string, unknown>;
};

export type WikiLlmConnectionTestResult = {
  provider: string;
  model: string;
  baseUrl: string;
  reasoningEffort: string | null;
  verbosity: string | null;
  usingStoredKey: boolean;
  outputPreview: string;
};

export interface WikiLlmProvider {
  readonly providerNames: string[];
  compile(input: {
    apiKey: string;
    profile: WikiLlmProfileLike;
    input: WikiCompileInput;
    resumeResponseId?: string | null;
    logger?: WikiLlmDiagnosticLogger;
  }): Promise<WikiCompileResult | null>;
  testConnection(input: {
    apiKey: string;
    profile: WikiLlmProfileLike;
    logger?: WikiLlmDiagnosticLogger;
  }): Promise<{ outputPreview: string }>;
}

type StoredSecretPayload = {
  kind?: "api_key" | "oauth";
  provider?: string;
  apiKey?: string;
  access?: string;
  refresh?: string;
  expires?: number;
};

function emitDiagnostic(
  logger: WikiLlmDiagnosticLogger | undefined,
  input: Parameters<WikiLlmDiagnosticLogger>[0]
) {
  logger?.(input);
}

export class LlmManager extends AbstractManager {
  readonly name = "LlmManager";
  private readonly providers = new Map<string, WikiLlmProvider>();

  constructor(private readonly secretsManager: SecretsManager) {
    super();
  }

  register(provider: WikiLlmProvider) {
    for (const alias of provider.providerNames) {
      this.providers.set(alias, provider);
    }
  }

  async compileWikiIngest(
    profile: WikiLlmProfileLike,
    input: WikiCompileInput,
    options: {
      resumeResponseId?: string | null;
    } = {},
    logger?: WikiLlmDiagnosticLogger
  ) {
    const provider = this.resolveProvider(profile.provider);
    if (!provider) {
      emitDiagnostic(logger, {
        level: "error",
        message: "Wiki ingest LLM provider is not supported.",
        details: {
          scope: "wiki_llm",
          eventKey: "llm_provider_missing",
          provider: profile.provider,
          baseUrl: profile.baseUrl,
          model: profile.model
        }
      });
      return null;
    }
    const apiKey = await this.readApiKey(profile.secretId);
    if (!apiKey) {
      emitDiagnostic(logger, {
        level: "error",
        message: "Wiki ingest LLM profile is missing an API key.",
        details: {
          scope: "wiki_llm",
          eventKey: "llm_api_key_missing",
          provider: profile.provider,
          baseUrl: profile.baseUrl,
          model: profile.model,
          secretId: profile.secretId ?? null
        }
      });
      return null;
    }
    return provider.compile({
      apiKey,
      profile,
      input,
      resumeResponseId: options.resumeResponseId ?? null,
      logger
    });
  }

  async testWikiConnection(
    profile: WikiLlmProfileLike,
    explicitApiKey?: string | null,
    logger?: WikiLlmDiagnosticLogger
  ): Promise<WikiLlmConnectionTestResult> {
    const provider = this.resolveProvider(profile.provider);
    if (!provider) {
      emitDiagnostic(logger, {
        level: "error",
        message: "Wiki LLM connection test requested an unsupported provider.",
        details: {
          scope: "wiki_llm",
          eventKey: "llm_provider_missing",
          provider: profile.provider,
          baseUrl: profile.baseUrl,
          model: profile.model
        }
      });
      throw new Error("Unsupported LLM provider.");
    }
    const apiKey =
      explicitApiKey?.trim() || (await this.readApiKey(profile.secretId));
    if (!apiKey) {
      emitDiagnostic(logger, {
        level: "error",
        message: "Wiki LLM connection test is missing an API key.",
        details: {
          scope: "wiki_llm",
          eventKey: "llm_api_key_missing",
          provider: profile.provider,
          baseUrl: profile.baseUrl,
          model: profile.model,
          secretId: profile.secretId ?? null
        }
      });
      throw new Error("Save an OpenAI API key first.");
    }
    const result = await provider.testConnection({
      apiKey,
      profile,
      logger
    });
    return {
      provider: profile.provider,
      model: profile.model,
      baseUrl: profile.baseUrl,
      reasoningEffort:
        typeof profile.metadata.reasoningEffort === "string"
          ? profile.metadata.reasoningEffort
          : null,
      verbosity:
        typeof profile.metadata.verbosity === "string"
          ? profile.metadata.verbosity
          : null,
      usingStoredKey: !explicitApiKey?.trim(),
      outputPreview: result.outputPreview
    };
  }

  private resolveProvider(providerName: string) {
    return (
      this.providers.get(providerName) ??
      this.providers.get("openai-responses") ??
      null
    );
  }

  private async readApiKey(secretId: string | null | undefined) {
    if (!secretId) {
      return null;
    }
    const cipherText = readEncryptedSecret(secretId);
    if (!cipherText) {
      return null;
    }
    const payload =
      this.secretsManager.openJson<StoredSecretPayload>(cipherText);
    if (
      payload.kind === "oauth" &&
      payload.provider === "openai-codex" &&
      typeof payload.refresh === "string"
    ) {
      let access = payload.access?.trim() || null;
      const expires =
        typeof payload.expires === "number" ? payload.expires : Date.now();
      if (!access || expires <= Date.now() + 60_000) {
        const refreshed = await refreshOpenAICodexToken(payload.refresh);
        const nextPayload: StoredSecretPayload = {
          ...payload,
          access: refreshed.access,
          refresh: refreshed.refresh,
          expires: refreshed.expires
        };
        storeEncryptedSecret(
          secretId,
          this.secretsManager.sealJson(nextPayload),
          "Refreshed OpenAI Codex OAuth credential"
        );
        access = refreshed.access;
      }
      return access;
    }
    return payload.apiKey?.trim() || null;
  }
}
