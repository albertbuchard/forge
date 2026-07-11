import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildExperimentInput,
  buildInitialExperimentDraft,
  validateExperimentDraft,
  WeightLossExperimentDialog
} from "./weight-loss-experiment-dialog";

afterEach(cleanup);

describe("nutrition experiment draft", () => {
  it("builds the exact API contract and normalizes confounders", () => {
    const input = buildExperimentInput({
      ...buildInitialExperimentDraft(),
      title: " Carbohydrates before kickboxing ",
      hypothesis: " Better training performance ",
      metricKey: " workoutPerformance ",
      intervention: " 60 g carbohydrates before training ",
      successCriteria: " Improve by one point ",
      confounders: "sleep, training intensity\nsleep",
      baselineStart: "2026-07-01",
      baselineEnd: "2026-07-07",
      experimentStart: "2026-07-08",
      experimentEnd: "2026-07-21",
      status: "running"
    });

    expect(input).toEqual({
      title: "Carbohydrates before kickboxing",
      hypothesis: "Better training performance",
      metricKey: "workoutPerformance",
      intervention: "60 g carbohydrates before training",
      successCriteria: "Improve by one point",
      confounders: ["sleep", "training intensity"],
      baselineStart: "2026-07-01",
      baselineEnd: "2026-07-07",
      experimentStart: "2026-07-08",
      experimentEnd: "2026-07-21",
      status: "running"
    });
  });

  it("requires an interpretable hypothesis, intervention, and outcome", () => {
    expect(validateExperimentDraft(buildInitialExperimentDraft())).toMatch(
      /short title.*change you expect.*what you will change.*primary outcome/i
    );
  });

  it("rejects reversed baseline and experiment windows", () => {
    const complete = {
      ...buildInitialExperimentDraft(),
      title: "Caffeine timing",
      hypothesis: "Earlier caffeine improves sleep",
      metricKey: "sleepQuality",
      intervention: "No caffeine after noon"
    };
    expect(
      validateExperimentDraft({
        ...complete,
        baselineStart: "2026-07-08",
        baselineEnd: "2026-07-01"
      })
    ).toMatch(/baseline end date/i);
    expect(
      validateExperimentDraft({
        ...complete,
        experimentStart: "2026-07-21",
        experimentEnd: "2026-07-08"
      })
    ).toMatch(/experiment end date/i);
  });
});

describe("WeightLossExperimentDialog", () => {
  it("uses the guided three-step flow and exposes custom metrics", async () => {
    const onChange = vi.fn();
    render(
      <WeightLossExperimentDialog
        open
        onOpenChange={() => undefined}
        value={buildInitialExperimentDraft()}
        onChange={onChange}
        onSubmit={async () => undefined}
        pending={false}
      />
    );

    expect(screen.getByText("What are you trying to learn?")).toBeTruthy();
    expect(screen.getByLabelText("Experiment title")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(
      await screen.findByText("What will change, and what will show it?")
    ).toBeTruthy();
    expect(screen.getByLabelText(/Primary outcome/i)).toHaveAttribute(
      "list",
      "nutrition-experiment-metrics"
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(
      await screen.findByText("When will you compare the change?")
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /save experiment/i })
    ).toBeTruthy();
  });
});
