import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  gitHelperOverviewSchema,
  gitHelperSearchKindSchema,
  gitHelperSearchResponseSchema,
  type GitHelperOverview,
  type GitHelperRef,
  type GitHelperSearchKind,
  type GitHelperSearchResponse
} from "../types.js";

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  ".."
);

function trim(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

async function runCommand(command: string, args: string[]) {
  const { stdout } = await execFile(command, args, {
    cwd: repoRoot,
    timeout: 8_000,
    maxBuffer: 1024 * 1024
  });
  return stdout.trim();
}

function parseGithubRepository(remote: string) {
  const sshMatch = remote.match(/github\.com:([^/]+\/[^/.]+)(?:\.git)?$/);
  if (sshMatch) {
    return sshMatch[1] ?? "";
  }
  const httpsMatch = remote.match(
    /github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/
  );
  return httpsMatch?.[1] ?? "";
}

function buildBranchUrl(repository: string, branch: string) {
  if (!repository || !branch) {
    return null;
  }
  return `https://github.com/${repository}/tree/${encodeURIComponent(branch)}`;
}

function buildCommitUrl(repository: string, sha: string) {
  if (!repository || !sha) {
    return null;
  }
  return `https://github.com/${repository}/commit/${sha}`;
}

function normalizeBranchName(value: string) {
  return value.replace(/^origin\//, "");
}

async function getRepositoryContext() {
  const warnings: string[] = [];
  let remote = "";
  let repository = "";
  let currentBranch: string | null = null;

  try {
    remote = await runCommand("git", ["config", "--get", "remote.origin.url"]);
    repository = parseGithubRepository(remote);
  } catch {
    warnings.push("Forge could not resolve the local git remote.");
  }

  try {
    currentBranch = await runCommand("git", [
      "rev-parse",
      "--abbrev-ref",
      "HEAD"
    ]);
  } catch {
    warnings.push("Forge could not resolve the current branch.");
  }

  return {
    provider: repository ? "github" : "git",
    repository,
    currentBranch,
    baseBranch: "main",
    warnings
  };
}

async function searchBranches(
  repository: string,
  query = "",
  limit = 12
): Promise<GitHelperRef[]> {
  const output = await runCommand("git", [
    "for-each-ref",
    "--sort=-committerdate",
    "--format=%(refname:short)\t%(committerdate:short)\t%(subject)",
    "refs/heads",
    "refs/remotes/origin/*"
  ]);
  const normalizedQuery = query.trim().toLowerCase();
  const seen = new Set<string>();

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawName, dateLabel = "", subject = ""] = line.split("\t");
      const branch = normalizeBranchName(rawName ?? "");
      return {
        branch,
        dateLabel,
        subject
      };
    })
    .filter((entry) => {
      if (!entry.branch || seen.has(entry.branch)) {
        return false;
      }
      seen.add(entry.branch);
      if (!normalizedQuery) {
        return true;
      }
      return `${entry.branch} ${entry.subject}`.toLowerCase().includes(
        normalizedQuery
      );
    })
    .slice(0, limit)
    .map((entry) => ({
      key: `branch:${entry.branch}`,
      refType: "branch",
      provider: repository ? "github" : "git",
      repository,
      refValue: entry.branch,
      url: buildBranchUrl(repository, entry.branch),
      displayTitle: entry.branch,
      subtitle: [entry.dateLabel, entry.subject].filter(Boolean).join(" · ")
    }));
}

async function searchCommits(
  repository: string,
  query = "",
  limit = 12
): Promise<GitHelperRef[]> {
  const output = await runCommand("git", [
    "log",
    "--all",
    "--date=short",
    "--pretty=format:%H\t%h\t%s\t%ad\t%an",
    "-n",
    "60"
  ]);
  const normalizedQuery = query.trim().toLowerCase();

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha = "", shortSha = "", subject = "", dateLabel = "", author = ""] =
        line.split("\t");
      return {
        sha,
        shortSha,
        subject,
        dateLabel,
        author
      };
    })
    .filter((entry) => {
      if (!normalizedQuery) {
        return true;
      }
      return `${entry.sha} ${entry.shortSha} ${entry.subject} ${entry.author}`
        .toLowerCase()
        .includes(normalizedQuery);
    })
    .slice(0, limit)
    .map((entry) => ({
      key: `commit:${entry.sha}`,
      refType: "commit",
      provider: repository ? "github" : "git",
      repository,
      refValue: entry.sha,
      url: buildCommitUrl(repository, entry.sha),
      displayTitle: `${entry.shortSha} ${entry.subject}`.trim(),
      subtitle: [entry.dateLabel, entry.author].filter(Boolean).join(" · ")
    }));
}

async function searchPullRequests(
  repository: string,
  query = "",
  limit = 12
): Promise<{ refs: GitHelperRef[]; warnings: string[] }> {
  if (!repository) {
    return { refs: [], warnings: [] };
  }

  try {
    const stdout = await runCommand("gh", [
      "pr",
      "list",
      "-R",
      repository,
      "--state",
      "all",
      "--limit",
      String(limit),
      "--search",
      query.trim(),
      "--json",
      "number,title,url,headRefName,state,isDraft,updatedAt,author"
    ]);
    const parsed = JSON.parse(stdout) as Array<{
      number: number;
      title: string;
      url: string;
      headRefName: string;
      state: string;
      isDraft: boolean;
      updatedAt: string;
      author?: { login?: string | null } | null;
    }>;
    return {
      refs: parsed.map((entry) => ({
        key: `pull_request:${entry.number}`,
        refType: "pull_request",
        provider: "github",
        repository,
        refValue: String(entry.number),
        url: entry.url,
        displayTitle: `PR #${entry.number} ${entry.title}`.trim(),
        subtitle: [
          entry.headRefName,
          entry.state.toLowerCase(),
          entry.isDraft ? "draft" : "",
          entry.author?.login ?? ""
        ]
          .filter(Boolean)
          .join(" · ")
      })),
      warnings: []
    };
  } catch {
    return {
      refs: [],
      warnings: [
        "Forge could not search pull requests through GitHub CLI right now."
      ]
    };
  }
}

export async function getGitHelperOverview(): Promise<GitHelperOverview> {
  const context = await getRepositoryContext();
  const [branches, commits, prResult] = await Promise.all([
    searchBranches(context.repository),
    searchCommits(context.repository),
    searchPullRequests(context.repository)
  ]);

  return gitHelperOverviewSchema.parse({
    repoRoot,
    provider: context.provider,
    repository: context.repository,
    currentBranch: context.currentBranch,
    baseBranch: context.baseBranch,
    branches,
    commits,
    pullRequests: prResult.refs,
    warnings: [...context.warnings, ...prResult.warnings]
  });
}

export async function searchGitHelperRefs(input: {
  kind: GitHelperSearchKind;
  query?: string;
  repository?: string;
}): Promise<GitHelperSearchResponse> {
  const parsedKind = gitHelperSearchKindSchema.parse(input.kind);
  const context = await getRepositoryContext();
  const repository = trim(input.repository) || context.repository;
  let refs: GitHelperRef[] = [];
  let warnings = [...context.warnings];

  if (parsedKind === "branch") {
    refs = await searchBranches(repository, input.query);
  } else if (parsedKind === "commit") {
    refs = await searchCommits(repository, input.query);
  } else {
    const prResult = await searchPullRequests(repository, input.query);
    refs = prResult.refs;
    warnings = [...warnings, ...prResult.warnings];
  }

  return gitHelperSearchResponseSchema.parse({
    provider: repository ? "github" : context.provider,
    repository,
    kind: parsedKind,
    refs,
    warnings
  });
}
