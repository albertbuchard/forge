export type ApiRouteKey = `${Uppercase<string>} ${string}`;
export type ForgeSupportedPluginApiRoute = {
    method: Uppercase<string>;
    path: string;
    purpose: "diagnostics" | "overview" | "operator_context" | "onboarding" | "psyche" | "xp" | "weekly_review" | "entities" | "work" | "insights";
};
export declare const FORGE_SUPPORTED_PLUGIN_API_ROUTES: ForgeSupportedPluginApiRoute[];
export declare function makeApiRouteKey(method: string, path: string): ApiRouteKey;
export declare function collectSupportedPluginApiRouteKeys(): Set<`${Uppercase<string>} ${string}`>;
