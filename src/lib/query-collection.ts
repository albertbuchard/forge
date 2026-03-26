import type { UseQueryResult } from "@tanstack/react-query";

export type QueryCollectionEntry = Pick<UseQueryResult<unknown, unknown>, "error" | "isError" | "isLoading" | "isPending" | "refetch">;

function normalizeQueryError(error: unknown) {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return new Error(error);
  }
  return new Error("Forge could not complete the requested query collection.");
}

export function collectQueryCollectionState(queries: readonly QueryCollectionEntry[]) {
  const failingQuery = queries.find((query) => query.isError);

  return {
    isLoading: queries.some((query) => query.isPending || query.isLoading),
    error: failingQuery ? normalizeQueryError(failingQuery.error) : null
  };
}

export async function retryQueryCollection(queries: readonly QueryCollectionEntry[]) {
  await Promise.all(queries.map((query) => query.refetch()));
}
