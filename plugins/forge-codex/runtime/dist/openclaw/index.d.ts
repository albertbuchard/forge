import { forgePluginConfigSchema, registerForgePlugin, resolveForgePluginConfig } from "./plugin-entry-shared.js";
declare const pluginEntry: {
    id: string;
    name: string;
    description: string;
    configSchema: import("openclaw/plugin-sdk/plugin-entry").OpenClawPluginConfigSchema;
    register: NonNullable<import("openclaw/plugin-sdk/plugin-entry").OpenClawPluginDefinition["register"]>;
} & Pick<import("openclaw/plugin-sdk/plugin-entry").OpenClawPluginDefinition, "kind" | "reload" | "nodeHostCommands" | "securityAuditCollectors">;
export default pluginEntry;
export { forgePluginConfigSchema, registerForgePlugin, resolveForgePluginConfig };
