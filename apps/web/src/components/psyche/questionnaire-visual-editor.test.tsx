import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  QuestionnaireDefinitionEditor,
  QuestionnaireProvenanceEditor,
  QuestionnaireScoringEditor
} from "@/components/psyche/questionnaire-visual-editor";
import type {
  QuestionnaireDefinition,
  QuestionnaireItem,
  QuestionnaireProvenance,
  QuestionnaireScoring
} from "@/lib/questionnaire-types";

afterEach(cleanup);

function makeItem(id: string, prompt = `Question ${id}`): QuestionnaireItem {
  return {
    id,
    prompt,
    shortLabel: "",
    description: "",
    helperText: "",
    required: true,
    visibility: null,
    tags: [],
    options: [
      { key: "0", label: "No", value: 0, description: "" },
      { key: "1", label: "Yes", value: 1, description: "" }
    ]
  };
}

function makeDefinition(
  sections: number,
  questionsPerSection: number
): QuestionnaireDefinition {
  const items = Array.from(
    { length: sections * questionsPerSection },
    (_, index) => makeItem(`item_${index + 1}`, `Prompt ${index + 1}`)
  );
  return {
    locale: "en",
    instructions: "Answer from your own experience.",
    completionNote: "Thank you.",
    presentationMode: "single_question",
    responseStyle: "binary",
    itemIds: items.map((item) => item.id),
    items,
    sections: Array.from({ length: sections }, (_, sectionIndex) => ({
      id: `section_${sectionIndex + 1}`,
      title: `Section ${sectionIndex + 1}`,
      description: "",
      visibility: null,
      itemIds: items
        .slice(
          sectionIndex * questionsPerSection,
          (sectionIndex + 1) * questionsPerSection
        )
        .map((item) => item.id)
    })),
    pageSize: null
  };
}

function DefinitionHarness({ initial }: { initial: QuestionnaireDefinition }) {
  const [definition, setDefinition] = useState(initial);
  return (
    <>
      <QuestionnaireDefinitionEditor
        definition={definition}
        onChange={setDefinition}
      />
      <output data-testid="definition-state">
        {JSON.stringify(definition)}
      </output>
    </>
  );
}

function ScoringHarness() {
  const [scoring, setScoring] = useState<QuestionnaireScoring>({
    scores: [
      {
        key: "total",
        label: "Total",
        description: "Original details",
        valueType: "number",
        expression: { kind: "sum", itemIds: ["item_1"] },
        dependsOnItemIds: ["item_1"],
        missingPolicy: { mode: "require_all" },
        bands: [{ label: "Elevated", min: 2, max: null, severity: "warning" }],
        roundTo: null,
        unitLabel: "points"
      }
    ]
  });
  return (
    <>
      <QuestionnaireScoringEditor
        scoring={scoring}
        itemIds={["item_1", "item_2", "item_3"]}
        onChange={setScoring}
      />
      <output data-testid="scoring-state">{JSON.stringify(scoring)}</output>
    </>
  );
}

function ProvenanceHarness() {
  const [provenance, setProvenance] = useState<QuestionnaireProvenance>({
    retrievalDate: "2026-08-11",
    sourceClass: "open_access",
    scoringNotes: "Published scoring guidance.",
    sources: [
      {
        label: "Original paper",
        url: "https://example.com/original",
        citation: "Example et al. (2026)",
        notes: "Primary definition"
      }
    ]
  });
  return (
    <>
      <QuestionnaireProvenanceEditor
        provenance={provenance}
        onChange={setProvenance}
      />
      <output data-testid="provenance-state">
        {JSON.stringify(provenance)}
      </output>
    </>
  );
}

describe("questionnaire visual editors", () => {
  it("keeps long instruments bounded to one active section", () => {
    render(<DefinitionHarness initial={makeDefinition(3, 20)} />);

    expect(screen.getByText(/3 sections · 60 questions/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Prompt 1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Prompt 20")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Prompt 21")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /2\. Section 2 · 20/ }));

    expect(screen.queryByDisplayValue("Prompt 1")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Prompt 21")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Prompt 40")).toBeInTheDocument();
  });

  it("adds stable section and question ids without discarding advanced fields", () => {
    const initial = makeDefinition(1, 1);
    initial.items[0]!.visibility = { script: "answer('item_0') > 0" };
    initial.items[0]!.options[0]!.description = "Preserve this option note";
    render(<DefinitionHarness initial={initial} />);

    fireEvent.click(screen.getByRole("button", { name: "Add section" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Add question to Section 2" })
    );
    fireEvent.change(screen.getByDisplayValue("New question"), {
      target: { value: "A newly authored question" }
    });

    const state = JSON.parse(
      screen.getByTestId("definition-state").textContent ?? "{}"
    ) as QuestionnaireDefinition;
    expect(state.itemIds).toEqual(["item_1", "item_2"]);
    expect(state.sections[1]).toMatchObject({
      id: "section_2",
      itemIds: ["item_2"]
    });
    expect(state.items[1]?.prompt).toBe("A newly authored question");
    expect(state.items[1]?.options).toEqual(initial.items[0]?.options);
    expect(state.items[1]?.options).not.toBe(initial.items[0]?.options);
    expect(state.items[0]?.visibility).toEqual({
      script: "answer('item_0') > 0"
    });
    expect(state.items[0]?.options[0]?.description).toBe(
      "Preserve this option note"
    );
  });

  it("supports common scoring changes while preserving interpretation bands", () => {
    render(<ScoringHarness />);

    fireEvent.change(screen.getByLabelText("Score label total"), {
      target: { value: "Overall score" }
    });
    fireEvent.change(screen.getByLabelText("Missing answers total"), {
      target: { value: "min_answered" }
    });
    fireEvent.change(screen.getByLabelText("Minimum answered total"), {
      target: { value: "2" }
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Include all 3 questions in total"
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Add total score" }));

    const state = JSON.parse(
      screen.getByTestId("scoring-state").textContent ?? "{}"
    ) as QuestionnaireScoring;
    expect(state.scores[0]).toMatchObject({
      key: "total",
      label: "Overall score",
      expression: {
        kind: "sum",
        itemIds: ["item_1", "item_2", "item_3"]
      },
      dependsOnItemIds: ["item_1", "item_2", "item_3"],
      missingPolicy: { mode: "min_answered", minAnswered: 2 },
      bands: [{ label: "Elevated", min: 2, max: null, severity: "warning" }]
    });
    expect(state.scores[1]).toMatchObject({
      key: "score_1",
      expression: {
        kind: "sum",
        itemIds: ["item_1", "item_2", "item_3"]
      }
    });
  });

  it("edits provenance and appends another explicit source", () => {
    render(<ProvenanceHarness />);

    fireEvent.change(screen.getByLabelText("Scoring provenance notes"), {
      target: { value: "Use the published scoring appendix." }
    });
    fireEvent.change(screen.getByLabelText("Source URL 1"), {
      target: { value: "https://example.com/revised" }
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Add provenance source" })
    );

    const state = JSON.parse(
      screen.getByTestId("provenance-state").textContent ?? "{}"
    ) as QuestionnaireProvenance;
    expect(state.scoringNotes).toBe("Use the published scoring appendix.");
    expect(state.sources).toHaveLength(2);
    expect(state.sources[0]?.url).toBe("https://example.com/revised");
    expect(state.sources[1]).toEqual({
      label: "New source",
      url: "",
      citation: "",
      notes: ""
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove source 2" }));
    const reducedState = JSON.parse(
      screen.getByTestId("provenance-state").textContent ?? "{}"
    ) as QuestionnaireProvenance;
    expect(reducedState.sources).toHaveLength(1);
    expect(reducedState.sources[0]?.url).toBe("https://example.com/revised");
  });
});
