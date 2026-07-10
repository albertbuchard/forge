export const DESKTOP_SHELL_COLLAPSE_DISTANCE = 124;
export const MOBILE_SHELL_COLLAPSE_DISTANCE = 96;
export const SHELL_HERO_COLLAPSED_LAYOUT_DELTA = 11;

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function interpolateNumber(progress: number, from: number, to: number) {
  return from + (to - from) * progress;
}

export function resolveShellCollapseProgress(input: {
  scrollTop: number;
  viewportWidth: number;
  maxScrollable: number;
  reduceMotion?: boolean;
}) {
  const collapseDistance =
    input.viewportWidth >= 1024
      ? DESKTOP_SHELL_COLLAPSE_DISTANCE
      : MOBILE_SHELL_COLLAPSE_DISTANCE;
  if (input.maxScrollable < collapseDistance) {
    return 0;
  }

  const progress = clamp(input.scrollTop / collapseDistance, 0, 1);
  if (!input.reduceMotion) {
    return progress;
  }
  return progress >= 0.5 ? 1 : 0;
}

export function resolveShellCollapseMaxScrollable(input: {
  maxScrollable: number;
  expandedHeaderHeight: number;
  currentHeaderHeight: number;
  collapseProgress?: number;
}) {
  return Math.max(
    0,
    input.maxScrollable +
      Math.max(0, input.expandedHeaderHeight - input.currentHeaderHeight) +
      SHELL_HERO_COLLAPSED_LAYOUT_DELTA *
        clamp(input.collapseProgress ?? 0, 0, 1)
  );
}

export function resolveExpandedShellMeasurement(input: {
  previous: number;
  observed: number;
  collapseProgress: number;
  previousCollapseProgress: number;
}) {
  const observed = Math.max(0, input.observed);
  if (observed === 0) {
    return Math.max(0, input.previous);
  }
  if (input.previous <= 0 || !Number.isFinite(input.previous)) {
    return observed;
  }
  const remainedExpanded =
    input.collapseProgress <= 0.001 &&
    Number.isFinite(input.previousCollapseProgress) &&
    input.previousCollapseProgress <= 0.001;
  return remainedExpanded ? observed : Math.max(input.previous, observed);
}

export function applyShellCollapseVariables(
  target: HTMLElement | null,
  progress: number,
  measurements: {
    desktopSecondaryHeight?: number;
    mobileCopyHeight?: number;
  } = {}
) {
  if (!target) {
    return;
  }
  target.dataset.shellCollapseState =
    progress >= 0.999 ? "collapsed" : "expanded";
  target.style.setProperty("--forge-shell-collapse", progress.toFixed(4));
  target.style.setProperty(
    "--forge-shell-desktop-header-padding-top",
    `${interpolateNumber(progress, 18, 4)}px`
  );
  target.style.setProperty(
    "--forge-shell-desktop-header-padding-bottom",
    `${interpolateNumber(progress, 15, 4)}px`
  );
  target.style.setProperty(
    "--forge-shell-desktop-title-size",
    `${interpolateNumber(progress, 1.42, 0.96)}rem`
  );
  target.style.setProperty(
    "--forge-shell-desktop-primary-translate-y",
    `${interpolateNumber(progress, 0, 2)}px`
  );
  target.style.setProperty(
    "--forge-shell-desktop-primary-scale",
    `${interpolateNumber(progress, 1, 0.98)}`
  );
  target.style.setProperty(
    "--forge-shell-desktop-secondary-opacity",
    `${interpolateNumber(progress, 1, 0)}`
  );
  target.style.setProperty(
    "--forge-shell-desktop-secondary-max-height",
    `${interpolateNumber(
      progress,
      Math.max(0, measurements.desktopSecondaryHeight ?? 176),
      0
    )}px`
  );
  target.style.setProperty(
    "--forge-shell-desktop-secondary-spacing",
    `${interpolateNumber(progress, 14, 0)}px`
  );
  target.style.setProperty(
    "--forge-shell-desktop-secondary-translate-y",
    `${interpolateNumber(progress, 0, -18)}px`
  );
  target.style.setProperty(
    "--forge-shell-mobile-header-padding-top",
    `${interpolateNumber(progress, 14, 4)}px`
  );
  target.style.setProperty(
    "--forge-shell-mobile-header-padding-bottom",
    `${interpolateNumber(progress, 12, 4)}px`
  );
  target.style.setProperty(
    "--forge-shell-mobile-title-size",
    `${interpolateNumber(progress, 1.2, 0.9)}rem`
  );
  target.style.setProperty(
    "--forge-shell-mobile-primary-translate-y",
    `${interpolateNumber(progress, 0, 1)}px`
  );
  target.style.setProperty(
    "--forge-shell-mobile-primary-scale",
    `${interpolateNumber(progress, 1, 0.98)}`
  );
  target.style.setProperty(
    "--forge-shell-mobile-copy-opacity",
    `${interpolateNumber(progress, 1, 0)}`
  );
  target.style.setProperty(
    "--forge-shell-mobile-copy-max-height",
    `${interpolateNumber(
      progress,
      Math.max(0, measurements.mobileCopyHeight ?? 320),
      0
    )}px`
  );
  target.style.setProperty(
    "--forge-shell-mobile-copy-spacing",
    `${interpolateNumber(progress, 8, 0)}px`
  );
  target.style.setProperty(
    "--forge-shell-mobile-copy-translate-y",
    `${interpolateNumber(progress, 0, -14)}px`
  );
  target.style.setProperty(
    "--forge-shell-hero-padding-top",
    `${interpolateNumber(progress, 20, 15)}px`
  );
  target.style.setProperty(
    "--forge-shell-hero-padding-bottom",
    `${interpolateNumber(progress, 20, 14)}px`
  );
  target.style.setProperty(
    "--forge-shell-hero-title-translate-y",
    `${interpolateNumber(progress, 0, -6)}px`
  );
  target.style.setProperty(
    "--forge-shell-hero-title-scale",
    `${interpolateNumber(progress, 1, 0.94)}`
  );
  target.style.setProperty(
    "--forge-shell-hero-description-opacity",
    `${interpolateNumber(progress, 1, 0.45)}`
  );
  target.style.setProperty(
    "--forge-shell-hero-description-translate-y",
    `${interpolateNumber(progress, 0, -5)}px`
  );
}

export function readWindowScrollTop() {
  if (typeof window === "undefined") {
    return 0;
  }
  return Math.max(
    window.scrollY || 0,
    document.scrollingElement?.scrollTop || 0,
    document.documentElement?.scrollTop || 0,
    document.body?.scrollTop || 0
  );
}
