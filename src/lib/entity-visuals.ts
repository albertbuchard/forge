import type { LucideIcon } from "lucide-react";
import { FileText, FolderOpen, GitBranch, Heart, ListTodo, Quote, RefreshCw, Repeat, Route, Shapes, Target } from "lucide-react";

export type EntityKind = "goal" | "project" | "task" | "strategy" | "habit" | "value" | "pattern" | "behavior" | "belief" | "mode" | "report";

export type EntityVisualDefinition = {
  kind: EntityKind;
  label: string;
  icon: LucideIcon;
  iconClassName: string;
  nameClassName: string;
  badgeClassName: string;
  subtleBadgeClassName: string;
  buttonClassName: string;
};

export const ENTITY_KINDS: EntityKind[] = ["goal", "project", "task", "strategy", "habit", "value", "pattern", "behavior", "belief", "mode", "report"];

const ENTITY_VISUALS: Record<EntityKind, EntityVisualDefinition> = {
  goal: {
    kind: "goal",
    label: "Goal",
    icon: Target,
    iconClassName: "text-amber-100",
    nameClassName: "text-amber-100",
    badgeClassName:
      "border-amber-300/24 bg-[linear-gradient(135deg,rgba(251,191,36,0.24),rgba(251,191,36,0.08))] text-amber-50",
    subtleBadgeClassName: "border-amber-300/18 bg-[rgba(251,191,36,0.08)] text-amber-100",
    buttonClassName:
      "border-amber-300/20 bg-[rgba(251,191,36,0.12)] text-amber-50 hover:bg-[rgba(251,191,36,0.18)]"
  },
  project: {
    kind: "project",
    label: "Project",
    icon: FolderOpen,
    iconClassName: "text-sky-100",
    nameClassName: "text-sky-100",
    badgeClassName:
      "border-sky-300/24 bg-[linear-gradient(135deg,rgba(56,189,248,0.22),rgba(56,189,248,0.08))] text-sky-50",
    subtleBadgeClassName: "border-sky-300/18 bg-[rgba(56,189,248,0.08)] text-sky-100",
    buttonClassName:
      "border-sky-300/20 bg-[rgba(56,189,248,0.12)] text-sky-50 hover:bg-[rgba(56,189,248,0.18)]"
  },
  task: {
    kind: "task",
    label: "Task",
    icon: ListTodo,
    iconClassName: "text-indigo-100",
    nameClassName: "text-indigo-100",
    badgeClassName:
      "border-indigo-300/24 bg-[linear-gradient(135deg,rgba(129,140,248,0.22),rgba(129,140,248,0.08))] text-indigo-50",
    subtleBadgeClassName: "border-indigo-300/18 bg-[rgba(129,140,248,0.08)] text-indigo-100",
    buttonClassName:
      "border-indigo-300/20 bg-[rgba(129,140,248,0.12)] text-indigo-50 hover:bg-[rgba(129,140,248,0.18)]"
  },
  strategy: {
    kind: "strategy",
    label: "Strategy",
    icon: GitBranch,
    iconClassName: "text-cyan-100",
    nameClassName: "text-cyan-100",
    badgeClassName:
      "border-cyan-300/24 bg-[linear-gradient(135deg,rgba(34,211,238,0.22),rgba(34,211,238,0.08))] text-cyan-50",
    subtleBadgeClassName: "border-cyan-300/18 bg-[rgba(34,211,238,0.08)] text-cyan-100",
    buttonClassName:
      "border-cyan-300/20 bg-[rgba(34,211,238,0.12)] text-cyan-50 hover:bg-[rgba(34,211,238,0.18)]"
  },
  habit: {
    kind: "habit",
    label: "Habit",
    icon: RefreshCw,
    iconClassName: "text-teal-100",
    nameClassName: "text-teal-100",
    badgeClassName:
      "border-teal-300/24 bg-[linear-gradient(135deg,rgba(45,212,191,0.22),rgba(45,212,191,0.08))] text-teal-50",
    subtleBadgeClassName: "border-teal-300/18 bg-[rgba(45,212,191,0.08)] text-teal-100",
    buttonClassName:
      "border-teal-300/20 bg-[rgba(45,212,191,0.12)] text-teal-50 hover:bg-[rgba(45,212,191,0.18)]"
  },
  value: {
    kind: "value",
    label: "Value",
    icon: Heart,
    iconClassName: "text-emerald-100",
    nameClassName: "text-emerald-100",
    badgeClassName:
      "border-emerald-300/24 bg-[linear-gradient(135deg,rgba(52,211,153,0.24),rgba(52,211,153,0.08))] text-emerald-50",
    subtleBadgeClassName: "border-emerald-300/18 bg-[rgba(52,211,153,0.08)] text-emerald-100",
    buttonClassName:
      "border-emerald-300/20 bg-[rgba(52,211,153,0.12)] text-emerald-50 hover:bg-[rgba(52,211,153,0.18)]"
  },
  pattern: {
    kind: "pattern",
    label: "Pattern",
    icon: Repeat,
    iconClassName: "text-rose-100",
    nameClassName: "text-rose-100",
    badgeClassName:
      "border-rose-300/24 bg-[linear-gradient(135deg,rgba(251,113,133,0.24),rgba(251,113,133,0.08))] text-rose-50",
    subtleBadgeClassName: "border-rose-300/18 bg-[rgba(251,113,133,0.08)] text-rose-100",
    buttonClassName:
      "border-rose-300/20 bg-[rgba(251,113,133,0.12)] text-rose-50 hover:bg-[rgba(251,113,133,0.18)]"
  },
  behavior: {
    kind: "behavior",
    label: "Behavior",
    icon: Route,
    iconClassName: "text-orange-100",
    nameClassName: "text-orange-100",
    badgeClassName:
      "border-orange-300/24 bg-[linear-gradient(135deg,rgba(251,146,60,0.24),rgba(251,146,60,0.08))] text-orange-50",
    subtleBadgeClassName: "border-orange-300/18 bg-[rgba(251,146,60,0.08)] text-orange-100",
    buttonClassName:
      "border-orange-300/20 bg-[rgba(251,146,60,0.12)] text-orange-50 hover:bg-[rgba(251,146,60,0.18)]"
  },
  belief: {
    kind: "belief",
    label: "Belief",
    icon: Quote,
    iconClassName: "text-violet-100",
    nameClassName: "text-violet-100",
    badgeClassName:
      "border-violet-300/24 bg-[linear-gradient(135deg,rgba(167,139,250,0.24),rgba(167,139,250,0.08))] text-violet-50",
    subtleBadgeClassName: "border-violet-300/18 bg-[rgba(167,139,250,0.08)] text-violet-100",
    buttonClassName:
      "border-violet-300/20 bg-[rgba(167,139,250,0.12)] text-violet-50 hover:bg-[rgba(167,139,250,0.18)]"
  },
  mode: {
    kind: "mode",
    label: "Mode",
    icon: Shapes,
    iconClassName: "text-fuchsia-100",
    nameClassName: "text-fuchsia-100",
    badgeClassName:
      "border-fuchsia-300/24 bg-[linear-gradient(135deg,rgba(217,70,239,0.24),rgba(217,70,239,0.08))] text-fuchsia-50",
    subtleBadgeClassName: "border-fuchsia-300/18 bg-[rgba(217,70,239,0.08)] text-fuchsia-100",
    buttonClassName:
      "border-fuchsia-300/20 bg-[rgba(217,70,239,0.12)] text-fuchsia-50 hover:bg-[rgba(217,70,239,0.18)]"
  },
  report: {
    kind: "report",
    label: "Report",
    icon: FileText,
    iconClassName: "text-blue-100",
    nameClassName: "text-blue-100",
    badgeClassName:
      "border-blue-300/24 bg-[linear-gradient(135deg,rgba(96,165,250,0.24),rgba(96,165,250,0.08))] text-blue-50",
    subtleBadgeClassName: "border-blue-300/18 bg-[rgba(96,165,250,0.08)] text-blue-100",
    buttonClassName:
      "border-blue-300/20 bg-[rgba(96,165,250,0.12)] text-blue-50 hover:bg-[rgba(96,165,250,0.18)]"
  }
};

export function getEntityVisual(kind: EntityKind): EntityVisualDefinition {
  return ENTITY_VISUALS[kind];
}

export function isEntityKind(value: string): value is EntityKind {
  return ENTITY_KINDS.includes(value as EntityKind);
}

export function getEntityButtonClassName(kind: EntityKind, selected: boolean): string {
  const visual = getEntityVisual(kind);
  return selected
    ? `border ${visual.buttonClassName}`
    : "border border-white/8 bg-white/[0.05] text-white/62 hover:bg-white/[0.08] hover:text-white";
}
