import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import {
  getWorkbenchBoxDefinition,
  type WorkbenchMountedBox
} from "@/lib/workbench/boxes";

type WorkbenchContextValue = {
  mountedBoxes: WorkbenchMountedBox[];
  registerBox: (input: {
    boxId: string;
    surfaceId?: string | null;
    routePath?: string | null;
  }) => () => void;
};

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);
const FALLBACK_REGISTRY: WorkbenchContextValue = {
  mountedBoxes: [],
  registerBox: () => () => {}
};
let hasWarnedAboutMissingProvider = false;

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const [mountedBoxes, setMountedBoxes] = useState<WorkbenchMountedBox[]>([]);

  const value = useMemo<WorkbenchContextValue>(
    () => ({
      mountedBoxes,
      registerBox: ({ boxId, surfaceId = null, routePath = null }) => {
        const mountedAt = new Date().toISOString();
        setMountedBoxes((current) => {
          const next = current.filter((entry) => entry.boxId !== boxId);
          next.push({ boxId, surfaceId, routePath, mountedAt });
          return next;
        });
        return () => {
          setMountedBoxes((current) =>
            current.filter((entry) => entry.boxId !== boxId)
          );
        };
      }
    }),
    [mountedBoxes]
  );

  return (
    <WorkbenchContext.Provider value={value}>
      {children}
    </WorkbenchContext.Provider>
  );
}

export function useWorkbenchRegistry() {
  const context = useContext(WorkbenchContext);
  if (!context) {
    if (
      import.meta.env.DEV &&
      import.meta.env.MODE !== "test" &&
      !hasWarnedAboutMissingProvider
    ) {
      hasWarnedAboutMissingProvider = true;
      console.warn(
        "[Workbench] useWorkbenchRegistry was called outside WorkbenchProvider. Falling back to a no-op registry."
      );
    }
    return FALLBACK_REGISTRY;
  }
  return context;
}

export function useWorkbenchBox(input: {
  boxId: string;
  surfaceId?: string | null;
  routePath?: string | null;
}) {
  const registry = useWorkbenchRegistry();
  const definition = getWorkbenchBoxDefinition(input.boxId);

  useEffect(() => {
    const dispose = registry.registerBox(input);
    return dispose;
  }, [input.boxId, input.routePath, input.surfaceId, registry]);

  useEffect(() => {
    if (!definition && import.meta.env.DEV) {
      console.warn(
        `[Workbench] rendered box ${input.boxId} is not present in the shared Workbench box manifest.`
      );
    }
  }, [definition, input.boxId]);

  return definition;
}

export function WorkbenchBox({
  boxId,
  surfaceId = null,
  routePath = null,
  children
}: {
  boxId: string;
  surfaceId?: string | null;
  routePath?: string | null;
  children: ReactNode;
}) {
  useWorkbenchBox({ boxId, surfaceId, routePath });
  return <>{children}</>;
}
