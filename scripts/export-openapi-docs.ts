import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiDocument } from "../server/src/openapi.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const docsRoot = path.join(repoRoot, "openclaw-plugin", "docs");
const apiDocsRoot = path.join(docsRoot, "api");
const document = buildOpenApiDocument();
const payload = `${JSON.stringify(document, null, 2)}\n`;

mkdirSync(apiDocsRoot, { recursive: true });
writeFileSync(path.join(docsRoot, "openapi.json"), payload, "utf8");
writeFileSync(path.join(apiDocsRoot, "openapi.json"), payload, "utf8");

console.log("Exported OpenAPI documents:");
console.log(`- ${path.join(docsRoot, "openapi.json")}`);
console.log(`- ${path.join(apiDocsRoot, "openapi.json")}`);
