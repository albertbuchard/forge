import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { forgeApi } from "@/store/api/forge-api";
import { appStore } from "@/store/store";

export async function invalidateForgeSnapshot(
  queryClient: QueryClient,
  extraQueryKeys: QueryKey[] = []
) {
  appStore.dispatch(forgeApi.util.invalidateTags(["Snapshot"]));
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] }),
    ...extraQueryKeys.map((queryKey) =>
      queryClient.invalidateQueries({ queryKey })
    )
  ]);
}
