import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHero } from "@/components/shell/page-hero";

describe("PageHero", () => {
  it("adds a clear explanation affordance when the page description is plain text", () => {
    render(
      <PageHero
        title="Training Load"
        titleText="Training Load"
        description="Forge estimates cardiovascular training stress from workouts and heart-rate evidence."
      />
    );

    const helpButton = screen.getByRole("button", {
      name: /explain what the training load page shows and how to interpret it/i
    });
    expect(helpButton).toBeInTheDocument();
    fireEvent.click(helpButton);
    expect(screen.getByText("Training Load explained")).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Forge estimates cardiovascular training stress from workouts and heart-rate evidence."
      ).length
    ).toBeGreaterThanOrEqual(1);
  });

  it("lets a page provide more specific help than the visible hero sentence", () => {
    render(
      <PageHero
        title="Vitals"
        titleText="Vitals"
        description="Stored health measurements and trend signals."
        helpContent="Use this page to compare recent measurements with baseline ranges and data coverage before acting on a trend."
      />
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /explain what the vitals page shows and how to interpret it/i
      })
    );
    expect(
      screen.getByText(
        "Use this page to compare recent measurements with baseline ranges and data coverage before acting on a trend."
      )
    ).toBeInTheDocument();
  });

  it("adopts a supplied level-one heading without nesting another heading", () => {
    const { container } = render(
      <PageHero
        title={<h1 className="font-editorial">Agent Messages</h1>}
        titleText="Agent Messages"
        description="Asynchronous messages for connected agents."
      />
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Agent Messages" })
    ).toHaveClass("font-editorial");
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1 h1")).toBeNull();
  });
});
