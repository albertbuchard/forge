import { Fragment, type ReactNode } from "react";
import { getEntityRoute } from "@/lib/note-helpers";
import { resolveForgePath } from "@/lib/runtime-paths";
import type { CrudEntityType } from "@/lib/types";
import { cn } from "@/lib/utils";

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(!?\[\[([^\]]+)\]\]|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<Fragment key={`${keyPrefix}-text-${index}`}>{text.slice(lastIndex, match.index)}</Fragment>);
      index += 1;
    }

    if (match[1] && match[2]) {
      const wikiTarget = match[2].trim();
      const isEmbed = match[1].startsWith("!");
      const separatorIndex = wikiTarget.indexOf("|");
      const rawTarget =
        separatorIndex >= 0 ? wikiTarget.slice(0, separatorIndex).trim() : wikiTarget;
      const label =
        separatorIndex >= 0 ? wikiTarget.slice(separatorIndex + 1).trim() : rawTarget;

      if (rawTarget.toLowerCase().startsWith("forge:")) {
        const [, entityType, entityId] = rawTarget.split(":");
        const route =
          entityType && entityId
            ? getEntityRoute(entityType as CrudEntityType, entityId)
            : null;
        const href = route ? resolveForgePath(route) : null;
        nodes.push(
          href ? (
            <a
              key={`${keyPrefix}-forge-${index}`}
              href={href}
              className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 px-2 py-0.5 text-[0.9em] text-amber-100 transition hover:bg-amber-400/18"
            >
              <span className="text-[0.72em] uppercase tracking-[0.14em] text-amber-200/72">
                Forge
              </span>
              <span>{label}</span>
            </a>
          ) : (
            <span
              key={`${keyPrefix}-forge-${index}`}
              className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[0.9em] text-white/66"
            >
              {label}
            </span>
          )
        );
      } else {
        const href = resolveForgePath(
          `/wiki/page/${encodeURIComponent(rawTarget)}`
        );
        nodes.push(
          <a
            key={`${keyPrefix}-wiki-${index}`}
            href={href}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.9em] transition",
              isEmbed
                ? "bg-cyan-400/14 text-cyan-50 hover:bg-cyan-400/22"
                : "bg-white/[0.06] text-[var(--secondary)] hover:bg-white/[0.1]"
            )}
          >
            {isEmbed ? (
              <span className="text-[0.72em] uppercase tracking-[0.14em] text-cyan-100/68">
                Embed
              </span>
            ) : null}
            <span>{label}</span>
          </a>
        );
      }
    } else if (match[3] && match[4]) {
      const href = match[4].trim();
      const external = /^https?:\/\//i.test(href);
      nodes.push(
        <a
          key={`${keyPrefix}-link-${index}`}
          href={href}
          className="text-[var(--secondary)] underline decoration-[rgba(125,211,252,0.4)] underline-offset-4 transition hover:text-white"
          target={external ? "_blank" : undefined}
          rel={external ? "noreferrer" : undefined}
        >
          {match[3]}
        </a>
      );
    } else if (match[5]) {
      nodes.push(
        <code key={`${keyPrefix}-code-${index}`} className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[0.92em] text-white/90">
          {match[5]}
        </code>
      );
    } else if (match[6]) {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${index}`} className="font-semibold text-white">
          {match[6]}
        </strong>
      );
    } else if (match[7]) {
      nodes.push(
        <em key={`${keyPrefix}-em-${index}`} className="italic text-white/88">
          {match[7]}
        </em>
      );
    }

    lastIndex = pattern.lastIndex;
    index += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(<Fragment key={`${keyPrefix}-tail-${index}`}>{text.slice(lastIndex)}</Fragment>);
  }

  return nodes;
}

function renderBlocks(markdown: string) {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
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
      blocks.push(
        <pre key={`code-${index}`} className="overflow-x-auto rounded-[18px] bg-[rgba(6,10,18,0.88)] px-4 py-3 text-xs leading-6 text-white/86">
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const sizeClass =
        level === 1 ? "text-xl" : level === 2 ? "text-lg" : level === 3 ? "text-base" : "text-sm";
      blocks.push(
        <div key={`heading-${index}`} className={cn("font-semibold text-white", sizeClass)}>
          {renderInline(headingMatch[2], `heading-${index}`)}
        </div>
      );
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) {
        quoteLines.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote key={`quote-${index}`} className="border-l-2 border-[var(--secondary)]/50 pl-4 text-sm leading-7 text-white/72">
          {renderInline(quoteLines.join(" "), `quote-${index}`)}
        </blockquote>
      );
      continue;
    }

    if (/^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const ordered = /^\d+\.\s+/.test(line);
      const items: string[] = [];
      while (index < lines.length && (/^[-*+]\s+/.test(lines[index] ?? "") || /^\d+\.\s+/.test(lines[index] ?? ""))) {
        items.push((lines[index] ?? "").replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag key={`list-${index}`} className={cn("space-y-1 pl-5 text-sm leading-7 text-white/74", ordered ? "list-decimal" : "list-disc")}>
          {items.map((item, itemIndex) => (
            <li key={`item-${index}-${itemIndex}`}>{renderInline(item, `list-${index}-${itemIndex}`)}</li>
          ))}
        </ListTag>
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index] ?? "";
      if (!candidate.trim() || candidate.trim().startsWith("```") || /^#{1,6}\s+/.test(candidate) || /^>\s?/.test(candidate) || /^[-*+]\s+/.test(candidate) || /^\d+\.\s+/.test(candidate)) {
        break;
      }
      paragraphLines.push(candidate.trim());
      index += 1;
    }

    blocks.push(
      <p key={`paragraph-${index}`} className="text-sm leading-7 text-white/72">
        {renderInline(paragraphLines.join(" "), `paragraph-${index}`)}
      </p>
    );
  }

  return blocks;
}

export function NoteMarkdown({ markdown, className }: { markdown: string; className?: string }) {
  return <div className={cn("grid gap-3", className)}>{renderBlocks(markdown)}</div>;
}
