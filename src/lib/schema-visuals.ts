import type { SchemaCatalogEntry } from "./psyche-types";

export type SchemaType = SchemaCatalogEntry["schemaType"];

const schemaTypeLabelMap: Record<SchemaType, string> = {
  maladaptive: "Maladaptive schema",
  adaptive: "Adaptive schema"
};

const schemaTypeHelpMap: Record<SchemaType, string> = {
  maladaptive: "A recurring pressure pattern that can distort how you interpret situations or respond.",
  adaptive: "A stable healthy belief pattern you want to strengthen and rely on."
};

const schemaFamilyLabelMap: Record<string, string> = {
  disconnection_rejection: "Disconnection & rejection",
  impaired_autonomy: "Autonomy & competence",
  other_directedness: "Boundaries & mutuality",
  overvigilance_inhibition: "Standards & inhibition",
  healthy_selfhood: "Healthy selfhood"
};

export function getSchemaTypeLabel(schemaType: SchemaType) {
  return schemaTypeLabelMap[schemaType];
}

export function getSchemaTypeHelpText(schemaType: SchemaType) {
  return schemaTypeHelpMap[schemaType];
}

export function getSchemaFamilyLabel(family: string) {
  return schemaFamilyLabelMap[family] ?? family.replaceAll("_", " ");
}

export function getSchemaVisual(schemaType: SchemaType) {
  if (schemaType === "adaptive") {
    return {
      sectionTone: "border-emerald-400/14 bg-[linear-gradient(180deg,rgba(26,53,48,0.72),rgba(10,18,30,0.92))]",
      sectionEyebrow: "text-emerald-200/84",
      cardTone: "border-emerald-400/14 bg-[linear-gradient(180deg,rgba(28,63,56,0.44),rgba(14,24,36,0.92))]",
      badgeTone: "border-emerald-300/18 bg-[linear-gradient(135deg,rgba(16,185,129,0.18),rgba(56,189,248,0.12))] text-emerald-50",
      subtleBadgeTone: "border-emerald-300/12 bg-[rgba(16,185,129,0.1)] text-emerald-100/88",
      countLabel: "support links",
      linkSummary: "linked strengthening belief",
      emptyCopy: "No adaptive schema is linked yet. Add one when you want to capture the healthier pattern you are building from."
    };
  }

  return {
    sectionTone: "border-fuchsia-400/14 bg-[linear-gradient(180deg,rgba(44,28,58,0.72),rgba(10,18,30,0.92))]",
    sectionEyebrow: "text-fuchsia-200/84",
    cardTone: "border-violet-400/14 bg-[linear-gradient(180deg,rgba(48,33,68,0.44),rgba(14,18,34,0.92))]",
    badgeTone: "border-rose-300/18 bg-[linear-gradient(135deg,rgba(244,63,94,0.16),rgba(168,85,247,0.12))] text-rose-50",
    subtleBadgeTone: "border-rose-300/12 bg-[rgba(244,63,94,0.1)] text-rose-100/88",
    countLabel: "linked records",
    linkSummary: "linked belief",
    emptyCopy: "No maladaptive schema is linked yet. Add one when you want to capture the recurring old pattern clearly."
  };
}

function normalizeSchemaLink(value: string) {
  return value.trim().toLowerCase();
}

export function matchesSchemaLink(schema: SchemaCatalogEntry, value: string) {
  const normalized = normalizeSchemaLink(value);
  return [schema.id, schema.slug, schema.title].some((candidate) => normalizeSchemaLink(candidate) === normalized);
}

export function findSchemaForLink(value: string, schemas: SchemaCatalogEntry[]) {
  return schemas.find((schema) => matchesSchemaLink(schema, value)) ?? null;
}

export function isSchemaSelected(values: string[], schema: SchemaCatalogEntry) {
  return values.some((value) => matchesSchemaLink(schema, value));
}

export function toggleSchemaSelection(values: string[], schema: SchemaCatalogEntry) {
  const next = values.filter((value) => !matchesSchemaLink(schema, value));
  return next.length === values.length ? [...next, schema.id] : next;
}
