import type { QueryClient } from "@tanstack/react-query";

export function prependEntityToCollection<T extends { id: string }, K extends string>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  field: K,
  item: T
) {
  queryClient.setQueryData<Record<K, T[]> | undefined>(queryKey, (current) => {
    const existing = current?.[field] ?? [];
    if (existing.some((entry) => entry.id === item.id)) {
      return current;
    }

    return {
      ...(current ?? {}),
      [field]: [item, ...existing]
    } as Record<K, T[]>;
  });
}
