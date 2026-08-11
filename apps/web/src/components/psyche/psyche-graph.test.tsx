import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { PsycheGraphCanvas } from "@/components/psyche/psyche-graph";

afterEach(cleanup);

describe("PsycheGraphCanvas", () => {
  it("publishes every visual edge as a named direct or indirect relationship", () => {
    render(
      <MemoryRouter>
        <PsycheGraphCanvas
          title="Relationship test"
          nodes={[
            { id: "goal", kind: "goal", x: 0, y: 0, label: "Steady work" },
            {
              id: "habit",
              kind: "habit",
              x: 100,
              y: 100,
              label: "Evening walk"
            }
          ]}
          edges={[
            {
              id: "goal-to-habit",
              from: "goal",
              to: "habit",
              label: "Habit and goal share a linked value",
              dashed: true
            }
          ]}
          selectedNodeId="goal"
        />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("list", { name: "Graph relationships" })
    ).toHaveTextContent(
      "Steady work to Evening walk: Habit and goal share a linked value. Indirect association."
    );
    expect(
      screen.getByRole("button", { name: /Goal Steady work/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Habit Evening walk/i })
    ).toBeInTheDocument();
  });
});
