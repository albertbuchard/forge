import { QueryClient } from "@tanstack/react-query";
import ReactDOM from "react-dom/client";
import type { Root } from "react-dom/client";
import { ForgeApiError } from "./api-error";

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

function readErrorStatus(error: unknown) {
  if (error instanceof ForgeApiError) {
    return error.status;
  }
  if (!error || typeof error !== "object") {
    return null;
  }
  const candidate = error as { status?: unknown; statusCode?: unknown };
  const value =
    typeof candidate.status === "number"
      ? candidate.status
      : candidate.statusCode;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export function shouldRetryForgeQuery(failureCount: number, error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return false;
  }
  const status = readErrorStatus(error);
  if (status !== null && status >= 400 && status < 500) {
    return false;
  }
  return failureCount < 2;
}

export function createForgeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 20_000,
        refetchOnWindowFocus: false,
        retry: shouldRetryForgeQuery
      },
      mutations: {
        retry: false
      }
    }
  });
}
