import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import { ProjectDialog } from "./project-dialog";

function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "(max-width: 1023px)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
}

describe("ProjectDialog", () => {
  beforeEach(() => {
    installMatchMedia();
    window.localStorage.clear();
  });
  afterEach(cleanup);

  it("explains the required goal anchor when no goals are available", () => {
    render(
      <I18nProvider locale="en">
        <ProjectDialog
          open
          goals={[]}
          editingProject={null}
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
        />
      </I18nProvider>
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Create an active goal before adding a project"
    );
  });
});
