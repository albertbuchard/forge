import { useEffect, useMemo, useState } from "react";
import {
  FlowField,
  QuestionFlowDialog
} from "@/components/flows/question-flow-dialog";
import type { QuestionFlowStep } from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createWorkSupportingRecord,
  updateWorkSupportingRecord
} from "@/lib/work-api";
import type { WorkRecord } from "@/lib/work-api";
import {
  provenance,
  lines,
  message,
  recordValue,
  Select,
  Check
} from "./work-operational-dialog-shared";
import {
  asArtifactReference,
  ArtifactVersionPicker
} from "./work-response-question-dialogs";
import type { WorkArtifactVersionReference } from "./work-response-question-dialogs";

type DocumentSetDraft = {
  title: string;
  version: string;
  profileId: string;
  approvalState: string;
  sealed: boolean;
  confidentiality: string;
  validFrom: string;
  validUntil: string;
  artifactVersions: WorkArtifactVersionReference[];
};

function documentSetDraft(value?: WorkRecord): DocumentSetDraft {
  return {
    title: String(value?.title ?? ""),
    version: String(value?.version ?? "1"),
    profileId: String(value?.profileId ?? ""),
    approvalState: String(value?.approvalState ?? "draft"),
    sealed: value?.sealed === true,
    confidentiality: String(value?.confidentiality ?? "private"),
    validFrom: String(value?.validFrom ?? ""),
    validUntil: String(value?.validUntil ?? ""),
    artifactVersions: Array.isArray(value?.artifactVersions)
      ? value.artifactVersions
          .map(asArtifactReference)
          .filter((entry): entry is WorkArtifactVersionReference =>
            Boolean(entry)
          )
      : []
  };
}

export function DocumentSetDialog({
  open,
  onOpenChange,
  userIds,
  profiles,
  documentSet,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  profiles: WorkRecord[];
  documentSet?: WorkRecord;
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(() => documentSetDraft(documentSet));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setDraft(documentSetDraft(documentSet));
  }, [documentSet, open]);
  const steps = useMemo<Array<QuestionFlowStep<DocumentSetDraft>>>(
    () => [
      {
        id: "identity",
        eyebrow: "Exact document set",
        title: documentSet
          ? "Version the document set"
          : "Create a document set",
        description:
          "A document set is a named, permissioned bundle of checksum-pinned Artifact versions for one positioning profile.",
        render: (value, setValue) => (
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="Title">
              <Input
                value={value.title}
                onChange={(event) => setValue({ title: event.target.value })}
                autoFocus
              />
            </FlowField>
            <FlowField label="Version">
              <Input
                type="number"
                min="1"
                value={value.version}
                onChange={(event) => setValue({ version: event.target.value })}
              />
            </FlowField>
            <Select
              label="Positioning profile"
              value={value.profileId}
              onChange={(profileId) => setValue({ profileId })}
            >
              <option value="">No profile</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {String(profile.title ?? profile.id)}
                </option>
              ))}
            </Select>
            <Select
              label="Approval state"
              value={value.approvalState}
              onChange={(approvalState) => setValue({ approvalState })}
            >
              {["draft", "reviewed", "approved", "retired"].map((option) => (
                <option key={option}>{option}</option>
              ))}
            </Select>
            <Select
              label="Confidentiality"
              value={value.confidentiality}
              onChange={(confidentiality) => setValue({ confidentiality })}
            >
              {["private", "restricted", "shareable"].map((option) => (
                <option key={option}>{option}</option>
              ))}
            </Select>
            <Check
              checked={value.sealed}
              onChange={(sealed) => setValue({ sealed })}
            >
              Seal this set against accidental editing after review.
            </Check>
            <FlowField label="Valid from">
              <Input
                type="date"
                value={value.validFrom}
                onChange={(event) =>
                  setValue({ validFrom: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Valid until">
              <Input
                type="date"
                value={value.validUntil}
                onChange={(event) =>
                  setValue({ validUntil: event.target.value })
                }
              />
            </FlowField>
          </div>
        )
      },
      {
        id: "artifacts",
        eyebrow: "Exact Artifact versions",
        title: "Which files belong to this version?",
        description:
          "The content checksum prevents a later file update from silently changing what was reviewed or submitted.",
        render: (value, setValue) => (
          <ArtifactVersionPicker
            value={value.artifactVersions}
            onChange={(artifactVersions) => setValue({ artifactVersions })}
          />
        )
      }
    ],
    [documentSet, profiles]
  );
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Documents"
      title={documentSet ? "Edit document set" : "Add document set"}
      description="Pin reusable documents to exact Artifact versions."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={
        documentSet ? "Save document-set revision" : "Add document set"
      }
      pending={pending}
      error={error}
      draftPersistenceKey={`work-document-set-${documentSet?.id ?? "new"}`}
      resolveContinueBlocker={(step) =>
        step === "identity" && !draft.title.trim()
          ? "Enter a document-set title."
          : null
      }
      onSubmit={async () => {
        setPending(true);
        setError(null);
        const data = {
          profileId: draft.profileId || null,
          title: draft.title,
          version: Number(draft.version),
          artifactVersions: draft.artifactVersions,
          targetProfile: {},
          approvalState: draft.approvalState,
          sealed: draft.sealed,
          confidentiality: draft.confidentiality,
          retentionPolicy: {},
          scopeProjectIds: [],
          scopeTagIds: [],
          validFrom: draft.validFrom || null,
          validUntil: draft.validUntil || null,
          provenance
        };
        try {
          if (documentSet)
            await updateWorkSupportingRecord(
              userIds,
              "documentSet",
              documentSet.id,
              { expectedRevision: Number(documentSet.revision), data }
            );
          else
            await createWorkSupportingRecord(userIds, "documentSet", { data });
          onOpenChange(false);
          await onSaved();
        } catch (caught) {
          setError(message(caught));
        } finally {
          setPending(false);
        }
      }}
    />
  );
}

type ProfileDraft = {
  title: string;
  headline: string;
  summary: string;
  targetRoles: string;
  skills: string;
  evidenceClaims: string;
  accomplishments: string;
  languages: string;
  publicLinks: string;
  preferredDefaultArtifactId: string;
  validFrom: string;
  validUntil: string;
  approvalState: string;
};

function profileDraft(value?: WorkRecord): ProfileDraft {
  const evidenceClaims = Array.isArray(value?.evidenceClaims)
    ? value.evidenceClaims.map(evidenceClaimLine).join("\n")
    : "";
  const accomplishments = Array.isArray(value?.accomplishments)
    ? value.accomplishments.map(evidenceClaimLine).join("\n")
    : "";
  const languages = Array.isArray(value?.languages)
    ? value.languages
        .map((entry) =>
          String(
            recordValue(entry).label ?? recordValue(entry).language ?? entry
          )
        )
        .join("\n")
    : "";
  const publicLinks = Array.isArray(value?.publicLinks)
    ? value.publicLinks
        .map(
          (entry) =>
            `${String(recordValue(entry).label ?? "Link")}|${String(recordValue(entry).url ?? "")}`
        )
        .join("\n")
    : "";
  return {
    title: String(value?.title ?? ""),
    headline: String(value?.headline ?? ""),
    summary: String(value?.summary ?? ""),
    targetRoles: Array.isArray(value?.targetRoles)
      ? value.targetRoles.map(String).join("\n")
      : "",
    skills: Array.isArray(value?.skills)
      ? value.skills.map(String).join("\n")
      : "",
    evidenceClaims,
    accomplishments,
    languages,
    publicLinks,
    preferredDefaultArtifactId: String(value?.preferredDefaultArtifactId ?? ""),
    validFrom: String(value?.validFrom ?? ""),
    validUntil: String(value?.validUntil ?? ""),
    approvalState: String(value?.approvalState ?? "draft")
  };
}

function evidenceClaimLine(value: unknown) {
  const claim = recordValue(value);
  const references = Array.isArray(claim.evidenceLinks)
    ? claim.evidenceLinks.flatMap((entry) => {
        const link = recordValue(entry);
        return link.entityType && link.entityId
          ? [`${String(link.entityType)}:${String(link.entityId)}`]
          : [];
      })
    : [];
  return `${String(claim.claim ?? "")} | ${references.join(", ")}`.trim();
}

function evidenceClaims(value: string) {
  return lines(value).map((entry) => {
    const [claim, ...referenceParts] = entry.split("|");
    const evidenceLinks = referenceParts
      .join("|")
      .split(",")
      .flatMap((reference) => {
        const separator = reference.indexOf(":");
        const entityType =
          separator < 0 ? "" : reference.slice(0, separator).trim();
        const entityId =
          separator < 0 ? "" : reference.slice(separator + 1).trim();
        return entityType && entityId
          ? [{ entityType, entityId, relationship: "supports" }]
          : [];
      });
    return { claim: claim.trim(), evidenceLinks, reviewState: "draft" };
  });
}

export function evidenceReferences(value: string) {
  return lines(value).flatMap((reference) => {
    const separator = reference.indexOf(":");
    const entityType =
      separator < 0 ? "" : reference.slice(0, separator).trim();
    const entityId = separator < 0 ? "" : reference.slice(separator + 1).trim();
    return entityType && entityId
      ? [{ entityType, entityId, relationship: "supports" }]
      : [];
  });
}

export function evidenceReferenceText(value: unknown) {
  return Array.isArray(value)
    ? value
        .flatMap((entry) => {
          const link = recordValue(entry);
          return link.entityType && link.entityId
            ? [`${String(link.entityType)}:${String(link.entityId)}`]
            : [];
        })
        .join("\n")
    : "";
}

export function evidenceReferenceError(value: string) {
  return lines(value).length === evidenceReferences(value).length
    ? null
    : "Use one complete entityType:entityId evidence reference per line.";
}

function evidenceClaimError(value: string) {
  const claims = evidenceClaims(value);
  if (claims.some((claim) => !claim.claim))
    return "Every evidence line needs a claim before the | separator.";
  if (claims.some((claim) => claim.evidenceLinks.length === 0))
    return "Every claim or accomplishment needs at least one authoritative Forge reference in entityType:entityId form.";
  return null;
}

export function PositioningProfileDialog({
  open,
  onOpenChange,
  userIds,
  profile,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  profile?: WorkRecord;
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(() => profileDraft(profile));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setDraft(profileDraft(profile));
  }, [open, profile]);
  const steps = useMemo<Array<QuestionFlowStep<ProfileDraft>>>(
    () => [
      {
        id: "position",
        eyebrow: "Candidate positioning",
        title: profile
          ? "Update the positioning profile"
          : "Create a positioning profile",
        description:
          "A profile describes one truthful way to present the same person for a role family. Claims should point back to authoritative Forge evidence.",
        render: (value, setValue) => (
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="Profile title">
              <Input
                value={value.title}
                onChange={(event) => setValue({ title: event.target.value })}
                autoFocus
              />
            </FlowField>
            <FlowField label="Headline">
              <Input
                value={value.headline}
                onChange={(event) => setValue({ headline: event.target.value })}
              />
            </FlowField>
            <FlowField label="Summary" className="md:col-span-2">
              <Textarea
                rows={6}
                value={value.summary}
                onChange={(event) => setValue({ summary: event.target.value })}
              />
            </FlowField>
            <FlowField label="Target roles" hint="One per line">
              <Textarea
                rows={5}
                value={value.targetRoles}
                onChange={(event) =>
                  setValue({ targetRoles: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Skills" hint="One per line">
              <Textarea
                rows={5}
                value={value.skills}
                onChange={(event) => setValue({ skills: event.target.value })}
              />
            </FlowField>
            <FlowField
              label="Evidence claims"
              hint="One per line: truthful claim | entityType:entityId, entityType:entityId"
            >
              <Textarea
                rows={5}
                value={value.evidenceClaims}
                onChange={(event) =>
                  setValue({ evidenceClaims: event.target.value })
                }
              />
            </FlowField>
            <FlowField
              label="Accomplishments"
              hint="One per line: accomplishment | entityType:entityId"
            >
              <Textarea
                rows={5}
                value={value.accomplishments}
                onChange={(event) =>
                  setValue({ accomplishments: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Languages" hint="One per line">
              <Textarea
                rows={4}
                value={value.languages}
                onChange={(event) =>
                  setValue({ languages: event.target.value })
                }
              />
            </FlowField>
            <FlowField
              label="Intentionally public links"
              hint="Label|https://…, one per line"
            >
              <Textarea
                rows={4}
                value={value.publicLinks}
                onChange={(event) =>
                  setValue({ publicLinks: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Preferred Artifact ID">
              <Input
                value={value.preferredDefaultArtifactId}
                onChange={(event) =>
                  setValue({ preferredDefaultArtifactId: event.target.value })
                }
              />
            </FlowField>
            <Select
              label="Approval state"
              value={value.approvalState}
              onChange={(approvalState) => setValue({ approvalState })}
            >
              {["draft", "reviewed", "approved", "retired"].map((option) => (
                <option key={option}>{option}</option>
              ))}
            </Select>
            <FlowField label="Valid from">
              <Input
                type="date"
                value={value.validFrom}
                onChange={(event) =>
                  setValue({ validFrom: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Valid until">
              <Input
                type="date"
                value={value.validUntil}
                onChange={(event) =>
                  setValue({ validUntil: event.target.value })
                }
              />
            </FlowField>
          </div>
        )
      }
    ],
    [profile]
  );
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Documents"
      title={profile ? "Edit positioning profile" : "Add positioning profile"}
      description="Create evidence-linked, reusable candidate positioning."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={profile ? "Save profile revision" : "Add profile"}
      pending={pending}
      error={error}
      draftPersistenceKey={`work-profile-${profile?.id ?? "new"}`}
      resolveContinueBlocker={() =>
        evidenceClaimError(draft.evidenceClaims) ??
        evidenceClaimError(draft.accomplishments)
      }
      onSubmit={async () => {
        setPending(true);
        setError(null);
        const publicLinks = lines(draft.publicLinks)
          .map((entry) => {
            const [label, ...rest] = entry.split("|");
            return {
              label: label.trim(),
              url: rest.join("|").trim(),
              intentionallyPublic: true
            };
          })
          .filter((entry) => entry.url);
        const data = {
          title: draft.title,
          headline: draft.headline,
          summary: draft.summary,
          targetRoles: lines(draft.targetRoles),
          evidenceClaims: evidenceClaims(draft.evidenceClaims),
          skills: lines(draft.skills),
          accomplishments: evidenceClaims(draft.accomplishments),
          languages: lines(draft.languages).map((language) => ({ language })),
          publicLinks,
          preferredDefaultArtifactId: draft.preferredDefaultArtifactId || null,
          validFrom: draft.validFrom || null,
          validUntil: draft.validUntil || null,
          approvalState: draft.approvalState,
          scopeProjectIds: [],
          scopeTagIds: [],
          provenance
        };
        try {
          if (profile)
            await updateWorkSupportingRecord(
              userIds,
              "positioningProfile",
              profile.id,
              { expectedRevision: Number(profile.revision), data }
            );
          else
            await createWorkSupportingRecord(userIds, "positioningProfile", {
              data
            });
          onOpenChange(false);
          await onSaved();
        } catch (caught) {
          setError(message(caught));
        } finally {
          setPending(false);
        }
      }}
    />
  );
}

export type ArtifactUseDraft = {
  references: WorkArtifactVersionReference[];
  useKind: string;
  approvalState: string;
};
