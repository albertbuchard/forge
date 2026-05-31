import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InfoTooltip } from "@/components/ui/info-tooltip";

describe("InfoTooltip", () => {
  it("keeps explanatory copy hidden from assistive tech until the user asks for it", async () => {
    render(
      <InfoTooltip
        label="Explain acute load"
        title="Acute load"
        content="Acute load is the last seven days of internal training load."
      />
    );

    const button = screen.getByRole("button", { name: "Explain acute load" });
    const tooltip = screen.getByRole("tooltip", { hidden: true });

    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(tooltip).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(tooltip).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByText("Acute load")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Acute load is the last seven days of internal training load."
      )
    ).toBeInTheDocument();

    fireEvent.keyDown(button, { key: "Escape" });

    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(tooltip).toHaveAttribute("aria-hidden", "true");
  });
});
