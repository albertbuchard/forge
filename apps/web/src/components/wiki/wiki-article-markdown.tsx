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

const wikiCopyClass = "text-[var(--ui-ink-medium)]";
const wikiSoftCopyClass = "text-[var(--ui-ink-soft)]";
const wikiFaintCopyClass = "text-[var(--ui-ink-faint)]";
const wikiStrongCopyClass = "text-[var(--ui-ink-strong)]";
const wikiPanelClass =
  "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]";
const wikiMutedPanelClass =
  "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)]";
const wikiInlineTokenClass =
  "max-w-full break-words rounded-sm bg-[var(--ui-surface-2)] px-1.5 py-0.5 text-[var(--ui-ink-strong)] no-underline ring-1 ring-[var(--ui-border-subtle)] transition hover:bg-[var(--ui-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40";

export type WikiArticleLinkState = {
  rawTarget: string;
  label: string;
  isEmbed: boolean;
  status: "available" | "missing" | "unavailable" | "unverified";
  targetPage: {
    id: string;
    slug: string;
    spaceId: string;
  } | null;
  isSelfLink: boolean;
};

type WikiArticleLinkStateIndex = Map<string, WikiArticleLinkState>;

function wikiLinkStateKey(rawTarget: string, label: string, isEmbed: boolean) {
  return [
    isEmbed ? "embed" : "link",
    rawTarget.trim().toLowerCase(),
    label.trim()
  ].join("\u0000");
}

function findLinkState(
  index: WikiArticleLinkStateIndex,
  rawTarget: string,
  label: string,
  isEmbed: boolean
) {
  return index.get(wikiLinkStateKey(rawTarget, label, isEmbed));
}

function unavailableInlineLink(label: string, reason: string, key: string) {
  return (
    <span
      key={key}
      className="break-words rounded-sm bg-[var(--ui-warning-soft)] px-1.5 py-0.5 text-[var(--ui-ink-soft)] decoration-dashed underline underline-offset-2 ring-1 ring-[color-mix(in_srgb,var(--warning)_24%,var(--ui-border-subtle)_76%)]"
      title={reason}
      data-wiki-link-status="unavailable"
    >
      {label}
      <span className="sr-only"> ({reason})</span>
    </span>
  );
}

function renderInlineTokens(
  tokens: WikiInlineToken[],
  keyPrefix: string,
  spaceId: string | undefined,
  linkStateIndex: WikiArticleLinkStateIndex
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
            className="rounded bg-[var(--ui-surface-2)] px-1.5 py-0.5 font-mono text-[0.92em] text-[var(--ui-ink-strong)] ring-1 ring-[var(--ui-border-subtle)]"
          >
            {token.value}
          </code>
        );
      case "strong":
        return (
          <strong
            key={key}
            className="font-semibold text-[var(--ui-ink-strong)]"
          >
            {token.value}
          </strong>
        );
      case "em":
        return (
          <em key={key} className="italic text-[var(--ui-ink-medium)]">
            {token.value}
          </em>
        );
      case "link": {
        const external = /^https?:\/\//i.test(token.href);
        const internal = /^(?:\/|#|\.\.?\/)/.test(token.href);
        const email = /^mailto:/i.test(token.href);
        if (!external && !internal && !email) {
          return unavailableInlineLink(
            token.label,
            "Unsupported link target",
            key
          );
        }
        if (internal && !token.href.startsWith("#")) {
          return (
            <Link
              key={key}
              to={token.href}
              className="break-words text-[var(--secondary)] underline decoration-current/30 underline-offset-2 transition hover:text-[var(--ui-ink-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/35"
            >
              {token.label}
            </Link>
          );
        }
        return (
          <a
            key={key}
            href={token.href}
            target={external ? "_blank" : undefined}
            rel={external ? "noreferrer" : undefined}
            className="break-words text-[var(--secondary)] underline decoration-current/30 underline-offset-2 transition hover:text-[var(--ui-ink-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/35"
          >
            {token.label}
            {external ? (
              <span className="sr-only"> (opens in a new tab)</span>
            ) : null}
          </a>
        );
      }
      case "forge-link": {
        const rawTarget = `forge:${token.entityType}:${token.entityId}`;
        const state = findLinkState(
          linkStateIndex,
          rawTarget,
          token.label,
          false
        );
        const route = getEntityRoute(token.entityType as never, token.entityId);
        const href = route ? resolveForgePath(route) : null;
        if (state && state.status !== "unverified") {
          return unavailableInlineLink(
            token.label,
            "Forge entity unavailable",
            key
          );
        }
        return href ? (
          <a
            key={key}
            href={href}
            className={wikiInlineTokenClass}
            data-wiki-link-status="unverified"
          >
            {token.label}
          </a>
        ) : (
          unavailableInlineLink(
            token.label,
            "Forge entity route unavailable",
            key
          )
        );
      }
      case "wiki-link": {
        const state = findLinkState(
          linkStateIndex,
          token.target,
          token.label,
          token.embed
        );
        if (state && state.status !== "available") {
          return unavailableInlineLink(
            token.label,
            state.status === "missing"
              ? "Wiki page not found in this space"
              : "Wiki page unavailable",
            key
          );
        }
        const target = state?.targetPage?.slug ?? token.target;
        const targetSpaceId = state?.targetPage?.spaceId ?? spaceId;
        return (
          <Link
            key={key}
            to={{
              pathname:
                target === "index"
                  ? "/wiki"
                  : `/wiki/page/${encodeURIComponent(target)}`,
              search: targetSpaceId
                ? `?spaceId=${encodeURIComponent(targetSpaceId)}`
                : ""
            }}
            className={cn(
              "break-words underline decoration-current/30 underline-offset-2 transition hover:text-[var(--ui-ink-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/35",
              token.embed ? "text-[var(--primary)]" : "text-[var(--secondary)]"
            )}
            data-wiki-link-status="available"
          >
            {token.label}
            {state?.isSelfLink ? (
              <span className="sr-only"> (this page)</span>
            ) : null}
          </Link>
        );
      }
    }
  });
}

function renderInline(
  text: string,
  keyPrefix: string,
  spaceId: string | undefined,
  linkStateIndex: WikiArticleLinkStateIndex
) {
  return renderInlineTokens(
    parseWikiInline(text),
    keyPrefix,
    spaceId,
    linkStateIndex
  );
}

function renderDirectiveList(
  lines: string[],
  spaceId: string | undefined,
  linkStateIndex: WikiArticleLinkStateIndex
) {
  const items = lines.map((line) => line.trim()).filter(Boolean);
  if (items.length === 0) {
    return null;
  }
  return (
    <ul className={cn("space-y-1.5 pl-4 text-[13px] leading-6", wikiCopyClass)}>
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>
          {renderInline(item, `directive-${index}`, spaceId, linkStateIndex)}
        </li>
      ))}
    </ul>
  );
}

function renderBlock(
  block: WikiContentBlock,
  index: number,
  spaceId: string | undefined,
  linkStateIndex: WikiArticleLinkStateIndex
) {
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
            "font-semibold",
            wikiStrongCopyClass,
            index > 0 && "mt-6",
            sizeClass
          )}
        >
          {renderInline(
            block.text,
            `heading-${index}`,
            spaceId,
            linkStateIndex
          )}
        </h2>
      );
    }
    case "paragraph":
      return (
        <p
          key={`paragraph-${index}`}
          className={cn("text-[14px] leading-7", wikiCopyClass)}
        >
          {renderInline(
            block.text,
            `paragraph-${index}`,
            spaceId,
            linkStateIndex
          )}
        </p>
      );
    case "quote":
      return (
        <blockquote
          key={`quote-${index}`}
          className={cn(
            "border-l-[3px] border-[var(--ui-border-strong)] pl-4 text-[14px] leading-7",
            wikiSoftCopyClass
          )}
        >
          {renderInline(block.text, `quote-${index}`, spaceId, linkStateIndex)}
        </blockquote>
      );
    case "list": {
      const ListTag = block.ordered ? "ol" : "ul";
      return (
        <ListTag
          key={`list-${index}`}
          className={cn(
            "space-y-1.5 pl-5 text-[14px] leading-7",
            wikiCopyClass,
            block.ordered ? "list-decimal" : "list-disc"
          )}
        >
          {block.items.map((item, itemIndex) => (
            <li key={`item-${index}-${itemIndex}`}>
              {renderInline(
                item,
                `list-${index}-${itemIndex}`,
                spaceId,
                linkStateIndex
              )}
            </li>
          ))}
        </ListTag>
      );
    }
    case "code":
      return (
        <pre
          key={`code-${index}`}
          className="max-w-full overflow-x-auto rounded-xl border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-code)] px-4 py-3 text-[12px] leading-6 text-[var(--ui-ink-strong)]"
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
              ? "border-[color-mix(in_srgb,var(--warning)_32%,transparent)] bg-[var(--ui-warning-soft)]"
              : wikiMutedPanelClass
          )}
        >
          <div
            className={cn(
              "mb-2 text-[11px] font-semibold uppercase tracking-[0.16em]",
              wikiFaintCopyClass
            )}
          >
            {block.kind}
          </div>
          <div
            className={cn("grid gap-2 text-[13px] leading-6", wikiCopyClass)}
          >
            {block.lines.map((line, lineIndex) => (
              <p key={`admonition-line-${lineIndex}`}>
                {renderInline(
                  line,
                  `admonition-${index}-${lineIndex}`,
                  spaceId,
                  linkStateIndex
                )}
              </p>
            ))}
          </div>
        </aside>
      );
    case "forge-links":
    case "forge-media":
    case "forge-related": {
      const heading =
        block.type === "forge-links"
          ? "Citations and links"
          : block.type === "forge-related"
            ? "Related pages"
            : "Media";
      const headingId = `wiki-${block.type}-${index}`;
      return (
        <section
          key={`${block.type}-${index}`}
          className={cn("rounded-xl border px-4 py-3", wikiPanelClass)}
          aria-labelledby={headingId}
        >
          <div
            id={headingId}
            className={cn(
              "mb-2 text-[11px] font-semibold uppercase",
              wikiFaintCopyClass
            )}
          >
            {heading}
          </div>
          {renderDirectiveList(block.lines, spaceId, linkStateIndex)}
        </section>
      );
    }
  }
}

function renderInfoboxValue(
  value: string,
  keyPrefix: string,
  spaceId: string | undefined,
  linkStateIndex: WikiArticleLinkStateIndex
) {
  return (
    <div className={cn("text-[13px] leading-6", wikiCopyClass)}>
      {renderInline(value, keyPrefix, spaceId, linkStateIndex)}
    </div>
  );
}

export function WikiArticleInfobox({
  infobox,
  spaceId,
  linkStateIndex,
  className
}: {
  infobox: WikiInfoboxData;
  spaceId?: string;
  linkStateIndex: WikiArticleLinkStateIndex;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        "wiki-infobox rounded-2xl border p-4",
        wikiPanelClass,
        className
      )}
    >
      {infobox.title ? (
        <div className="text-[1rem] font-semibold leading-tight text-[var(--ui-ink-strong)]">
          {infobox.title}
        </div>
      ) : null}
      {infobox.summary ? (
        <p className="mt-2 text-[13px] leading-6 text-[var(--ui-ink-soft)]">
          {renderInline(
            infobox.summary,
            "infobox-summary",
            spaceId,
            linkStateIndex
          )}
        </p>
      ) : null}
      <dl className="mt-3 grid gap-2">
        {infobox.rows.map((row, index) => (
          <div
            key={`${row.label}-${index}`}
            className="grid gap-1 border-t border-[var(--ui-border-subtle)] pt-2 first:border-t-0 first:pt-0"
          >
            <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
              {row.label}
            </dt>
            <dd>
              {renderInfoboxValue(
                row.value,
                `infobox-row-${index}`,
                spaceId,
                linkStateIndex
              )}
            </dd>
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
    if (
      !introDone &&
      block.type === "heading" &&
      block.level <= 2 &&
      intro.length > 0
    ) {
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
  linkStates = [],
  className
}: {
  markdown: string;
  spaceId?: string;
  linkStates?: WikiArticleLinkState[];
  className?: string;
}) {
  const parsed = parseWikiMarkup(markdown);
  const { intro, rest } = splitIntro(parsed.blocks);
  const linkStateIndex = new Map(
    linkStates.map((state) => [
      wikiLinkStateKey(state.rawTarget, state.label, state.isEmbed),
      state
    ])
  );

  return (
    <div className={cn("grid gap-4", className)}>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_19rem] xl:items-start">
        <div className="grid gap-4">
          {intro.map((block, index) =>
            renderBlock(block, index, spaceId, linkStateIndex)
          )}
        </div>
        {parsed.infobox ? (
          <WikiArticleInfobox
            infobox={parsed.infobox}
            spaceId={spaceId}
            linkStateIndex={linkStateIndex}
            className="order-2 xl:order-none"
          />
        ) : null}
      </div>

      {rest.length > 0 ? (
        <div className="grid gap-4">
          {rest.map((block, index) =>
            renderBlock(block, index + intro.length, spaceId, linkStateIndex)
          )}
        </div>
      ) : null}
    </div>
  );
}
