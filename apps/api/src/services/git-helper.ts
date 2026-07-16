import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { HttpError } from "../errors.js";
import {
  TASK_CLOSEOUT_LIMITS,
  gitHelperOverviewSchema,
  gitHelperSearchQuerySchema,
  gitHelperSearchResponseSchema,
  type GitHelperOverview,
  type GitHelperRef,
  type GitHelperSearchInput,
  type GitHelperSearchResponse
} from "../types.js";

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".."
);

function trim(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function truncate(value: string | null | undefined, maxLength: number) {
  return trim(value).slice(0, maxLength);
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
  const match = remote.match(
    /github\.com[:/]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/?$/
  );
  const repository = (match?.[1] ?? "").replace(/\.git$/, "");
  return repository.length <= TASK_CLOSEOUT_LIMITS.gitHelperRepositoryLength
    ? repository
    : "";
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
    currentBranch = truncate(
      await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
      TASK_CLOSEOUT_LIMITS.gitRefValueLength
    );
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
      return `${entry.branch} ${entry.subject}`
        .toLowerCase()
        .includes(normalizedQuery);
    })
    .slice(0, limit)
    .map((entry) => ({
      key: `branch:${entry.branch}`,
      refType: "branch",
      provider: repository ? "github" : "git",
      repository,
      refValue: truncate(entry.branch, TASK_CLOSEOUT_LIMITS.gitRefValueLength),
      url: buildBranchUrl(repository, entry.branch),
      displayTitle: truncate(
        entry.branch,
        TASK_CLOSEOUT_LIMITS.gitDisplayTitleLength
      ),
      subtitle: truncate(
        [entry.dateLabel, entry.subject].filter(Boolean).join(" · "),
        TASK_CLOSEOUT_LIMITS.gitDisplayTitleLength
      )
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
      const [
        sha = "",
        shortSha = "",
        subject = "",
        dateLabel = "",
        author = ""
      ] = line.split("\t");
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
      displayTitle: truncate(
        `${entry.shortSha} ${entry.subject}`,
        TASK_CLOSEOUT_LIMITS.gitDisplayTitleLength
      ),
      subtitle: truncate(
        [entry.dateLabel, entry.author].filter(Boolean).join(" · "),
        TASK_CLOSEOUT_LIMITS.gitDisplayTitleLength
      )
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
        displayTitle: truncate(
          `PR #${entry.number} ${entry.title}`,
          TASK_CLOSEOUT_LIMITS.gitDisplayTitleLength
        ),
        subtitle: truncate(
          [
            entry.headRefName,
            entry.state.toLowerCase(),
            entry.isDraft ? "draft" : "",
            entry.author?.login ?? ""
          ]
            .filter(Boolean)
            .join(" · "),
          TASK_CLOSEOUT_LIMITS.gitDisplayTitleLength
        )
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

export async function searchGitHelperRefs(
  input: GitHelperSearchInput
): Promise<GitHelperSearchResponse> {
  const parsedInput = gitHelperSearchQuerySchema.parse(input);
  const context = await getRepositoryContext();
  const repository = parsedInput.repository ?? context.repository;
  let refs: GitHelperRef[] = [];
  let warnings = [...context.warnings];

  if (
    parsedInput.kind !== "pull_request" &&
    parsedInput.repository !== undefined &&
    parsedInput.repository !== context.repository
  ) {
    throw new HttpError(
      400,
      "git_helper_repository_mismatch",
      "Local branch and commit searches are limited to the configured Forge repository"
    );
  }

  if (parsedInput.kind === "branch") {
    refs = await searchBranches(
      context.repository,
      parsedInput.query,
      parsedInput.limit
    );
  } else if (parsedInput.kind === "commit") {
    refs = await searchCommits(
      context.repository,
      parsedInput.query,
      parsedInput.limit
    );
  } else {
    const prResult = await searchPullRequests(
      repository,
      parsedInput.query,
      parsedInput.limit
    );
    refs = prResult.refs;
    warnings = [...warnings, ...prResult.warnings];
  }

  return gitHelperSearchResponseSchema.parse({
    provider: repository ? "github" : context.provider,
    repository,
    kind: parsedInput.kind,
    refs,
    warnings
  });
}
