import type { ForgePluginConfig } from "./api-client.js";
export type ForgeRuntimeStopResult = {
    ok: boolean;
    stopped: boolean;
    managed: boolean;
    message: string;
    pid: number | null;
};
export type ForgeRuntimeStartResult = {
    ok: boolean;
    started: boolean;
    managed: boolean;
    message: string;
    pid: number | null;
    baseUrl: string;
};
export type ForgeRuntimeStatusResult = {
    ok: boolean;
    running: boolean;
    healthy: boolean;
    managed: boolean;
    message: string;
    pid: number | null;
    baseUrl: string;
};
export type ForgeRuntimeRestartResult = {
    ok: boolean;
    restarted: boolean;
    managed: boolean;
    message: string;
    pid: number | null;
    baseUrl: string;
};
export declare function ensureForgeRuntimeReady(config: ForgePluginConfig): Promise<void>;
export declare function startForgeRuntime(config: ForgePluginConfig): Promise<ForgeRuntimeStartResult>;
export declare function primeForgeRuntime(config: ForgePluginConfig, logger?: {
    warn?(message: string): void;
}): void;
export declare function stopForgeRuntime(config: ForgePluginConfig): Promise<ForgeRuntimeStopResult>;
export declare function getForgeRuntimeStatus(config: ForgePluginConfig): Promise<ForgeRuntimeStatusResult>;
export declare function restartForgeRuntime(config: ForgePluginConfig): Promise<ForgeRuntimeRestartResult>;
