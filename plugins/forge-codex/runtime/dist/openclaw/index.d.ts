import { type OpenClawPluginDefinition } from "openclaw/plugin-sdk/plugin-entry";
import { forgePluginConfigSchema, registerForgePlugin, resolveForgePluginConfig } from "./plugin-entry-shared.js";
declare const pluginEntry: OpenClawPluginDefinition;
export default pluginEntry;
export { forgePluginConfigSchema, registerForgePlugin, resolveForgePluginConfig };
