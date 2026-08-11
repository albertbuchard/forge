import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NoteMarkdown, NoteMarkdownDisclosure } from "./note-markdown";

describe("NoteMarkdown", () => {
  afterEach(cleanup);

  it("renders semantic Markdown structure and safe links", () => {
    render(
      <NoteMarkdown
        markdown={[
          "# Durable heading",
          "",
          "Read [Forge](https://example.com/forge) and [local](/forge/notes).",
          "",
          "- First item",
          "- Second item",
          "",
          "> Preserved context"
        ].join("\n")}
      />
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Durable heading" })
    ).toBeInTheDocument();
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByText("Preserved context")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Forge" })).toHaveAttribute(
      "rel",
      "noopener noreferrer"
    );
    expect(screen.getByRole("link", { name: "local" })).toHaveAttribute(
      "href",
      "/forge/notes"
    );
  });

  it("does not create executable links or inject raw HTML", () => {
    const { container } = render(
      <NoteMarkdown
        markdown={
          '[unsafe](javascript:alert(1))\n\n<img src=x onerror="alert(2)">'
        }
      />
    );

    expect(screen.queryByRole("link", { name: "unsafe" })).toBeNull();
    expect(screen.getByText("unsafe")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x");
  });

  it("classifies relative, mail, protocol-relative, and external links safely", () => {
    render(
      <NoteMarkdown
        markdown={[
          "[relative](notes/next)",
          "[hash](#section)",
          "[query](?focus=note_1)",
          "[mail](mailto:person@example.com)",
          "[protocol relative](//example.com/note)",
          "[external](https://example.org/note)",
          "[data](data:text/html,unsafe)"
        ].join(" ")}
      />
    );

    for (const name of ["relative", "hash", "query", "mail"]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute("target");
    }
    for (const name of ["protocol relative", "external"]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute(
        "target",
        "_blank"
      );
      expect(screen.getByRole("link", { name })).toHaveAttribute(
        "rel",
        "noopener noreferrer"
      );
    }
    expect(screen.queryByRole("link", { name: "data" })).toBeNull();
  });

  it("links Forge note references back to the focused Notes view", () => {
    render(
      <NoteMarkdown markdown="See [[forge:note:note_123|the source note]]." />
    );

    expect(
      screen.getByRole("link", { name: /the source note/i })
    ).toHaveAttribute("href", expect.stringContaining("/notes?focus=note_123"));
  });

  it("anchors embedded artifacts at their human-only download action", () => {
    render(
      <NoteMarkdown
        markdown={[
          "[[forge:artifact:artifact_123|Artifact detail]]",
          "![[forge:artifact:artifact_123|Download evidence]]"
        ].join(" ")}
      />
    );

    expect(
      screen.getByRole("link", { name: /Artifact detail/i })
    ).toHaveAttribute("href", "/artifacts/artifact_123");
    expect(
      screen.getByRole("link", { name: /Download evidence/i })
    ).toHaveAttribute(
      "href",
      "/artifacts/artifact_123#artifact-human-download"
    );
  });

  it("keeps long note bodies unmounted until the reader expands them", () => {
    const markdown = `Visible opening ${"context ".repeat(90)}private-tail-marker`;
    render(
      <NoteMarkdownDisclosure
        markdown={markdown}
        plainText={markdown}
        title="Long research note"
      />
    );

    expect(screen.queryByText(/private-tail-marker/)).toBeNull();
    const disclosure = screen.getByRole("button", {
      name: "Show full note: Long research note"
    });
    expect(disclosure).toHaveTextContent("Show full note");
    expect(disclosure).not.toHaveTextContent("Long research note");
    expect(disclosure).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(disclosure);
    expect(screen.getByText(/private-tail-marker/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show less of Long research note" })
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps short notes directly readable without a disclosure control", () => {
    render(
      <NoteMarkdownDisclosure
        markdown="Short and directly readable."
        title="Short note"
      />
    );

    expect(
      screen.getByText("Short and directly readable.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /full note/i })).toBeNull();
  });
});
