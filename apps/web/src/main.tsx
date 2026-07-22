import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/sora";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "katex/dist/katex.min.css";
import { App } from "./app";
import {
  getOrCreateForgeRuntime,
  type ForgeRuntimeHost
} from "./lib/app-runtime";
import { normalizeRouterBasename } from "./lib/runtime-paths";
import { appStore } from "./store/store";
import "./styles.css";

type RootErrorBoundaryProps = {
  children: React.ReactNode;
};

type RootErrorBoundaryState = {
  error: Error | null;
};

class RootErrorBoundary extends React.Component<
  RootErrorBoundaryProps,
  RootErrorBoundaryState
> {
  state: RootErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Forge failed to render", error, errorInfo);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="grid min-h-dvh place-items-center bg-canvas px-5 py-10 text-ink">
        <section className="w-full max-w-xl rounded-[1.25rem] border border-[var(--ui-border-strong)] bg-[var(--surface-panel)] p-6 shadow-[var(--ui-shadow-floating)]">
          <p className="font-label text-xs font-bold uppercase tracking-[0.08em] text-primary/80">
            Forge runtime
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-normal text-ink">
            Forge could not finish rendering
          </h1>
          <p className="mt-3 text-sm leading-6 text-ink/70">
            The HTML entrypoint loaded, but the React application hit an error
            before the interface could be displayed. Hard refresh the Tailscale
            page first; if this remains visible, check the browser console and
            the local Forge runtime logs.
          </p>
          <pre className="mt-4 max-h-44 overflow-auto rounded-2xl border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 text-xs leading-5 text-ink/70">
            {this.state.error.message}
          </pre>
          <button
            className="mt-5 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-2 text-sm font-semibold text-ink transition hover:bg-[var(--ui-surface-hover)]"
            type="button"
            onClick={() => window.location.reload()}
          >
            Reload Forge
          </button>
        </section>
      </main>
    );
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Forge could not find its root element.");
}
const { queryClient, reactRoot } = getOrCreateForgeRuntime(
  window as ForgeRuntimeHost,
  rootElement
);

reactRoot.render(
  <React.StrictMode>
    <RootErrorBoundary>
      <Provider store={appStore}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter
            basename={normalizeRouterBasename(import.meta.env.BASE_URL)}
          >
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </Provider>
    </RootErrorBoundary>
  </React.StrictMode>
);
