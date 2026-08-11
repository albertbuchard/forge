import {
  Fragment,
  createElement,
  useId,
  useState,
  type ReactNode
} from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getArtifactHumanDownloadRoute } from "@/lib/artifact-routes";
import { getEntityRoute } from "@/lib/note-helpers";
import { resolveForgePath } from "@/lib/runtime-paths";
import type { CrudEntityType } from "@/lib/types";
import { cn } from "@/lib/utils";

function resolveSafeMarkdownHref(rawHref: string) {
  const href = rawHref.trim();
  if (!href) {
    return null;
  }
  try {
    const url = new URL(href, window.location.href);
    if (url.protocol === "mailto:") {
      return { href, external: false };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return {
      href,
      external: url.origin !== window.location.origin
    };
  } catch {
    return null;
  }
}

function resolveForgeHref(route: string) {
  const parsed = new URL(route, window.location.origin);
  return `${resolveForgePath(parsed.pathname)}${parsed.search}${parsed.hash}`;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(!?\[\[([^\]]+)\]\]|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        <Fragment key={`${keyPrefix}-text-${index}`}>
          {text.slice(lastIndex, match.index)}
        </Fragment>
      );
      index += 1;
    }

    if (match[1] && match[2]) {
      const wikiTarget = match[2].trim();
      const isEmbed = match[1].startsWith("!");
      const separatorIndex = wikiTarget.indexOf("|");
      const rawTarget =
        separatorIndex >= 0
          ? wikiTarget.slice(0, separatorIndex).trim()
          : wikiTarget;
      const label =
        separatorIndex >= 0
          ? wikiTarget.slice(separatorIndex + 1).trim()
          : rawTarget;

      if (rawTarget.toLowerCase().startsWith("forge:")) {
        const [, entityType, entityId] = rawTarget.split(":");
        const route =
          entityType && entityId
            ? isEmbed && entityType === "artifact"
              ? getArtifactHumanDownloadRoute(entityId)
              : getEntityRoute(entityType as CrudEntityType, entityId)
            : null;
        const href = route ? resolveForgeHref(route) : null;
        nodes.push(
          href ? (
            <a
              key={`${keyPrefix}-forge-${index}`}
              href={href}
              className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-[var(--warning)]/20 bg-[var(--ui-warning-soft)] px-2 py-0.5 text-[0.9em] text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)] transition hover:bg-[var(--ui-surface-3)]"
            >
              <span className="shrink-0 text-[0.72em] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                Forge
              </span>
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                {label}
              </span>
            </a>
          ) : (
            <span
              key={`${keyPrefix}-forge-${index}`}
              className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-[var(--ui-surface-2)] px-2 py-0.5 text-[0.9em] text-[var(--ui-ink-soft)]"
            >
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                {label}
              </span>
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
              "inline-flex min-w-0 max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[0.9em] transition",
              isEmbed
                ? "border border-[var(--info)]/20 bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_78%,var(--ui-ink-strong)_22%)] hover:bg-[var(--ui-surface-3)]"
                : "bg-[var(--ui-surface-2)] text-[var(--secondary)] hover:bg-[var(--ui-surface-3)]"
            )}
          >
            {isEmbed ? (
              <span className="shrink-0 text-[0.72em] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                Embed
              </span>
            ) : null}
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
              {label}
            </span>
          </a>
        );
      }
    } else if (match[3] && match[4]) {
      const link = resolveSafeMarkdownHref(match[4]);
      nodes.push(
        link ? (
          <a
            key={`${keyPrefix}-link-${index}`}
            href={link.href}
            className="break-words text-[var(--secondary)] underline decoration-current/35 underline-offset-4 transition hover:text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]"
            target={link.external ? "_blank" : undefined}
            rel={link.external ? "noopener noreferrer" : undefined}
          >
            {match[3]}
          </a>
        ) : (
          <span
            key={`${keyPrefix}-blocked-link-${index}`}
            className="break-words text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]"
          >
            {match[3]}
          </span>
        )
      );
    } else if (match[5]) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${index}`}
          className="rounded bg-[var(--ui-surface-2)] px-1.5 py-0.5 text-[0.92em] text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]"
        >
          {match[5]}
        </code>
      );
    } else if (match[6]) {
      nodes.push(
        <strong
          key={`${keyPrefix}-strong-${index}`}
          className="font-semibold text-[var(--ui-ink-strong)]"
        >
          {match[6]}
        </strong>
      );
    } else if (match[7]) {
      nodes.push(
        <em
          key={`${keyPrefix}-em-${index}`}
          className="italic text-[var(--ui-ink-medium)]"
        >
          {match[7]}
        </em>
      );
    }

    lastIndex = pattern.lastIndex;
    index += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(
      <Fragment key={`${keyPrefix}-tail-${index}`}>
        {text.slice(lastIndex)}
      </Fragment>
    );
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
      while (
        index < lines.length &&
        !(lines[index] ?? "").trim().startsWith("```")
      ) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      blocks.push(
        <pre
          key={`code-${index}`}
          className="max-w-full overflow-x-auto rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-xs leading-6 text-[var(--ui-ink-strong)]"
        >
          <code className="block min-w-0 whitespace-pre">
            {codeLines.join("\n")}
          </code>
        </pre>
      );
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const sizeClass =
        level === 1
          ? "text-xl"
          : level === 2
            ? "text-lg"
            : level === 3
              ? "text-base"
              : "text-sm";
      blocks.push(
        createElement(
          `h${level}`,
          {
            key: `heading-${index}`,
            className: cn(
              "font-semibold text-[var(--ui-ink-strong)]",
              sizeClass
            )
          },
          renderInline(headingMatch[2], `heading-${index}`)
        )
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
        <blockquote
          key={`quote-${index}`}
          className="min-w-0 border-l-2 border-[var(--secondary)]/50 pl-4 text-sm leading-7 text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]"
        >
          {renderInline(quoteLines.join(" "), `quote-${index}`)}
        </blockquote>
      );
      continue;
    }

    if (/^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const ordered = /^\d+\.\s+/.test(line);
      const items: string[] = [];
      while (
        index < lines.length &&
        (/^[-*+]\s+/.test(lines[index] ?? "") ||
          /^\d+\.\s+/.test(lines[index] ?? ""))
      ) {
        items.push(
          (lines[index] ?? "").replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "")
        );
        index += 1;
      }
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag
          key={`list-${index}`}
          className={cn(
            "min-w-0 space-y-1 pl-5 text-sm leading-7 text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]",
            ordered ? "list-decimal" : "list-disc"
          )}
        >
          {items.map((item, itemIndex) => (
            <li key={`item-${index}-${itemIndex}`} className="min-w-0">
              {renderInline(item, `list-${index}-${itemIndex}`)}
            </li>
          ))}
        </ListTag>
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index] ?? "";
      if (
        !candidate.trim() ||
        candidate.trim().startsWith("```") ||
        /^#{1,6}\s+/.test(candidate) ||
        /^>\s?/.test(candidate) ||
        /^[-*+]\s+/.test(candidate) ||
        /^\d+\.\s+/.test(candidate)
      ) {
        break;
      }
      paragraphLines.push(candidate.trim());
      index += 1;
    }

    blocks.push(
      <p
        key={`paragraph-${index}`}
        className="min-w-0 text-sm leading-7 text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]"
      >
        {renderInline(paragraphLines.join(" "), `paragraph-${index}`)}
      </p>
    );
  }

  return blocks;
}

export function NoteMarkdown({
  markdown,
  className
}: {
  markdown: string;
  className?: string;
}) {
  return (
    <div className={cn("grid min-w-0 max-w-full gap-3", className)}>
      {renderBlocks(markdown)}
    </div>
  );
}

const LONG_NOTE_CHARACTER_THRESHOLD = 560;
const LONG_NOTE_LINE_THRESHOLD = 8;

function buildNotePreview(markdown: string, plainText?: string) {
  const source = plainText?.trim() || markdown;
  const normalized = source.replace(/\s+/g, " ").trim();
  if (normalized.length <= LONG_NOTE_CHARACTER_THRESHOLD) {
    return normalized;
  }
  return `${normalized.slice(0, LONG_NOTE_CHARACTER_THRESHOLD - 1).trimEnd()}…`;
}

export function NoteMarkdownDisclosure({
  markdown,
  plainText,
  title,
  className
}: {
  markdown: string;
  plainText?: string;
  title: string;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const isLong =
    markdown.length > LONG_NOTE_CHARACTER_THRESHOLD ||
    markdown.replace(/\r/g, "").split("\n").length > LONG_NOTE_LINE_THRESHOLD;

  if (!isLong) {
    return <NoteMarkdown markdown={markdown} className={className} />;
  }

  return (
    <div className={cn("grid min-w-0 gap-3", className)}>
      {expanded ? (
        <div id={contentId}>
          <NoteMarkdown markdown={markdown} />
        </div>
      ) : (
        <p
          id={contentId}
          className="min-h-[5.25rem] min-w-0 text-sm leading-7 text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]"
        >
          {buildNotePreview(markdown, plainText)}
        </p>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-fit max-w-full"
        aria-expanded={expanded}
        aria-controls={contentId}
        aria-label={
          expanded ? `Show less of ${title}` : `Show full note: ${title}`
        }
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? (
          <ChevronUp className="size-4" />
        ) : (
          <ChevronDown className="size-4" />
        )}
        {expanded ? "Show less" : "Show full note"}
      </Button>
    </div>
  );
}
