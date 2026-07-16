import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "../..");

const privatePathPatterns = [
  /(^|\/)docs\/(?:internal|private|handoffs?|automations?)(?:\/|$)/i,
  /(^|\/)(?:gpt[-_ ]?pro|conversation[-_ ]?captures?|automation[-_ ]?memory)(?:\/|\.|$)/i,
  /(^|\/)(?:private|internal)[-_](?:goal|plan|audit|handoff|memory)(?:\/|\.|$)/i
];

const privateContentPatterns = [
  {
    label: "Codex automation memory path",
    pattern: /\$CODEX_HOME\/automations\//i
  },
  { label: "private Forge goal path", pattern: /private\/forge-goals\//i },
  { label: "private monorepo path", pattern: /aurel-monorepo\/private\//i },
  { label: "GPT Pro capture", pattern: /\bGPT Pro\b/i },
  {
    label: "Codex delegation payload",
    pattern: /<\/?codex_delegation\b|source_thread_id/i
  },
  {
    label: "conversation-derived private record",
    pattern:
      /\b(?:personal discussion summar(?:y|ies)|internal handoff|automation memory|conversation-derived (?:file|note|record|summary))\b/i,
    allowPaths: new Set([
      ".vision/goal_alignment.md",
      ".vision/product_vision.md",
      "docs/reference/repository-structure.md"
    ])
  }
];

export function findPublicReleasePrivacyFindings(relativePath, content) {
  const normalizedPath = relativePath.split(path.sep).join("/");
  const findings = [];
  for (const pattern of privatePathPatterns) {
    if (pattern.test(normalizedPath)) {
      findings.push({ kind: "path", label: "private planning path" });
      break;
    }
  }
  for (const { label, pattern, allowPaths } of privateContentPatterns) {
    if (allowPaths?.has(normalizedPath)) continue;
    const match = pattern.exec(content);
    if (!match) continue;
    const line = content.slice(0, match.index).split("\n").length;
    findings.push({ kind: "content", label, line });
  }
  return findings;
}

function gitPaths(args) {
  const output = execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  return output.split("\0").filter(Boolean);
}

function candidatePaths() {
  const tracked = gitPaths(["ls-files", "-z", "--", "*.md", "docs/**"]);
  const staged = gitPaths([
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMR",
    "-z",
    "--",
    "*.md",
    "docs/**"
  ]);
  const untracked = gitPaths([
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    "*.md",
    "docs/**"
  ]);
  return [...new Set([...tracked, ...staged, ...untracked])].sort();
}

export function runPublicReleasePrivacyCheck() {
  const findings = [];
  for (const relativePath of candidatePaths()) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!existsSync(absolutePath)) continue;
    const content = readFileSync(absolutePath);
    if (content.includes(0)) continue;
    for (const finding of findPublicReleasePrivacyFindings(
      relativePath,
      content.toString("utf8")
    )) {
      findings.push({ relativePath, ...finding });
    }
  }
  if (findings.length > 0) {
    for (const finding of findings) {
      const location =
        finding.kind === "content"
          ? `${finding.relativePath}:${finding.line}`
          : finding.relativePath;
      console.error(`${location}: ${finding.label}`);
    }
    throw new Error(
      "Public Forge release privacy check found private planning or conversation-derived material."
    );
  }
  console.log("public Forge release privacy check passed");
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  runPublicReleasePrivacyCheck();
}
