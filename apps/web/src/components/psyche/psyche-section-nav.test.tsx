import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PsycheSectionNav } from "./psyche-section-nav";

describe("PsycheSectionNav", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: true,
        media: "(max-width: 1023px)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn()
      }))
    });
  });

  it("traps focus in the phone section dialog and restores it when closed", () => {
    render(
      <MemoryRouter initialEntries={["/preferences"]}>
        <PsycheSectionNav />
      </MemoryRouter>
    );

    const trigger = screen.getByRole("button", { name: /psyche section/i });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Psyche sections" });
    expect(dialog).toBeVisible();
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const close = screen.getAllByRole("button", {
      name: "Close psyche sections"
    })[1]!;
    close.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: /Sleep Psyche workspace Open/i })
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Psyche sections" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
