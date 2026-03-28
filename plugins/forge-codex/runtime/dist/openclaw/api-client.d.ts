import type { IncomingMessage, ServerResponse } from "node:http";
export type ForgeHttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export type ForgePluginConfig = {
    origin: string;
    port: number;
    baseUrl: string;
    webAppUrl: string;
    portSource: "configured" | "default" | "preferred";
    dataRoot: string;
    apiToken: string;
    actorLabel: string;
    timeoutMs: number;
};
export type CallForgeApiArgs = {
    baseUrl: string;
    apiToken?: string;
    actorLabel?: string;
    timeoutMs?: number;
    method: ForgeHttpMethod;
    path: string;
    body?: unknown;
    idempotencyKey?: string | null;
    extraHeaders?: Record<string, string | null | undefined>;
};
export type CallConfiguredForgeApiArgs = Omit<CallForgeApiArgs, "baseUrl" | "apiToken" | "actorLabel" | "timeoutMs">;
export type ForgeProxyResponse = {
    status: number;
    body: unknown;
};
export declare class ForgePluginError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string);
}
export declare function buildForgeBaseUrl(origin: string, port: number): string;
export declare function buildForgeWebAppUrl(origin: string, port: number): string;
export declare function canBootstrapOperatorSession(baseUrl: string): boolean;
export declare function callForgeApi(args: CallForgeApiArgs): Promise<ForgeProxyResponse>;
export declare function callConfiguredForgeApi(config: ForgePluginConfig, args: CallConfiguredForgeApiArgs): Promise<ForgeProxyResponse>;
export declare function readJsonRequestBody(request: IncomingMessage, options?: {
    maxBytes?: number;
    emptyObject?: boolean;
}): Promise<unknown>;
export declare function readSingleHeaderValue(headers: IncomingMessage["headers"], name: string): string | null;
export declare function requireApiToken(config: ForgePluginConfig): void;
export declare function writeJsonResponse(response: ServerResponse, status: number, body: unknown): void;
export declare function writeRedirectResponse(response: ServerResponse, location: string): void;
export declare function writeForgeProxyResponse(response: ServerResponse, result: ForgeProxyResponse): void;
export declare function writePluginError(response: ServerResponse, error: unknown): void;
export declare function expectForgeSuccess(result: ForgeProxyResponse): unknown;
