import type { ReactNode } from "react";
import {
  buildSearchWorkbenchExecution,
  buildStaticWorkbenchExecution
} from "../../../lib/workbench/runtime.js";
import type {
  WorkbenchExecutionFunction,
  WorkbenchNodeExecutionInput
} from "../../../lib/workbench/nodes.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";

type SlotProps = { children: ReactNode };
function Slot({ children }: SlotProps) {
  return <>{children}</>;
}

function defineQuestionnaireBox(
  id: string,
  title: string,
  description: string,
  tags: string[],
  execute: WorkbenchExecutionFunction,
  entityTypes: string[] = []
) {
  const tools =
    entityTypes.length > 0
      ? [
          {
            key: "forge.search_entities",
            label: "Search Forge entities",
            description: "Search questionnaire instruments and related records.",
            accessMode: "read" as const
          }
        ]
      : [];
  return defineWorkbenchBox(Slot, {
    id,
    surfaceId: "questionnaires",
    routePath: "/psyche/questionnaires",
    title,
    icon: "questionnaire",
    description,
    category: "Questionnaires",
    tags,
    inputs: [],
    params: [],
    output: [{ key: "primary", label: title, kind: "content" }],
    tools,
    NodeView: createGenericWorkbenchNodeView({
      title,
      description,
      inputs: [],
      params: [],
      output: [{ key: "primary", label: title, kind: "content" }],
      tools
    }),
    execute
  });
}

export const QuestionnairesLibraryBox = defineQuestionnaireBox(
  "surface:questionnaires:library",
  "Questionnaire library",
  "Library of questionnaire instruments available in Forge.",
  ["questionnaires", "library"],
  (input: WorkbenchNodeExecutionInput) =>
    buildSearchWorkbenchExecution(input, {
      query: "",
      entityTypes: ["questionnaire_instrument"],
      limit: 20
    }),
  ["questionnaire_instrument"]
);

export const QuestionnairesDraftingBox = defineQuestionnaireBox(
  "surface:questionnaires:drafting",
  "Questionnaire drafting",
  "Drafting and publishing context for questionnaire instruments.",
  ["questionnaires", "drafting", "authoring"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(
      input,
      {
        states: ["draft", "published", "run"]
      },
      "Questionnaire drafting surface with draft, publish, and run lifecycle context."
    )
);

export const QuestionnairesObservationBox = defineQuestionnaireBox(
  "surface:questionnaires:self-observation",
  "Self-observation calendar",
  "Calendar of self-observation notes and linked psyche context.",
  ["questionnaires", "self-observation", "psyche"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(
      input,
      {
        linkedDomains: ["patterns", "reports", "notes"]
      },
      "Self-observation calendar surface with linked psyche context."
    )
);
