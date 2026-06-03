import {
  ArrowUpRight,
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
  LayoutDashboard,
  Map,
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
    id: "life-force",
    to: "/life-force",
    label: "Life Force",
    detail: "Action Point capacity, weekday curves, and instant drains",
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
    id: "knowledge-graph",
    to: "/knowledge-graph",
    label: "Knowledge Graph",
    detail: "A living graph of Forge entities, links, and structural layers",
    icon: Orbit
  },
  {
    id: "workbench",
    to: "/workbench",
    label: "Workbench",
    detail: "Global graph flows, AI tools, and published outputs",
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
    detail:
      "Cardiovascular load, HR zone targets, acute/chronic stress, and adaptation signals",
    icon: Gauge
  },
  {
    id: "vitals",
    to: "/vitals",
    label: "Vitals",
    detail:
      "Recovery, cardio fitness, breathing, composition, and body signals",
    icon: HeartPulse
  },
  {
    id: "weight-loss",
    to: "/weight-loss",
    label: "Weight Loss",
    detail:
      "Food logs, body composition, gut comfort, aesthetic signals, and nutrition experiments",
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
    detail: "Forge Smith levels, streaks, trophies, and cosmetic unlocks",
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

const PSYCHE_SHORTCUT_ROUTES: ShellRouteDefinition[] = PSYCHE_SECTIONS.filter(
  (route) => route.to !== "/psyche"
).map((route) => ({
  id: `psyche:${route.to}`,
  to: route.to,
  icon: route.icon,
  label: route.label,
  detail: "Psyche shortcut"
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
