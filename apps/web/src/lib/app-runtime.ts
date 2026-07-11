import { QueryClient } from "@tanstack/react-query";
import ReactDOM from "react-dom/client";
import type { Root } from "react-dom/client";

export type ForgeRuntimeHost = {
  __forgeQueryClient?: QueryClient;
  __forgeReactRoot?: Root;
  __forgeReactRootElement?: HTMLElement;
};

type ForgeRuntimeFactories = {
  createQueryClient?: () => QueryClient;
  createRoot?: (element: HTMLElement) => Root;
};

export function getOrCreateForgeRuntime(
  host: ForgeRuntimeHost,
  rootElement: HTMLElement,
  factories: ForgeRuntimeFactories = {}
) {
  const queryClient =
    host.__forgeQueryClient ??
    (factories.createQueryClient ?? createForgeQueryClient)();
  const canReuseRoot =
    host.__forgeReactRoot !== undefined &&
    host.__forgeReactRootElement === rootElement;
  const reactRoot = canReuseRoot
    ? host.__forgeReactRoot!
    : (factories.createRoot ?? ReactDOM.createRoot)(rootElement);

  host.__forgeQueryClient = queryClient;
  host.__forgeReactRoot = reactRoot;
  host.__forgeReactRootElement = rootElement;

  return { queryClient, reactRoot };
}

function createForgeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 20_000,
        refetchOnWindowFocus: false
      }
    }
  });
}
