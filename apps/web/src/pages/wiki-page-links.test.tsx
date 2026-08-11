import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  WikiArticleMarkdown,
  type WikiArticleLinkState
} from "@/components/wiki/wiki-article-markdown";

describe("wiki page relationship links", () => {
  afterEach(cleanup);

  it("renders canonical, unavailable, citation, related-page, and entity links accessibly", () => {
    const linkStates: WikiArticleLinkState[] = [
      {
        rawTarget: "Target title",
        label: "Canonical page",
        isEmbed: false,
        status: "available",
        targetPage: {
          id: "note_target",
          slug: "canonical-target",
          spaceId: "wiki_space_shared"
        },
        isSelfLink: false
      },
      {
        rawTarget: "Missing page",
        label: "Broken page",
        isEmbed: false,
        status: "missing",
        targetPage: null,
        isSelfLink: false
      },
      {
        rawTarget: "Expired page",
        label: "Expired page",
        isEmbed: false,
        status: "unavailable",
        targetPage: null,
        isSelfLink: false
      },
      {
        rawTarget: "forge:task:task_plugin_surface",
        label: "Plugin task",
        isEmbed: false,
        status: "unverified",
        targetPage: null,
        isSelfLink: false
      }
    ];

    render(
      <MemoryRouter>
        <WikiArticleMarkdown
          spaceId="wiki_space_shared"
          linkStates={linkStates}
          markdown={[
            "# Link map",
            "",
            "[[Target title|Canonical page]]",
            "[[Missing page|Broken page]]",
            "[[Expired page]]",
            "[[forge:task:task_plugin_surface|Plugin task]]",
            "[[forge:artifact:artifact_123|Artifact detail]]",
            "![[forge:artifact:artifact_123|Download evidence]]",
            "",
            ":::forge-links",
            "[Primary source](https://example.test/source)",
            ":::",
            "",
            ":::forge-related",
            "[[Target title|Canonical page]]",
            ":::"
          ].join("\n")}
        />
      </MemoryRouter>
    );

    const canonicalLinks = screen.getAllByRole("link", {
      name: "Canonical page"
    });
    expect(canonicalLinks).toHaveLength(2);
    expect(canonicalLinks[0]).toHaveAttribute(
      "href",
      "/wiki/page/canonical-target?spaceId=wiki_space_shared"
    );
    canonicalLinks[0]!.focus();
    expect(canonicalLinks[0]).toHaveFocus();

    expect(screen.queryByRole("link", { name: "Broken page" })).toBeNull();
    expect(
      screen.getByText("Broken page", { selector: "span" })
    ).toHaveAttribute("data-wiki-link-status", "unavailable");
    expect(screen.queryByRole("link", { name: "Expired page" })).toBeNull();
    expect(screen.getByText("Expired page", { selector: "span" })).toHaveClass(
      "break-words"
    );

    expect(screen.getByRole("link", { name: "Plugin task" })).toHaveAttribute(
      "data-wiki-link-status",
      "unverified"
    );
    expect(
      screen.getByRole("link", { name: "Artifact detail" })
    ).toHaveAttribute("href", "/artifacts/artifact_123");
    expect(
      screen.getByRole("link", { name: "Download evidence" })
    ).toHaveAttribute(
      "href",
      "/artifacts/artifact_123#artifact-human-download"
    );
    expect(
      screen.getByRole("link", {
        name: "Primary source (opens in a new tab)"
      })
    ).toHaveAttribute("target", "_blank");
    expect(
      screen.getByRole("region", { name: "Citations and links" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Related pages" })
    ).toBeInTheDocument();
  });

  it("keeps unsupported link schemes and entity routes non-interactive", () => {
    render(
      <MemoryRouter>
        <WikiArticleMarkdown
          markdown={[
            "[Unsafe](javascript:alert(1))",
            "[[forge:habit:habit_missing|Unknown habit]]"
          ].join("\n")}
        />
      </MemoryRouter>
    );

    expect(screen.queryByRole("link", { name: "Unsafe" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Unknown habit" })).toBeNull();
    expect(screen.getByText("Unsafe", { selector: "span" })).toHaveAttribute(
      "title",
      "Unsupported link target"
    );
    expect(
      screen.getByText("Unknown habit", { selector: "span" })
    ).toHaveAttribute("title", "Forge entity route unavailable");
  });
});
