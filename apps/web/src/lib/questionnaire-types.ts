export type QuestionnaireSourceClass =
  | "public_domain"
  | "free_use"
  | "open_access"
  | "open_noncommercial"
  | "free_clinician"
  | "secondary_verified";

export type QuestionnaireAvailability = "open" | "free_clinician" | "custom";
export type QuestionnairePresentationMode =
  | "single_question"
  | "batched_likert";
export type QuestionnaireVersionStatus = "draft" | "published" | "archived";
export type QuestionnaireRunStatus = "draft" | "completed" | "abandoned";
export type QuestionnaireComparator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte";

export interface QuestionnaireOption {
  key: string;
  label: string;
  value: number;
  description: string;
}

export interface QuestionnaireFlowRule {
  script: string;
}

export interface QuestionnaireItem {
  id: string;
  prompt: string;
  shortLabel: string;
  description: string;
  helperText: string;
  required: boolean;
  visibility: QuestionnaireFlowRule | null;
  options: QuestionnaireOption[];
  tags: string[];
}

export interface QuestionnaireSection {
  id: string;
  title: string;
  description: string;
  visibility: QuestionnaireFlowRule | null;
  itemIds: string[];
}

export interface QuestionnaireDefinition {
  locale: string;
  instructions: string;
  completionNote: string;
  presentationMode: QuestionnairePresentationMode;
  responseStyle: string;
  itemIds: string[];
  items: QuestionnaireItem[];
  sections: QuestionnaireSection[];
  pageSize: number | null;
}

export type QuestionnaireScoreExpression =
  | { kind: "const"; value: number | string | boolean | null }
  | { kind: "answer"; itemId: string; defaultValue?: number | null }
  | { kind: "score"; scoreKey: string }
  | {
      kind: "add" | "multiply" | "min" | "max";
      values: QuestionnaireScoreExpression[];
    }
  | {
      kind: "subtract" | "divide";
      left: QuestionnaireScoreExpression;
      right: QuestionnaireScoreExpression;
      zeroValue?: number | null;
    }
  | { kind: "sum" | "average"; itemIds: string[] }
  | {
      kind: "weighted_sum";
      terms: Array<{ itemId: string; weight: number }>;
    }
  | {
      kind: "count_if" | "filtered_mean";
      itemIds: string[];
      comparator: QuestionnaireComparator;
      target: number;
    }
  | {
      kind: "compare";
      comparator: QuestionnaireComparator;
      left: QuestionnaireScoreExpression;
      right: QuestionnaireScoreExpression;
    }
  | {
      kind: "if";
      condition: QuestionnaireScoreExpression;
      then: QuestionnaireScoreExpression;
      else: QuestionnaireScoreExpression;
    }
  | { kind: "round"; value: QuestionnaireScoreExpression; digits: number };

export interface QuestionnaireScoreBand {
  label: string;
  min?: number | null;
  max?: number | null;
  severity: string;
}

export interface QuestionnaireScoreDefinition {
  key: string;
  label: string;
  description: string;
  valueType: "number" | "text" | "boolean" | "percent";
  expression: QuestionnaireScoreExpression;
  dependsOnItemIds: string[];
  missingPolicy?: {
    mode: "require_all" | "allow_partial" | "min_answered";
    minAnswered?: number | null;
  };
  bands: QuestionnaireScoreBand[];
  roundTo?: number | null;
  unitLabel: string;
}

export interface QuestionnaireScoring {
  scores: QuestionnaireScoreDefinition[];
}

export interface QuestionnaireProvenanceSource {
  label: string;
  url: string;
  citation: string;
  notes: string;
}

export interface QuestionnaireProvenance {
  retrievalDate: string;
  sourceClass: QuestionnaireSourceClass;
  scoringNotes: string;
  sources: QuestionnaireProvenanceSource[];
}

export interface QuestionnaireVersion {
  id: string;
  instrumentId: string;
  versionNumber: number;
  status: QuestionnaireVersionStatus;
  label: string;
  isReadOnly: boolean;
  definition: QuestionnaireDefinition;
  scoring: QuestionnaireScoring;
  provenance: QuestionnaireProvenance;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface QuestionnaireHistoryPoint {
  runId: string;
  completedAt: string;
  primaryScore: number | null;
  primaryScoreLabel: string;
  bandLabel: string;
}

export interface QuestionnaireInstrumentSummary {
  id: string;
  key: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  aliases: string[];
  symptomDomains: string[];
  tags: string[];
  sourceClass: QuestionnaireSourceClass;
  availability: QuestionnaireAvailability;
  responseStyle: string;
  presentationMode: QuestionnairePresentationMode;
  itemCount: number;
  isSelfReport: boolean;
  isSystem: boolean;
  isReadOnly: boolean;
  ownerUserId: string | null;
  currentVersionId: string | null;
  currentVersionNumber: number | null;
  latestRunId: string | null;
  latestRunAt: string | null;
  completedRunCount: number;
  primarySourceUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionnaireInstrumentDetail
  extends QuestionnaireInstrumentSummary {
  status: "active" | "archived";
  currentVersion: QuestionnaireVersion | null;
  draftVersion: QuestionnaireVersion | null;
  versions: QuestionnaireVersion[];
  history: QuestionnaireHistoryPoint[];
  latestDraftRunId: string | null;
}

export interface QuestionnaireAnswer {
  itemId: string;
  optionKey: string | null;
  valueText: string;
  numericValue: number | null;
  answer: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionnaireRunScore {
  scoreKey: string;
  label: string;
  valueNumeric: number | null;
  valueText: string | null;
  bandLabel: string;
  severity: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface QuestionnaireRun {
  id: string;
  instrumentId: string;
  versionId: string;
  userId: string | null;
  status: QuestionnaireRunStatus;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  progressIndex: number;
}

export interface QuestionnaireRunDetail {
  run: QuestionnaireRun;
  instrument: QuestionnaireInstrumentSummary;
  version: QuestionnaireVersion;
  answers: QuestionnaireAnswer[];
  scores: QuestionnaireRunScore[];
  history: QuestionnaireHistoryPoint[];
}

export interface QuestionnaireAnswerInput {
  itemId: string;
  optionKey?: string | null;
  valueText: string;
  numericValue?: number | null;
  answer: Record<string, unknown>;
}

export interface CreateQuestionnaireInstrumentInput {
  title: string;
  subtitle: string;
  description: string;
  aliases: string[];
  symptomDomains: string[];
  tags: string[];
  sourceClass: QuestionnaireSourceClass;
  availability: QuestionnaireAvailability;
  isSelfReport: boolean;
  userId?: string | null;
  versionLabel: string;
  definition: QuestionnaireDefinition;
  scoring: QuestionnaireScoring;
  provenance: QuestionnaireProvenance;
}

export interface UpdateQuestionnaireVersionInput {
  title: string;
  subtitle: string;
  description: string;
  aliases: string[];
  symptomDomains: string[];
  tags: string[];
  sourceClass: QuestionnaireSourceClass;
  availability: QuestionnaireAvailability;
  isSelfReport: boolean;
  label: string;
  definition: QuestionnaireDefinition;
  scoring: QuestionnaireScoring;
  provenance: QuestionnaireProvenance;
}
