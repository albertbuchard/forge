import { AbstractManager } from "../base.js";
export class ConfigurationManager extends AbstractManager {
    env;
    name = "ConfigurationManager";
    constructor(env = process.env) {
        super();
        this.env = env;
    }
    readRuntimeConfig(overrides = {}) {
        return {
            host: this.env.HOST?.trim() || "0.0.0.0",
            port: Number(this.env.PORT ?? 4317),
            basePath: this.normalizeBasePath(this.env.FORGE_BASE_PATH ?? "/forge/"),
            dataRoot: overrides.dataRoot ? overrides.dataRoot : this.env.FORGE_DATA_ROOT?.trim() || null,
            sessionCookieName: this.env.FORGE_OPERATOR_SESSION_COOKIE?.trim() || "forge_operator_session",
            sessionTtlSeconds: Math.max(3600, Number(this.env.FORGE_OPERATOR_SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 7)),
            allowedOrigins: [
                /^https?:\/\/localhost(?::\d+)?$/i,
                /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i,
                /^https?:\/\/\[::1\](?::\d+)?$/i,
                /^https?:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net(?::\d+)?$/i,
                /^https?:\/\/100\.(?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3})(?::\d+)?$/i
            ]
        };
    }
    normalizeBasePath(value) {
        if (!value || value === "/") {
            return "/";
        }
        const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
        return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
    }
}
