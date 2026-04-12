import { type ForgeHttpMethod, type ForgePluginConfig } from "./api-client.js";
import { type ApiRouteKey } from "./parity.js";
import type { ForgePluginCliApi, ForgePluginRouteApi, ForgeRegisteredHttpRoute } from "./plugin-sdk-types.js";
type PluginRouteMatch = NonNullable<ForgeRegisteredHttpRoute["match"]>;
type ProxyRouteOperation = {
    kind?: "proxy";
    method: ForgeHttpMethod;
    pattern: RegExp;
    upstreamPath: string;
    target: (match: RegExpMatchArray, url: URL) => string;
    requiresToken?: boolean;
    requestBody?: "json";
};
type UiRedirectRouteOperation = {
    kind: "ui_redirect";
    method: "GET";
    pattern: RegExp;
};
type RouteOperation = ProxyRouteOperation | UiRedirectRouteOperation;
type RouteGroup = {
    path: string;
    match: PluginRouteMatch;
    operations: RouteOperation[];
};
export declare const FORGE_PLUGIN_ROUTE_GROUPS: RouteGroup[];
export declare function collectMirroredApiRouteKeys(): Set<ApiRouteKey>;
export declare function buildRouteParityReport(pathMap: Record<string, Record<string, unknown>>): {
    supported: `${Uppercase<string>} ${string}`[];
    mirrored: `${Uppercase<string>} ${string}`[];
    missingFromPlugin: `${Uppercase<string>} ${string}`[];
    missingFromOpenApi: `${Uppercase<string>} ${string}`[];
    unexpectedMirrors: `${Uppercase<string>} ${string}`[];
};
export declare function registerForgePluginRoutes(api: ForgePluginRouteApi, config: ForgePluginConfig): void;
export declare function runRouteCheck(config: ForgePluginConfig): Promise<{
    supported: `${Uppercase<string>} ${string}`[];
    mirrored: `${Uppercase<string>} ${string}`[];
    missingFromPlugin: `${Uppercase<string>} ${string}`[];
    missingFromOpenApi: `${Uppercase<string>} ${string}`[];
    unexpectedMirrors: `${Uppercase<string>} ${string}`[];
}>;
export declare function runDoctor(config: ForgePluginConfig): Promise<{
    ok: boolean;
    origin: string;
    port: number;
    baseUrl: string;
    webAppUrl: string;
    actorLabel: string;
    apiTokenConfigured: boolean;
    operatorSessionBootstrapAvailable: boolean;
    warnings: string[];
    overview: unknown;
    onboarding: unknown;
    routeParity: {
        supported: `${Uppercase<string>} ${string}`[];
        mirrored: `${Uppercase<string>} ${string}`[];
        missingFromPlugin: `${Uppercase<string>} ${string}`[];
        missingFromOpenApi: `${Uppercase<string>} ${string}`[];
        unexpectedMirrors: `${Uppercase<string>} ${string}`[];
    };
}>;
export declare function registerForgePluginCli(api: ForgePluginCliApi, config: ForgePluginConfig): void;
export {};
