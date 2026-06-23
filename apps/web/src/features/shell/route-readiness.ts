export type ShellRouteReadinessState = {
  bootstrapReady: boolean;
  sleepReady: boolean;
};

type ShellRouteReadinessRule = {
  id: string;
  matches: (pathname: string) => boolean;
  isReady: (state: ShellRouteReadinessState) => boolean;
};

const SHELL_ROUTE_READINESS_RULES: ShellRouteReadinessRule[] = [
  {
    id: "sleep",
    matches: (pathname) => pathname === "/sleep" || pathname.startsWith("/sleep/"),
    isReady: (state) => state.bootstrapReady && state.sleepReady
  }
];

export function resolveShellRouteReadinessRule(pathname: string) {
  return (
    SHELL_ROUTE_READINESS_RULES.find((rule) => rule.matches(pathname)) ?? null
  );
}

export function isShellRouteReady(
  pathname: string,
  readiness: ShellRouteReadinessState
) {
  if (!readiness.bootstrapReady) {
    return false;
  }

  const rule = resolveShellRouteReadinessRule(pathname);
  return rule ? rule.isReady(readiness) : true;
}
