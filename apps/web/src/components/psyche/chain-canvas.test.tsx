import type { HTMLAttributes, ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChainCanvas } from "@/components/psyche/chain-canvas";

const { useReducedMotionMock } = vi.hoisted(() => ({
  useReducedMotionMock: vi.fn()
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      initial,
      animate,
      exit,
      transition,
      ...props
    }: HTMLAttributes<HTMLDivElement> & {
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
    }) => (
      <div
        data-initial={JSON.stringify(initial)}
        data-animate={JSON.stringify(animate)}
        data-exit={JSON.stringify(exit)}
        data-transition={JSON.stringify(transition)}
        {...props}
      />
    )
  },
  useReducedMotion: useReducedMotionMock
}));

const stages = [
  { id: "spark", label: "Spark", summary: "What happened?" },
  { id: "wave", label: "Wave", summary: "What did you feel?" }
];

beforeEach(() => {
  useReducedMotionMock.mockReturnValue(false);
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "(max-width: 1023px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn()
    }))
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ChainCanvas", () => {
  it("announces the selected stage and its controlled panel", () => {
    const onStageChange = vi.fn();
    render(
      <ChainCanvas
        stages={stages}
        activeStageId="spark"
        onStageChange={onStageChange}
        stageContent={<div>Current stage</div>}
      />
    );

    expect(screen.getByRole("button", { name: /Spark/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: /Wave/ })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByRole("button", { name: /Spark/ })).toHaveAttribute(
      "aria-controls",
      "psyche-chain-stage-panel"
    );

    fireEvent.click(screen.getByRole("button", { name: /Wave/ }));
    expect(onStageChange).toHaveBeenCalledWith("wave");
  });

  it("removes movement transitions when reduced motion is requested", () => {
    useReducedMotionMock.mockReturnValue(true);
    render(
      <ChainCanvas
        stages={stages}
        activeStageId="spark"
        onStageChange={vi.fn()}
        stageContent={<div>Current stage</div>}
        inspector={<div>Inspector content</div>}
      />
    );

    const reducedMotionSurfaces = Array.from(
      document.querySelectorAll('[data-motion-mode="reduced"]')
    );
    expect(reducedMotionSurfaces).toHaveLength(2);
    reducedMotionSurfaces.forEach((surface) => {
      expect(surface).toHaveAttribute("data-initial", "false");
      expect(surface).toHaveAttribute("data-transition", '{"duration":0}');
      expect(surface.getAttribute("data-exit")).toBeNull();
    });
  });
});
