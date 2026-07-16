import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PeopleGatewayProvider } from "@/components/people/people-gateway";
import type { PeopleGateway } from "@/components/people/people-types";

export function createPeopleTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false }
    }
  });
}

export function renderPeopleUi(
  ui: ReactElement,
  {
    gateway,
    route = "/people"
  }: { gateway?: PeopleGateway; route?: string } = {}
) {
  const queryClient = createPeopleTestQueryClient();
  const router = <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>;
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        {gateway ? (
          <PeopleGatewayProvider gateway={gateway}>
            {router}
          </PeopleGatewayProvider>
        ) : (
          router
        )}
      </QueryClientProvider>
    )
  };
}

export function setPeopleViewport(desktop: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: query.includes("min-width") ? desktop : !desktop,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false
    })
  });
}
