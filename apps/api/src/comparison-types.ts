export const COMPARISON_FAMILIES = [
  "preference",
  "health",
  "psyche",
  "insight",
  "note",
  "wiki"
] as const;

export type ComparisonFamily = (typeof COMPARISON_FAMILIES)[number];
export type ComparisonAlignment = "separate_tracks" | "shared_axis";
export type ComparisonValueKind = "number" | "event";
export type ComparisonAvailability = "history" | "current_only";
export type ComparisonMissingReason = "not_recorded" | "not_stored";

export type ComparisonCatalogItem = {
  selector: string;
  family: ComparisonFamily;
  title: string;
  description: string;
  valueKind: ComparisonValueKind;
  unit: string | null;
  availability: ComparisonAvailability;
  sourceHref: string;
};

export type ComparisonCatalogResponse = {
  userId: string;
  query: string;
  family: ComparisonFamily | null;
  items: ComparisonCatalogItem[];
  total: number;
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
};

export type ComparisonEvidenceReference = {
  key: string;
  label: string;
};

export type ComparisonSourceReference = {
  entityType: string;
  entityId: string;
  href: string;
};

export type ComparisonPoint = {
  at: string;
  dateKey: string;
  value: number | null;
  label: string | null;
  missingReason: ComparisonMissingReason | null;
  source: ComparisonSourceReference | null;
  evidence: ComparisonEvidenceReference[];
};

export type ComparisonLane = {
  selector: string;
  family: ComparisonFamily | null;
  title: string;
  valueKind: ComparisonValueKind | null;
  unit: string | null;
  availability: ComparisonAvailability | null;
  state: "available" | "unavailable";
  limitation: string | null;
  sourceHref: string | null;
  points: ComparisonPoint[];
  pointCount: number;
  sourceReferenceCount: number;
  sourceReferencesTruncated: boolean;
};

export type ComparisonResponse = {
  userId: string;
  from: string;
  to: string;
  timeZone: string;
  alignmentRequested: ComparisonAlignment;
  alignmentApplied: ComparisonAlignment;
  sharedAxisReason: string | null;
  lanes: ComparisonLane[];
  totals: {
    laneCount: number;
    pointCount: number;
    sourceReferenceCount: number;
    sourceReferencesTruncated: boolean;
  };
};

export type ComparisonCatalogQuery = {
  userId: string;
  query: string;
  family: ComparisonFamily | null;
  limit: number;
  cursor: string | null;
};

export type ComparisonQuery = {
  userId: string;
  selections: string[];
  from: string;
  to: string;
  timeZone: string;
  alignment: ComparisonAlignment;
};
