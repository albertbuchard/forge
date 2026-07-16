import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { EmotionRowsEditor } from "@/components/psyche/report-chain-fields";
import type { EmotionDefinition, TriggerEmotion } from "@/lib/psyche-types";

const definitions: EmotionDefinition[] = [
  {
    id: "emotion_fear",
    domainId: "psyche",
    label: "Fear",
    description: "",
    category: "",
    system: true,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z"
  },
  {
    id: "emotion_dread",
    domainId: "psyche",
    label: "Dread",
    description: "",
    category: "",
    system: true,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z"
  }
];

afterEach(cleanup);

function Harness({ label }: { label: string }) {
  const [items, setItems] = useState<TriggerEmotion[]>([
    {
      id: "report_emotion",
      emotionDefinitionId: "emotion_fear",
      label,
      intensity: 55,
      note: ""
    }
  ]);
  return (
    <EmotionRowsEditor
      items={items}
      onChange={setItems}
      definitions={definitions}
    />
  );
}

describe("EmotionRowsEditor", () => {
  it("preserves the user's own emotion wording when the preset changes", () => {
    render(<Harness label="A cold sense of danger" />);

    fireEvent.change(screen.getByLabelText("Emotion"), {
      target: { value: "emotion_dread" }
    });

    expect(
      screen.getByLabelText(
        "If the preset is not right, how would you name it?"
      )
    ).toHaveValue("A cold sense of danger");
  });

  it("uses the preset label when no personal wording has been entered", () => {
    render(<Harness label="" />);

    fireEvent.change(screen.getByLabelText("Emotion"), {
      target: { value: "emotion_dread" }
    });

    expect(
      screen.getByLabelText(
        "If the preset is not right, how would you name it?"
      )
    ).toHaveValue("Dread");
  });
});
