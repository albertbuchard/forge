import type { Task, TaskRun, WorkItemGitRef } from "@/lib/types";

type ParsedStep = {
  label: string;
  completed: boolean | null;
};

export interface TaskStepSummary {
  total: number;
  completed: number;
  source: "acceptance_criteria" | "ai_instructions" | "description";
  items: string[];
}

export interface TaskGitSummary {
  provider: string | null;
  repository: string | null;
  branch: string | null;
  branchUrl: string | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  compareUrl: string | null;
  linkedRefCount: number;
}

export interface TaskExecutionSummary {
  actor: string | null;
  activeRun: TaskRun | null;
  stepSummary: TaskStepSummary | null;
  changedFileCount: number;
  changedFilesPreview: string[];
  git: TaskGitSummary;
}

function parsePullRequestNumber(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const match = value.match(/(\d+)/);
    if (match) {
      const parsed = Number.parseInt(match[1] ?? "", 10);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }
  }
  return null;
}

function parseMarkdownSteps(markdown: string): ParsedStep[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .reduce<ParsedStep[]>((steps, line) => {
      const checklistMatch = line.match(/^[-*+]\s+\[([ xX])\]\s+(.+)$/);
      if (checklistMatch) {
        steps.push({
          label: checklistMatch[2]!.trim(),
          completed: checklistMatch[1]!.toLowerCase() === "x"
        });
        return steps;
      }
      const listMatch = line.match(/^(?:[-*+]|\d+\.)\s+(.+)$/);
      if (listMatch) {
        steps.push({
          label: listMatch[1]!.trim(),
          completed: null
        });
      }
      return steps;
    }, [])
    .filter((step) => step.label.length > 0);
}

export function getTaskStepSummary(task: Task): TaskStepSummary | null {
  if (task.acceptanceCriteria.length > 0) {
    return {
      total: task.acceptanceCriteria.length,
      completed:
        task.status === "done" ? task.acceptanceCriteria.length : 0,
      source: "acceptance_criteria",
      items: task.acceptanceCriteria
    };
  }

  const aiInstructionSteps = parseMarkdownSteps(task.aiInstructions);
  if (aiInstructionSteps.length > 0) {
    const completed =
      task.status === "done"
        ? aiInstructionSteps.length
        : aiInstructionSteps.filter((step) => step.completed === true).length;
    return {
      total: aiInstructionSteps.length,
      completed,
      source: "ai_instructions",
      items: aiInstructionSteps.map((step) => step.label)
    };
  }

  const descriptionSteps = parseMarkdownSteps(task.description);
  if (descriptionSteps.length > 0) {
    const completed =
      task.status === "done"
        ? descriptionSteps.length
        : descriptionSteps.filter((step) => step.completed === true).length;
    return {
      total: descriptionSteps.length,
      completed,
      source: "description",
      items: descriptionSteps.map((step) => step.label)
    };
  }

  return null;
}

function pickLatestRef(
  refs: WorkItemGitRef[],
  refType: WorkItemGitRef["refType"]
): WorkItemGitRef | null {
  return refs.find((ref) => ref.refType === refType) ?? null;
}

export function getTaskExecutionSummary(
  task: Task,
  activeRun: TaskRun | null = null
): TaskExecutionSummary {
  const linkedGitRefIds = new Set(task.completionReport?.linkedGitRefIds ?? []);
  const branchRef = pickLatestRef(task.gitRefs, "branch");
  const pullRequestRef = pickLatestRef(task.gitRefs, "pull_request");
  const gitContext = activeRun?.gitContext ?? null;
  const pullRequestNumber =
    gitContext?.pullRequestNumber ??
    parsePullRequestNumber(
      pullRequestRef?.refValue ?? pullRequestRef?.displayTitle ?? null
    );

  return {
    actor: activeRun?.actor ?? null,
    activeRun,
    stepSummary: getTaskStepSummary(task),
    changedFileCount: task.completionReport?.modifiedFiles.length ?? 0,
    changedFilesPreview: (task.completionReport?.modifiedFiles ?? []).slice(0, 2),
    git: {
      provider:
        gitContext?.provider?.trim() ||
        branchRef?.provider?.trim() ||
        pullRequestRef?.provider?.trim() ||
        null,
      repository:
        gitContext?.repository?.trim() ||
        branchRef?.repository?.trim() ||
        pullRequestRef?.repository?.trim() ||
        null,
      branch:
        gitContext?.branch?.trim() || branchRef?.refValue?.trim() || null,
      branchUrl: gitContext?.branchUrl ?? branchRef?.url ?? null,
      pullRequestNumber,
      pullRequestUrl:
        gitContext?.pullRequestUrl ?? pullRequestRef?.url ?? null,
      compareUrl: gitContext?.compareUrl ?? null,
      linkedRefCount: linkedGitRefIds.size
    }
  };
}
