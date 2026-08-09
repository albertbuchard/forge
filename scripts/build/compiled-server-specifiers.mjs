import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

function normalizeRelativeJsSpecifier(specifier) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return specifier;
  }
  if (specifier.endsWith("/")) {
    return `${specifier}index.js`;
  }
  return path.extname(specifier) ? specifier : `${specifier}.js`;
}

function rewriteRelativeJsSpecifiers(source) {
  return source
    .replace(
      /((?:import|export)\s[^"'\n]*?\sfrom\s+["'])(\.\.?\/[^"']+)(["'])/g,
      (_match, prefix, specifier, suffix) =>
        `${prefix}${normalizeRelativeJsSpecifier(specifier)}${suffix}`
    )
    .replace(
      /(import\s*\(\s*["'])(\.\.?\/[^"']+)(["']\s*\))/g,
      (_match, prefix, specifier, suffix) =>
        `${prefix}${normalizeRelativeJsSpecifier(specifier)}${suffix}`
    );
}

function resolveAliasJsSpecifier(filePath, specifier, emittedWebSrcRoot) {
  if (!specifier.startsWith("@/")) {
    return specifier;
  }
  const targetPath = path.join(emittedWebSrcRoot, specifier.slice(2));
  const relativePath = path.relative(
    path.dirname(filePath),
    path.extname(targetPath) ? targetPath : `${targetPath}.js`
  );
  const normalized = relativePath.split(path.sep).join("/");
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

function rewriteAliasJsSpecifiers(filePath, source, emittedWebSrcRoot) {
  return source
    .replace(
      /((?:import|export)\s[^"'\n]*?\sfrom\s+["'])(@\/[^"']+)(["'])/g,
      (_match, prefix, specifier, suffix) =>
        `${prefix}${resolveAliasJsSpecifier(filePath, specifier, emittedWebSrcRoot)}${suffix}`
    )
    .replace(
      /(import\s*\(\s*["'])(@\/[^"']+)(["']\s*\))/g,
      (_match, prefix, specifier, suffix) =>
        `${prefix}${resolveAliasJsSpecifier(filePath, specifier, emittedWebSrcRoot)}${suffix}`
    );
}

export async function removeCompiledTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await removeCompiledTests(fullPath);
      continue;
    }
    if (entry.isFile() && /\.test\.js$/u.test(entry.name)) {
      await rm(fullPath, { force: true });
    }
  }
}

export async function patchCompiledJsSpecifiers(
  directory,
  { emittedWebSrcRoot }
) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await patchCompiledJsSpecifiers(fullPath, { emittedWebSrcRoot });
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".js")) {
      continue;
    }
    const source = await readFile(fullPath, "utf8");
    const rewritten = rewriteAliasJsSpecifiers(
      fullPath,
      rewriteRelativeJsSpecifiers(source),
      emittedWebSrcRoot
    );
    if (rewritten !== source) {
      await writeFile(fullPath, rewritten, "utf8");
    }
  }
}
