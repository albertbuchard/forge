import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOTE_LINK_ENTITY_TYPES,
  parseNoteLinkSearchResults,
  resolveSelectedNoteLinkOptions,
  searchNoteLinkOptions
} from "./note-link-options";

const searchEntitiesMock = vi.hoisted(() => vi.fn());

vi.mock("./api", () => ({
  searchEntities: searchEntitiesMock
}));

describe("note link options", () => {
  beforeEach(() => {
    searchEntitiesMock.mockReset();
  });

  it("searches the complete canonical entity catalog through one bounded batch operation", async () => {
    searchEntitiesMock.mockResolvedValue({
      results: [
        {
          ok: true,
          matches: [
            {
              entityType: "artifact",
              id: "artifact_1",
              entity: {
                title: "Travel tickets",
                shortDescription: "Flight documents"
              }
            },
            {
              entityType: "person",
              id: "person_1",
              entity: { displayName: "Ada Lovelace" }
            },
            { entityType: "artifact", id: 7, entity: {} },
            null
          ]
        }
      ]
    });

    const options = await searchNoteLinkOptions("travel", ["user_1"]);

    expect(searchEntitiesMock).toHaveBeenCalledWith({
      searches: [
        expect.objectContaining({
          entityTypes: [...NOTE_LINK_ENTITY_TYPES],
          query: "travel",
          userIds: ["user_1"],
          limit: 40,
          clientRef: "note-links"
        })
      ]
    });
    expect(options).toEqual([
      expect.objectContaining({
        value: "artifact:artifact_1",
        label: "Travel tickets",
        description: "Flight documents"
      }),
      expect.objectContaining({
        value: "person:person_1",
        label: "Ada Lovelace"
      })
    ]);
  });

  it("hydrates selected links by exact type and id without an unbounded query", async () => {
    searchEntitiesMock.mockResolvedValue({
      results: [
        {
          ok: true,
          matches: [
            {
              entityType: "calendar_event",
              id: "event_1",
              entity: { title: "Flight to Paris" }
            }
          ]
        }
      ]
    });

    const options = await resolveSelectedNoteLinkOptions(
      ["calendar_event:event_1", "invalid", "calendar_event:event_1"],
      ["user_1"]
    );

    expect(searchEntitiesMock).toHaveBeenCalledWith({
      searches: [
        expect.objectContaining({
          entityTypes: ["calendar_event"],
          ids: ["event_1"],
          limit: 1,
          userIds: ["user_1"]
        })
      ]
    });
    expect(options[0]?.label).toBe("Flight to Paris");
  });

  it("fails clearly on an operation error and ignores malformed matches", () => {
    expect(parseNoteLinkSearchResults(null)).toEqual([]);
    expect(
      parseNoteLinkSearchResults([
        null,
        {
          ok: true,
          matches: [
            { entityType: "not_real", id: "x", entity: { title: "No" } },
            { entityType: "goal", id: "", entity: { title: "No" } }
          ]
        }
      ])
    ).toEqual([]);
    expect(() =>
      parseNoteLinkSearchResults([
        { ok: false, error: { message: "Search access denied" } }
      ])
    ).toThrow("Search access denied");
  });
});
