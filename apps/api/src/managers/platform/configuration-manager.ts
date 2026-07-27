import { AbstractManager } from "../base.js";

export type ForgeRuntimeConfig = {
  host: string;
  port: number;
  basePath: string;
  dataRoot: string | null;
  sessionCookieName: string;
  sessionTtlSeconds: number;
  allowedOrigins: readonly string[];
};

function exactHttpOrigin(value: string, settingName: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${settingName} contains an invalid URL.`);
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(
      `${settingName} accepts only HTTP(S) origins without credentials.`
    );
  }
  return parsed.origin;
}

export class ConfigurationManager extends AbstractManager {
  readonly name = "ConfigurationManager";

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {
    super();
  }

  readRuntimeConfig(overrides: { dataRoot?: string } = {}): ForgeRuntimeConfig {
    const explicitOrigins = (this.env.FORGE_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => exactHttpOrigin(entry, "FORGE_ALLOWED_ORIGINS"));
    const devWebOrigin = this.env.FORGE_DEV_WEB_ORIGIN?.trim();
    const allowedOrigins = [
      "http://127.0.0.1:3027",
      "http://localhost:3027",
      "http://[::1]:3027",
      ...(devWebOrigin
        ? [exactHttpOrigin(devWebOrigin, "FORGE_DEV_WEB_ORIGIN")]
        : []),
      ...explicitOrigins
    ];
    return {
      host: this.env.HOST?.trim() || "0.0.0.0",
      port: Number(this.env.PORT ?? 4317),
      basePath: this.normalizeBasePath(this.env.FORGE_BASE_PATH ?? "/forge/"),
      dataRoot: overrides.dataRoot
        ? overrides.dataRoot
        : this.env.FORGE_DATA_ROOT?.trim() || null,
      sessionCookieName:
        this.env.FORGE_OPERATOR_SESSION_COOKIE?.trim() ||
        "forge_operator_session",
      sessionTtlSeconds: Math.max(
        3600,
        Number(this.env.FORGE_OPERATOR_SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 7)
      ),
      allowedOrigins: [...new Set(allowedOrigins)]
    };
  }

  private normalizeBasePath(value: string) {
    if (!value || value === "/") {
      return "/";
    }
    const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
    return withLeadingSlash.endsWith("/")
      ? withLeadingSlash
      : `${withLeadingSlash}/`;
  }
}
