import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { MobileSyncAttentionSourceReturn } from "@/components/attention/attention-source-return";

const sourceRoot = path.join(process.cwd(), "apps/web/src/pages");

function readPage(name: string) {
  return readFileSync(path.join(sourceRoot, name), "utf8");
}

afterEach(cleanup);

describe("Attention resolution source-page contract", () => {
  it("focuses every supported source with the server's stable sourceRef", () => {
    const agents = readPage("settings-agents-page.tsx");
    const insights = readPage("insights-page.tsx");
    const mobile = readPage("settings-mobile-page.tsx");
    const task = readPage("task-detail-page.tsx");

    expect(agents).toContain("sourceRef={`approval_request:${approval.id}`}");
    expect(agents).toContain(
      "sourceRef={`agent_runtime_session:${session.id}`}"
    );
    expect(insights).toContain("sourceRef={`insight:${insight.id}`}");
    expect(mobile).toContain("<MobileSyncAttentionSourceReturn />");
    expect(task).toContain("sourceRef={`task:${payload.task.id}`}");
  });

  it("renders the exact mobile sync session independently of import-run identifiers", () => {
    render(
      createElement(
        MemoryRouter,
        {
          initialEntries: [
            "/settings/mobile?attentionSource=health_mobile_sync_session%3Ahms_failed_1&attentionReturn=%2Fattention%3Ffocus%3Dattn%253Acompanion_sync%253Ahms_failed_1"
          ]
        },
        createElement(
          "div",
          { "data-testid": "unrelated-import-run" },
          "hir_import_99"
        ),
        createElement(MobileSyncAttentionSourceReturn)
      )
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("companion sync session hms_failed_1");
    expect(status.closest("[data-attention-source]")).toHaveAttribute(
      "data-attention-source",
      "health_mobile_sync_session:hms_failed_1"
    );
    expect(status).not.toHaveTextContent("hir_import_99");
    expect(
      screen.getByRole("link", { name: "Return to Attention" })
    ).toHaveAttribute(
      "href",
      "/attention?focus=attn%3Acompanion_sync%3Ahms_failed_1"
    );
  });

  it("does not render an invalid mobile sync source reference", () => {
    render(
      createElement(
        MemoryRouter,
        {
          initialEntries: [
            "/settings/mobile?attentionSource=health_mobile_sync_session%3A..%2Fother"
          ]
        },
        createElement(MobileSyncAttentionSourceReturn)
      )
    );

    expect(screen.queryByRole("status")).toBeNull();
  });
});
