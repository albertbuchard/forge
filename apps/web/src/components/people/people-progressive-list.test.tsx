import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PeopleProgressiveList } from "@/components/people/people-progressive-list";

afterEach(cleanup);

describe("PeopleProgressiveList", () => {
  it("keeps large sections bounded, semantic, and resettable", () => {
    const items = Array.from({ length: 45 }, (_, index) => ({
      id: `item_${index + 1}`,
      label: `Record ${index + 1}`
    }));
    const view = render(
      <PeopleProgressiveList
        items={items}
        getKey={(item) => item.id}
        resetKey="person_one"
        label="records"
        className="grid gap-2"
        renderItem={(item) => <li>{item.label}</li>}
      />
    );

    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(20);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Showing 20 of 45 records"
    );
    const showMore = screen.getByRole("button", { name: "Show 20 more" });
    expect(showMore).toHaveClass("min-h-11");

    fireEvent.click(showMore);
    expect(screen.getAllByRole("listitem")).toHaveLength(40);
    fireEvent.click(screen.getByRole("button", { name: "Show 5 more" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(45);
    expect(screen.queryByRole("button", { name: /Show \d+ more/ })).toBeNull();

    view.rerender(
      <PeopleProgressiveList
        items={items}
        getKey={(item) => item.id}
        resetKey="person_two"
        label="records"
        ordered
        renderItem={(item) => <li>{item.label}</li>}
      />
    );
    expect(screen.getByRole("list").tagName).toBe("OL");
    expect(screen.getAllByRole("listitem")).toHaveLength(20);
  });
});
