import { getDomainBySlug } from "../repositories/domains.js";
import { listInsights } from "../repositories/collaboration.js";
import { listNotes } from "../repositories/notes.js";
import { filterOwnedEntities } from "../repositories/entity-ownership.js";
import {
  listBehaviorPatterns,
  listBehaviors,
  listBeliefEntries,
  listModeProfiles,
  listPsycheValues,
  listSchemaCatalog,
  listTriggerReports
} from "../repositories/psyche.js";
import { psycheOverviewPayloadSchema, type PsycheOverviewPayload } from "../psyche-types.js";

const PSYCHE_ENTITY_TYPE_SET = new Set([
  "psyche_value",
  "behavior_pattern",
  "behavior",
  "belief_entry",
  "mode_profile",
  "trigger_report"
]);

export function getPsycheOverview(userIds?: string[]): PsycheOverviewPayload {
  const domain = getDomainBySlug("psyche");
  if (!domain) {
    throw new Error("Psyche domain is not available");
  }

  const values = filterOwnedEntities("psyche_value", listPsycheValues(), userIds);
  const patterns = filterOwnedEntities("behavior_pattern", listBehaviorPatterns(), userIds);
  const behaviors = filterOwnedEntities("behavior", listBehaviors(), userIds);
  const beliefs = filterOwnedEntities("belief_entry", listBeliefEntries(), userIds);
  const modes = filterOwnedEntities("mode_profile", listModeProfiles(), userIds);
  const reports = filterOwnedEntities("trigger_report", listTriggerReports(5), userIds);
  const schemaCatalog = listSchemaCatalog();
  const notes = filterOwnedEntities("note", listNotes({ limit: 200 }), userIds);
  const openInsights = filterOwnedEntities("insight", listInsights({ limit: 100 }), userIds).filter(
    (insight) => insight.entityType && PSYCHE_ENTITY_TYPE_SET.has(insight.entityType)
  ).length;
  const openNotes = notes.filter((note) => note.links.some((link) => PSYCHE_ENTITY_TYPE_SET.has(link.entityType))).length;
  const committedActions = [
    ...values.flatMap((value) => value.committedActions),
    ...behaviors.filter((behavior) => behavior.kind === "committed").map((behavior) => behavior.title),
    ...reports.flatMap((report) => report.nextMoves)
  ];
  const schemaPressure = schemaCatalog
    .filter((schema) => schema.schemaType === "maladaptive")
    .map((schema) => {
      const activationCount =
        beliefs.filter((belief) => belief.schemaId === schema.id).length +
        behaviors.filter((behavior) => behavior.linkedSchemaIds.includes(schema.id)).length +
        reports.filter((report) => report.schemaLinks.includes(schema.id) || report.schemaLinks.includes(schema.slug)).length;
      return {
        schemaId: schema.id,
        title: schema.title,
        activationCount
      };
    })
    .filter((entry) => entry.activationCount > 0)
    .sort((left, right) => right.activationCount - left.activationCount)
    .slice(0, 6);

  return psycheOverviewPayloadSchema.parse({
    generatedAt: new Date().toISOString(),
    domain,
    values,
    patterns,
    behaviors,
    beliefs,
    modes,
    reports,
    schemaPressure,
    openInsights,
    openNotes,
    committedActions
  });
}
