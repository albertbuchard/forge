import type { LucideIcon } from "lucide-react";
import {
  Bot,
  CalendarDays,
  Compass,
  FileText,
  FolderOpen,
  GitBranch,
  Heart,
  ListTodo,
  Network,
  NotebookPen,
  PanelTop,
  Quote,
  RefreshCw,
  Repeat,
  Route,
  Shapes,
  Sparkles,
  StickyNote,
  Target,
  Timer,
  Workflow
} from "lucide-react";
import type { AiConnectorKind, CrudEntityType, Note } from "@/lib/types";

export const ENTITY_KINDS = [
  "goal",
  "project",
  "task",
  "strategy",
  "habit",
  "tag",
  "note",
  "wiki_page",
  "wiki_space",
  "insight",
  "calendar_event",
  "work_block",
  "timebox",
  "value",
  "pattern",
  "behavior",
  "belief",
  "mode",
  "mode_session",
  "report",
  "event_type",
  "emotion",
  "workbench",
  "functor",
  "chat"
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

type EntityRgbTuple = readonly [number, number, number];

export type EntityColorToken = {
  cssVariable: `--forge-entity-${string}-rgb`;
  rgb: EntityRgbTuple;
  hex: string;
};

export type EntityVisualDefinition = {
  kind: EntityKind;
  label: string;
  icon: LucideIcon;
  iconName: string;
  colorToken: EntityColorToken;
  iconClassName: string;
  nameClassName: string;
  badgeClassName: string;
  subtleBadgeClassName: string;
  buttonClassName: string;
};

type EntityVisualSeed = {
  kind: EntityKind;
  label: string;
  icon: LucideIcon;
  iconName: string;
  accentRgb: EntityRgbTuple;
};

const ENTITY_VISUAL_SEEDS: ReadonlyArray<EntityVisualSeed> = [
  {
    kind: "goal",
    label: "Goal",
    icon: Target,
    iconName: "Target",
    accentRgb: [251, 191, 36]
  },
  {
    kind: "project",
    label: "Project",
    icon: FolderOpen,
    iconName: "FolderOpen",
    accentRgb: [56, 189, 248]
  },
  {
    kind: "task",
    label: "Task",
    icon: ListTodo,
    iconName: "ListTodo",
    accentRgb: [129, 140, 248]
  },
  {
    kind: "strategy",
    label: "Strategy",
    icon: GitBranch,
    iconName: "GitBranch",
    accentRgb: [34, 211, 238]
  },
  {
    kind: "habit",
    label: "Habit",
    icon: RefreshCw,
    iconName: "RefreshCw",
    accentRgb: [45, 212, 191]
  },
  {
    kind: "tag",
    label: "Tag",
    icon: PanelTop,
    iconName: "PanelTop",
    accentRgb: [163, 230, 53]
  },
  {
    kind: "note",
    label: "Note",
    icon: NotebookPen,
    iconName: "NotebookPen",
    accentRgb: [148, 163, 184]
  },
  {
    kind: "wiki_page",
    label: "Wiki Page",
    icon: StickyNote,
    iconName: "StickyNote",
    accentRgb: [125, 211, 252]
  },
  {
    kind: "wiki_space",
    label: "Wiki Space",
    icon: Network,
    iconName: "Network",
    accentRgb: [99, 102, 241]
  },
  {
    kind: "insight",
    label: "Insight",
    icon: Sparkles,
    iconName: "Sparkles",
    accentRgb: [244, 63, 94]
  },
  {
    kind: "calendar_event",
    label: "Calendar Event",
    icon: CalendarDays,
    iconName: "CalendarDays",
    accentRgb: [14, 165, 233]
  },
  {
    kind: "work_block",
    label: "Work Block",
    icon: PanelTop,
    iconName: "PanelTop",
    accentRgb: [16, 185, 129]
  },
  {
    kind: "timebox",
    label: "Timebox",
    icon: Timer,
    iconName: "Timer",
    accentRgb: [244, 114, 182]
  },
  {
    kind: "value",
    label: "Value",
    icon: Heart,
    iconName: "Heart",
    accentRgb: [52, 211, 153]
  },
  {
    kind: "pattern",
    label: "Pattern",
    icon: Repeat,
    iconName: "Repeat",
    accentRgb: [251, 113, 133]
  },
  {
    kind: "behavior",
    label: "Behavior",
    icon: Route,
    iconName: "Route",
    accentRgb: [251, 146, 60]
  },
  {
    kind: "belief",
    label: "Belief",
    icon: Quote,
    iconName: "Quote",
    accentRgb: [167, 139, 250]
  },
  {
    kind: "mode",
    label: "Mode",
    icon: Shapes,
    iconName: "Shapes",
    accentRgb: [217, 70, 239]
  },
  {
    kind: "mode_session",
    label: "Mode Session",
    icon: Compass,
    iconName: "Compass",
    accentRgb: [192, 132, 252]
  },
  {
    kind: "report",
    label: "Report",
    icon: FileText,
    iconName: "FileText",
    accentRgb: [96, 165, 250]
  },
  {
    kind: "event_type",
    label: "Event Type",
    icon: CalendarDays,
    iconName: "CalendarDays",
    accentRgb: [45, 212, 191]
  },
  {
    kind: "emotion",
    label: "Emotion",
    icon: Heart,
    iconName: "Heart",
    accentRgb: [248, 113, 113]
  },
  {
    kind: "workbench",
    label: "Workbench",
    icon: Workflow,
    iconName: "Workflow",
    accentRgb: [45, 212, 191]
  },
  {
    kind: "functor",
    label: "Functor",
    icon: Sparkles,
    iconName: "Sparkles",
    accentRgb: [250, 204, 21]
  },
  {
    kind: "chat",
    label: "Chat",
    icon: Bot,
    iconName: "Bot",
    accentRgb: [129, 140, 248]
  }
] as const;

function toHex(rgb: EntityRgbTuple) {
  return `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function toRgbaVar(kind: EntityKind, rgb: EntityRgbTuple, alpha: number) {
  return `rgba(var(--forge-entity-${kind}-rgb,${rgb.join(",")}),${alpha})`;
}

function createEntityVisual(seed: EntityVisualSeed): EntityVisualDefinition {
  return {
    kind: seed.kind,
    label: seed.label,
    icon: seed.icon,
    iconName: seed.iconName,
    colorToken: {
      cssVariable: `--forge-entity-${seed.kind}-rgb`,
      rgb: seed.accentRgb,
      hex: toHex(seed.accentRgb)
    },
    iconClassName: `text-[${toRgbaVar(seed.kind, seed.accentRgb, 0.96)}]`,
    nameClassName: `text-[${toRgbaVar(seed.kind, seed.accentRgb, 0.96)}]`,
    badgeClassName:
      `border-[${toRgbaVar(seed.kind, seed.accentRgb, 0.24)}] ` +
      `bg-[linear-gradient(135deg,${toRgbaVar(seed.kind, seed.accentRgb, 0.24)},${toRgbaVar(seed.kind, seed.accentRgb, 0.08)})] text-white`,
    subtleBadgeClassName:
      `border-[${toRgbaVar(seed.kind, seed.accentRgb, 0.18)}] ` +
      `bg-[${toRgbaVar(seed.kind, seed.accentRgb, 0.08)}] text-[${toRgbaVar(seed.kind, seed.accentRgb, 0.92)}]`,
    buttonClassName:
      `border-[${toRgbaVar(seed.kind, seed.accentRgb, 0.2)}] ` +
      `bg-[${toRgbaVar(seed.kind, seed.accentRgb, 0.12)}] text-white hover:bg-[${toRgbaVar(seed.kind, seed.accentRgb, 0.18)}]`
  };
}

const ENTITY_VISUALS: Record<EntityKind, EntityVisualDefinition> =
  Object.fromEntries(
    ENTITY_VISUAL_SEEDS.map((seed) => [seed.kind, createEntityVisual(seed)])
  ) as Record<EntityKind, EntityVisualDefinition>;

const CRUD_ENTITY_KIND_MAP: Partial<Record<CrudEntityType, EntityKind>> = {
  goal: "goal",
  project: "project",
  task: "task",
  strategy: "strategy",
  habit: "habit",
  tag: "tag",
  note: "note",
  insight: "insight",
  calendar_event: "calendar_event",
  work_block_template: "work_block",
  task_timebox: "timebox",
  psyche_value: "value",
  behavior_pattern: "pattern",
  behavior: "behavior",
  belief_entry: "belief",
  mode_profile: "mode",
  mode_guide_session: "mode_session",
  event_type: "event_type",
  emotion_definition: "emotion",
  trigger_report: "report"
};

export function getEntityVisual(kind: EntityKind): EntityVisualDefinition {
  return ENTITY_VISUALS[kind];
}

export function getEntityVisualCatalog(): EntityVisualDefinition[] {
  return ENTITY_KINDS.map((kind) => getEntityVisual(kind));
}

export function isEntityKind(value: string): value is EntityKind {
  return (ENTITY_KINDS as readonly string[]).includes(value);
}

export function getEntityKindForCrudEntityType(
  entityType: CrudEntityType,
  options?: { noteKind?: Note["kind"] | null }
): EntityKind | null {
  if (entityType === "note" && options?.noteKind === "wiki") {
    return "wiki_page";
  }
  return CRUD_ENTITY_KIND_MAP[entityType] ?? null;
}

export function getEntityKindForWorkbenchFlowKind(
  kind: AiConnectorKind
): EntityKind {
  return kind === "chat" ? "chat" : "functor";
}

export function getEntityButtonClassName(
  kind: EntityKind,
  selected: boolean
): string {
  const visual = getEntityVisual(kind);
  return selected
    ? `border ${visual.buttonClassName}`
    : "border border-white/8 bg-white/[0.05] text-white/62 hover:bg-white/[0.08] hover:text-white";
}
