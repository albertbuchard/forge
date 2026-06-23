import type { SchemaCatalogEntry } from "./psyche-types";

export type SchemaType = SchemaCatalogEntry["schemaType"];

const schemaTypeLabelMap: Record<SchemaType, string> = {
  maladaptive: "Maladaptive schema",
  adaptive: "Adaptive schema"
};

const schemaTypeHelpMap: Record<SchemaType, string> = {
  maladaptive:
    "A recurring pressure pattern that can distort how you interpret situations or respond.",
  adaptive:
    "A stable healthy belief pattern you want to strengthen and rely on."
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
      sectionTone:
        "border-[color-mix(in_srgb,var(--success)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-success-soft)]",
      sectionEyebrow:
        "text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]",
      cardTone:
        "border-[color-mix(in_srgb,var(--success)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-success-soft)]",
      badgeTone:
        "border-[color-mix(in_srgb,var(--success)_35%,var(--ui-border-subtle)_65%)] bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]",
      subtleBadgeTone:
        "border-[color-mix(in_srgb,var(--success)_25%,var(--ui-border-subtle)_75%)] bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_70%,var(--ui-ink-strong)_30%)]",
      countLabel: "support links",
      linkSummary: "linked strengthening belief",
      emptyCopy:
        "No adaptive schema is linked yet. Add one when you want to capture the healthier pattern you are building from."
    };
  }

  return {
    sectionTone:
      "border-[color-mix(in_srgb,var(--danger)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-danger-soft)]",
    sectionEyebrow:
      "text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]",
    cardTone:
      "border-[color-mix(in_srgb,var(--danger)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-danger-soft)]",
    badgeTone:
      "border-[color-mix(in_srgb,var(--danger)_35%,var(--ui-border-subtle)_65%)] bg-[var(--ui-danger-soft)] text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]",
    subtleBadgeTone:
      "border-[color-mix(in_srgb,var(--danger)_25%,var(--ui-border-subtle)_75%)] bg-[var(--ui-danger-soft)] text-[color-mix(in_srgb,var(--danger)_70%,var(--ui-ink-strong)_30%)]",
    countLabel: "linked records",
    linkSummary: "linked belief",
    emptyCopy:
      "No maladaptive schema is linked yet. Add one when you want to capture the recurring old pattern clearly."
  };
}

function normalizeSchemaLink(value: string) {
  return value.trim().toLowerCase();
}

export function matchesSchemaLink(schema: SchemaCatalogEntry, value: string) {
  const normalized = normalizeSchemaLink(value);
  return [schema.id, schema.slug, schema.title].some(
    (candidate) => normalizeSchemaLink(candidate) === normalized
  );
}

export function findSchemaForLink(
  value: string,
  schemas: SchemaCatalogEntry[]
) {
  return schemas.find((schema) => matchesSchemaLink(schema, value)) ?? null;
}

export function isSchemaSelected(values: string[], schema: SchemaCatalogEntry) {
  return values.some((value) => matchesSchemaLink(schema, value));
}

export function toggleSchemaSelection(
  values: string[],
  schema: SchemaCatalogEntry
) {
  const next = values.filter((value) => !matchesSchemaLink(schema, value));
  return next.length === values.length ? [...next, schema.id] : next;
}
