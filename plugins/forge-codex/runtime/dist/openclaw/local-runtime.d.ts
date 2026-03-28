import type { ForgePluginConfig } from "./api-client.js";
export type ForgeRuntimeStopResult = {
    ok: boolean;
    stopped: boolean;
    managed: boolean;
    message: string;
    pid: number | null;
};
export declare function ensureForgeRuntimeReady(config: ForgePluginConfig): Promise<void>;
export declare function primeForgeRuntime(config: ForgePluginConfig): void;
export declare function stopForgeRuntime(config: ForgePluginConfig): Promise<ForgeRuntimeStopResult>;
