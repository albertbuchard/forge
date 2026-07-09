import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { FlagshipSignalDeck } from "@/components/experience/flagship-signal-deck";

describe("FlagshipSignalDeck", () => {
  it("shows each signal once in a bounded action list", () => {
    render(
      <MemoryRouter>
        <FlagshipSignalDeck
          eyebrow="Actions"
          title="Next actions"
          description="Open the records that need attention."
          items={[
            {
              id: "task",
              label: "Top task",
              title: "Finish the audit",
              detail: "Review the remaining evidence and close the task.",
              badge: "80 xp",
              href: "/tasks/task_audit",
              actionLabel: "Open task"
            },
            {
              id: "reward",
              label: "Next reward",
              title: "Level 18",
              detail: "276 XP remain before the next level.",
              href: "/rewards",
              actionLabel: "Open rewards"
            },
            {
              id: "activity",
              label: "Recent activity",
              title: "Workout imported",
              detail: "The latest HealthKit workout is ready to inspect."
            }
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.getAllByText("Finish the audit")).toHaveLength(1);
    expect(screen.getAllByText("Level 18")).toHaveLength(1);
    expect(screen.getAllByText("Workout imported")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Open task/i })).toHaveAttribute(
      "href",
      "/tasks/task_audit"
    );
    expect(screen.getByRole("link", { name: /Open rewards/i })).toHaveAttribute(
      "href",
      "/rewards"
    );
  });
});
