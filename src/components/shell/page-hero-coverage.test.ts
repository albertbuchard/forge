import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function collectTsxFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return collectTsxFiles(path);
    }
    return path.endsWith(".tsx") ? [path] : [];
  });
}

function pageHeroUsageCount(source: string) {
  return [...source.matchAll(/<PageHero\b/g)].length;
}

describe("PageHero clarity coverage", () => {
  it("keeps routed page heroes description-backed so every main view has an explanation affordance", () => {
    const files = collectTsxFiles(join(process.cwd(), "src/pages"));
    const totalUsages = files.reduce(
      (count, file) => count + pageHeroUsageCount(readFileSync(file, "utf8")),
      0
    );
    const pageHeroSource = readFileSync(
      join(process.cwd(), "src/components/shell/page-hero.tsx"),
      "utf8"
    );

    expect(totalUsages).toBeGreaterThan(50);
    expect(pageHeroSource).toMatch(
      /helpContent \?\? \(typeof description === "string"/
    );
    expect(pageHeroSource).toMatch(
      /Explain what the .* page shows and how to interpret it/
    );
  });
});
