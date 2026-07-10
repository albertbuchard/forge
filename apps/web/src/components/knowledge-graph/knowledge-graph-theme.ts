import type { RenderedKnowledgeGraphEdge } from "@/lib/knowledge-graph";
import { resolveForgeThemeToken } from "@/lib/theme-system";

export function resolveKnowledgeGraphThemeColor(
  token: string | null | undefined,
  fallback = "#c0c1ff"
) {
  if (!token || typeof window === "undefined") {
    return fallback;
  }
  const value = resolveForgeThemeToken(token, fallback);
  return /^\d+(?:\.\d+)?\s*,/.test(value) ? `rgb(${value})` : value;
}

export function fadeKnowledgeGraphColor(color: string, alpha: number) {
  if (color.startsWith("rgb(") && color.endsWith(")")) {
    return color.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
  }
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const normalized =
      hex.length === 3
        ? hex
            .split("")
            .map((part) => `${part}${part}`)
            .join("")
        : hex;
    const red = parseInt(normalized.slice(0, 2), 16);
    const green = parseInt(normalized.slice(2, 4), 16);
    const blue = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }
  return color;
}

export function buildKnowledgeGraphEdgeStroke(
  edge: Pick<RenderedKnowledgeGraphEdge, "family">,
  alpha: number
) {
  const fallback =
    edge.family === "structural"
      ? "125, 211, 252"
      : edge.family === "contextual"
        ? "45, 212, 191"
        : edge.family === "taxonomy"
          ? "192, 132, 252"
          : edge.family === "workspace"
            ? "251, 191, 36"
            : "148, 163, 184";
  const token =
    edge.family === "structural"
      ? "--info"
      : edge.family === "contextual"
        ? "--secondary"
        : edge.family === "taxonomy"
          ? "--primary"
          : edge.family === "workspace"
            ? "--warning"
            : "--forge-body-text";
  const color = resolveKnowledgeGraphThemeColor(token, `rgb(${fallback})`);
  return fadeKnowledgeGraphColor(color, alpha);
}
