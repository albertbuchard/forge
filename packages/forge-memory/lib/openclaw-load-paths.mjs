import fs from "node:fs";
import path from "node:path";

function resolvedPath(value) {
  const absolute = path.resolve(value);
  try {
    return fs.realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

function manifestIdentifiesForgePlugin(pluginRoot, pluginId) {
  for (const [fileName, identityKey] of [
    ["openclaw.plugin.json", "id"],
    ["package.json", "name"]
  ]) {
    try {
      const payload = JSON.parse(
        fs.readFileSync(path.join(pluginRoot, fileName), "utf8")
      );
      if (payload?.[identityKey] === pluginId) return true;
    } catch {
      // A missing or invalid unrelated manifest is not Forge authority.
    }
  }
  return false;
}

export function reconcileOpenClawPluginLoadPaths(
  loadPaths,
  desiredPluginRoot,
  pluginId
) {
  const desired = resolvedPath(desiredPluginRoot);
  const reconciled = [];

  for (const entry of Array.isArray(loadPaths) ? loadPaths : []) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    const candidate = resolvedPath(entry);
    if (candidate === desired) continue;
    if (manifestIdentifiesForgePlugin(candidate, pluginId)) continue;
    if (!reconciled.some((kept) => resolvedPath(kept) === candidate)) {
      reconciled.push(entry);
    }
  }

  reconciled.push(desired);
  return reconciled;
}
