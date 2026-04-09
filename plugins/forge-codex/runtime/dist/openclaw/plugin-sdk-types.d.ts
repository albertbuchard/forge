import type { IncomingMessage, ServerResponse } from "node:http";
import type { TSchema } from "@sinclair/typebox";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { InternalHookEvent } from "openclaw/plugin-sdk/hook-runtime";
export type ForgePluginConfigSchema = {
    parse(value: unknown): unknown;
    jsonSchema: Record<string, unknown>;
    uiHints?: Record<string, ForgePluginConfigUiHint>;
};
export type ForgePluginConfigUiHint = {
    label?: string;
    help?: string;
    placeholder?: string;
    sensitive?: boolean;
    advanced?: boolean;
};
export type ForgeRegisteredHttpRoute = {
    path: string;
    auth: "plugin" | "gateway";
    match?: "exact" | "prefix";
    handler: (request: IncomingMessage, response: ServerResponse) => Promise<boolean | void> | boolean | void;
};
export type ForgeRegisteredTool = {
    name: string;
    label: string;
    description: string;
    parameters: TSchema;
    execute: (toolCallId: string, params: unknown) => Promise<AgentToolResult<unknown>>;
};
export type ForgeCliProgram = {
    command(name: string): ForgeCliProgram;
    description(text: string): ForgeCliProgram;
    action(handler: () => Promise<void> | void): ForgeCliProgram;
};
export type ForgeCliRegistrarContext = {
    program: ForgeCliProgram;
    config: unknown;
    logger: {
        info?(message: string): void;
        warn?(message: string): void;
        error?(message: string): void;
        debug?(message: string): void;
    };
};
export type ForgePluginServiceContext = {
    config?: unknown;
    workspaceDir?: string;
    stateDir: string;
    logger: {
        info?(message: string): void;
        warn?(message: string): void;
        error?(message: string): void;
        debug?(message: string): void;
    };
};
export type ForgeRegisteredService = {
    id: string;
    start: (context: ForgePluginServiceContext) => Promise<void> | void;
    stop?: (context: ForgePluginServiceContext) => Promise<void> | void;
};
export type ForgePluginRegistrationApi = {
    pluginConfig?: unknown;
    logger?: {
        info?(message: string): void;
        warn?(message: string): void;
        error?(message: string): void;
        debug?(message: string): void;
    };
    registerHttpRoute(route: ForgeRegisteredHttpRoute): void;
    registerTool(tool: ForgeRegisteredTool, options?: {
        optional?: boolean;
    }): void;
    registerHook?(events: string | string[], handler: (event: InternalHookEvent) => Promise<void> | void, options?: {
        name?: string;
        description?: string;
        register?: boolean;
    }): void;
    registerCli?(registrar: (context: ForgeCliRegistrarContext) => void, options?: {
        commands?: string[];
    }): void;
    registerService?(service: ForgeRegisteredService): void;
};
export type ForgePluginRouteApi = Pick<ForgePluginRegistrationApi, "registerHttpRoute">;
export type ForgePluginToolApi = Pick<ForgePluginRegistrationApi, "registerTool">;
export type ForgePluginCliApi = Pick<ForgePluginRegistrationApi, "registerCli">;
