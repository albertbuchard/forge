import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { PsycheModeGuidePage } from "@/pages/psyche-mode-guide-page";

const { listModeGuideSessionsMock } = vi.hoisted(() => ({
  listModeGuideSessionsMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  createModeGuideSession: vi.fn(),
  listModeGuideSessions: listModeGuideSessionsMock
}));

vi.mock("@/components/psyche/psyche-section-nav", () => ({
  PsycheSectionNav: () => null
}));

vi.mock("@/components/psyche/use-psyche-focus-target", () => ({
  psycheFocusClass: () => "",
  usePsycheFocusTarget: () => undefined
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({ actions }: { actions?: React.ReactNode }) => <>{actions}</>
}));

beforeEach(() => {
  listModeGuideSessionsMock.mockResolvedValue({ sessions: [] });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: true,
      media: "(max-width: 1023px)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PsycheModeGuidePage phone flow", () => {
  it("opens the real guided flow as a bounded phone panel with one prompt", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/psyche/modes/guide"]}>
          <PsycheModeGuidePage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Start guided reflection" })
    );

    expect(screen.getByTestId("question-flow-dialog")).toHaveClass("inset-x-3");
    expect(
      screen.getByRole("heading", {
        name: "What was happening, and what felt most important?"
      })
    ).toBeInTheDocument();
    expect(
      screen.queryByText("What did your system seem to do next?")
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const copingGroup = await screen.findByRole("radiogroup", {
      name: "Protective response"
    });
    const mixedRadio = screen.getByRole("radio", {
      name: /Mixed or unclear/
    });
    const pushBackRadio = screen.getByRole("radio", { name: /Push back/ });

    expect(copingGroup).toContainElement(mixedRadio);
    expect(mixedRadio).toHaveAttribute("aria-checked", "true");
    mixedRadio.focus();
    fireEvent.keyDown(mixedRadio, { key: "ArrowRight" });
    expect(pushBackRadio).toHaveAttribute("aria-checked", "true");
    expect(pushBackRadio).toHaveFocus();

    for (const nextGroupName of [
      "Possible protected need",
      "Critical voice",
      "Supportive capacity",
      "Working hypothesis fit",
      "Next response",
      "Save decision"
    ]) {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await screen.findByRole("radiogroup", { name: nextGroupName });
    }

    const consentGroup = screen.getByRole("radiogroup", {
      name: "Save decision"
    });
    const saveRadio = screen.getByRole("radio", {
      name: /Save guided session/
    });
    const deferRadio = screen.getByRole("radio", {
      name: /Keep this unsaved/
    });

    expect(consentGroup).toContainElement(deferRadio);
    expect(saveRadio).toHaveAttribute("aria-checked", "false");
    saveRadio.focus();
    fireEvent.keyDown(saveRadio, { key: "ArrowRight" });
    expect(deferRadio).toHaveAttribute("aria-checked", "true");
    expect(deferRadio).toHaveFocus();
  });
});
