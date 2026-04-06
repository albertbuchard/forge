import { AbstractManager } from "../base.js";
import { readEncryptedSecret } from "../../repositories/calendar.js";
function emitDiagnostic(logger, input) {
    logger?.(input);
}
export class LlmManager extends AbstractManager {
    secretsManager;
    name = "LlmManager";
    providers = new Map();
    constructor(secretsManager) {
        super();
        this.secretsManager = secretsManager;
    }
    register(provider) {
        for (const alias of provider.providerNames) {
            this.providers.set(alias, provider);
        }
    }
    async compileWikiIngest(profile, input, options = {}, logger) {
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
        const apiKey = this.readApiKey(profile.secretId);
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
    async testWikiConnection(profile, explicitApiKey, logger) {
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
        const apiKey = explicitApiKey?.trim() || this.readApiKey(profile.secretId);
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
            reasoningEffort: typeof profile.metadata.reasoningEffort === "string"
                ? profile.metadata.reasoningEffort
                : null,
            verbosity: typeof profile.metadata.verbosity === "string"
                ? profile.metadata.verbosity
                : null,
            usingStoredKey: !explicitApiKey?.trim(),
            outputPreview: result.outputPreview
        };
    }
    resolveProvider(providerName) {
        return (this.providers.get(providerName) ??
            this.providers.get("openai-responses") ??
            null);
    }
    readApiKey(secretId) {
        if (!secretId) {
            return null;
        }
        const cipherText = readEncryptedSecret(secretId);
        if (!cipherText) {
            return null;
        }
        const payload = this.secretsManager.openJson(cipherText);
        return payload.apiKey?.trim() || null;
    }
}
