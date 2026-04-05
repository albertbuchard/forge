import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { getEntityRoute } from "@/lib/note-helpers";
import { resolveForgePath } from "@/lib/runtime-paths";
import {
  parseWikiInline,
  parseWikiMarkup,
  type WikiContentBlock,
  type WikiInfoboxData,
  type WikiInlineToken
} from "@/lib/wiki-markup";
import { cn } from "@/lib/utils";

function renderInlineTokens(
  tokens: WikiInlineToken[],
  keyPrefix: string,
  spaceId?: string
): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (token.type) {
      case "text":
        return <Fragment key={key}>{token.value}</Fragment>;
      case "code":
        return (
          <code
            key={key}
            className="rounded bg-black/10 px-1.5 py-0.5 font-mono text-[0.92em] text-white"
          >
            {token.value}
          </code>
        );
      case "strong":
        return (
          <strong key={key} className="font-semibold text-white">
            {token.value}
          </strong>
        );
      case "em":
        return (
          <em key={key} className="italic text-white/82">
            {token.value}
          </em>
        );
      case "link": {
        const external = /^https?:\/\//i.test(token.href);
        return (
          <a
            key={key}
            href={token.href}
            target={external ? "_blank" : undefined}
            rel={external ? "noreferrer" : undefined}
            className="text-[var(--secondary)] underline decoration-current/30 underline-offset-2 transition hover:text-white"
          >
            {token.label}
          </a>
        );
      }
      case "forge-link": {
        const route = getEntityRoute(token.entityType as never, token.entityId);
        const href = route ? resolveForgePath(route) : null;
        return href ? (
          <a
            key={key}
            href={href}
            className="rounded-sm bg-white/[0.08] px-1.5 py-0.5 text-white no-underline ring-1 ring-black/5 transition hover:bg-white/[0.12]"
          >
            {token.label}
          </a>
        ) : (
          <span
            key={key}
            className="rounded-sm bg-white/[0.08] px-1.5 py-0.5 text-white/64"
          >
            {token.label}
          </span>
        );
      }
      case "wiki-link":
        return (
          <Link
            key={key}
            to={{
              pathname: `/wiki/page/${encodeURIComponent(token.target)}`,
              search: spaceId ? `?spaceId=${encodeURIComponent(spaceId)}` : ""
            }}
            className={cn(
              "underline decoration-current/30 underline-offset-2 transition hover:text-white",
              token.embed
                ? "text-[var(--primary)]"
                : "text-[var(--secondary)]"
            )}
          >
            {token.label}
          </Link>
        );
    }
  });
}

function renderInline(text: string, keyPrefix: string, spaceId?: string) {
  return renderInlineTokens(parseWikiInline(text), keyPrefix, spaceId);
}

function renderDirectiveList(lines: string[], spaceId?: string) {
  const items = lines.map((line) => line.trim()).filter(Boolean);
  if (items.length === 0) {
    return null;
  }
  return (
    <ul className="space-y-1.5 pl-4 text-[13px] leading-6 text-white/76">
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{renderInline(item, `directive-${index}`, spaceId)}</li>
      ))}
    </ul>
  );
}

function renderBlock(block: WikiContentBlock, index: number, spaceId?: string) {
  switch (block.type) {
    case "heading": {
      const sizeClass =
        block.level === 1
          ? "text-[1.9rem] leading-[1.08]"
          : block.level === 2
            ? "text-[1.25rem] leading-[1.2]"
            : block.level === 3
              ? "text-[1.05rem] leading-[1.3]"
              : "text-[0.92rem] leading-[1.35]";
      return (
        <h2
          key={`heading-${index}`}
          className={cn(
            "font-semibold tracking-[-0.02em] text-white",
            index > 0 && "mt-6",
            sizeClass
          )}
        >
          {renderInline(block.text, `heading-${index}`, spaceId)}
        </h2>
      );
    }
    case "paragraph":
      return (
        <p key={`paragraph-${index}`} className="text-[14px] leading-7 text-white/78">
          {renderInline(block.text, `paragraph-${index}`, spaceId)}
        </p>
      );
    case "quote":
      return (
        <blockquote
          key={`quote-${index}`}
          className="border-l-[3px] border-white/16 pl-4 text-[14px] leading-7 text-white/62"
        >
          {renderInline(block.text, `quote-${index}`, spaceId)}
        </blockquote>
      );
    case "list": {
      const ListTag = block.ordered ? "ol" : "ul";
      return (
        <ListTag
          key={`list-${index}`}
          className={cn(
            "space-y-1.5 pl-5 text-[14px] leading-7 text-white/78",
            block.ordered ? "list-decimal" : "list-disc"
          )}
        >
          {block.items.map((item, itemIndex) => (
            <li key={`item-${index}-${itemIndex}`}>
              {renderInline(item, `list-${index}-${itemIndex}`, spaceId)}
            </li>
          ))}
        </ListTag>
      );
    }
    case "code":
      return (
        <pre
          key={`code-${index}`}
          className="overflow-x-auto rounded-xl bg-[rgba(10,16,30,0.9)] px-4 py-3 text-[12px] leading-6 text-white ring-1 ring-black/5"
        >
          <code>{block.code}</code>
        </pre>
      );
    case "admonition":
      return (
        <aside
          key={`admonition-${index}`}
          className={cn(
            "rounded-xl border px-4 py-3",
            block.kind === "warning" || block.kind === "danger"
              ? "border-amber-500/25 bg-amber-500/8"
              : "border-white/12 bg-white/[0.04]"
          )}
        >
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/48">
            {block.kind}
          </div>
          <div className="grid gap-2 text-[13px] leading-6 text-white/76">
            {block.lines.map((line, lineIndex) => (
              <p key={`admonition-line-${lineIndex}`}>
                {renderInline(line, `admonition-${index}-${lineIndex}`, spaceId)}
              </p>
            ))}
          </div>
        </aside>
      );
    case "forge-links":
    case "forge-media":
    case "forge-related":
      return (
        <section
          key={`${block.type}-${index}`}
          className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
        >
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/48">
            {block.type.replace("forge-", "")}
          </div>
          {renderDirectiveList(block.lines, spaceId)}
        </section>
      );
  }
}

function renderInfoboxValue(value: string, keyPrefix: string, spaceId?: string) {
  return (
    <div className="text-[13px] leading-6 text-white/76">
      {renderInline(value, keyPrefix, spaceId)}
    </div>
  );
}

export function WikiArticleInfobox({
  infobox,
  spaceId,
  className
}: {
  infobox: WikiInfoboxData;
  spaceId?: string;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        "wiki-infobox rounded-2xl border border-white/10 bg-white/[0.03] p-4",
        className
      )}
    >
      {infobox.title ? (
        <div className="text-[1rem] font-semibold leading-tight text-white">
          {infobox.title}
        </div>
      ) : null}
      {infobox.summary ? (
        <p className="mt-2 text-[13px] leading-6 text-white/60">
          {renderInline(infobox.summary, "infobox-summary", spaceId)}
        </p>
      ) : null}
      <dl className="mt-3 grid gap-2">
        {infobox.rows.map((row, index) => (
          <div
            key={`${row.label}-${index}`}
            className="grid gap-1 border-t border-white/10 pt-2 first:border-t-0 first:pt-0"
          >
            <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/48">
              {row.label}
            </dt>
            <dd>{renderInfoboxValue(row.value, `infobox-row-${index}`, spaceId)}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

function splitIntro(blocks: WikiContentBlock[]) {
  const intro: WikiContentBlock[] = [];
  const rest: WikiContentBlock[] = [];
  let introDone = false;

  for (const block of blocks) {
    if (!introDone && block.type === "heading" && block.level <= 2 && intro.length > 0) {
      introDone = true;
    }
    if (introDone) {
      rest.push(block);
    } else {
      intro.push(block);
    }
  }

  return {
    intro: intro.length > 0 ? intro : blocks.slice(0, 1),
    rest: intro.length > 0 ? rest : blocks.slice(1)
  };
}

export function WikiArticleMarkdown({
  markdown,
  spaceId,
  className
}: {
  markdown: string;
  spaceId?: string;
  className?: string;
}) {
  const parsed = parseWikiMarkup(markdown);
  const { intro, rest } = splitIntro(parsed.blocks);

  return (
    <div className={cn("grid gap-4", className)}>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_19rem] xl:items-start">
        <div className="grid gap-4">
          {intro.map((block, index) => renderBlock(block, index, spaceId))}
        </div>
        {parsed.infobox ? (
          <WikiArticleInfobox
            infobox={parsed.infobox}
            spaceId={spaceId}
            className="order-2 xl:order-none"
          />
        ) : null}
      </div>

      {rest.length > 0 ? (
        <div className="grid gap-4">
          {rest.map((block, index) => renderBlock(block, index + intro.length, spaceId))}
        </div>
      ) : null}
    </div>
  );
}
