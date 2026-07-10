import {
  ArrowUpRight,
  Archive,
  BarChart3,
  BatteryCharging,
  BookCopy,
  BrainCircuit,
  BriefcaseBusiness,
  CalendarDays,
  Clock3,
  Dumbbell,
  Gauge,
  GitBranch,
  HeartPulse,
  Inbox,
  LayoutDashboard,
  Map,
  Milestone,
  Moon,
  Network,
  NotebookPen,
  Orbit,
  Radar,
  Repeat,
  Settings,
  SlidersHorizontal,
  Target,
  Trophy,
  Utensils,
  Zap,
  type LucideIcon
} from "lucide-react";
import { PSYCHE_SECTIONS } from "@/components/psyche/psyche-section-nav";
import type { TranslationKey } from "@/lib/i18n";
import { ROUTE_VIEW_CATALOG } from "@/routes/route-view-catalog";

export type ShellRouteDefinition = {
  id: string;
  to: string;
  labelKey?: TranslationKey;
  detailKey?: TranslationKey;
  icon: LucideIcon;
  label?: string;
  detail?: string;
};

export const PRIMARY_ROUTES: ShellRouteDefinition[] = [
  {
    id: "overview",
    to: "/overview",
    labelKey: "common.routeLabels.overview",
    detailKey: "common.routeDetails.overview",
    icon: LayoutDashboard
  },
  {
    id: "attention",
    to: "/attention",
    label: "Attention",
    detail: ROUTE_VIEW_CATALOG["attention-index"].description,
    icon: Inbox
  },
  {
    id: "life-force",
    to: "/life-force",
    label: "Life Force",
    detail: ROUTE_VIEW_CATALOG["life-force-index"].description,
    icon: BatteryCharging
  },
  {
    id: "goals",
    to: "/goals",
    labelKey: "common.routeLabels.goals",
    detailKey: "common.routeDetails.goals",
    icon: Target
  },
  {
    id: "habits",
    to: "/habits",
    labelKey: "common.routeLabels.habits",
    detailKey: "common.routeDetails.habits",
    icon: Repeat
  },
  {
    id: "projects",
    to: "/projects",
    labelKey: "common.routeLabels.projects",
    detailKey: "common.routeDetails.projects",
    icon: BriefcaseBusiness
  },
  {
    id: "strategies",
    to: "/strategies",
    labelKey: "common.routeLabels.strategies",
    detailKey: "common.routeDetails.strategies",
    icon: GitBranch
  },
  {
    id: "preferences",
    to: "/preferences",
    labelKey: "common.routeLabels.preferences",
    detailKey: "common.routeDetails.preferences",
    icon: SlidersHorizontal
  },
  {
    id: "calendar",
    to: "/calendar",
    labelKey: "common.routeLabels.calendar",
    detailKey: "common.routeDetails.calendar",
    icon: CalendarDays
  },
  {
    id: "life-events",
    to: "/life-events",
    label: "Life Events",
    detail: ROUTE_VIEW_CATALOG["life-events-index"].description,
    icon: Milestone
  },
  {
    id: "knowledge-graph",
    to: "/knowledge-graph",
    label: "Knowledge Graph",
    detail: ROUTE_VIEW_CATALOG["knowledge-graph-index"].description,
    icon: Orbit
  },
  {
    id: "artifacts",
    to: "/artifacts",
    label: "Artifacts",
    detail: ROUTE_VIEW_CATALOG["artifacts-index"].description,
    icon: Archive
  },
  {
    id: "workbench",
    to: "/workbench",
    label: "Workbench",
    detail: ROUTE_VIEW_CATALOG.workbench.description,
    icon: Network
  },
  {
    id: "movement",
    to: "/movement",
    labelKey: "common.routeLabels.movement",
    detailKey: "common.routeDetails.movement",
    icon: Map
  },
  {
    id: "sleep",
    to: "/sleep",
    labelKey: "common.routeLabels.sleep",
    detailKey: "common.routeDetails.sleep",
    icon: Moon
  },
  {
    id: "sports",
    to: "/sports",
    labelKey: "common.routeLabels.sports",
    detailKey: "common.routeDetails.sports",
    icon: Dumbbell
  },
  {
    id: "training-load",
    to: "/training-load",
    label: "Training Load",
    detail: ROUTE_VIEW_CATALOG["training-load-index"].description,
    icon: Gauge
  },
  {
    id: "vitals",
    to: "/vitals",
    label: "Vitals",
    detail: ROUTE_VIEW_CATALOG["vitals-index"].description,
    icon: HeartPulse
  },
  {
    id: "weight-loss",
    to: "/weight-loss",
    label: "Weight Loss",
    detail: ROUTE_VIEW_CATALOG["weight-loss-index"].description,
    icon: Utensils
  },
  {
    id: "kanban",
    to: "/kanban",
    labelKey: "common.routeLabels.kanban",
    detailKey: "common.routeDetails.kanban",
    icon: Zap
  },
  {
    id: "today",
    to: "/today",
    labelKey: "common.routeLabels.today",
    detailKey: "common.routeDetails.today",
    icon: Clock3
  },
  {
    id: "rewards",
    to: "/rewards",
    label: "Trophy Hall",
    detail: ROUTE_VIEW_CATALOG.rewards.description,
    icon: Trophy
  },
  {
    id: "notes",
    to: "/notes",
    labelKey: "common.routeLabels.notes",
    detailKey: "common.routeDetails.notes",
    icon: NotebookPen
  },
  {
    id: "wiki",
    to: "/wiki",
    labelKey: "common.routeLabels.wiki",
    detailKey: "common.routeDetails.wiki",
    icon: BookCopy
  },
  {
    id: "psyche",
    to: "/psyche",
    labelKey: "common.routeLabels.psyche",
    detailKey: "common.routeDetails.psyche",
    icon: BrainCircuit
  },
  {
    id: "activity",
    to: "/activity",
    labelKey: "common.routeLabels.activity",
    detailKey: "common.routeDetails.activity",
    icon: ArrowUpRight
  },
  {
    id: "insights",
    to: "/insights",
    labelKey: "common.routeLabels.insights",
    detailKey: "common.routeDetails.insights",
    icon: Radar
  },
  {
    id: "review",
    to: "/review/weekly",
    labelKey: "common.routeLabels.review",
    detailKey: "common.routeDetails.review",
    icon: BarChart3
  },
  {
    id: "settings",
    to: "/settings",
    labelKey: "common.routeLabels.settings",
    detailKey: "common.routeDetails.settings",
    icon: Settings
  }
];

const PSYCHE_SHORTCUT_DETAILS: Record<string, string> = {
  "/psyche/metrics": ROUTE_VIEW_CATALOG["psyche-metrics"].description,
  "/psyche/flashcards": ROUTE_VIEW_CATALOG["psyche-flashcards"].description,
  "/psyche/values": ROUTE_VIEW_CATALOG["psyche-values"].description,
  "/psyche/patterns": ROUTE_VIEW_CATALOG["psyche-patterns"].description,
  "/psyche/questionnaires":
    ROUTE_VIEW_CATALOG["psyche-questionnaires"].description,
  "/psyche/self-observation":
    ROUTE_VIEW_CATALOG["psyche-self-observation"].description,
  "/psyche/behaviors": ROUTE_VIEW_CATALOG["psyche-behaviors"].description,
  "/psyche/reports": ROUTE_VIEW_CATALOG["psyche-reports"].description,
  "/psyche/goal-map": ROUTE_VIEW_CATALOG["psyche-goal-map"].description,
  "/psyche/schemas-beliefs":
    ROUTE_VIEW_CATALOG["psyche-schemas-beliefs"].description,
  "/psyche/modes": ROUTE_VIEW_CATALOG["psyche-modes"].description,
  "/psyche/screen-time": ROUTE_VIEW_CATALOG["psyche-screen-time"].description,
  "/preferences": ROUTE_VIEW_CATALOG["preferences-index"].description,
  "/sleep": ROUTE_VIEW_CATALOG["sleep-index"].description
};

const PSYCHE_SHORTCUT_ROUTES: ShellRouteDefinition[] = PSYCHE_SECTIONS.filter(
  (route) => route.to !== "/psyche"
).map((route) => ({
  id: `psyche:${route.to}`,
  to: route.to,
  icon: route.icon,
  label: route.label,
  detail:
    PSYCHE_SHORTCUT_DETAILS[route.to] ??
    ROUTE_VIEW_CATALOG["psyche-index"].description
}));

export const NAV_ROUTE_REGISTRY: ShellRouteDefinition[] = [
  ...PRIMARY_ROUTES,
  ...PSYCHE_SHORTCUT_ROUTES
];

export const SHELL_NAV_ROUTES = PRIMARY_ROUTES.filter(
  (route) => route.to !== "/preferences" && route.to !== "/sleep"
);

export function requirePrimaryRoute(id: string) {
  const route = PRIMARY_ROUTES.find((entry) => entry.id === id);
  if (!route) {
    throw new Error(`Missing primary route: ${id}`);
  }
  return route;
}

export function isWikiRoute(pathname: string) {
  return (
    pathname === "/wiki" ||
    pathname.startsWith("/wiki/page/") ||
    pathname === "/wiki/new" ||
    pathname.startsWith("/wiki/edit/")
  );
}

export function isPsycheRoute(pathname: string) {
  return (
    pathname.startsWith("/psyche") ||
    pathname === "/preferences" ||
    pathname.startsWith("/preferences/") ||
    pathname === "/sleep" ||
    pathname.startsWith("/sleep/")
  );
}

export function routeMatches(pathname: string, route: ShellRouteDefinition) {
  if (route.to === "/psyche") {
    return isPsycheRoute(pathname);
  }
  return pathname === route.to || pathname.startsWith(`${route.to}/`);
}

export function getRouteLabel(
  route: ShellRouteDefinition,
  t: (key: TranslationKey) => string
) {
  return route.labelKey ? t(route.labelKey) : (route.label ?? route.to);
}

export function getRouteDetail(
  route: ShellRouteDefinition,
  t: (key: TranslationKey) => string
) {
  if (route.detailKey) {
    return t(route.detailKey);
  }
  return route.detail ?? route.to;
}
