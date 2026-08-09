import { afterEach, describe, expect, it, vi } from "vitest";
import { getComparison, listComparisonCatalog } from "./api";

function mockJsonResponse(body: unknown) {
  return {
    ok: true,
    text: vi.fn().mockResolvedValue(JSON.stringify(body))
  } as unknown as Response;
}

describe("comparison API contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves the exact catalog scope, filter, limit, and cursor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        userId: "user_1",
        query: "sleep",
        family: "health",
        items: [],
        total: 0,
        limit: 40,
        nextCursor: null,
        hasMore: false
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await listComparisonCatalog({
      userId: "user_1",
      query: " sleep ",
      family: "health",
      limit: 40,
      cursor: "opaque-cursor"
    });

    const requested = new URL(
      String(fetchMock.mock.calls[0]?.[0]),
      "http://forge.local"
    );
    expect(requested.pathname).toBe("/api/v1/comparisons/catalog");
    expect(Object.fromEntries(requested.searchParams)).toMatchObject({
      userId: "user_1",
      query: "sleep",
      family: "health",
      limit: "40",
      cursor: "opaque-cursor"
    });
  });

  it("serializes ordered selections as repeated parameters without widening user scope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        userId: "user_1",
        from: "2026-07-01",
        to: "2026-07-31",
        timeZone: "Europe/Zurich",
        alignmentRequested: "separate_tracks",
        alignmentApplied: "separate_tracks",
        sharedAxisReason: null,
        lanes: [],
        totals: {
          laneCount: 0,
          pointCount: 0,
          sourceReferenceCount: 0,
          sourceReferencesTruncated: false
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await getComparison({
      userId: "user_1",
      selections: ["preference:item_1:context_1", "health:resting_heart_rate"],
      from: "2026-07-01",
      to: "2026-07-31",
      timeZone: "Europe/Zurich",
      alignment: "separate_tracks"
    });

    const requested = new URL(
      String(fetchMock.mock.calls[0]?.[0]),
      "http://forge.local"
    );
    expect(requested.pathname).toBe("/api/v1/comparisons");
    expect(requested.searchParams.get("userId")).toBe("user_1");
    expect(requested.searchParams.getAll("selection")).toEqual([
      "preference:item_1:context_1",
      "health:resting_heart_rate"
    ]);
    expect(requested.searchParams.get("from")).toBe("2026-07-01");
    expect(requested.searchParams.get("to")).toBe("2026-07-31");
    expect(requested.searchParams.get("timeZone")).toBe("Europe/Zurich");
    expect(requested.searchParams.get("alignment")).toBe("separate_tracks");
  });
});
