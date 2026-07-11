import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserSummary } from "@/lib/types";
import { UserMultiSelectField } from "./user-multi-select-field";

const users = Array.from({ length: 6 }, (_, index) => ({
  id: `user_${index + 1}`,
  displayName: index === 5 ? "Build Agent" : `Person ${index + 1}`,
  kind: index === 5 ? "bot" : "human"
})) as UserSummary[];

describe("UserMultiSelectField", () => {
  afterEach(cleanup);

  it("makes selection, filtering, and clearing explicit", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <UserMultiSelectField value={[]} users={users} onChange={onChange} />
    );

    expect(screen.getByText("0 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Build Agent/i }));
    expect(onChange).toHaveBeenLastCalledWith(["user_6"]);

    rerender(
      <UserMultiSelectField
        value={["user_6"]}
        users={users}
        onChange={onChange}
      />
    );
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "agent" }
    });
    expect(
      screen.getByRole("checkbox", { name: /Build Agent/i })
    ).toBeChecked();
    expect(
      screen.queryByRole("checkbox", { name: /Person 1/i })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear assignees" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("keeps a bounded empty search state", () => {
    render(
      <UserMultiSelectField value={[]} users={users} onChange={vi.fn()} />
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "nobody" }
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "No people or agents match this search"
    );
  });
});
