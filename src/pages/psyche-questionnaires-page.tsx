import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { SearchCheck, SlidersHorizontal } from "lucide-react";
import { FacetedTokenSearch, type FacetedTokenOption } from "@/components/search/faceted-token-search";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/page-state";
import { listQuestionnaires } from "@/lib/api";
import { cn } from "@/lib/utils";

function formatChipLabel(prefix: string, value: string) {
  return `${prefix}: ${value}`;
}

function buildFilterOptions(instruments: Awaited<ReturnType<typeof listQuestionnaires>>["instruments"]): FacetedTokenOption[] {
  const values = new Map<string, FacetedTokenOption>();

  for (const instrument of instruments) {
    const push = (id: string, label: string, description: string) => {
      if (!values.has(id)) {
        values.set(id, { id, label, description });
      }
    };

    for (const alias of instrument.aliases) {
      push(`alias:${alias}`, formatChipLabel("Alias", alias), "Filter by questionnaire alias.");
    }
    for (const domain of instrument.symptomDomains) {
      push(`domain:${domain}`, formatChipLabel("Domain", domain), "Filter by symptom domain.");
    }
    push(
      `source:${instrument.sourceClass}`,
      formatChipLabel("Source", instrument.sourceClass.replaceAll("_", " ")),
      "Filter by source and licence class."
    );
    push(
      `presentation:${instrument.presentationMode}`,
      formatChipLabel("Flow", instrument.presentationMode.replaceAll("_", " ")),
      "Filter by runner presentation mode."
    );
    push(
      `response:${instrument.responseStyle}`,
      formatChipLabel("Response", instrument.responseStyle.replaceAll("_", " ")),
      "Filter by response style."
    );
    push(
      `availability:${instrument.availability}`,
      formatChipLabel("Availability", instrument.availability.replaceAll("_", " ")),
      "Filter by availability."
    );
    push(
      `size:${instrument.itemCount >= 50 ? "long" : instrument.itemCount >= 15 ? "medium" : "short"}`,
      formatChipLabel(
        "Length",
        instrument.itemCount >= 50 ? "long" : instrument.itemCount >= 15 ? "medium" : "short"
      ),
      "Filter by approximate questionnaire length."
    );
    push(
      `self:${instrument.isSelfReport ? "self_report" : "other"}`,
      formatChipLabel("Type", instrument.isSelfReport ? "self report" : "other"),
      "Filter by self-report availability."
    );
  }

  return Array.from(values.values()).sort((left, right) =>
    left.label.localeCompare(right.label)
  );
}

function matchesSelectedFilters(
  selected: string[],
  instrument: Awaited<ReturnType<typeof listQuestionnaires>>["instruments"][number]
) {
  return selected.every((token) => {
    const [kind, rawValue] = token.split(":", 2);
    if (!kind || !rawValue) {
      return true;
    }
    switch (kind) {
      case "alias":
        return instrument.aliases.includes(rawValue);
      case "domain":
        return instrument.symptomDomains.includes(rawValue);
      case "source":
        return instrument.sourceClass === rawValue;
      case "presentation":
        return instrument.presentationMode === rawValue;
      case "response":
        return instrument.responseStyle === rawValue;
      case "availability":
        return instrument.availability === rawValue;
      case "size":
        return rawValue === "long"
          ? instrument.itemCount >= 50
          : rawValue === "medium"
            ? instrument.itemCount >= 15 && instrument.itemCount < 50
            : instrument.itemCount < 15;
      case "self":
        return rawValue === "self_report" ? instrument.isSelfReport : !instrument.isSelfReport;
      default:
        return true;
    }
  });
}

export function PsycheQuestionnairesPage() {
  const [query, setQuery] = useState("");
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const questionnairesQuery = useQuery({
    queryKey: ["forge-psyche-questionnaires"],
    queryFn: () => listQuestionnaires()
  });

  const instruments = questionnairesQuery.data?.instruments ?? [];
  const filterOptions = useMemo(
    () => buildFilterOptions(instruments),
    [instruments]
  );

  const filteredInstruments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return instruments.filter((instrument) => {
      const textMatch =
        normalizedQuery.length === 0 ||
        `${instrument.title} ${instrument.subtitle} ${instrument.description} ${instrument.aliases.join(" ")} ${instrument.symptomDomains.join(" ")} ${instrument.tags.join(" ")}`
          .toLowerCase()
          .includes(normalizedQuery);
      return textMatch && matchesSelectedFilters(selectedOptionIds, instrument);
    });
  }, [instruments, query, selectedOptionIds]);

  if (questionnairesQuery.isLoading) {
    return (
      <LoadingState
        eyebrow="Questionnaires"
        title="Loading the questionnaire library"
        description="Hydrating the seeded assessment catalog, versions, and latest run history."
      />
    );
  }

  if (questionnairesQuery.isError) {
    return (
      <ErrorState
        eyebrow="Questionnaires"
        error={questionnairesQuery.error}
        onRetry={() => void questionnairesQuery.refetch()}
      />
    );
  }

  return (
    <div className="grid gap-5">
      <PageHero
        eyebrow="Psyche"
        title="Questionnaires"
        description="Browse the seeded mental health questionnaire library, narrow it with facet chips, launch guided runs, and build your own versioned instruments."
        badge={`${instruments.length} instruments`}
        actions={
          <Link to="/psyche/questionnaires/new">
            <Button>Build questionnaire</Button>
          </Link>
        }
      />

      <PsycheSectionNav />

      <FacetedTokenSearch
        title="Questionnaire filters"
        description="Search by title or alias, then pin chips for symptom domain, source class, item count, response style, flow mode, self-report status, or availability."
        query={query}
        onQueryChange={setQuery}
        options={filterOptions}
        selectedOptionIds={selectedOptionIds}
        onSelectedOptionIdsChange={setSelectedOptionIds}
        resultSummary={`${filteredInstruments.length} of ${instruments.length} questionnaires visible`}
      />

      {filteredInstruments.length === 0 ? (
        <EmptyState
          eyebrow="Questionnaire library"
          title="No questionnaires match the current filters"
          description="Clear one or two chips and the seeded catalog will come back into view."
        />
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          {filteredInstruments.map((instrument) => (
            <Card
              key={instrument.id}
              className="min-w-0 overflow-hidden border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]"
            >
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="break-words font-label text-[11px] uppercase tracking-[0.18em] text-[var(--tertiary)] [overflow-wrap:anywhere]">
                    {instrument.subtitle || "Questionnaire"}
                  </div>
                  <h2 className="mt-3 break-words font-display text-[clamp(1.35rem,2vw,1.9rem)] leading-tight text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]">
                    {instrument.title}
                  </h2>
                  <p className="mt-3 break-words text-sm leading-6 text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
                    {instrument.description}
                  </p>
                </div>
                <div className="min-w-[8.5rem] rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-3 text-left sm:text-right">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                    Latest
                  </div>
                  <div className="mt-2 break-words text-sm text-[var(--ui-ink-medium)]">
                    {instrument.latestRunAt
                      ? new Date(instrument.latestRunAt).toLocaleDateString()
                      : "Not taken yet"}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                  {instrument.itemCount} items
                </Badge>
                <Badge className="bg-[color-mix(in_srgb,var(--success)_12%,var(--ui-surface-1)_88%)] text-[color-mix(in_srgb,var(--success)_68%,var(--ui-ink-strong)_32%)]">
                  {instrument.presentationMode.replaceAll("_", " ")}
                </Badge>
                <Badge className="bg-[color-mix(in_srgb,var(--info)_12%,var(--ui-surface-1)_88%)] text-[color-mix(in_srgb,var(--info)_68%,var(--ui-ink-strong)_32%)]">
                  {instrument.responseStyle.replaceAll("_", " ")}
                </Badge>
                <Badge className="bg-[color-mix(in_srgb,var(--primary)_12%,var(--ui-surface-1)_88%)] text-[color-mix(in_srgb,var(--primary)_68%,var(--ui-ink-strong)_32%)]">
                  {instrument.sourceClass.replaceAll("_", " ")}
                </Badge>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {instrument.symptomDomains.map((domain) => (
                  <Badge
                    key={`${instrument.id}-${domain}`}
                    className="max-w-full whitespace-normal break-words bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]"
                  >
                    {domain}
                  </Badge>
                ))}
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <div className="min-w-0 break-words rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-sm text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
                  {instrument.completedRunCount > 0
                    ? `${instrument.completedRunCount} completed runs saved in history`
                    : "No saved history yet"}
                </div>
                <Link to={`/psyche/questionnaires/${instrument.id}`}>
                  <Button variant="secondary" className="w-full sm:w-auto">
                    Open detail
                  </Button>
                </Link>
                <Link to={`/psyche/questionnaires/${instrument.id}/take`}>
                  <Button className="w-full sm:w-auto">Start guided run</Button>
                </Link>
              </div>
            </Card>
          ))}
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <Card className="min-w-0 border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]">
          <div className="flex items-center gap-3">
            <SearchCheck className="size-5 text-[var(--tertiary)]" />
            <div className="break-words font-display text-2xl text-[var(--ui-ink-strong)]">
              Seeded first wave
            </div>
          </div>
          <p className="mt-3 break-words text-sm leading-6 text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
            The current library ships a verified first wave: PHQ-9, GAD-7, WHO-5,
            PCL-5, AUDIT, SRQ-20, and YSQ-R, each stored in SQLite as a versioned
            definition with scoring and provenance.
          </p>
        </Card>

        <Card className="min-w-0 border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]">
          <div className="flex items-center gap-3">
            <SlidersHorizontal className="size-5 text-[var(--secondary)]" />
            <div className="break-words font-display text-2xl text-[var(--ui-ink-strong)]">
              Builder ready
            </div>
          </div>
          <p className="mt-3 break-words text-sm leading-6 text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
            System questionnaires stay read-only. Custom drafts can branch from
            any seed, edit structure and scoring JSON safely, and publish new
            immutable versions without rewriting past runs.
          </p>
          <div className="mt-4">
            <Link to="/psyche/questionnaires/new">
              <Button variant="secondary" className={cn("w-full sm:w-auto")}>
                Open builder
              </Button>
            </Link>
          </div>
        </Card>
      </section>
    </div>
  );
}
