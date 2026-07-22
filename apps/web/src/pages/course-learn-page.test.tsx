import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CourseDrawer } from "./course-learn-page";

function DrawerHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open concepts</button>
      {open ? (
        <CourseDrawer label="Concept ledger" onClose={() => setOpen(false)}>
          <button>First action</button>
          <button>Last action</button>
        </CourseDrawer>
      ) : null}
    </>
  );
}

describe("course drawer", () => {
  it("traps focus, closes with Escape, and restores the trigger", async () => {
    render(<DrawerHarness />);
    const trigger = screen.getByRole("button", { name: "Open concepts" });
    trigger.focus();
    fireEvent.click(trigger);

    const first = screen.getByRole("button", { name: "First action" });
    const last = screen.getByRole("button", { name: "Last action" });
    await waitFor(() => expect(first).toHaveFocus());
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });
});
