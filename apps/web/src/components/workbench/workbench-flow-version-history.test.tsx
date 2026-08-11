import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchFlowVersionHistory } from "@/components/workbench/workbench-flow-version-history";
import type { WorkbenchFlowVersionSummary } from "@/lib/types";

const VERSIONS: WorkbenchFlowVersionSummary[] = [
  {
    connectorId: "flow_contract",
    revision: 2,
    changeKind: "updated",
    restoredFromRevision: null,
    title: "Contract flow",
    kind: "functor",
    nodeCount: 3,
    edgeCount: 2,
    publicInputCount: 1,
    publishedOutputCount: 1,
    createdAt: "2026-08-11T10:00:00.000Z"
  },
  {
    connectorId: "flow_contract",
    revision: 1,
    changeKind: "created",
    restoredFromRevision: null,
    title: "Contract flow",
    kind: "functor",
    nodeCount: 2,
    edgeCount: 1,
    publicInputCount: 1,
    publishedOutputCount: 1,
    createdAt: "2026-08-11T09:00:00.000Z"
  }
];

afterEach(cleanup);

describe("WorkbenchFlowVersionHistory", () => {
  it("requires explicit confirmation and explains that restore creates a new revision", async () => {
    const onRestore = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkbenchFlowVersionHistory
        currentRevision={2}
        versions={VERSIONS}
        loading={false}
        unavailable={false}
        onRestore={onRestore}
      />
    );

    expect(screen.getByText("Version 2 · Current")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore version 1" }));
    expect(onRestore).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Forge will create version 3. It will not erase the current revision."
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm restore" }));
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(1));
  });

  it("keeps the confirmation visible and reports a concurrent restore conflict", async () => {
    const onRestore = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "This flow changed after it was opened. Reload the current revision."
        )
      );
    render(
      <WorkbenchFlowVersionHistory
        currentRevision={2}
        versions={VERSIONS}
        loading={false}
        unavailable={false}
        onRestore={onRestore}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Restore version 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm restore" }));

    expect(
      await screen.findByText(
        "This flow changed after it was opened. Reload the current revision."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Restore version 1?" })
    ).toBeInTheDocument();
  });
});
