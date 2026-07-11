import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserSummary } from "@/lib/types";
import { sameUserScope, UserScopeSelector } from "./user-scope-selector";

const human = {
  id: "user_human",
  kind: "human",
  handle: "albert",
  displayName: "Albert",
  description: "",
  accentColor: "#c8a46b",
  createdAt: "2026-07-11T08:00:00.000Z",
  updatedAt: "2026-07-11T08:00:00.000Z"
} satisfies UserSummary;

const bot = {
  ...human,
  id: "user_bot",
  kind: "bot",
  handle: "codex",
  displayName: "Codex"
} satisfies UserSummary;

describe("shell UserScopeSelector", () => {
  afterEach(cleanup);

  it("compares custom scopes without depending on selection order", () => {
    expect(sameUserScope([human.id, bot.id], [bot.id, human.id])).toBe(true);
  });

  it("names the active scope and exposes selected options", async () => {
    const onChange = vi.fn();
    render(
      <UserScopeSelector
        users={[human, bot]}
        selectedUserIds={[bot.id]}
        onChange={onChange}
      />
    );

    const trigger = screen.getByRole("button", { name: "User scope: Codex" });
    expect(trigger).toHaveClass("min-h-11");
    fireEvent.click(trigger);

    expect(
      await screen.findByRole("group", { name: "Available user scopes" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Codex/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(
      screen.queryByRole("button", { name: /^Bots/ })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Albert/ }));
    expect(onChange).toHaveBeenCalledWith([human.id]);
  });
});
