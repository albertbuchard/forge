import { useState } from "react";
import { Link } from "react-router-dom";
import { FileStack, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-state";
import {
  WorkSectionNav,
  WorkStatusBadge,
  readable
} from "@/components/work/work-components";
import {
  DocumentSetDialog,
  PositioningProfileDialog,
  ReusableResponseDialog
} from "@/components/work/work-operational-dialogs";
import type { WorkRecord } from "@/lib/work-api";
import { SectionHeading } from "./work-page-overview";

export type DocumentsView = "positioning" | "documents" | "answers";

export function resolveDocumentsView(value: string | null): DocumentsView {
  return ["positioning", "documents", "answers"].includes(value ?? "")
    ? (value as DocumentsView)
    : "positioning";
}

export function DocumentsOperationalTab({
  view,
  profiles,
  documentSets,
  responses,
  mutationEnabled,
  userIds,
  onRefresh,
  onViewChange
}: {
  view: DocumentsView;
  profiles: WorkRecord[];
  documentSets: WorkRecord[];
  responses: WorkRecord[];
  mutationEnabled: boolean;
  userIds: string[];
  onRefresh: () => Promise<void>;
  onViewChange: (view: DocumentsView) => void;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<
    WorkRecord | undefined
  >();
  const [documentOpen, setDocumentOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<
    WorkRecord | undefined
  >();
  const [responseOpen, setResponseOpen] = useState(false);
  const [selectedResponse, setSelectedResponse] = useState<
    WorkRecord | undefined
  >();
  return (
    <div className="grid gap-7">
      <SectionHeading
        eyebrow="Documents"
        title="Prepare trustworthy application materials"
        description="Keep your positioning, document versions, and reviewed answers organized without showing every library at once."
        actions={
          <Link to="/artifacts">
            <Button variant="secondary">
              <FileStack className="size-4" />
              Open files
            </Button>
          </Link>
        }
      />
      <WorkSectionNav
        label="Document views"
        active={view}
        onChange={onViewChange}
        options={[
          {
            id: "positioning",
            label: "Positioning",
            description: "Role-specific profiles"
          },
          {
            id: "documents",
            label: "Documents",
            description: "CVs, letters, and portfolios"
          },
          {
            id: "answers",
            label: "Saved answers",
            description: "Reviewed reusable wording"
          }
        ]}
      />
      {view === "positioning" ? (
        <section className="grid gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-semibold text-[var(--ui-ink-strong)]">
                Positioning profiles
              </h3>
              <p className="mt-1 text-sm text-[var(--ui-ink-soft)]">
                Truthful variants for distinct role families, not duplicated
                biographies.
              </p>
            </div>
            <Button
              onClick={() => {
                setSelectedProfile(undefined);
                setProfileOpen(true);
              }}
              disabled={!mutationEnabled}
            >
              <Plus className="size-4" />
              Profile
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                onClick={() => {
                  setSelectedProfile(profile);
                  setProfileOpen(true);
                }}
                className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 text-left transition hover:bg-[var(--ui-surface-hover)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-[var(--ui-ink-strong)]">
                      {String(profile.title)}
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs text-[var(--ui-ink-soft)]">
                      {String(profile.headline ?? profile.summary ?? "")}
                    </div>
                  </div>
                  <WorkStatusBadge status={profile.approvalState} />
                </div>
                <div className="mt-3 text-xs text-[var(--ui-ink-faint)]">
                  {Array.isArray(profile.targetRoles)
                    ? profile.targetRoles.length
                    : 0}{" "}
                  target roles
                </div>
              </button>
            ))}
            {!profiles.length ? (
              <EmptyState
                title="No positioning profile"
                description="Create an evidence-linked profile for each materially different role family."
              />
            ) : null}
          </div>
        </section>
      ) : null}
      {view === "documents" ? (
        <section className="grid gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-semibold text-[var(--ui-ink-strong)]">
                Document sets
              </h3>
              <p className="mt-1 text-sm text-[var(--ui-ink-soft)]">
                Named bundles of the exact files you intend to use, with review
                and privacy state kept intact.
              </p>
            </div>
            <Button
              onClick={() => {
                setSelectedDocument(undefined);
                setDocumentOpen(true);
              }}
              disabled={!mutationEnabled}
            >
              <Plus className="size-4" />
              Document set
            </Button>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {documentSets.map((set) => (
              <Card key={set.id}>
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDocument(set);
                      setDocumentOpen(true);
                    }}
                    className="min-w-0 text-left"
                  >
                    <div className="truncate font-semibold text-[var(--ui-ink-strong)]">
                      {String(set.title)}
                    </div>
                    <div className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                      Version {String(set.version)} ·{" "}
                      {set.sealed ? "sealed" : "editable"} ·{" "}
                      {readable(set.confidentiality)}
                    </div>
                  </button>
                  <WorkStatusBadge status={set.approvalState} />
                </div>
                <div className="mt-4 grid gap-2">
                  {Array.isArray(set.artifactVersions)
                    ? set.artifactVersions.map((entry, index) => {
                        const artifact = entry as Record<string, unknown>;
                        return (
                          <Link
                            key={`${String(artifact.artifactId)}-${index}`}
                            to={`/artifacts/${String(artifact.artifactId)}`}
                            className="rounded-[15px] bg-[var(--ui-surface-2)] p-3"
                          >
                            <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                              {String(artifact.label ?? artifact.artifactId)}
                            </div>
                            <details className="mt-2 text-[10px] text-[var(--ui-ink-faint)]">
                              <summary className="cursor-pointer font-medium">
                                Technical details
                              </summary>
                              <div className="mt-1 truncate font-mono">
                                SHA-256 {String(artifact.contentSha256)}
                              </div>
                            </details>
                          </Link>
                        );
                      })
                    : null}
                  {!Array.isArray(set.artifactVersions) ||
                  !set.artifactVersions.length ? (
                    <p className="text-sm text-[var(--ui-ink-faint)]">
                      No file has been added. Open this set to add one.
                    </p>
                  ) : null}
                </div>
              </Card>
            ))}
            {!documentSets.length ? (
              <EmptyState
                title="No document set"
                description="Create a set and add the exact curriculum vitae, cover letter, portfolio, or supporting file versions you plan to use."
              />
            ) : null}
          </div>
        </section>
      ) : null}
      {view === "answers" ? (
        <section className="grid gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-semibold text-[var(--ui-ink-strong)]">
                Reusable answers
              </h3>
              <p className="mt-1 text-sm text-[var(--ui-ink-soft)]">
                Reviewed wording can be adapted; company-specific motivation
                should not be copied blindly.
              </p>
            </div>
            <Button
              onClick={() => {
                setSelectedResponse(undefined);
                setResponseOpen(true);
              }}
              disabled={!mutationEnabled}
            >
              <Plus className="size-4" />
              Answer
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {responses.map((response) => (
              <button
                key={response.id}
                type="button"
                onClick={() => {
                  setSelectedResponse(response);
                  setResponseOpen(true);
                }}
                className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 text-left"
              >
                <div className="line-clamp-2 font-medium text-[var(--ui-ink-strong)]">
                  {String(response.exactQuestion)}
                </div>
                <div className="mt-2 text-xs text-[var(--ui-ink-soft)]">
                  {readable(response.normalizedCategory)} ·{" "}
                  {readable(response.reviewState)} ·{" "}
                  {readable(response.sensitivity)}
                </div>
              </button>
            ))}
            {!responses.length ? (
              <p className="text-sm text-[var(--ui-ink-faint)]">
                No reviewed reusable response.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}
      <PositioningProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        userIds={userIds}
        profile={selectedProfile}
        onSaved={onRefresh}
      />
      <DocumentSetDialog
        open={documentOpen}
        onOpenChange={setDocumentOpen}
        userIds={userIds}
        profiles={profiles}
        documentSet={selectedDocument}
        onSaved={onRefresh}
      />
      <ReusableResponseDialog
        open={responseOpen}
        onOpenChange={setResponseOpen}
        userIds={userIds}
        response={selectedResponse}
        onSaved={onRefresh}
      />
    </div>
  );
}
