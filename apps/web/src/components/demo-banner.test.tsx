import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DemoBanner } from "@/components/demo-banner";

describe("public demo banner", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("labels sample data, isolation, expiry, and deliberate reset", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            demo: {
              sampleData: true,
              isolatedSession: true,
              resettable: true,
              expiresAt: "2026-08-12T14:00:00.000Z"
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

    render(<DemoBanner />);
    await screen.findByRole("complementary", {
      name: "Public demonstration notice"
    });
    expect(screen.getByText("Public demonstration · sample data only")).toBeTruthy();
    expect(screen.getByText(/cannot reach personal Forge data or external services/u)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset sample" })).toBeTruthy();
  });

  it("renders nothing outside the isolated demo gateway", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 404 }));
    const { container } = render(<DemoBanner />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
