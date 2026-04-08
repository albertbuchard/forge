import { useEffect, useRef, type RefObject } from "react";
import {
  applyShellCollapseVariables,
  clamp,
  readWindowScrollTop
} from "@/features/shell/collapse-variables";
import { selectCollapseProgress } from "@/features/shell/selectors";
import { setCollapseProgress } from "@/store/slices/shell-slice";
import { useAppDispatch, useAppSelector } from "@/store/typed-hooks";

export function useShellCollapseController(
  shellRootRef: RefObject<HTMLElement | null>
) {
  const dispatch = useAppDispatch();
  const collapseProgress = useAppSelector(selectCollapseProgress);
  const collapseProgressRef = useRef(collapseProgress);

  useEffect(() => {
    collapseProgressRef.current = collapseProgress;
  }, [collapseProgress]);

  useEffect(() => {
    const updateCollapsed = () => {
      const collapseDistance = window.innerWidth >= 1024 ? 124 : 96;
      const scrollRoot =
        document.scrollingElement ??
        document.documentElement ??
        document.body;
      const maxScrollable = Math.max(
        0,
        scrollRoot.scrollHeight - window.innerHeight
      );
      const nextProgress =
        maxScrollable < collapseDistance
          ? 0
          : clamp(readWindowScrollTop() / collapseDistance, 0, 1);

      if (Math.abs(collapseProgressRef.current - nextProgress) < 0.001) {
        return;
      }
      dispatch(setCollapseProgress(nextProgress));
    };

    updateCollapsed();
    window.addEventListener("scroll", updateCollapsed, { passive: true });
    window.addEventListener("resize", updateCollapsed);
    return () => {
      window.removeEventListener("scroll", updateCollapsed);
      window.removeEventListener("resize", updateCollapsed);
    };
  }, [dispatch]);

  useEffect(() => {
    applyShellCollapseVariables(shellRootRef.current, collapseProgress);
  }, [collapseProgress, shellRootRef]);
}
