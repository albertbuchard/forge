import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

export const derivedDataSourceSchema = z.object({
  id: nonEmptyString,
  label: nonEmptyString,
  kind: z.enum(["record", "aggregate", "derived", "device", "service"]),
  observedAt: z.string().datetime().nullable().default(null),
  detailRoute: nonEmptyString.nullable().default(null)
});

export const derivedDataEvidenceSchema = z.object({
  label: nonEmptyString,
  reference: nonEmptyString,
  observedAt: z.string().datetime().nullable().default(null)
});

export const derivedDataProvenanceSchema = z.object({
  generatedAt: z.string().datetime(),
  observedAt: z.string().datetime().nullable(),
  freshness: z.enum(["fresh", "stale", "future", "missing"]),
  completeness: z.enum(["complete", "partial", "unknown"]),
  staleAfterSeconds: z.number().int().positive(),
  sourceSummary: nonEmptyString,
  statusDetail: nonEmptyString,
  confidence: z.object({
    level: z.enum(["high", "medium", "low", "unknown"]),
    reason: nonEmptyString
  }),
  sources: z.array(derivedDataSourceSchema).min(1),
  evidence: z.array(derivedDataEvidenceSchema).max(24)
});

export type DerivedDataProvenance = z.infer<typeof derivedDataProvenanceSchema>;

export type BuildDerivedDataProvenanceInput = {
  generatedAt: string;
  observedAt: string | null;
  staleAfterSeconds: number;
  sourceSummary: string;
  completeness: DerivedDataProvenance["completeness"];
  completenessReason: string;
  confidence: DerivedDataProvenance["confidence"];
  sources: DerivedDataProvenance["sources"];
  evidence?: DerivedDataProvenance["evidence"];
  futureClockSkewSeconds?: number;
};

function describeFreshness(input: {
  freshness: DerivedDataProvenance["freshness"];
  completeness: DerivedDataProvenance["completeness"];
  completenessReason: string;
  ageSeconds: number | null;
}) {
  const completenessPrefix =
    input.completeness === "complete"
      ? "Complete evidence."
      : input.completeness === "partial"
        ? `Partial evidence: ${input.completenessReason}`
        : `Completeness unknown: ${input.completenessReason}`;

  if (input.freshness === "missing") {
    return `${completenessPrefix} No observation time is available, so freshness cannot be confirmed.`;
  }
  if (input.freshness === "future") {
    return `${completenessPrefix} The latest observation is ahead of the runtime clock. Check device time and timezone before acting.`;
  }
  if (input.freshness === "stale") {
    const age = Math.max(0, Math.floor(input.ageSeconds ?? 0));
    return `${completenessPrefix} The latest observation is ${age} seconds old and needs a refresh before it is treated as current.`;
  }
  return `${completenessPrefix} The latest observation is within the freshness window.`;
}

export function buildDerivedDataProvenance(
  input: BuildDerivedDataProvenanceInput
): DerivedDataProvenance {
  const generatedAtMs = Date.parse(input.generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    throw new Error(
      "Derived-data provenance requires a valid generatedAt time."
    );
  }
  const observedAtMs = input.observedAt ? Date.parse(input.observedAt) : null;
  if (input.observedAt && !Number.isFinite(observedAtMs)) {
    throw new Error(
      "Derived-data provenance requires a valid observedAt time."
    );
  }
  const ageSeconds =
    observedAtMs === null
      ? null
      : Math.round((generatedAtMs - observedAtMs) / 1_000);
  const futureClockSkewSeconds = input.futureClockSkewSeconds ?? 300;
  const freshness: DerivedDataProvenance["freshness"] =
    ageSeconds === null
      ? "missing"
      : ageSeconds < -futureClockSkewSeconds
        ? "future"
        : Math.max(0, ageSeconds) > input.staleAfterSeconds
          ? "stale"
          : "fresh";

  return {
    generatedAt: input.generatedAt,
    observedAt: input.observedAt,
    freshness,
    completeness: input.completeness,
    staleAfterSeconds: input.staleAfterSeconds,
    sourceSummary: input.sourceSummary,
    statusDetail: describeFreshness({
      freshness,
      completeness: input.completeness,
      completenessReason: input.completenessReason,
      ageSeconds
    }),
    confidence: input.confidence,
    sources: input.sources,
    evidence: input.evidence ?? []
  };
}

export function latestObservedAt(values: Array<string | null | undefined>) {
  return (
    values
      .filter((value): value is string => {
        if (!value) {
          return false;
        }
        return Number.isFinite(Date.parse(value));
      })
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null
  );
}
