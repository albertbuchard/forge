import {
  createContext,
  useContext,
  useMemo,
  type ReactNode
} from "react";
import {
  getWorkbenchNodeCatalog,
  getWorkbenchNodeDefinition,
  listWorkbenchNodeDefinitions
} from "@/lib/workbench/registry";
import type { WorkbenchNodeDefinition } from "@/lib/workbench/nodes";

type WorkbenchContextValue = {
  definitions: WorkbenchNodeDefinition[];
  catalog: ReturnType<typeof getWorkbenchNodeCatalog>;
  getDefinition: (nodeId: string) => WorkbenchNodeDefinition | null;
};

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

const FALLBACK_REGISTRY: WorkbenchContextValue = {
  definitions: listWorkbenchNodeDefinitions(),
  catalog: getWorkbenchNodeCatalog(),
  getDefinition: getWorkbenchNodeDefinition
};

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const value = useMemo<WorkbenchContextValue>(
    () => ({
      definitions: listWorkbenchNodeDefinitions(),
      catalog: getWorkbenchNodeCatalog(),
      getDefinition: getWorkbenchNodeDefinition
    }),
    []
  );

  return (
    <WorkbenchContext.Provider value={value}>
      {children}
    </WorkbenchContext.Provider>
  );
}

export function useWorkbenchRegistry() {
  return useContext(WorkbenchContext) ?? FALLBACK_REGISTRY;
}

export function useWorkbenchNodeCatalog() {
  return useWorkbenchRegistry().catalog;
}

export function useWorkbenchNodeDefinition(nodeId: string | null | undefined) {
  const registry = useWorkbenchRegistry();
  if (!nodeId) {
    return null;
  }
  return registry.getDefinition(nodeId);
}

export function WorkbenchBox({
  children
}: {
  children: ReactNode;
  boxId?: string;
  surfaceId?: string | null;
  routePath?: string | null;
}) {
  return <>{children}</>;
}
