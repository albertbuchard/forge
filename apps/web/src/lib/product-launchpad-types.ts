import type { CrudEntityType } from "./types";

export type ProductOutcomeKey =
  | "plan_week"
  | "daily_reflection"
  | "research_project";

export interface ProductPackageRecord {
  ref: string;
  entityType: Extract<
    CrudEntityType,
    "goal" | "project" | "task" | "habit" | "note" | "tag"
  >;
  title: string;
  description: string;
  dependsOn: string[];
  data: Record<string, unknown>;
}

export interface ProductPackage {
  id: string;
  version: string;
  kind: "starter_pack" | "integration";
  title: string;
  summary: string;
  outcomeKey: ProductOutcomeKey | null;
  author: string;
  reviewState: "forge_reviewed" | "external_setup";
  compatibility: string;
  permissions: string[];
  records: ProductPackageRecord[];
  setupHref: string | null;
  manifestSha256: string;
}

export interface ProductPackagePreview {
  package: ProductPackage;
  ownerUserId: string;
  changes: Array<{
    ref: string;
    entityType: ProductPackageRecord["entityType"];
    title: string;
    description: string;
    dependsOn: string[];
  }>;
  permissions: string[];
  collisions: Array<{
    ref: string;
    entityType: string;
    title: string;
    reason: string;
  }>;
  canInstall: boolean;
}

export interface ProductPackageInstall {
  id: string;
  packageId: string;
  packageVersion: string;
  manifestSha256: string;
  status: "installed" | "removed";
  createdEntities: Array<{
    ref: string;
    entityType: string;
    entityId: string;
    title: string;
    href: string;
  }>;
  installedAt: string;
  removedAt: string | null;
  updatedAt: string;
}

export interface ProductOnboardingState {
  ownerUserId: string;
  outcomeKey: ProductOutcomeKey | null;
  currentStep:
    | "choose_outcome"
    | "review_pack"
    | "install_pack"
    | "first_result"
    | "complete";
  status: "not_started" | "in_progress" | "skipped" | "complete";
  installedPackageId: string | null;
  lastResultHref: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export type ProductImportSource =
  | "markdown"
  | "obsidian"
  | "notion"
  | "todoist"
  | "apple_reminders"
  | "calendar"
  | "github_issues"
  | "linear";

export interface ProductImportItem {
  sourceId: string;
  recordType: "note" | "task" | "calendar_event";
  title: string;
  content: string;
  status: string | null;
  dueAt: string | null;
  sourceUrl: string | null;
  metadata: Record<string, unknown>;
}

export interface ProductImportPreview {
  previewId: string;
  ownerUserId: string;
  sourceKind: ProductImportSource;
  sourceLabel: string;
  payloadFingerprint: string;
  items: Array<
    ProductImportItem & {
      duplicate: boolean;
      proposedAction: "review" | "create";
      provenance: Record<string, unknown>;
    }
  >;
  counts: { total: number; create: number; conflicts: number };
}

export interface ProductImportRun {
  id: string;
  sourceKind: ProductImportSource;
  sourceLabel: string;
  status: "preview" | "committed" | "rolled_back";
  created: Array<{
    sourceId: string;
    entityType: CrudEntityType;
    entityId: string;
    title: string;
    href: string;
  }>;
  skipped: Array<{ sourceId: string; reason: string }>;
  committedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductReviewItem {
  id: string;
  kind:
    | "import_conflict"
    | "capture_classification"
    | "agent_proposal"
    | "relationship_proposal"
    | "offline_conflict"
    | "artifact_enrichment"
    | "sync_conflict";
  sourceType: string;
  sourceId: string;
  revision: number;
  status: "pending";
  title: string;
  summary: string;
  proposedAction: Record<string, unknown>;
  evidence: Array<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
}

export interface ProductFeedbackPayload {
  settings: {
    ownerUserId: string;
    enabled: boolean;
    consentVersion: string | null;
    consentedAt: string | null;
    updatedAt: string | null;
  };
  events: Array<{
    id: string;
    eventName: string;
    outcomeKey: ProductOutcomeKey | null;
    surfaceKey: string | null;
    success: boolean | null;
    durationBucket: string | null;
    createdAt: string;
  }>;
  policy: {
    transport: "local_only";
    allowedFields: string[];
    prohibitedFields: string[];
    retentionDays: number;
  };
}
