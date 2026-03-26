import {
  FORGE_PLUGIN_DESCRIPTION,
  FORGE_PLUGIN_ID,
  FORGE_PLUGIN_NAME,
  forgePluginConfigSchema,
  registerForgePlugin,
  resolveForgePluginConfig
} from "./plugin-entry-shared.js";

const legacyPluginEntry = {
  id: FORGE_PLUGIN_ID,
  name: FORGE_PLUGIN_NAME,
  description: FORGE_PLUGIN_DESCRIPTION,
  configSchema: forgePluginConfigSchema,
  register: registerForgePlugin
};

export default legacyPluginEntry;

export { forgePluginConfigSchema, registerForgePlugin, resolveForgePluginConfig };
