import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AskPersonFlow } from "@/components/people/ask-person-flow";
import { PairingFlow } from "@/components/people/pairing-flow";
import { PeopleConsequenceFlow } from "@/components/people/people-consequence-flow";
import { PersonEditorFlow } from "@/components/people/person-editor-flow";
import { ShareGrantFlow } from "@/components/people/share-grant-flow";
import { WikiAssociationFlow } from "@/components/people/wiki-association-flow";
import {
  buildSyntheticPeople,
  buildSyntheticPersonContext,
  createSyntheticPeopleGateway
} from "@/components/people/people-fixtures";
import { renderPeopleUi } from "@/components/people/people-test-utils";
import type {
  QuestionInterpretation,
  SavePersonInput
} from "@/components/people/people-types";

vi.mock("framer-motion", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const motionElement = (tag: "div" | "span") =>
    React.forwardRef<HTMLElement, Record<string, unknown>>((props, ref) => {
      const {
        initial: _initial,
        animate: _animate,
        exit: _exit,
        transition: _transition,
        ...elementProps
      } = props;
      return React.createElement(tag, { ...elementProps, ref });
    });
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    useReducedMotion: () => false,
    motion: {
      div: motionElement("div"),
      span: motionElement("span")
    }
  };
});

const context = buildSyntheticPersonContext(buildSyntheticPeople(1)[0]);

function ReopenablePersonEditor() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen editor
      </button>
      <PersonEditorFlow
        open={open}
        context={context}
        onOpenChange={setOpen}
        onSaved={vi.fn()}
      />
    </>
  );
}

function storageContents(storage: Storage) {
  return Array.from({ length: storage.length }, (_, index) => {
    const key = storage.key(index) ?? "";
    return `${key}:${storage.getItem(key) ?? ""}`;
  }).join("\n");
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("People guided flows", () => {
  it("previews the exact outgoing share before proposing it", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    const onUpdated = vi.fn();
    renderPeopleUi(
      <ShareGrantFlow
        open
        context={context}
        onOpenChange={vi.fn()}
        onUpdated={onUpdated}
      />,
      { gateway }
    );

    expect(
      await screen.findByRole("heading", { name: "You share with Ari Alden" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/What they share with you is controlled separately/i)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(
      screen.getByRole("heading", { name: "Choose what to share" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I reviewed what stays hidden/i
      })
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(
      screen.getByRole("heading", {
        name: "Set when access ends and which devices can receive it"
      })
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Home Forge/i })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /New laptop/i })
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    fireEvent.click(
      screen.getByRole("button", { name: "Preview exact share" })
    );
    expect(
      await screen.findByText("Typical information shared")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Most information this could reveal")
    ).toBeInTheDocument();
    expect(screen.getByText("You share with Ari Alden")).toBeInTheDocument();
    expect(
      screen.getByText(/Managed recipient cache for 7 days/)
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Send sharing request" })
    );
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
    expect(gateway.inspect().calls.map((call) => call.operation)).toEqual(
      expect.arrayContaining(["previewShareGrant", "proposeShareGrant"])
    );
  });

  it("selects exact linked entities instead of accepting free-form record IDs", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    renderPeopleUi(
      <ShareGrantFlow
        open
        context={context}
        onOpenChange={vi.fn()}
        onUpdated={vi.fn()}
      />,
      { gateway }
    );

    fireEvent.click(await screen.findByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /Selected records/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(screen.queryByLabelText("Selected record IDs")).toBeNull();
    const projectRecord = screen.getByRole("checkbox", {
      name: /Community garden proposal/i
    });
    const eventRecord = screen.getByRole("checkbox", {
      name: /Autumn planning retreat/i
    });
    expect(projectRecord).not.toBeChecked();
    expect(eventRecord).not.toBeChecked();
    fireEvent.click(projectRecord);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I reviewed what stays hidden/i
      })
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(
      screen.getByRole("button", { name: "Preview exact share" })
    );

    await screen.findByText("Typical information shared");
    const previewCall = gateway
      .inspect()
      .calls.find((call) => call.operation === "previewShareGrant");
    expect(previewCall?.input).toEqual(
      expect.objectContaining({
        preset: "selected_records",
        selectedRecordIds: ["project_synthetic_garden"]
      })
    );
  });

  it("states what revocation stops and what may remain", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    const share = context.outgoingShares[0]!;
    const onUpdated = vi.fn();
    renderPeopleUi(
      <PeopleConsequenceFlow
        open
        action={{
          kind: "grant",
          grantId: share.grantId,
          label: share.label
        }}
        context={context}
        onOpenChange={vi.fn()}
        onUpdated={onUpdated}
      />,
      { gateway }
    );

    expect(
      await screen.findByText(/This share stops immediately/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/An older sharing version cannot turn access back on/i)
    ).toBeInTheDocument();
    expect(screen.getByText("Limits of revocation")).toBeInTheDocument();
    expect(
      screen.getByText(/cannot erase what another person remembers/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    const acknowledgement = screen.getByRole("checkbox", {
      name: /future access stops, protected offline copies/i
    });
    fireEvent.click(acknowledgement);
    fireEvent.click(screen.getByRole("button", { name: "Revoke share" }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
    expect(
      gateway
        .inspect()
        .calls.find((call) => call.operation === "revokeShareGrant")?.input
    ).toEqual({ grantId: share.grantId, acknowledgement: true });
  });

  it("keeps unsupported nested edits read-only while saving entity links", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    const editorContext = buildSyntheticPersonContext(
      buildSyntheticPeople(1)[0]
    );
    editorContext.person.contactMethods.push({
      id: "contact_secondary",
      kind: "email",
      label: "Work email",
      value: "ari@example.test",
      isPrimary: true
    });
    editorContext.person.facts.push({
      id: "fact_secondary",
      label: "Meeting format",
      value: "Walking meeting",
      sensitivity: "ordinary",
      sourceLabel: "This Forge",
      reviewedAt: null
    });
    const onSaved = vi.fn();
    renderPeopleUi(
      <PersonEditorFlow
        open
        context={editorContext}
        onOpenChange={vi.fn()}
        onSaved={onSaved}
      />,
      { gateway }
    );

    await screen.findByRole("heading", {
      name: "Update Ari Alden"
    });
    for (let step = 0; step < 4; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    }

    expect(
      screen.getByText(/Aliases, contacts, and facts are read-only/i)
    ).toBeVisible();
    for (const button of screen.getAllByRole("button", {
      name: /Remove contact method/i
    })) {
      expect(button).toBeDisabled();
    }
    for (const button of screen.getAllByRole("button", {
      name: /Remove fact/i
    })) {
      expect(button).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Add contact" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add fact" })).toBeDisabled();
    expect(screen.getByPlaceholderText("Search Forge records")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Remove Community garden proposal"
      })
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Autumn planning retreat" })
    );

    fireEvent.click(screen.getByRole("button", { name: "Save person" }));

    expect(
      screen.queryAllByRole("alert").map((alert) => alert.textContent)
    ).toEqual([]);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const saveCall = gateway
      .inspect()
      .calls.find((call) => call.operation === "savePerson");
    const saved = saveCall?.input as SavePersonInput;
    expect(saved.contactMethods).toHaveLength(2);
    expect(saved.contactMethods.map((method) => method.label)).toEqual([
      "Signal",
      "Work email"
    ]);
    expect(saved.facts).toHaveLength(2);
    expect(saved.facts.map((fact) => fact.label)).toEqual([
      "Preferred check-in",
      "Meeting format"
    ]);
    expect(saved.linkUpdate).toEqual({
      mode: "replace_complete",
      links: [
        {
          entityType: "project",
          entityId: "project_synthetic_garden",
          anchorKey: null,
          relationship: "collaborator"
        }
      ]
    });
  });

  it("normalizes birthday parts when precision changes", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    renderPeopleUi(
      <PersonEditorFlow
        open
        context={null}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
      { gateway }
    );

    fireEvent.change(await screen.findByLabelText(/Display name/), {
      target: { value: "New Person" }
    });
    for (let step = 0; step < 3; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    }
    fireEvent.change(screen.getByLabelText("Birthday precision"), {
      target: { value: "full" }
    });
    expect(screen.getByLabelText("Birthday year")).toBeInTheDocument();
    expect(screen.getByLabelText("Birthday month")).toBeInTheDocument();
    expect(screen.getByLabelText("Birthday day")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getAllByText("Enter a valid birthday year.").length).toBe(2);

    fireEvent.change(screen.getByLabelText(/Birthday precision/), {
      target: { value: "unknown" }
    });
    expect(screen.queryByLabelText("Birthday year")).toBeNull();
    expect(screen.queryByLabelText("Birthday month")).toBeNull();
    expect(screen.queryByLabelText("Birthday day")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(
      screen.getByRole("heading", {
        name: "What else should stay connected to this person?"
      })
    ).toBeInTheDocument();
  });

  it("opens the add-person flow with guidance instead of validation errors", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    renderPeopleUi(
      <PersonEditorFlow
        open
        context={null}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
      { gateway }
    );

    expect(
      await screen.findByRole("heading", {
        name: "Who would you like to remember?"
      })
    ).toBeInTheDocument();
    expect(screen.queryByText("Display name is required.")).toBeNull();
    expect(
      screen.getByText("Enter a display name to continue.").parentElement
    ).toHaveAttribute("role", "status");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("blocks invalid time zones before saving local date and place context", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    renderPeopleUi(
      <PersonEditorFlow
        open
        context={context}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
      { gateway }
    );

    await screen.findByRole("heading", {
      name: "Update Ari Alden"
    });
    for (let step = 0; step < 3; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    }
    fireEvent.change(screen.getByLabelText(/Timezone/), {
      target: { value: "Zurich-ish" }
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(
      screen.getAllByText(/Enter a valid IANA time zone/i).length
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", {
        name: "Are there dates or places worth remembering?"
      })
    ).toBeInTheDocument();
  });

  it("associates a reviewed Wiki candidate without changing its page", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    const onApplied = vi.fn();
    renderPeopleUi(
      <WikiAssociationFlow
        open
        context={context}
        onOpenChange={vi.fn()}
        onApplied={onApplied}
      />,
      { gateway }
    );

    const candidates = await screen.findAllByRole("radio");
    fireEvent.click(candidates[0]!);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(
      screen.getByRole("button", { name: /Associate this page/i })
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(
      screen.getByText(/Wiki page content and path remain unchanged/i)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply decision" }));

    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(
      gateway
        .inspect()
        .calls.find((call) => call.operation === "applyWikiAssociation")?.input
    ).toEqual({
      personId: context.person.id,
      pageId: "wiki_candidate_mara",
      decision: "associate"
    });
  });

  it("does not offer scanned pairing when no approved local device is configured", async () => {
    const baseGateway = createSyntheticPeopleGateway({ count: 4 });
    const gateway = {
      ...baseGateway,
      capabilities: {
        ...baseGateway.capabilities,
        pairingAcceptance: false
      }
    };
    renderPeopleUi(
      <PairingFlow
        open
        context={context}
        onOpenChange={vi.fn()}
        onPaired={vi.fn()}
      />,
      { gateway }
    );

    expect(
      await screen.findByText("This device cannot accept a scanned invitation")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Create invitation/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Use scanned invitation/i })
    ).toBeNull();
  });

  it("renders a stable one-use pairing QR image", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    renderPeopleUi(
      <PairingFlow
        open
        context={context}
        onOpenChange={vi.fn()}
        onPaired={vi.fn()}
      />,
      { gateway }
    );

    fireEvent.click(await screen.findByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));

    const qrImage = await screen.findByRole("img", {
      name: "One-use Forge pairing invitation QR code"
    });
    expect(qrImage).toHaveAttribute("width", "280");
    expect(qrImage).toHaveAttribute("height", "280");
    expect(qrImage).toHaveAttribute("decoding", "async");
    expect(qrImage.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(screen.getByText(/One use only\. Expires/)).toBeInTheDocument();
    expect(
      screen.getAllByText(/Pairing alone shares no information/i).length
    ).toBeGreaterThan(0);
  });

  it("cancels a generated invitation and removes its sensitive QR payload", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    renderPeopleUi(
      <PairingFlow
        open
        context={context}
        onOpenChange={vi.fn()}
        onPaired={vi.fn()}
      />,
      { gateway }
    );

    fireEvent.click(await screen.findByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
    expect(
      await screen.findByRole("img", {
        name: "One-use Forge pairing invitation QR code"
      })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel invitation" }));

    expect(await screen.findByText("Invitation canceled")).toBeInTheDocument();
    expect(
      screen.queryByRole("img", {
        name: "One-use Forge pairing invitation QR code"
      })
    ).toBeNull();
    expect(
      gateway
        .inspect()
        .calls.find((call) => call.operation === "cancelPairingInvitation")
        ?.input
    ).toEqual({
      invitationId: `invite_${context.person.id}`,
      expectedVersion: "2026-07-15T12:00:00.000Z"
    });
  });

  it("hides an invitation that is already expired even when its payload returns", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    gateway.createPairingInvitation = vi.fn().mockResolvedValue({
      id: "invite_expired",
      qrPayload: "forge-peer://invite/expired-secret",
      expiresAt: "2020-01-01T00:00:00.000Z",
      verificationPhrase: null,
      fingerprint: "8D4A72B13F906CE2",
      oneUse: true,
      expectedVersion: "2020-01-01T00:00:00.000Z",
      status: "active"
    });
    renderPeopleUi(
      <PairingFlow
        open
        context={context}
        onOpenChange={vi.fn()}
        onPaired={vi.fn()}
      />,
      { gateway }
    );

    fireEvent.click(await screen.findByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));

    expect(await screen.findByText("Invitation expired")).toBeInTheDocument();
    expect(
      screen.queryByRole("img", {
        name: "One-use Forge pairing invitation QR code"
      })
    ).toBeNull();
    expect(document.body).not.toHaveTextContent("expired-secret");
  });

  it("interprets locally before executing a registered typed query", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    const onOpenChange = vi.fn();
    renderPeopleUi(
      <AskPersonFlow
        open
        context={context}
        onOpenChange={onOpenChange}
        onReviewIncomingAccess={vi.fn()}
      />,
      { gateway }
    );

    fireEvent.click(screen.getByRole("button", { name: /Current goals/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: "Review question" }));

    expect(
      await screen.findByText("Selected goal summaries for this quarter")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Exact ID: goals\.horizon_summary\.v1/)
    ).toBeInTheDocument();
    expect(screen.getByText(/mapped this locally/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ask for answer" }));
    expect(
      await screen.findByText(
        "Complete the community garden proposal this quarter."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Exact ID: goals\.horizon_summary\.v1/)
    ).toBeInTheDocument();
    expect(screen.getByText("principal_person_000001")).toBeInTheDocument();
    expect(
      screen.getByText("device_primary_person_000001")
    ).toBeInTheDocument();
    expect(screen.getByText("Shared information")).toBeInTheDocument();
    expect(screen.getByText("Source identity ID")).toBeInTheDocument();
    expect(screen.getByText("Source device ID")).toBeInTheDocument();
    expect(gateway.inspect().calls.map((call) => call.operation)).toEqual(
      expect.arrayContaining(["interpretQuestion", "executeQuestion"])
    );
  });

  it("ignores a late interpretation after the question revision changes", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    const fallbackInterpret = gateway.interpretQuestion.bind(gateway);
    let resolveFirst!: (value: QuestionInterpretation) => void;
    const firstInterpretation = new Promise<QuestionInterpretation>(
      (resolve) => {
        resolveFirst = resolve;
      }
    );
    gateway.interpretQuestion = vi
      .fn()
      .mockImplementationOnce(() => firstInterpretation)
      .mockImplementation(fallbackInterpret);
    renderPeopleUi(
      <AskPersonFlow
        open
        context={context}
        onOpenChange={vi.fn()}
        onReviewIncomingAccess={vi.fn()}
      />,
      { gateway }
    );

    fireEvent.click(screen.getByRole("button", { name: /Next Monday/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: "Review question" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.change(screen.getByLabelText("Question"), {
      target: { value: "What is Ari's main goal this quarter?" }
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await act(async () => {
      resolveFirst({
        status: "supported",
        typedQueryId: "calendar.late-a",
        projectionId: "calendar.availability.v1",
        interpretationLabel: "Late result for question A",
        timeRangeLabel: "Next Monday",
        requiredGrantLabel: "Availability",
        liveRefreshPossible: true,
        explanation: "This result belongs only to question A.",
        execution: {
          interpretationId: "interpretation_late_a",
          interpretationHash: "a".repeat(64),
          query: {
            projectionId: "calendar.availability.v1",
            parameters: {},
            interval: null,
            entityIds: [],
            fields: ["startsAt", "endsAt", "state"],
            precision: "free_busy",
            maximumResultCount: 100
          }
        }
      });
    });

    expect(screen.queryByText("Late result for question A")).toBeNull();
    expect(
      await screen.findByRole("button", { name: "Review question" })
    ).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Ask for answer" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Review question" }));
    expect(
      await screen.findByText("Selected goal summaries for this quarter")
    ).toBeInTheDocument();
  });

  it("routes a missing incoming grant to connection review without creating the opposite share", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    const onOpenChange = vi.fn();
    const onReviewIncomingAccess = vi.fn();
    renderPeopleUi(
      <AskPersonFlow
        open
        context={context}
        onOpenChange={onOpenChange}
        onReviewIncomingAccess={onReviewIncomingAccess}
      />,
      { gateway }
    );

    fireEvent.click(screen.getByRole("button", { name: /Cycling aggregate/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: "Review question" }));
    expect(
      await screen.findByText("A sharing permission is missing")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Only Ari Alden can choose to share this information/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/You cannot approve that access/i)
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Review connection and requests" })
    );

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onReviewIncomingAccess).toHaveBeenCalledTimes(1);
    expect(
      gateway
        .inspect()
        .calls.some((call) => call.operation === "previewShareGrant")
    ).toBe(false);
  });

  it("keeps private, pairing, grant, and question drafts out of browser storage", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    const localStorageSet = vi.spyOn(window.localStorage, "setItem");
    const sessionStorageSet = vi.spyOn(window.sessionStorage, "setItem");
    const privateNote = "PRIVATE-DRAFT-ALPHA-927";
    const pairingSecret = "forge-peer://invite/PAIRING-SECRET-BETA-483";
    const privateQuestion = "PRIVATE-QUESTION-GAMMA-614";

    const editor = renderPeopleUi(
      <PersonEditorFlow
        open
        context={context}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
      { gateway }
    );
    await screen.findByRole("heading", {
      name: "Update Ari Alden"
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/Private notes/i), {
      target: { value: privateNote }
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    editor.unmount();
    const pairing = renderPeopleUi(
      <PairingFlow
        open
        context={context}
        onOpenChange={vi.fn()}
        onPaired={vi.fn()}
      />,
      { gateway }
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Use scanned invitation/i })
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/Scanned Forge invitation/i), {
      target: { value: pairingSecret }
    });
    fireEvent.click(screen.getByRole("button", { name: "Inspect invitation" }));
    expect(await screen.findByText("8D4A 72B1 3F90 6CE2")).toBeInTheDocument();

    pairing.unmount();
    renderPeopleUi(
      <AskPersonFlow
        open
        context={context}
        onOpenChange={vi.fn()}
        onReviewIncomingAccess={vi.fn()}
      />,
      { gateway }
    );
    fireEvent.change(await screen.findByLabelText(/Question/i), {
      target: { value: privateQuestion }
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: "Review question" }));
    await screen.findByText("No registered typed query matched");

    expect(localStorageSet).not.toHaveBeenCalled();
    expect(sessionStorageSet).not.toHaveBeenCalled();
    expect(storageContents(window.localStorage)).not.toMatch(
      /PRIVATE-DRAFT|PAIRING-SECRET|PRIVATE-QUESTION/
    );
    expect(storageContents(window.sessionStorage)).not.toMatch(
      /PRIVATE-DRAFT|PAIRING-SECRET|PRIVATE-QUESTION/
    );
    expect(window.location.href).not.toMatch(
      /PRIVATE-DRAFT|PAIRING-SECRET|PRIVATE-QUESTION/
    );
    expect(JSON.stringify(gateway.inspect().calls)).not.toContain(
      pairingSecret
    );
  });

  it("wipes an unsaved private draft when the guided modal closes", async () => {
    const gateway = createSyntheticPeopleGateway({ count: 4 });
    const privateDraft = "UNSAVED-PRIVATE-CONTEXT-472";
    renderPeopleUi(<ReopenablePersonEditor />, { gateway });

    await screen.findByRole("heading", {
      name: "Update Ari Alden"
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    const privateNotes = screen.getByLabelText(/Private notes/i);
    fireEvent.change(privateNotes, { target: { value: privateDraft } });
    expect(privateNotes).toHaveValue(privateDraft);
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reopen editor" }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByLabelText(/Private notes/i)).toHaveValue(
      context.person.privateNotes
    );
    expect(document.body).not.toHaveTextContent(privateDraft);
  });
});
