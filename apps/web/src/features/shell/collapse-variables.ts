export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function interpolateNumber(progress: number, from: number, to: number) {
  return from + (to - from) * progress;
}

export function applyShellCollapseVariables(
  target: HTMLElement | null,
  progress: number
) {
  if (!target) {
    return;
  }
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
    `${interpolateNumber(progress, 176, 0)}px`
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
    `${interpolateNumber(progress, 320, 0)}px`
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
