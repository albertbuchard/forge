import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ImagePlus,
  Link2,
  ListPlus,
  Network,
  PanelTop,
  Save,
  X
} from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  EntityLinkMultiSelect,
  type EntityLinkOption
} from "@/components/psyche/entity-link-multiselect";
import { useForgeShell } from "@/components/shell/app-shell";
import { WikiArticleMarkdown } from "@/components/wiki/wiki-article-markdown";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/page-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createWikiPage,
  getWikiPage,
  getWikiSettings,
  listWikiPages,
  patchWikiPage
} from "@/lib/api";
import type { EntityKind } from "@/lib/entity-visuals";
import type { CrudEntityType, Note } from "@/lib/types";

type WikiPageDraft = {
  pageId: string | null;
  kind: "wiki" | "evidence";
  title: string;
  slug: string;
  parentSlug: string | null;
  indexOrder: number;
  showInIndex: boolean;
  summary: string;
  aliasesText: string;
  contentMarkdown: string;
  author: string;
  tagsText: string;
  frontmatterText: string;
  linkedValues: string[];
};

type HelperDialogKind =
  | null
  | "wiki-link"
  | "forge-link"
  | "infobox"
  | "admonition"
  | "related"
  | "media";

const ENTITY_KIND_BY_TYPE: Partial<Record<CrudEntityType, EntityKind>> = {
  goal: "goal",
  project: "project",
  task: "task",
  strategy: "strategy",
  habit: "habit"
};

function encodeLinkedValue(entityType: CrudEntityType, entityId: string) {
  return `${entityType}:${entityId}`;
}

function decodeLinkedValue(
  value: string
): { entityType: CrudEntityType; entityId: string } | null {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) {
    return null;
  }
  return {
    entityType: value.slice(0, separatorIndex) as CrudEntityType,
    entityId: value.slice(separatorIndex + 1)
  };
}

function slugifyTitle(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseCsvList(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function safeParseFrontmatter(value: string) {
  if (!value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function createBlankDraft(): WikiPageDraft {
  return {
    pageId: null,
    kind: "wiki",
    title: "",
    slug: "",
    parentSlug: "index",
    indexOrder: 0,
    showInIndex: true,
    summary: "",
    aliasesText: "",
    contentMarkdown: "# Untitled\n\n",
    author: "",
    tagsText: "",
    frontmatterText: "{\n  \"status\": \"draft\"\n}",
    linkedValues: []
  };
}

function toDraft(page: Note): WikiPageDraft {
  return {
    pageId: page.id,
    kind: page.kind,
    title: page.title,
    slug: page.slug,
    parentSlug: page.parentSlug,
    indexOrder: page.indexOrder,
    showInIndex: page.showInIndex,
    summary: page.summary,
    aliasesText: page.aliases.join(", "),
    contentMarkdown: page.contentMarkdown,
    author: page.author ?? "",
    tagsText: (page.tags ?? []).join(", "),
    frontmatterText: JSON.stringify(page.frontmatter ?? {}, null, 2),
    linkedValues: page.links.map((link) =>
      encodeLinkedValue(link.entityType, link.entityId)
    )
  };
}

function HelperDialog({
  open,
  title,
  description,
  children,
  onOpenChange
}: {
  open: boolean;
  title: string;
  description: string;
  children: ReactNode;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgba(3,7,18,0.8)] backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-[12vh] z-50 w-[min(32rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-[24px] border border-white/10 bg-[rgba(10,15,28,0.96)] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-[1.05rem] font-semibold text-white">
                {title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-[13px] leading-6 text-white/56">
                {description}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-white/64 transition hover:bg-white/[0.08] hover:text-white"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>
          <div className="mt-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function WikiEditorPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pageId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState<WikiPageDraft>(() => createBlankDraft());
  const [helperDialog, setHelperDialog] = useState<HelperDialogKind>(null);
  const [helperValue, setHelperValue] = useState("");
  const [helperSecondaryValue, setHelperSecondaryValue] = useState("");
  const [helperEntityValue, setHelperEntityValue] = useState("");
  const [spacePickerOpen, setSpacePickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["forge-wiki-settings"],
    queryFn: getWikiSettings
  });

  const pageQuery = useQuery({
    queryKey: ["forge-wiki-page", pageId],
    queryFn: () => getWikiPage(pageId ?? ""),
    enabled: Boolean(pageId)
  });

  const activeSpaceId =
    searchParams.get("spaceId") ||
    pageQuery.data?.page.spaceId ||
    settingsQuery.data?.settings.spaces[0]?.id ||
    "";

  const pagesQuery = useQuery({
    queryKey: ["forge-wiki-pages", activeSpaceId],
    queryFn: () =>
      listWikiPages({
        spaceId: activeSpaceId || undefined,
        limit: 500
      }),
    enabled: Boolean(activeSpaceId)
  });

  useEffect(() => {
    if (!pageQuery.data?.page) {
      return;
    }
    setDraft(toDraft(pageQuery.data.page));
  }, [pageQuery.data]);

  const wikiPageOptions = useMemo(
    () =>
      (pagesQuery.data?.pages ?? [])
        .filter((page) => page.id !== draft.pageId)
        .sort((left, right) => left.title.localeCompare(right.title)),
    [draft.pageId, pagesQuery.data?.pages]
  );

  const entityOptions = useMemo<EntityLinkOption[]>(() => {
    const goals = shell.snapshot.goals.map((goal) => ({
      value: encodeLinkedValue("goal", goal.id),
      label: goal.title,
      description: goal.description,
      searchText: `${goal.title} ${goal.description}`,
      kind: ENTITY_KIND_BY_TYPE.goal
    }));
    const projects = shell.snapshot.dashboard.projects.map((project) => ({
      value: encodeLinkedValue("project", project.id),
      label: project.title,
      description: [project.goalTitle, project.description].filter(Boolean).join(" · "),
      searchText: `${project.title} ${project.goalTitle} ${project.description}`,
      kind: ENTITY_KIND_BY_TYPE.project
    }));
    const tasks = shell.snapshot.tasks.map((task) => ({
      value: encodeLinkedValue("task", task.id),
      label: task.title,
      description: task.owner || task.description,
      searchText: `${task.title} ${task.owner} ${task.description}`,
      kind: ENTITY_KIND_BY_TYPE.task
    }));
    const strategies = shell.snapshot.strategies.map((strategy) => ({
      value: encodeLinkedValue("strategy", strategy.id),
      label: strategy.title,
      description: strategy.overview,
      searchText: `${strategy.title} ${strategy.overview} ${strategy.endStateDescription}`,
      kind: ENTITY_KIND_BY_TYPE.strategy
    }));
    const habits = shell.snapshot.habits.map((habit) => ({
      value: encodeLinkedValue("habit", habit.id),
      label: habit.title,
      description: habit.description,
      searchText: `${habit.title} ${habit.description}`,
      kind: ENTITY_KIND_BY_TYPE.habit
    }));

    return [...goals, ...projects, ...tasks, ...strategies, ...habits].sort(
      (left, right) => left.label.localeCompare(right.label)
    );
  }, [
    shell.snapshot.dashboard.projects,
    shell.snapshot.goals,
    shell.snapshot.habits,
    shell.snapshot.strategies,
    shell.snapshot.tasks
  ]);

  function insertIntoMarkdown(snippet: string) {
    const textarea = textareaRef.current;
    setDraft((current) => {
      const base = current.contentMarkdown;
      if (!textarea) {
        return {
          ...current,
          contentMarkdown: `${base}${base.endsWith("\n") ? "" : "\n"}${snippet}`
        };
      }
      const start = textarea.selectionStart ?? base.length;
      const end = textarea.selectionEnd ?? base.length;
      const nextMarkdown = `${base.slice(0, start)}${snippet}${base.slice(end)}`;
      requestAnimationFrame(() => {
        textarea.focus();
        const nextPosition = start + snippet.length;
        textarea.setSelectionRange(nextPosition, nextPosition);
      });
      return {
        ...current,
        contentMarkdown: nextMarkdown
      };
    });
  }

  const saveMutation = useMutation({
    mutationFn: async (current: WikiPageDraft) => {
      const payload = {
        kind: current.kind,
        title: current.title.trim(),
        slug: current.slug.trim() || slugifyTitle(current.title),
        parentSlug:
          current.parentSlug && current.parentSlug !== "none"
            ? current.parentSlug
            : null,
        indexOrder: current.indexOrder,
        showInIndex: current.showInIndex,
        summary: current.summary.trim(),
        aliases: parseCsvList(current.aliasesText),
        contentMarkdown: current.contentMarkdown.trim(),
        author: current.author.trim() || null,
        tags: parseCsvList(current.tagsText),
        spaceId: activeSpaceId,
        frontmatter: safeParseFrontmatter(current.frontmatterText),
        links: current.linkedValues
          .map((value) => decodeLinkedValue(value))
          .filter(
            (value): value is { entityType: CrudEntityType; entityId: string } =>
              value !== null
          )
      };

      return current.pageId
        ? patchWikiPage(current.pageId, payload)
        : createWikiPage(payload);
    },
    onSuccess: async (payload) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-wiki-pages"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-wiki-page"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-wiki-home"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-wiki-page-by-slug"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-wiki-tree"] })
      ]);
      navigate({
        pathname:
          payload.page.slug === "index"
            ? "/wiki"
            : `/wiki/page/${encodeURIComponent(payload.page.slug)}`,
        search: `?spaceId=${encodeURIComponent(payload.page.spaceId)}`
      });
    }
  });

  if (settingsQuery.isLoading || (pageId && pageQuery.isLoading)) {
    return (
      <LoadingState
        eyebrow="Wiki editor"
        title="Preparing the editor"
        description="Loading the draft, hierarchy, and link helpers."
      />
    );
  }

  if (settingsQuery.isError || pageQuery.isError || pagesQuery.isError) {
    return (
      <ErrorState
        eyebrow="Wiki editor"
        error={settingsQuery.error ?? pageQuery.error ?? pagesQuery.error}
        onRetry={() => {
          void settingsQuery.refetch();
          void pageQuery.refetch();
          void pagesQuery.refetch();
        }}
      />
    );
  }

  if (pageId && !pageQuery.data?.page) {
    return (
      <EmptyState
        eyebrow="Wiki editor"
        title="Page not found"
        description="This wiki entry does not exist anymore."
      />
    );
  }

  const helperButtons = [
    { kind: "wiki-link" as const, icon: Link2, label: "Wiki link" },
    { kind: "forge-link" as const, icon: Network, label: "Forge link" },
    { kind: "infobox" as const, icon: PanelTop, label: "Infobox" },
    { kind: "admonition" as const, icon: AlertTriangle, label: "Admonition" },
    { kind: "related" as const, icon: ListPlus, label: "Related" },
    { kind: "media" as const, icon: ImagePlus, label: "Media" }
  ];

  return (
    <>
      <div className="px-3 py-4 sm:px-5 lg:px-6">
        <div className="mx-auto flex w-full max-w-[1720px] flex-col gap-4">
        <section className="wiki-frame px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/42">
                Wiki editor
              </div>
              <h1 className="mt-1 text-[1.28rem] font-semibold tracking-[-0.04em] text-white">
                {draft.pageId ? "Edit page" : "New page"}
              </h1>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => navigate(-1)}>
                <ArrowLeft className="size-3.5" />
                Back
              </Button>
              <Button
                size="sm"
                pending={saveMutation.isPending}
                pendingLabel="Saving"
                disabled={!draft.title.trim() || !draft.contentMarkdown.trim()}
                onClick={() => void saveMutation.mutateAsync(draft)}
              >
                <Save className="size-3.5" />
                Save page
              </Button>
            </div>
          </div>
        </section>

        <section className="grid gap-4">
          <aside className="wiki-frame relative z-10 w-full max-w-[56rem] min-w-0 px-4 py-4 sm:px-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/42">
              Page metadata
            </div>

            <div className="mt-4 grid gap-3">
              <label className="grid gap-1.5">
                <span className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  Wiki space
                </span>
                <span className="text-[12px] leading-5 text-white/50">
                  The wiki collection this page belongs to.
                </span>
                <button
                  type="button"
                  className="flex min-h-[2.8rem] items-center justify-between gap-3 rounded-[16px] border border-white/8 bg-white/[0.04] px-3 text-[13px] text-white/78 transition hover:bg-white/[0.07] hover:text-white"
                  onClick={() => setSpacePickerOpen(true)}
                >
                  <span className="truncate">
                    {settingsQuery.data?.settings.spaces.find((space) => space.id === activeSpaceId)?.label ??
                      "Current space"}
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                    Change
                  </span>
                </button>
              </label>

              <label className="grid gap-1.5">
                <span className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  Title
                </span>
                <Input
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, title: event.target.value }))
                  }
                  placeholder="Page title"
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  Slug
                </span>
                <Input
                  value={draft.slug}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, slug: event.target.value }))
                  }
                  placeholder="page-slug"
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  Parent
                </span>
                <select
                  className="wiki-inline-select"
                  value={draft.parentSlug ?? "none"}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      parentSlug:
                        event.target.value === "none" ? null : event.target.value
                    }))
                  }
                >
                  <option value="none">No parent</option>
                  {wikiPageOptions.map((page) => (
                    <option key={page.id} value={page.slug}>
                      {page.title}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1.5">
                <span className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  Index order
                </span>
                <Input
                  type="number"
                  value={String(draft.indexOrder)}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      indexOrder: Number(event.target.value || 0)
                    }))
                  }
                />
              </label>

              <label className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-[13px] text-white/72">
                <input
                  type="checkbox"
                  checked={draft.showInIndex}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      showInIndex: event.target.checked
                    }))
                  }
                />
                Show in index
              </label>

              <label className="grid gap-1.5">
                <span className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  Summary
                </span>
                <Textarea
                  value={draft.summary}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, summary: event.target.value }))
                  }
                  rows={4}
                  placeholder="Short summary"
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  Aliases
                </span>
                <Input
                  value={draft.aliasesText}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      aliasesText: event.target.value
                    }))
                  }
                  placeholder="alias one, alias two"
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  Tags
                </span>
                <Input
                  value={draft.tagsText}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, tagsText: event.target.value }))
                  }
                  placeholder="design, product"
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  Author
                </span>
                <Input
                  value={draft.author}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, author: event.target.value }))
                  }
                  placeholder="Optional author"
                />
              </label>

              <div className="grid gap-1.5">
                <span className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  Forge entities
                </span>
                <EntityLinkMultiSelect
                  options={entityOptions}
                  selectedValues={draft.linkedValues}
                  onChange={(next) =>
                    setDraft((current) => ({ ...current, linkedValues: next }))
                  }
                  placeholder="Link Forge entities"
                />
              </div>

              <details className="rounded-[16px] border border-white/8 bg-white/[0.03]">
                <summary className="cursor-pointer list-none px-3 py-2.5 text-[12px] font-medium uppercase tracking-[0.14em] text-white/54">
                  Advanced metadata
                </summary>
                <div className="border-t border-white/8 px-3 pb-3 pt-3">
                  <label className="grid gap-1.5">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                      Frontmatter JSON
                    </span>
                    <Textarea
                      value={draft.frontmatterText}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          frontmatterText: event.target.value
                        }))
                      }
                      rows={8}
                      className="font-mono text-[12px]"
                    />
                  </label>
                </div>
              </details>
            </div>
          </aside>

          <div className="grid min-w-0 gap-4">
            <section className="wiki-frame min-w-0 overflow-hidden">
              <div className="border-b border-white/8 px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                {helperButtons.map((button) => {
                  const Icon = button.icon;
                  return (
                    <button
                      key={button.kind}
                      type="button"
                      title={button.label}
                      className="rounded-xl border border-white/8 bg-white/[0.03] p-2 text-white/62 transition hover:bg-white/[0.08] hover:text-white"
                      onClick={() => {
                        setHelperDialog(button.kind);
                        setHelperValue("");
                        setHelperSecondaryValue("");
                        setHelperEntityValue("");
                      }}
                    >
                      <Icon className="size-4" />
                    </button>
                  );
                })}
                </div>
              </div>
              <div className="min-w-0 px-0">
                <Textarea
                  ref={textareaRef}
                  value={draft.contentMarkdown}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      contentMarkdown: event.target.value
                    }))
                  }
                  rows={26}
                  className="min-h-[34rem] rounded-none border-0 bg-transparent px-5 py-4 font-mono text-[13px] leading-6 shadow-none outline-none focus-visible:ring-0 sm:px-6"
                  placeholder="Write the page in Markdown"
                />
              </div>
            </section>

            <section className="wiki-frame min-w-0 overflow-hidden px-4 py-5 sm:px-6">
              <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/42">
                Preview
              </div>
              <div className="wiki-reading-copy wiki-reading-flow mx-auto max-w-[76rem]">
                <WikiArticleMarkdown
                  markdown={draft.contentMarkdown}
                  spaceId={activeSpaceId}
                />
              </div>
            </section>
          </div>
        </section>
        </div>
      </div>

      <HelperDialog
        open={helperDialog === "wiki-link"}
        onOpenChange={(open) => !open && setHelperDialog(null)}
        title="Insert wiki link"
        description="Link another page in this wiki."
      >
        <div className="grid gap-3">
          <select
            className="wiki-inline-select"
            value={helperValue}
            onChange={(event) => setHelperValue(event.target.value)}
          >
            <option value="">Select a page</option>
            {wikiPageOptions.map((page) => (
              <option key={page.id} value={page.slug}>
                {page.title}
              </option>
            ))}
          </select>
          <Input
            value={helperSecondaryValue}
            onChange={(event) => setHelperSecondaryValue(event.target.value)}
            placeholder="Optional label"
          />
          <Button
            disabled={!helperValue}
            onClick={() => {
              insertIntoMarkdown(
                `[[${helperValue}${helperSecondaryValue.trim() ? `|${helperSecondaryValue.trim()}` : ""}]]`
              );
              setHelperDialog(null);
            }}
          >
            Insert
          </Button>
        </div>
      </HelperDialog>

      <HelperDialog
        open={helperDialog === "forge-link"}
        onOpenChange={(open) => !open && setHelperDialog(null)}
        title="Insert Forge link"
        description="Link a structured Forge entity inside the article."
      >
        <div className="grid gap-3">
          <select
            className="wiki-inline-select"
            value={helperEntityValue}
            onChange={(event) => setHelperEntityValue(event.target.value)}
          >
            <option value="">Select an entity</option>
            {entityOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Input
            value={helperSecondaryValue}
            onChange={(event) => setHelperSecondaryValue(event.target.value)}
            placeholder="Optional label"
          />
          <Button
            disabled={!helperEntityValue}
            onClick={() => {
              const [entityType, entityId] = helperEntityValue.split(":");
              insertIntoMarkdown(
                `[[forge:${entityType}:${entityId}${
                  helperSecondaryValue.trim() ? `|${helperSecondaryValue.trim()}` : ""
                }]]`
              );
              setHelperDialog(null);
            }}
          >
            Insert
          </Button>
        </div>
      </HelperDialog>

      <HelperDialog
        open={helperDialog === "infobox"}
        onOpenChange={(open) => !open && setHelperDialog(null)}
        title="Insert infobox"
        description="Create the article metadata box rendered beside the intro."
      >
        <div className="grid gap-3">
          <Button
            onClick={() => {
              insertIntoMarkdown(
                `:::forge-infobox\nTitle: ${draft.title || "Article title"}\nSummary: ${draft.summary || "Short summary"}\nTags: ${draft.tagsText || "tag-one, tag-two"}\nRelated: [[index|Home]]\n:::\n`
              );
              setHelperDialog(null);
            }}
          >
            Insert infobox
          </Button>
        </div>
      </HelperDialog>

      <HelperDialog
        open={helperDialog === "admonition"}
        onOpenChange={(open) => !open && setHelperDialog(null)}
        title="Insert admonition"
        description="Add a callout block inside the article."
      >
        <div className="grid gap-3">
          <select
            className="wiki-inline-select"
            value={helperValue}
            onChange={(event) => setHelperValue(event.target.value)}
          >
            <option value="">Select type</option>
            <option value="note">Note</option>
            <option value="tip">Tip</option>
            <option value="warning">Warning</option>
            <option value="danger">Danger</option>
          </select>
          <Textarea
            value={helperSecondaryValue}
            onChange={(event) => setHelperSecondaryValue(event.target.value)}
            rows={4}
            placeholder="Admonition text"
          />
          <Button
            disabled={!helperValue || !helperSecondaryValue.trim()}
            onClick={() => {
              insertIntoMarkdown(
                `:::${helperValue}\n${helperSecondaryValue.trim()}\n:::\n`
              );
              setHelperDialog(null);
            }}
          >
            Insert admonition
          </Button>
        </div>
      </HelperDialog>

      <HelperDialog
        open={helperDialog === "related"}
        onOpenChange={(open) => !open && setHelperDialog(null)}
        title="Insert related block"
        description="Add an explicit related-pages block."
      >
        <div className="grid gap-3">
          <Textarea
            value={helperSecondaryValue}
            onChange={(event) => setHelperSecondaryValue(event.target.value)}
            rows={5}
            placeholder={"[[page-one]]\n[[page-two|Readable label]]"}
          />
          <Button
            disabled={!helperSecondaryValue.trim()}
            onClick={() => {
              insertIntoMarkdown(`:::forge-related\n${helperSecondaryValue.trim()}\n:::\n`);
              setHelperDialog(null);
            }}
          >
            Insert related block
          </Button>
        </div>
      </HelperDialog>

      <HelperDialog
        open={helperDialog === "media"}
        onOpenChange={(open) => !open && setHelperDialog(null)}
        title="Insert media block"
        description="Reference media or assets in a structured block."
      >
        <div className="grid gap-3">
          <Textarea
            value={helperSecondaryValue}
            onChange={(event) => setHelperSecondaryValue(event.target.value)}
            rows={5}
            placeholder={"Image: /path/to/file.png\nCaption: Inspiration frame"}
          />
          <Button
            disabled={!helperSecondaryValue.trim()}
            onClick={() => {
              insertIntoMarkdown(`:::forge-media\n${helperSecondaryValue.trim()}\n:::\n`);
              setHelperDialog(null);
            }}
          >
            Insert media block
          </Button>
        </div>
      </HelperDialog>

      <Dialog.Root open={spacePickerOpen} onOpenChange={setSpacePickerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgba(3,7,18,0.72)] backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-[14vh] z-50 w-[min(28rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-[28px] border border-white/10 bg-[rgba(10,15,28,0.97)] p-4 shadow-[0_32px_90px_rgba(0,0,0,0.45)] sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="font-display text-[1.2rem] tracking-[-0.04em] text-white">
                  Choose wiki space
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-[13px] leading-6 text-white/56">
                  Save this page into a different wiki space.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-white/64 transition hover:bg-white/[0.08] hover:text-white"
                  aria-label="Close space picker"
                >
                  <X className="size-4" />
                </button>
              </Dialog.Close>
            </div>

            <div className="mt-4 grid gap-2">
              {settingsQuery.data?.settings.spaces.map((space) => {
                const active = space.id === activeSpaceId;
                return (
                  <button
                    key={space.id}
                    type="button"
                    className={
                      active
                        ? "flex items-center justify-between gap-3 rounded-[22px] border border-[rgba(192,193,255,0.22)] bg-[rgba(192,193,255,0.12)] px-4 py-3 text-left text-white transition"
                        : "flex items-center justify-between gap-3 rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-3 text-left text-white/78 transition hover:bg-white/[0.06] hover:text-white"
                    }
                    onClick={() => {
                      const next = new URLSearchParams(searchParams);
                      next.set("spaceId", space.id);
                      setSearchParams(next, { replace: true });
                      setSpacePickerOpen(false);
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block text-[14px] font-semibold">
                        {space.label}
                      </span>
                      <span className="mt-1 block text-[12px] leading-5 text-white/52">
                        {space.description || `/${space.slug}`}
                      </span>
                    </span>
                    {active ? (
                      <Check className="size-4 shrink-0 text-[var(--primary)]" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
