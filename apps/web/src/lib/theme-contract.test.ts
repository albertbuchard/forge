import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { FORGE_THEME_BOOTSTRAP_STORAGE_KEY } from "@/lib/theme-system";

const sourceRoot = existsSync(join(process.cwd(), "apps/web/src"))
  ? join(process.cwd(), "apps/web/src")
  : join(process.cwd(), "src");
const hardCodedPaletteClass =
  /(?:bg|text|border|ring|outline|divide|fill|stroke|from|via|to|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-|\/|\b)/g;
const hardCodedVisualAttribute =
  /\b(?:fill|stroke|stopColor)=["']#[0-9a-fA-F]{3,8}["']/g;
const hardCodedArbitraryPaletteClass =
  /(?:bg|text|border|ring|outline|divide|fill|stroke|from|via|to|shadow)-\[[^\]]*#[0-9a-fA-F]{3,8}[^\]]*\]/g;

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return productionSourceFiles(path);
    }
    if (
      ![".ts", ".tsx"].includes(extname(entry.name)) ||
      entry.name.includes(".test.") ||
      entry.name.includes(".spec.")
    ) {
      return [];
    }
    return [path];
  });
}

describe("Forge theme contract", () => {
  it("keeps legacy Tailwind palette aliases connected to the active theme", () => {
    const styles = readFileSync(join(sourceRoot, "styles.css"), "utf8");

    expect(styles).toContain("--color-canvas: var(--surface);");
    expect(styles).toContain("--color-panel: var(--surface-panel);");
    expect(styles).toContain("--color-panel-high: var(--surface-high);");
    expect(styles).toContain("--color-panel-low: var(--surface-low);");
    expect(styles).toContain("--color-ink: var(--forge-body-text);");
    expect(styles).toContain("--color-primary: var(--primary);");
    expect(
      styles.match(/--color-canvas: var\(--surface\);/g)?.length
    ).toBeGreaterThanOrEqual(2);
    expect(styles).not.toContain(
      "body.theme-forge-custom {\n  color-scheme: dark;"
    );
  });

  it("keeps production UI colors on semantic or domain-specific tokens", () => {
    const violations = productionSourceFiles(sourceRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return Array.from(source.matchAll(hardCodedPaletteClass), (match) => ({
        file: path.slice(sourceRoot.length),
        value: match[0]
      }));
    });

    expect(violations).toEqual([]);
  });

  it("does not hide fixed palette colors inside arbitrary Tailwind classes", () => {
    const violations = productionSourceFiles(sourceRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return Array.from(
        source.matchAll(hardCodedArbitraryPaletteClass),
        (match) => ({
          file: path.slice(sourceRoot.length),
          value: match[0]
        })
      );
    });

    expect(violations).toEqual([]);
  });

  it("uses readable semantic colors in light themes", () => {
    const styles = readFileSync(join(sourceRoot, "styles.css"), "utf8");
    const start = styles.indexOf("body.theme-forge-light {");
    const end = styles.indexOf("\n}", start);
    const lightTheme = styles.slice(start, end);

    expect(lightTheme).toContain("--success: #147a5a;");
    expect(lightTheme).toContain("--danger: #b83252;");
    expect(lightTheme).toContain("--warning: #98540c;");
    expect(lightTheme).toContain("--info: #176b8f;");
    expect(lightTheme).toContain("--ui-ink-on-accent: #ffffff;");
    expect(lightTheme).toContain("--chart-zone-1: #0369a1;");
    expect(lightTheme).toContain("--chart-zone-5: #b91c1c;");
    expect(lightTheme).toContain("--knowledge-graph-panel: color-mix(");
  });

  it("keeps SVG chrome and charts on theme-aware tokens", () => {
    const violations = productionSourceFiles(sourceRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return Array.from(source.matchAll(hardCodedVisualAttribute), (match) => ({
        file: path.slice(sourceRoot.length),
        value: match[0]
      }));
    });

    expect(violations).toEqual([]);
  });

  it("defines every global UI token used by production source", () => {
    const styles = readFileSync(join(sourceRoot, "styles.css"), "utf8");
    const definedTokens = new Set(
      Array.from(styles.matchAll(/(--ui-[a-z0-9-]+)\s*:/g), (match) => match[1])
    );
    const usedTokens = new Set(
      productionSourceFiles(sourceRoot).flatMap((path) => {
        const source = readFileSync(path, "utf8");
        return Array.from(
          source.matchAll(/var\((--ui-[a-z0-9-]+)/g),
          (match) => match[1]
        );
      })
    );

    expect(
      [...usedTokens].filter((token) => !definedTokens.has(token)).sort()
    ).toEqual([]);
  });

  it("applies the saved theme inline before the React root paints", () => {
    const index = readFileSync(join(sourceRoot, "..", "index.html"), "utf8");
    const bootstrapIndex = index.indexOf(FORGE_THEME_BOOTSTRAP_STORAGE_KEY);
    const rootIndex = index.indexOf('id="root"');

    expect(bootstrapIndex).toBeGreaterThan(-1);
    expect(rootIndex).toBeGreaterThan(bootstrapIndex);
    expect(index).not.toContain('src="./theme-bootstrap.js"');
    expect(index).not.toContain('src="%BASE_URL%theme-bootstrap.js"');
  });
});
