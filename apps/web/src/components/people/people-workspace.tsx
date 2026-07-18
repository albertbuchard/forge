import { useEffect, useState } from "react";
import { UserRoundSearch } from "lucide-react";
import { PeopleCollection } from "@/components/people/people-collection";
import { PeopleRequestsInbox } from "@/components/people/people-requests-inbox";
import { PersonDetail } from "@/components/people/person-detail";
import { PersonEditorFlow } from "@/components/people/person-editor-flow";
import { WikiPeopleImportFlow } from "@/components/people/wiki-people-import-flow";
import type { PersonContext } from "@/components/people/people-types";

const DESKTOP_WORKSPACE_QUERY = "(min-width: 1024px)";

export function useDesktopPeopleWorkspace() {
  const [desktop, setDesktop] = useState(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return true;
    }
    return window.matchMedia(DESKTOP_WORKSPACE_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia(DESKTOP_WORKSPACE_QUERY);
    const update = (event: MediaQueryListEvent) => setDesktop(event.matches);
    setDesktop(media.matches);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  return desktop;
}

export function PeopleWorkspace({
  selectedPersonId,
  onNavigatePerson,
  onNavigateCollection
}: {
  selectedPersonId: string | null;
  onNavigatePerson: (personId: string) => void;
  onNavigateCollection: () => void;
}) {
  const desktop = useDesktopPeopleWorkspace();
  const [addFlowOpen, setAddFlowOpen] = useState(false);
  const [wikiImportOpen, setWikiImportOpen] = useState(false);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const showCollection = desktop || !selectedPersonId;
  const showDetail = Boolean(selectedPersonId);

  return (
    <div className="min-h-full bg-[var(--ui-bg)] text-[var(--ui-ink-strong)]">
      {showCollection ? (
        <PeopleRequestsInbox
          open={requestsOpen}
          onOpenChange={setRequestsOpen}
          onOpenPerson={onNavigatePerson}
        />
      ) : null}

      <div
        className={
          desktop
            ? "grid min-h-[36rem] grid-cols-[minmax(22rem,26rem)_minmax(0,1fr)] divide-x divide-[var(--ui-border-subtle)]"
            : "min-h-[36rem]"
        }
      >
        {showCollection ? (
          <aside className="min-w-0" aria-label="People collection">
            <PeopleCollection
              selectedPersonId={selectedPersonId}
              onSelectPerson={onNavigatePerson}
              onAddPerson={() => setAddFlowOpen(true)}
              onImportFromWiki={() => setWikiImportOpen(true)}
            />
          </aside>
        ) : null}

        {showDetail && selectedPersonId ? (
          <main className="min-w-0" aria-label="Person detail">
            <PersonDetail
              personId={selectedPersonId}
              headingLevel={desktop ? 2 : 1}
              onBack={desktop ? undefined : onNavigateCollection}
              onNavigatePerson={onNavigatePerson}
            />
          </main>
        ) : desktop ? (
          <main
            className="grid min-h-[36rem] place-items-center bg-[var(--ui-bg)] p-8 text-center"
            aria-label="Person detail"
          >
            <div className="max-w-md">
              <UserRoundSearch
                className="mx-auto size-9 text-[var(--ui-ink-faint)]"
                aria-hidden="true"
              />
              <h2 className="mt-3 text-lg font-semibold text-[var(--ui-ink-strong)]">
                Select a Person
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-muted)]">
                Choose someone to view their details.
              </p>
            </div>
          </main>
        ) : null}
      </div>

      <PersonEditorFlow
        open={addFlowOpen}
        context={null}
        onOpenChange={setAddFlowOpen}
        onSaved={(context: PersonContext) => {
          setAddFlowOpen(false);
          onNavigatePerson(context.person.id);
        }}
      />
      <WikiPeopleImportFlow
        open={wikiImportOpen}
        onOpenChange={setWikiImportOpen}
        onImported={(contexts) => {
          setWikiImportOpen(false);
          if (contexts[0]) {
            onNavigatePerson(contexts[0].person.id);
          }
        }}
      />
    </div>
  );
}
