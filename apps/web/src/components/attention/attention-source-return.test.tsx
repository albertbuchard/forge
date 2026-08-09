import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  AttentionSourceReturn,
  safeAttentionReturnHref
} from "@/components/attention/attention-source-return";

afterEach(cleanup);

describe("AttentionSourceReturn", () => {
  it("focuses the exact source and preserves a bounded Attention return URL", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/insights?attentionSource=insight%3Ains_1&attentionReturn=%2Fattention%3Fstate%3Dactive%26offset%3D25%26focus%3Dattn%253Ainsight%253Ains_1"
        ]}
      >
        <AttentionSourceReturn sourceRef="insight:ins_1" />
      </MemoryRouter>
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Opened from Attention");
    const container = status.closest("[data-attention-source]");
    expect(container).toHaveFocus();
    expect(container).toHaveAttribute(
      "data-attention-source",
      "insight:ins_1"
    );
    expect(
      screen.getByRole("link", { name: "Return to Attention" })
    ).toHaveAttribute(
      "href",
      "/attention?state=active&offset=25&focus=attn%3Ainsight%3Ains_1"
    );
    expect(
      screen.getByRole("link", { name: "Return to Attention" })
    ).toHaveClass("min-h-11");
  });

  it("does not render for a different source", () => {
    render(
      <MemoryRouter
        initialEntries={["/insights?attentionSource=insight%3Aother"]}
      >
        <AttentionSourceReturn sourceRef="insight:ins_1" />
      </MemoryRouter>
    );

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("rejects external, credentialed, malformed, and unrelated return URLs", () => {
    expect(safeAttentionReturnHref("https://example.com/attention")).toBe(
      "/attention"
    );
    expect(safeAttentionReturnHref("//example.com/attention")).toBe(
      "/attention"
    );
    expect(safeAttentionReturnHref("/tasks/task_1")).toBe("/attention");
    expect(
      safeAttentionReturnHref("http://user:pass@forge.local/attention")
    ).toBe("/attention");
    expect(safeAttentionReturnHref("%not-a-url")).toBe("/attention");
  });
});
