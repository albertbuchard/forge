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
              className="overflow-hidden bg-[linear-gradient(180deg,rgba(16,24,34,0.97),rgba(10,16,24,0.95))]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[rgba(110,231,183,0.74)]">
                    {instrument.subtitle || "Questionnaire"}
                  </div>
                  <h2 className="mt-3 font-display text-[clamp(1.35rem,2vw,1.9rem)] leading-none text-white">
                    {instrument.title}
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-white/60">
                    {instrument.description}
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/[0.04] px-3 py-3 text-right">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                    Latest
                  </div>
                  <div className="mt-2 text-sm text-white/78">
                    {instrument.latestRunAt
                      ? new Date(instrument.latestRunAt).toLocaleDateString()
                      : "Not taken yet"}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Badge className="bg-white/[0.08] text-white/80">
                  {instrument.itemCount} items
                </Badge>
                <Badge className="bg-[rgba(110,231,183,0.12)] text-[rgba(187,247,208,0.9)]">
                  {instrument.presentationMode.replaceAll("_", " ")}
                </Badge>
                <Badge className="bg-[rgba(125,211,252,0.12)] text-sky-100/90">
                  {instrument.responseStyle.replaceAll("_", " ")}
                </Badge>
                <Badge className="bg-[rgba(192,193,255,0.12)] text-white/84">
                  {instrument.sourceClass.replaceAll("_", " ")}
                </Badge>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {instrument.symptomDomains.map((domain) => (
                  <Badge key={`${instrument.id}-${domain}`} className="bg-white/[0.05] text-white/66">
                    {domain}
                  </Badge>
                ))}
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/60">
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
        <Card className="bg-[linear-gradient(180deg,rgba(15,22,34,0.98),rgba(9,14,22,0.96))]">
          <div className="flex items-center gap-3">
            <SearchCheck className="size-5 text-[var(--tertiary)]" />
            <div className="font-display text-2xl text-white">
              Seeded first wave
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-white/62">
            The current library ships a verified first wave: PHQ-9, GAD-7, WHO-5,
            PCL-5, AUDIT, SRQ-20, and YSQ-R, each stored in SQLite as a versioned
            definition with scoring and provenance.
          </p>
        </Card>

        <Card className="bg-[linear-gradient(180deg,rgba(18,26,36,0.98),rgba(11,17,26,0.96))]">
          <div className="flex items-center gap-3">
            <SlidersHorizontal className="size-5 text-[var(--secondary)]" />
            <div className="font-display text-2xl text-white">
              Builder ready
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-white/62">
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
