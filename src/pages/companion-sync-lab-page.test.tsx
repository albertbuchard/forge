import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CompanionSyncLabPage } from "@/pages/companion-sync-lab-page";

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    title,
    description,
    badge
  }: {
    title: string;
    description: string;
    badge?: string;
  }) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
      {badge ? <span>{badge}</span> : null}
    </div>
  )
}));

describe("CompanionSyncLabPage", () => {
  it("renders deterministic source-state and gap-classifier fixtures", () => {
    render(<CompanionSyncLabPage />);

    expect(screen.getByRole("heading", { name: "Companion Sync Lab" })).toBeInTheDocument();
    expect(screen.getByText("Health ready")).toBeInTheDocument();
    expect(screen.getByText("Movement pending on phone")).toBeInTheDocument();
    expect(screen.getAllByText("Suppressed short jump").length).toBeGreaterThan(0);
    expect(screen.getByText("Repaired move")).toBeInTheDocument();
    expect(screen.getByText("Long missing gap")).toBeInTheDocument();
    expect(screen.getByText("Exact overnight stay-gap-move bug")).toBeInTheDocument();
    expect(screen.getAllByText("Coverage locked").length).toBeGreaterThan(0);
  });
});
