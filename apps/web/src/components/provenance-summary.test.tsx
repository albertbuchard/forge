import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { ProvenanceSummary } from "./provenance-summary";
import type { DerivedDataProvenance } from "@/lib/types";

const provenance: DerivedDataProvenance = {
  generatedAt: "2026-08-09T12:00:00.000Z",
  observedAt: "2026-08-09T11:58:00.000Z",
  freshness: "fresh",
  completeness: "partial",
  staleAfterSeconds: 600,
  sourceSummary: "recorded stays and trips",
  statusDetail: "Partial evidence: one gap is visible in the day.",
  confidence: {
    level: "medium",
    reason: "Recorded evidence remains separate from repaired spans."
  },
  sources: [
    {
      id: "stays",
      label: "Recorded stays",
      kind: "record",
      observedAt: "2026-08-09T11:58:00.000Z",
      detailRoute: "/api/v1/movement/day"
    },
    {
      id: "trips",
      label: "Recorded trips",
      kind: "record",
      observedAt: "2026-08-09T11:57:00.000Z",
      detailRoute: "/api/v1/movement/day"
    }
  ],
  evidence: []
};

afterEach(cleanup);

describe("ProvenanceSummary", () => {
  it("answers source, freshness, and completeness before disclosure", () => {
    render(
      <MemoryRouter>
        <ProvenanceSummary provenance={provenance} />
      </MemoryRouter>
    );

    expect(
      screen.getByText(/from recorded stays and trips/i)
    ).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Partial")).toBeInTheDocument();
  });

  it("reveals the reliability reason and links to the existing detail route", async () => {
    render(
      <MemoryRouter>
        <ProvenanceSummary
          provenance={provenance}
          href="/movement"
          actionLabel="Open Movement"
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText(/from recorded stays and trips/i));
    expect(screen.getByText(/one gap is visible/i)).toBeVisible();
    expect(screen.getByText(/^Computed /i)).toBeVisible();
    expect(screen.getByText("Recorded stays")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open Movement" })).toHaveAttribute(
      "href",
      "/movement"
    );
  });
});
