import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  FacetedTokenSearch,
  type FacetedTokenOption
} from "@/components/search/faceted-token-search";

const options: FacetedTokenOption[] = [
  {
    id: "type:cycling",
    label: "Cycling",
    description: "Cardio"
  },
  {
    id: "type:kickboxing",
    label: "Kickboxing",
    description: "Combat sport"
  }
];

function ControlledSearch() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <div data-testid="search-boundary" className="overflow-visible">
      <FacetedTokenSearch
        title="Exercise types"
        description="Choose one or more exercise types."
        query={query}
        onQueryChange={setQuery}
        options={options}
        selectedOptionIds={selected}
        onSelectedOptionIdsChange={setSelected}
        resultSummary={`${selected.length} selected`}
        placeholder="Search exercise types"
      />
    </div>
  );
}

describe("FacetedTokenSearch", () => {
  afterEach(cleanup);

  it("exposes an unclipped, accessible option list and selects an option", () => {
    render(<ControlledSearch />);

    const input = screen.getByRole("combobox", {
      name: "Search exercise types"
    });
    fireEvent.focus(input);

    expect(input).toHaveAttribute("aria-expanded", "true");
    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeInTheDocument();
    expect(listbox.parentElement).toBe(document.body);
    expect(listbox).toHaveStyle({ position: "fixed" });
    expect(
      screen.getByRole("option", { name: /cycling/i })
    ).toBeInTheDocument();
    expect(screen.getByText("Exercise types").closest(".relative")).toHaveClass(
      "z-50"
    );
    expect(screen.getByTestId("search-boundary")).toHaveClass(
      "overflow-visible"
    );

    fireEvent.click(screen.getByRole("option", { name: /cycling/i }));

    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByRole("button", { name: "Remove Cycling" })
    ).toBeInTheDocument();
  });

  it("supports keyboard navigation without submitting free text", () => {
    render(<ControlledSearch />);

    const input = screen.getByRole("combobox", {
      name: "Search exercise types"
    });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(
      screen.getByRole("button", { name: "Remove Kickboxing" })
    ).toBeInTheDocument();
  });
});
