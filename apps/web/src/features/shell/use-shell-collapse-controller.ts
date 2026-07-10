import { useEffect, type RefObject } from "react";
import {
  applyShellCollapseVariables,
  readWindowScrollTop,
  resolveExpandedShellMeasurement,
  resolveShellCollapseMaxScrollable,
  resolveShellCollapseProgress
} from "@/features/shell/collapse-variables";

export function useShellCollapseController(
  shellRootRef: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    const target = shellRootRef.current;
    if (!target || typeof window === "undefined") {
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animationFrameId: number | null = null;
    let lastProgress = Number.NaN;
    let activeHeader: HTMLElement | null = null;
    let expandedHeaderHeight = 0;
    let desktopSecondaryHeight = 0;
    let mobileCopyHeight = 0;

    const update = () => {
      animationFrameId = null;
      const scrollRoot =
        document.scrollingElement ?? document.documentElement ?? document.body;
      const expectedHeader = window.innerWidth >= 1024 ? "desktop" : "mobile";
      const header = target.querySelector<HTMLElement>(
        `[data-shell-collapse-header="${expectedHeader}"]`
      );
      const currentHeaderHeight = header?.getBoundingClientRect().height ?? 0;
      const desktopSecondary = target.querySelector<HTMLElement>(
        "[data-shell-desktop-secondary]"
      );
      const mobileCopy = target.querySelector<HTMLElement>(
        "[data-shell-mobile-copy]"
      );
      if (header !== activeHeader) {
        activeHeader = header;
        expandedHeaderHeight = currentHeaderHeight;
        lastProgress = Number.NaN;
      } else if (!Number.isFinite(lastProgress) || lastProgress <= 0.001) {
        expandedHeaderHeight = Math.max(
          expandedHeaderHeight,
          currentHeaderHeight
        );
      }
      const scrollTop = readWindowScrollTop();
      const progress = resolveShellCollapseProgress({
        scrollTop,
        viewportWidth: window.innerWidth,
        maxScrollable: resolveShellCollapseMaxScrollable({
          maxScrollable: Math.max(
            0,
            scrollRoot.scrollHeight - window.innerHeight
          ),
          expandedHeaderHeight:
            expectedHeader === "desktop"
              ? expandedHeaderHeight
              : currentHeaderHeight,
          currentHeaderHeight,
          collapseProgress: Number.isFinite(lastProgress) ? lastProgress : 0
        }),
        reduceMotion: reducedMotion.matches
      });
      const nextDesktopSecondaryHeight = resolveExpandedShellMeasurement({
        previous: desktopSecondaryHeight,
        observed: desktopSecondary?.scrollHeight ?? 0,
        collapseProgress: progress,
        previousCollapseProgress: lastProgress
      });
      const nextMobileCopyHeight = resolveExpandedShellMeasurement({
        previous: mobileCopyHeight,
        observed: mobileCopy?.scrollHeight ?? 0,
        collapseProgress: progress,
        previousCollapseProgress: lastProgress
      });
      const measurementsChanged =
        Math.abs(desktopSecondaryHeight - nextDesktopSecondaryHeight) >= 0.5 ||
        Math.abs(mobileCopyHeight - nextMobileCopyHeight) >= 0.5;
      desktopSecondaryHeight = nextDesktopSecondaryHeight;
      mobileCopyHeight = nextMobileCopyHeight;

      if (
        expectedHeader === "mobile" &&
        currentHeaderHeight > 0 &&
        (!Number.isFinite(lastProgress) || lastProgress <= 0.001)
      ) {
        target.style.setProperty(
          "--forge-shell-mobile-expanded-header-height",
          `${currentHeaderHeight}px`
        );
      }
      if (Math.abs(lastProgress - progress) < 0.001 && !measurementsChanged) {
        return;
      }
      lastProgress = progress;
      applyShellCollapseVariables(target, progress, {
        desktopSecondaryHeight,
        mobileCopyHeight
      });
    };

    const scheduleUpdate = () => {
      if (animationFrameId !== null) {
        return;
      }
      animationFrameId = window.requestAnimationFrame(update);
    };

    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    reducedMotion.addEventListener("change", scheduleUpdate);

    const resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(scheduleUpdate)
        : null;
    resizeObserver?.observe(document.documentElement);

    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      reducedMotion.removeEventListener("change", scheduleUpdate);
      resizeObserver?.disconnect();
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, [shellRootRef]);
}
