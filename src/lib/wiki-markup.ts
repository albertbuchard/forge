export type WikiInlineToken =
  | { type: "text"; value: string }
  | { type: "wiki-link"; target: string; label: string; embed: boolean }
  | { type: "forge-link"; entityType: string; entityId: string; label: string }
  | { type: "link"; label: string; href: string }
  | { type: "code"; value: string }
  | { type: "strong"; value: string }
  | { type: "em"; value: string };

export type WikiDirectiveBlock = {
  kind: string;
  lines: string[];
  raw: string;
};

export type WikiInfoboxData = {
  title?: string;
  summary?: string;
  rows: Array<{ label: string; value: string }>;
};

export type WikiContentBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; code: string }
  | { type: "admonition"; kind: "note" | "tip" | "warning" | "danger"; lines: string[] }
  | { type: "forge-links" | "forge-media" | "forge-related"; lines: string[] };

export type WikiMarkupDocument = {
  blocks: WikiContentBlock[];
  infobox: WikiInfoboxData | null;
  directives: WikiDirectiveBlock[];
};

function parseInfobox(lines: string[]): WikiInfoboxData {
  const rows: Array<{ label: string; value: string }> = [];
  let title: string | undefined;
  let summary: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      rows.push({ label: "Note", value: line });
      continue;
    }
    const label = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!value) {
      continue;
    }
    const normalized = label.toLowerCase();
    if (normalized === "title") {
      title = value;
      continue;
    }
    if (normalized === "summary") {
      summary = value;
      continue;
    }
    rows.push({ label, value });
  }

  return { title, summary, rows };
}

export function parseWikiInline(text: string): WikiInlineToken[] {
  const tokens: WikiInlineToken[] = [];
  const pattern =
    /(!?\[\[([^\]]+)\]\]|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        type: "text",
        value: text.slice(lastIndex, match.index)
      });
    }

    if (match[1] && match[2]) {
      const targetWithLabel = match[2].trim();
      const embed = match[1].startsWith("!");
      const separatorIndex = targetWithLabel.indexOf("|");
      const target =
        separatorIndex >= 0
          ? targetWithLabel.slice(0, separatorIndex).trim()
          : targetWithLabel;
      const label =
        separatorIndex >= 0
          ? targetWithLabel.slice(separatorIndex + 1).trim()
          : target;

      if (target.toLowerCase().startsWith("forge:")) {
        const [, entityType, ...entityIdParts] = target.split(":");
        tokens.push({
          type: "forge-link",
          entityType: entityType ?? "",
          entityId: entityIdParts.join(":").trim(),
          label
        });
      } else {
        tokens.push({
          type: "wiki-link",
          target,
          label,
          embed
        });
      }
    } else if (match[3] && match[4]) {
      tokens.push({
        type: "link",
        label: match[3],
        href: match[4].trim()
      });
    } else if (match[5]) {
      tokens.push({ type: "code", value: match[5] });
    } else if (match[6]) {
      tokens.push({ type: "strong", value: match[6] });
    } else if (match[7]) {
      tokens.push({ type: "em", value: match[7] });
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: "text", value: text.slice(lastIndex) });
  }

  return tokens;
}

export function parseWikiMarkup(markdown: string): WikiMarkupDocument {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const blocks: WikiContentBlock[] = [];
  const directives: WikiDirectiveBlock[] = [];
  let infobox: WikiInfoboxData | null = null;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      blocks.push({ type: "code", code: codeLines.join("\n") });
      continue;
    }

    const directiveMatch = trimmed.match(/^:::([a-z0-9-]+)\s*$/i);
    if (directiveMatch) {
      const kind = directiveMatch[1]!.toLowerCase();
      const bodyLines: string[] = [];
      index += 1;
      while (index < lines.length && (lines[index] ?? "").trim() !== ":::") {
        bodyLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      const raw = [`:::${kind}`, ...bodyLines, ":::"].join("\n");
      directives.push({ kind, lines: bodyLines, raw });
      if (kind === "forge-infobox") {
        infobox = parseInfobox(bodyLines);
      } else if (
        kind === "note" ||
        kind === "tip" ||
        kind === "warning" ||
        kind === "danger"
      ) {
        blocks.push({
          type: "admonition",
          kind,
          lines: bodyLines
        });
      } else if (
        kind === "forge-links" ||
        kind === "forge-media" ||
        kind === "forge-related"
      ) {
        blocks.push({
          type: kind,
          lines: bodyLines
        });
      }
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2].trim()
      });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) {
        quoteLines.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", text: quoteLines.join(" ").trim() });
      continue;
    }

    if (/^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const ordered = /^\d+\.\s+/.test(line);
      const items: string[] = [];
      while (
        index < lines.length &&
        (/^[-*+]\s+/.test(lines[index] ?? "") || /^\d+\.\s+/.test(lines[index] ?? ""))
      ) {
        items.push(
          (lines[index] ?? "")
            .replace(/^[-*+]\s+/, "")
            .replace(/^\d+\.\s+/, "")
            .trim()
        );
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index] ?? "";
      const candidateTrimmed = candidate.trim();
      if (
        !candidateTrimmed ||
        candidateTrimmed.startsWith("```") ||
        candidateTrimmed.startsWith(":::") ||
        /^#{1,6}\s+/.test(candidate) ||
        /^>\s?/.test(candidate) ||
        /^[-*+]\s+/.test(candidate) ||
        /^\d+\.\s+/.test(candidate)
      ) {
        break;
      }
      paragraphLines.push(candidateTrimmed);
      index += 1;
    }

    if (paragraphLines.length > 0) {
      blocks.push({
        type: "paragraph",
        text: paragraphLines.join(" ")
      });
      continue;
    }

    index += 1;
  }

  return { blocks, infobox, directives };
}
