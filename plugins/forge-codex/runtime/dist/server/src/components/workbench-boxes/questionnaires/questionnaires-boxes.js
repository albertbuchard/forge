import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { buildSearchWorkbenchExecution, buildStaticWorkbenchExecution } from "../../../lib/workbench/runtime.js";
import { createSearchEntitiesTool, createSearchInputs, createSearchOutputs, createSearchParams, createSummaryOutput } from "../../../lib/workbench/contracts.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";
function Slot({ children }) {
    return _jsx(_Fragment, { children: children });
}
function defineQuestionnaireBox(id, title, description, tags, execute, output, tools = [], options) {
    const inputs = options?.inputs ?? [];
    const params = options?.params ?? [];
    return defineWorkbenchBox(Slot, {
        id,
        surfaceId: "questionnaires",
        routePath: "/psyche/questionnaires",
        title,
        icon: "questionnaire",
        description,
        category: "Questionnaires",
        tags,
        inputs,
        params,
        output,
        tools,
        NodeView: createGenericWorkbenchNodeView({
            title,
            description,
            inputs,
            params,
            output,
            tools
        }),
        execute
    });
}
export const QuestionnairesLibraryBox = defineQuestionnaireBox("surface:questionnaires:library", "Questionnaire library", "Library of questionnaire instruments available in Forge.", ["questionnaires", "library"], (input) => buildSearchWorkbenchExecution(input, {
    query: "",
    entityTypes: ["questionnaire_instrument"],
    limit: 20
}), createSearchOutputs({
    itemKind: "questionnaire_instrument",
    itemLabel: "Questionnaire"
}), [createSearchEntitiesTool("Search questionnaire instruments and related records.")], {
    inputs: createSearchInputs({
        itemKind: "questionnaire_instrument",
        itemLabel: "Questionnaire",
        defaultEntityTypes: ["questionnaire_instrument"],
        defaultLimit: 20
    }),
    params: createSearchParams({
        itemKind: "questionnaire_instrument",
        defaultEntityTypes: ["questionnaire_instrument"],
        defaultLimit: 20
    })
});
export const QuestionnairesDraftingBox = defineQuestionnaireBox("surface:questionnaires:drafting", "Questionnaire drafting", "Drafting and publishing context for questionnaire instruments.", ["questionnaires", "drafting", "authoring"], (input) => buildStaticWorkbenchExecution(input, {
    states: ["draft", "published", "run"]
}, "Questionnaire drafting surface with draft, publish, and run lifecycle context."), [createSummaryOutput({ label: "Drafting summary", description: "Summary of questionnaire drafting and lifecycle context." })]);
export const QuestionnairesObservationBox = defineQuestionnaireBox("surface:questionnaires:self-observation", "Self-observation calendar", "Calendar of self-observation notes and linked psyche context.", ["questionnaires", "self-observation", "psyche"], (input) => buildStaticWorkbenchExecution(input, {
    linkedDomains: ["patterns", "reports", "notes"]
}, "Self-observation calendar surface with linked psyche context."), [createSummaryOutput({ label: "Observation summary", description: "Summary of the self-observation calendar and linked psyche context." })]);
