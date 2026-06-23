import { getGoalById } from "../repositories/goals.js";
import { listTagsByIds } from "../repositories/tags.js";
import { HttpError } from "../errors.js";

function assertKnownTags(tagIds: string[]): void {
  if (tagIds.length === 0) {
    return;
  }

  const knownTagIds = new Set(listTagsByIds(tagIds).map((tag) => tag.id));
  const missingTagIds = [...new Set(tagIds)].filter((tagId) => !knownTagIds.has(tagId));
  if (missingTagIds.length > 0) {
    throw new HttpError(404, "tag_not_found", `Unknown tag ids: ${missingTagIds.join(", ")}`);
  }
}

export function assertGoalExists(goalId: string | null | undefined): void {
  if (!goalId) {
    return;
  }

  if (!getGoalById(goalId)) {
    throw new HttpError(404, "goal_not_found", `Goal ${goalId} does not exist`);
  }
}

export function assertTaskRelations(input: { goalId?: string | null; tagIds?: string[] }): void {
  assertGoalExists(input.goalId);
  assertKnownTags(input.tagIds ?? []);
}

export function assertGoalRelations(input: { tagIds?: string[] }): void {
  assertKnownTags(input.tagIds ?? []);
}
