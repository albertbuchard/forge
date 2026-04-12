import { AbstractManager } from "../base.js";
import { refreshOpenAICodexToken } from "@mariozechner/pi-ai/oauth";
import { readEncryptedSecret, storeEncryptedSecret } from "../../repositories/calendar.js";
function emitDiagnostic(logger, input) {
    logger?.(input);
}
function providerAllowsCredentiallessPrompt(provider) {
    return provider === "mock";
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
        const apiKey = explicitApiKey?.trim() || (await this.readApiKey(profile.secretId));
        if (!apiKey && !providerAllowsCredentiallessPrompt(profile.provider)) {
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
            apiKey: apiKey ?? "mock",
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
    async runTextPrompt(profile, input, logger) {
        const provider = this.resolveProvider(profile.provider);
        if (!provider?.runText) {
            throw new Error("This LLM provider does not support text prompt execution.");
        }
        const apiKey = input.explicitApiKey?.trim() || (await this.readApiKey(profile.secretId));
        if (!apiKey && !providerAllowsCredentiallessPrompt(profile.provider)) {
            throw new Error("Missing provider credential for prompt execution.");
        }
        return await provider.runText({
            apiKey: apiKey ?? "mock",
            profile,
            systemPrompt: input.systemPrompt,
            prompt: input.prompt,
            logger
        });
    }
    resolveProvider(providerName) {
        return (this.providers.get(providerName) ??
            this.providers.get("openai-responses") ??
            null);
    }
    async readApiKey(secretId) {
        if (!secretId) {
            return null;
        }
        const cipherText = readEncryptedSecret(secretId);
        if (!cipherText) {
            return null;
        }
        const payload = this.secretsManager.openJson(cipherText);
        if (payload.kind === "oauth" &&
            payload.provider === "openai-codex" &&
            typeof payload.refresh === "string") {
            let access = payload.access?.trim() || null;
            const expires = typeof payload.expires === "number" ? payload.expires : Date.now();
            if (!access || expires <= Date.now() + 60_000) {
                const refreshed = await refreshOpenAICodexToken(payload.refresh);
                const nextPayload = {
                    ...payload,
                    access: refreshed.access,
                    refresh: refreshed.refresh,
                    expires: refreshed.expires
                };
                storeEncryptedSecret(secretId, this.secretsManager.sealJson(nextPayload), "Refreshed OpenAI Codex OAuth credential");
                access = refreshed.access;
            }
            return access;
        }
        return payload.apiKey?.trim() || null;
    }
}
