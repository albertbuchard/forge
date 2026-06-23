import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from "@testing-library/react";
import {
  EntityLinkMultiSelect,
  type EntityLinkOption
} from "@/components/psyche/entity-link-multiselect";

const OPTIONS: EntityLinkOption[] = Array.from({ length: 12 }, (_, index) => ({
  value: `option_${index + 1}`,
  label: `Forge option ${index + 1}`,
  description: `Description ${index + 1}`,
  searchText: `forge option ${index + 1}`
}));

describe("EntityLinkMultiSelect", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders its dropdown in a viewport layer instead of inside overflow-hidden parents", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          x: 24,
          y: 140,
          width: 320,
          height: 48,
          top: 140,
          right: 344,
          bottom: 188,
          left: 24,
          toJSON: () => ({})
        }) as DOMRect
    );

    render(
      <div data-testid="clip-shell" className="overflow-hidden rounded-[24px]">
        <EntityLinkMultiSelect
          options={OPTIONS}
          selectedValues={[]}
          onChange={() => undefined}
          placeholder="Filter by goal, project, or tag"
        />
      </div>
    );

    fireEvent.focus(
      screen.getByPlaceholderText("Filter by goal, project, or tag")
    );
    fireEvent.change(
      screen.getByPlaceholderText("Filter by goal, project, or tag"),
      {
        target: { value: "Forge" }
      }
    );

    const clipShell = screen.getByTestId("clip-shell");
    const listbox = screen.getByRole("listbox");
    expect(within(clipShell).queryByRole("listbox")).toBeNull();
    expect(listbox).toBeInTheDocument();
    expect(listbox).toHaveClass("overflow-y-auto");
    expect(listbox.style.position).toBe("fixed");
  });

  it("filters matches and selects an option from the overlay list", () => {
    function Example() {
      const [selectedValues, setSelectedValues] = useState<string[]>([]);

      return (
        <EntityLinkMultiSelect
          options={OPTIONS}
          selectedValues={selectedValues}
          onChange={setSelectedValues}
          placeholder="Search options"
        />
      );
    }

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          x: 24,
          y: 140,
          width: 320,
          height: 48,
          top: 140,
          right: 344,
          bottom: 188,
          left: 24,
          toJSON: () => ({})
        }) as DOMRect
    );

    render(<Example />);

    const input = screen.getByPlaceholderText("Search options");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "option 11" } });
    fireEvent.click(screen.getByRole("option", { name: /forge option 11/i }));

    expect(screen.getByText("Forge option 11")).toBeInTheDocument();
  });
});
