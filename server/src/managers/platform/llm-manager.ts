import { AbstractManager } from "../base.js";
import type { SecretsManager } from "./secrets-manager.js";
import { readEncryptedSecret } from "../../repositories/calendar.js";

export type WikiCompileInput = {
  titleHint: string;
  rawText: string;
  binary: Buffer | null;
  mimeType: string;
  parseStrategy: "auto" | "text_only" | "multimodal";
};

export type WikiCompileResult = {
  title: string;
  summary: string;
  markdown: string;
  tags: string[];
  entityProposals: Array<Record<string, unknown>>;
  pageUpdateSuggestions: Array<Record<string, unknown>>;
  articleCandidates: Array<Record<string, unknown>>;
};

type WikiLlmProfileLike = {
  provider: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  secretId: string | null;
};

export interface WikiLlmProvider {
  readonly providerNames: string[];
  compile(input: {
    apiKey: string;
    profile: WikiLlmProfileLike;
    input: WikiCompileInput;
  }): Promise<WikiCompileResult | null>;
}

type StoredSecretPayload = {
  apiKey?: string;
};

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
    input: WikiCompileInput
  ) {
    const provider =
      this.providers.get(profile.provider) ??
      this.providers.get("openai-responses") ??
      null;
    if (!provider) {
      return null;
    }
    const apiKey = this.readApiKey(profile.secretId);
    if (!apiKey) {
      return null;
    }
    return provider.compile({ apiKey, profile, input });
  }

  private readApiKey(secretId: string | null | undefined) {
    if (!secretId) {
      return null;
    }
    const cipherText = readEncryptedSecret(secretId);
    if (!cipherText) {
      return null;
    }
    const payload =
      this.secretsManager.openJson<StoredSecretPayload>(cipherText);
    return payload.apiKey?.trim() || null;
  }
}
