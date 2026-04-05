import { AbstractManager } from "../base.js";
import { readEncryptedSecret } from "../../repositories/calendar.js";
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
    async compileWikiIngest(profile, input) {
        const provider = this.providers.get(profile.provider) ??
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
