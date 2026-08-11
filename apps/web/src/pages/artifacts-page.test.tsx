import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ArtifactsPage } from "./artifacts-page";
import {
  applyArtifactEnrichment,
  deleteEntities,
  downloadArtifact,
  downloadArtifactWithPassword,
  enrichArtifact,
  getArtifact,
  listArtifactAuditEvents,
  listArtifactVersions,
  listArtifacts,
  patchArtifact,
  patchArtifactTrust,
  replaceArtifactEntityLinks,
  rescanArtifact,
  uploadArtifact
} from "@/lib/api";
import type { Artifact } from "@/lib/types";

const ARTIFACT_INTEGRATION_TEST_TIMEOUT_MS = 30_000;

vi.setConfig({ testTimeout: ARTIFACT_INTEGRATION_TEST_TIMEOUT_MS });

const createObjectURLMock = vi.fn(() => "blob:artifact-download");
const revokeObjectURLMock = vi.fn();
const anchorClickMock = vi.fn();
const scrollIntoViewMock = vi.fn();

Object.defineProperty(URL, "createObjectURL", {
  configurable: true,
  value: createObjectURLMock
});
Object.defineProperty(URL, "revokeObjectURL", {
  configurable: true,
  value: revokeObjectURLMock
});
vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
  anchorClickMock
);
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: scrollIntoViewMock
});

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    title,
    description,
    actions
  }: {
    title: string;
    description: string;
    actions?: ReactNode;
  }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
      {actions}
    </header>
  )
}));

const mockArtifact: Artifact = {
  id: "artifact_123",
  title: "Thesis budget workbook",
  shortDescription: "Budget workbook for thesis planning.",
  description: "Uploaded from the operator's local files.",
  originalFileName: "budget.xlsx",
  contentSha256: "hash",
  byteSize: 2048,
  storedContentSha256: "hash",
  storedByteSize: 2048,
  contentProtection: {
    mode: "plaintext",
    encryptedAt: null,
    algorithm: null,
    kdf: null,
    kdfParams: null,
    passwordHint: null
  },
  detectedExtension: "xlsx",
  declaredMimeType:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  detectedMimeType:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  formatFamily: "spreadsheet",
  sourceKind: "upload",
  sourceLabel: "Operator local files",
  uploadedByUserId: "user_operator",
  uploadedByAgentId: null,
  actingForUserId: null,
  artifactState: "active",
  dangerScore: 15,
  dangerLevel: "low",
  downloadPolicy: "human_only",
  scanResults: {
    scannedAt: "2026-06-28T00:00:00.000Z",
    scannerVersion: "artifact-static-scan-v1",
    declaredExtension: "xlsx",
    detectedMimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extensionAllowed: true,
    byteSize: 2048,
    findings: [
      {
        code: "office_external_relationship",
        severity: "low",
        message: "Workbook has one external relationship to review."
      }
    ],
    extractedTextAvailable: false,
    extractedTextTruncated: false
  },
  enrichmentResults: {},
  metadata: { department: "Research", retainedBy: "Operator" },
  links: [
    {
      sourceEntityType: "artifact",
      sourceEntityId: "artifact_123",
      targetEntityType: "project",
      targetEntityId: "project_thesis",
      anchorKey: null,
      relationship: "evidence",
      createdByActor: "Trusted Artifact Agent",
      createdAt: "2026-06-28T00:00:00.000Z"
    }
  ],
  createdAt: "2026-06-28T00:00:00.000Z",
  updatedAt: "2026-06-28T00:00:00.000Z"
};

vi.mock("@/lib/api", () => ({
  listArtifacts: vi.fn(async () => ({
    artifacts: [mockArtifact],
    total: 1,
    limit: 50,
    offset: 0,
    hasMore: false
  })),
  getArtifact: vi.fn(async () => ({ artifact: mockArtifact })),
  listArtifactVersions: vi.fn(async () => ({
    versions: [
      {
        id: "version_1",
        artifactId: "artifact_123",
        versionNumber: 1,
        contentSha256: "hash",
        byteSize: 2048,
        storedContentSha256: "hash",
        storedByteSize: 2048,
        contentProtection: mockArtifact.contentProtection,
        originalFileName: "budget.xlsx",
        scanResults: {},
        enrichmentResults: {},
        createdByActor: "Trusted Artifact Agent",
        createdAt: "2026-06-28T00:00:00.000Z"
      }
    ],
    total: 1,
    limit: 10,
    offset: 0,
    hasMore: false
  })),
  listArtifactAuditEvents: vi.fn(async () => ({
    events: [
      {
        id: "audit_1",
        artifactId: "artifact_123",
        eventType: "artifact.created",
        actor: "Trusted Artifact Agent",
        source: "agent",
        metadata: {},
        createdAt: "2026-06-28T00:00:00.000Z"
      }
    ],
    total: 1,
    limit: 10,
    offset: 0,
    hasMore: false
  })),
  downloadArtifact: vi.fn(async () => ({
    blob: new Blob(["plain"]),
    fileName: "budget.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  })),
  downloadArtifactWithPassword: vi.fn(async () => ({
    blob: new Blob(["plain"]),
    fileName: "budget.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  })),
  encryptArtifact: vi.fn(async () => ({ artifact: mockArtifact })),
  enrichArtifact: vi.fn(),
  applyArtifactEnrichment: vi.fn(),
  patchArtifact: vi.fn(async () => ({ artifact: mockArtifact })),
  patchArtifactTrust: vi.fn(async () => ({ artifact: mockArtifact })),
  replaceArtifactEntityLinks: vi.fn(),
  rescanArtifact: vi.fn(),
  deleteEntities: vi.fn(async () => ({ results: [{ ok: true }] })),
  uploadArtifact: vi.fn()
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  scrollIntoViewMock.mockClear();
});

function renderArtifactsPage(initialEntry = "/artifacts/artifact_123") {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/artifacts" element={<ArtifactsPage />} />
          <Route path="/artifacts/:artifactId" element={<ArtifactsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ArtifactsPage", () => {
  it("focuses the human-only download anchor after linked detail loads", async () => {
    renderArtifactsPage("/artifacts/artifact_123#artifact-human-download");

    const target = await screen.findByRole("region", {
      name: "Human-only artifact download"
    });
    await waitFor(() => expect(target).toHaveFocus());
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "center" });
  });

  it("renders artifact metadata, safety findings, and generic entity links", async () => {
    renderArtifactsPage();

    expect(
      await screen.findByRole("heading", { name: "Artifacts" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add artifacts/i })
    ).toBeInTheDocument();
    expect(screen.queryByText("Add File")).not.toBeInTheDocument();
    expect(
      (await screen.findAllByText("Thesis budget workbook")).length
    ).toBeGreaterThan(0);
    expect(
      screen.getByText("Budget workbook for thesis planning.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("office_external_relationship")
    ).toBeInTheDocument();
    expect(screen.getByText("Project")).toBeInTheDocument();
    expect(screen.getByText("project_thesis")).toBeInTheDocument();
    expect(screen.getByText("Evidence")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open record" })).toHaveAttribute(
      "href",
      "/projects/project_thesis"
    );
    expect(screen.getByRole("link", { name: "Open in graph" })).toHaveAttribute(
      "href",
      "/knowledge-graph?focus=project%3Aproject_thesis"
    );

    await waitFor(() => {
      expect(screen.getByText("artifact.created")).toBeInTheDocument();
    });
    expect(screen.getByText("Precise metadata")).toBeInTheDocument();
    expect(
      screen.queryByText("/tmp/forge/artifacts/blobs/aa/bb/hash.bin")
    ).not.toBeInTheDocument();
    expect(screen.getByText("Operator local files")).toBeInTheDocument();
    expect(screen.getByText("user_operator")).toBeInTheDocument();
    expect(screen.getByText(/"department": "Research"/)).toBeInTheDocument();
  });

  it("keeps LLM metadata as a reviewable proposal until the human applies the exact proposal", async () => {
    const proposedArtifact: Artifact = {
      ...mockArtifact,
      enrichmentResults: {
        generated: true,
        status: "proposed",
        proposalId: "artifact_enrichment_review_123",
        provider: "mock",
        model: "review-model",
        generatedAt: "2026-08-11T12:00:00.000Z",
        fillMissingOnly: true,
        baseFingerprint: "bounded-fingerprint",
        output: {
          title: "Model-proposed budget title",
          shortDescription: "Model-proposed summary",
          documentType: "budget workbook",
          keywords: ["budget", "forecast"],
          safetySummary: "Review the deterministic spreadsheet findings.",
          dangerReasons: ["Formula-like cell content"],
          dangerScore: mockArtifact.dangerScore,
          suggestedForgeLinks: [{ entityType: "goal", entityId: "goal_budget" }]
        }
      }
    };
    vi.mocked(enrichArtifact).mockResolvedValue({
      artifact: proposedArtifact
    });
    vi.mocked(applyArtifactEnrichment).mockResolvedValue({
      artifact: {
        ...proposedArtifact,
        title: "Model-proposed budget title",
        shortDescription: "Model-proposed summary",
        enrichmentResults: {
          ...proposedArtifact.enrichmentResults,
          status: "applied",
          appliedAt: "2026-08-11T12:01:00.000Z"
        }
      }
    });

    renderArtifactsPage();
    await screen.findByRole("heading", { name: "Artifacts" });
    fireEvent.click(
      await screen.findByRole("button", { name: "Propose metadata" })
    );

    expect(
      await screen.findByRole("heading", { name: "Review proposed metadata" })
    ).toBeInTheDocument();
    expect(screen.getByText("Model-proposed budget title")).toBeInTheDocument();
    expect(
      screen.getByText(/Current: Thesis budget workbook/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Nothing below changes the artifact until you choose/)
    ).toBeInTheDocument();
    expect(applyArtifactEnrichment).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Apply proposal" }));
    await waitFor(() =>
      expect(applyArtifactEnrichment).toHaveBeenCalledWith("artifact_123", {
        proposalId: "artifact_enrichment_review_123"
      })
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Review proposed metadata" })
      ).not.toBeInTheDocument()
    );
  });

  it("edits artifact description and provenance through a guided metadata flow", async () => {
    renderArtifactsPage();

    fireEvent.click(
      await screen.findByRole("button", { name: /edit metadata/i })
    );
    expect(
      await screen.findByRole("heading", {
        name: "Name and describe this artifact"
      })
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Reviewed thesis budget" }
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(
      await screen.findByRole("heading", {
        name: "Record where this file came from"
      })
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Source label or provenance note"), {
      target: { value: "Reviewed finance folder" }
    });
    fireEvent.change(screen.getByLabelText("Metadata JSON"), {
      target: { value: '{"reviewed":true,"owner":"research"}' }
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /save metadata/i }));

    await waitFor(() => {
      expect(patchArtifact).toHaveBeenCalledWith("artifact_123", {
        title: "Reviewed thesis budget",
        shortDescription: "Budget workbook for thesis planning.",
        description: "Uploaded from the operator's local files.",
        sourceLabel: "Reviewed finance folder",
        metadata: { reviewed: true, owner: "research" }
      });
    });
  });

  it("requires a reason and records trust decisions through the dedicated route", async () => {
    renderArtifactsPage();

    fireEvent.click(
      await screen.findByRole("button", { name: /trust state/i })
    );
    expect(
      await screen.findByRole("heading", {
        name: "Set the artifact safety state"
      })
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Artifact trust state"), {
      target: { value: "quarantined" }
    });
    fireEvent.change(screen.getByLabelText("Artifact download policy"), {
      target: { value: "disabled" }
    });
    fireEvent.change(screen.getByLabelText("Reason for this trust decision"), {
      target: { value: "External workbook links need manual review." }
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /apply trust decision/i })
    );

    await waitFor(() => {
      expect(patchArtifactTrust).toHaveBeenCalledWith("artifact_123", {
        artifactState: "quarantined",
        downloadPolicy: "disabled",
        reason: "External workbook links need manual review."
      });
    });
  });

  it("opens a guided multi-file upload flow with queue descriptions and per-file details", async () => {
    vi.mocked(uploadArtifact)
      .mockResolvedValueOnce({
        artifact: {
          ...mockArtifact,
          id: "artifact_png",
          title: "Evidence photo",
          originalFileName: "evidence.png",
          detectedExtension: "png",
          declaredMimeType: "image/png",
          detectedMimeType: "image/png",
          formatFamily: "image"
        }
      })
      .mockResolvedValueOnce({
        artifact: {
          ...mockArtifact,
          id: "artifact_doc",
          title: "Protocol notes",
          originalFileName: "protocol.docx"
        }
      });
    renderArtifactsPage();

    fireEvent.click(
      await screen.findByRole("button", { name: /add artifacts/i })
    );
    expect(
      await screen.findByRole("heading", {
        name: "Choose the files to preserve"
      })
    ).toBeInTheDocument();

    const image = new File(["png"], "evidence.png", { type: "image/png" });
    const documentFile = new File(["doc"], "protocol.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
    fireEvent.change(screen.getByLabelText("Artifact files"), {
      target: { files: [image, documentFile] }
    });

    expect(await screen.findByText("evidence.png")).toBeInTheDocument();
    expect(screen.getByText("protocol.docx")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(
      await screen.findByRole("heading", {
        name: "Review each file before upload"
      })
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByLabelText("Short description for evidence.png"),
      {
        target: { value: "Photo from the whiteboard." }
      }
    );
    fireEvent.click(screen.getAllByRole("button", { name: /details/i })[1]);
    fireEvent.change(await screen.findByLabelText("Title"), {
      target: { value: "Protocol notes" }
    });
    fireEvent.change(screen.getByLabelText("Source label or provenance note"), {
      target: { value: "Meeting folder" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Add relationship" }));
    fireEvent.change(screen.getByLabelText("Entity type for relationship 1"), {
      target: { value: "goal" }
    });
    fireEvent.change(screen.getByLabelText("Entity ID for relationship 1"), {
      target: { value: "goal_upload" }
    });
    fireEvent.change(screen.getByLabelText("Relationship for relationship 1"), {
      target: { value: "evidence" }
    });
    fireEvent.click(
      screen.getByRole("button", { name: /back to file queue/i })
    );

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(
      await screen.findByRole("heading", { name: "Upload artifacts" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /upload artifacts/i }));

    await waitFor(() => {
      expect(uploadArtifact).toHaveBeenCalledTimes(2);
    });
    expect(vi.mocked(uploadArtifact).mock.calls[0]?.[0]).toMatchObject({
      originalFileName: "evidence.png",
      declaredMimeType: "image/png",
      shortDescription: "Photo from the whiteboard."
    });
    expect(vi.mocked(uploadArtifact).mock.calls[1]?.[0]).toMatchObject({
      originalFileName: "protocol.docx",
      title: "Protocol notes",
      sourceLabel: "Meeting folder",
      links: [
        {
          entityType: "goal",
          entityId: "goal_upload",
          relationship: "evidence",
          anchorKey: ""
        }
      ]
    });
    expect(
      await screen.findByText("2 uploaded · 0 failed · 0 canceled")
    ).toBeInTheDocument();
  });

  it("applies bulk defaults and restores keyboard focus after per-file editing", async () => {
    renderArtifactsPage();

    fireEvent.click(
      await screen.findByRole("button", { name: /add artifacts/i })
    );
    fireEvent.change(screen.getByLabelText("Artifact files"), {
      target: {
        files: [
          new File(["first"], "first.txt", { type: "text/plain" }),
          new File(["second"], "second.txt", { type: "text/plain" })
        ]
      }
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(
      await screen.findByRole("heading", {
        name: "Review each file before upload"
      })
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Default short description"), {
      target: { value: "Shared interview evidence." }
    });
    fireEvent.change(screen.getByLabelText("Default source or provenance"), {
      target: { value: "Research interview folder" }
    });
    fireEvent.change(screen.getByLabelText("Default source kind"), {
      target: { value: "external_reference" }
    });
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Use LLM enrichment as a bulk default"
      })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Apply defaults to queued files" })
    );

    expect(
      screen.getByLabelText("Short description for first.txt")
    ).toHaveValue("Shared interview evidence.");
    expect(
      screen.getByLabelText("Short description for second.txt")
    ).toHaveValue("Shared interview evidence.");

    const firstDetails = screen.getAllByRole("button", { name: /details/i })[0];
    fireEvent.click(firstDetails);
    expect(await screen.findByLabelText("Source kind")).toHaveValue(
      "external_reference"
    );
    expect(
      screen.getByRole("switch", {
        name: "Use configured LLM to fill missing metadata for this file"
      })
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.queryByRole("option", { name: /agent upload/i })
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "First interview transcript" }
    });
    fireEvent.click(
      screen.getByRole("button", { name: /back to file queue/i })
    );

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: /details/i })[0]
      ).toHaveFocus();
    });
    fireEvent.click(screen.getAllByRole("button", { name: /details/i })[0]);
    expect(await screen.findByLabelText("Title")).toHaveValue(
      "First interview transcript"
    );
  });

  it("keeps retry identity after partial failure and explains duplicate bytes", async () => {
    const attemptByFile = new Map<string, number>();
    vi.mocked(uploadArtifact).mockImplementation(async (input, options) => {
      options?.onProgress?.(55);
      const attempt = (attemptByFile.get(input.originalFileName) ?? 0) + 1;
      attemptByFile.set(input.originalFileName, attempt);
      if (input.originalFileName === "retry.txt" && attempt === 1) {
        throw new Error("The safety scanner was temporarily unavailable.");
      }
      return {
        artifact: {
          ...mockArtifact,
          id: `${input.originalFileName}-${attempt}`,
          title: input.title ?? input.originalFileName,
          originalFileName: input.originalFileName,
          contentSha256: "shared-content-hash"
        }
      };
    });
    renderArtifactsPage();

    fireEvent.click(
      await screen.findByRole("button", { name: /add artifacts/i })
    );
    fireEvent.change(screen.getByLabelText("Artifact files"), {
      target: {
        files: [
          new File(["same"], "saved.txt", { type: "text/plain" }),
          new File(["same"], "retry.txt", { type: "text/plain" })
        ]
      }
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /upload artifacts/i }));

    expect(
      await screen.findByText("1 uploaded · 1 failed · 0 canceled")
    ).toBeInTheDocument();
    const failedCalls = vi
      .mocked(uploadArtifact)
      .mock.calls.filter(([input]) => input.originalFileName === "retry.txt");
    expect(failedCalls).toHaveLength(1);
    const retryKey = failedCalls[0]?.[1]?.idempotencyKey;
    expect(retryKey).toMatch(/^artifact-ui-/);

    fireEvent.click(screen.getByRole("button", { name: "Retry retry.txt" }));
    expect(
      await screen.findByText("2 uploaded · 0 failed · 0 canceled")
    ).toBeInTheDocument();
    const retryCalls = vi
      .mocked(uploadArtifact)
      .mock.calls.filter(([input]) => input.originalFileName === "retry.txt");
    expect(retryCalls).toHaveLength(2);
    expect(retryCalls[1]?.[1]?.idempotencyKey).toBe(retryKey);
    expect(
      screen.getAllByText(/reused the verified stored blob/i)
    ).toHaveLength(2);
  });

  it("describes duplicate encrypted bytes as independent ciphertext representations", async () => {
    vi.mocked(uploadArtifact).mockImplementation(async (input) => ({
      artifact: {
        ...mockArtifact,
        id: `encrypted-${input.originalFileName}`,
        title: input.title ?? input.originalFileName,
        originalFileName: input.originalFileName,
        contentSha256: "shared-encrypted-plaintext-hash",
        contentProtection: {
          mode: "password_encrypted",
          encryptedAt: "2026-07-01T00:00:00.000Z",
          algorithm: "libsodium-secretstream-xchacha20poly1305",
          kdf: "argon2id",
          kdfParams: { memlimit: 19922944, opslimit: 2, parallelism: 1 },
          passwordHint: null
        }
      }
    }));
    renderArtifactsPage();

    fireEvent.click(
      await screen.findByRole("button", { name: /add artifacts/i })
    );
    fireEvent.change(screen.getByLabelText("Artifact files"), {
      target: {
        files: [
          new File(["same"], "encrypted-a.txt", { type: "text/plain" }),
          new File(["same"], "encrypted-b.txt", { type: "text/plain" })
        ]
      }
    });
    fireEvent.click(
      screen.getByLabelText("Encrypt file content with a password")
    );
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "sample passphrase" }
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "sample passphrase" }
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /upload artifacts/i }));

    expect(
      await screen.findByText("2 uploaded · 0 failed · 0 canceled")
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/independently encrypted ciphertext representation/i)
    ).toHaveLength(2);
    expect(
      screen.queryByText(/reused the verified stored blob/i)
    ).not.toBeInTheDocument();
  });

  it("cancels and safely retries one in-flight file", async () => {
    let attempt = 0;
    vi.mocked(uploadArtifact).mockImplementation(async (input, options) => {
      attempt += 1;
      options?.onProgress?.(35);
      if (attempt === 1) {
        await new Promise<never>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              const error = new Error("Upload canceled.");
              error.name = "AbortError";
              reject(error);
            },
            { once: true }
          );
        });
      }
      return {
        artifact: {
          ...mockArtifact,
          id: "artifact-cancel-retry",
          title: input.title ?? input.originalFileName,
          originalFileName: input.originalFileName
        }
      };
    });
    renderArtifactsPage();

    fireEvent.click(
      await screen.findByRole("button", { name: /add artifacts/i })
    );
    fireEvent.change(screen.getByLabelText("Artifact files"), {
      target: {
        files: [new File(["cancel"], "cancel.txt", { type: "text/plain" })]
      }
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /upload artifacts/i }));

    const cancelButton = await screen.findByRole("button", {
      name: "Cancel cancel.txt"
    });
    const firstKey =
      vi.mocked(uploadArtifact).mock.calls[0]?.[1]?.idempotencyKey;
    fireEvent.click(cancelButton);
    expect(
      await screen.findByText("0 uploaded · 0 failed · 1 canceled")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry cancel.txt" }));
    expect(
      await screen.findByText("1 uploaded · 0 failed · 0 canceled")
    ).toBeInTheDocument();
    expect(vi.mocked(uploadArtifact).mock.calls[1]?.[1]?.idempotencyKey).toBe(
      firstKey
    );
  });

  it("keeps the guided upload queue bounded and reports files it cannot add", async () => {
    renderArtifactsPage();

    fireEvent.click(
      await screen.findByRole("button", { name: /add artifacts/i })
    );
    const files = Array.from(
      { length: 26 },
      (_, index) =>
        new File([String(index)], `evidence-${index}.txt`, {
          type: "text/plain"
        })
    );
    fireEvent.change(screen.getByLabelText("Artifact files"), {
      target: { files }
    });

    expect(
      await screen.findByText("The upload queue accepts at most 25 files.")
    ).toBeInTheDocument();
    expect(screen.getByText("25 of 25 files")).toBeInTheDocument();
    expect(screen.getByLabelText("Artifact files")).toBeDisabled();
    expect(screen.queryByText("evidence-25.txt")).not.toBeInTheDocument();
  });

  it("rejects empty and oversized files before reading them", async () => {
    renderArtifactsPage();

    fireEvent.click(
      await screen.findByRole("button", { name: /add artifacts/i })
    );
    const empty = new File([], "empty.txt", { type: "text/plain" });
    const oversized = new File(["x"], "oversized.txt", {
      type: "text/plain"
    });
    Object.defineProperty(oversized, "size", {
      configurable: true,
      value: 100 * 1024 * 1024 + 1
    });
    const valid = new File(["valid"], "valid.txt", { type: "text/plain" });

    fireEvent.change(screen.getByLabelText("Artifact files"), {
      target: { files: [empty, oversized, valid] }
    });

    expect(
      await screen.findByText(
        "Empty files cannot be added to the Artifact Store. Artifact files may not exceed 100 MiB each."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("valid.txt")).toBeInTheDocument();
    expect(screen.queryByText("empty.txt")).not.toBeInTheDocument();
    expect(screen.queryByText("oversized.txt")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 25 files")).toBeInTheDocument();
    expect(uploadArtifact).not.toHaveBeenCalled();
  });

  it("clears the transient upload password when the guided flow is dismissed", async () => {
    renderArtifactsPage();

    fireEvent.click(
      await screen.findByRole("button", { name: /add artifacts/i })
    );
    fireEvent.change(screen.getByLabelText("Artifact files"), {
      target: {
        files: [new File(["secret"], "secret.txt", { type: "text/plain" })]
      }
    });
    fireEvent.click(
      screen.getByLabelText("Encrypt file content with a password")
    );
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "transient passphrase" }
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "transient passphrase" }
    });
    fireEvent.click(screen.getByRole("button", { name: /close dialog/i }));

    fireEvent.click(
      await screen.findByRole("button", { name: /add artifacts/i })
    );
    expect(screen.getByText("No files selected yet.")).toBeInTheDocument();
    fireEvent.click(
      screen.getByLabelText("Encrypt file content with a password")
    );
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Confirm password")).toHaveValue("");
  });

  it("uses a guided relationship flow and saves normalized general entity links", async () => {
    vi.mocked(replaceArtifactEntityLinks).mockResolvedValue({
      artifact: mockArtifact
    });
    renderArtifactsPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Manage links" })
    );
    expect(
      await screen.findByRole("heading", {
        name: "Manage entity relationships"
      })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add relationship" }));
    fireEvent.change(screen.getByLabelText("Entity type for relationship 2"), {
      target: { value: "note" }
    });
    fireEvent.change(screen.getByLabelText("Entity ID for relationship 2"), {
      target: { value: "note:with:colons" }
    });
    fireEvent.change(screen.getByLabelText("Relationship for relationship 2"), {
      target: { value: "source" }
    });
    fireEvent.change(screen.getByLabelText("Anchor key for relationship 2"), {
      target: { value: "methods" }
    });

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(
      await screen.findByRole("heading", {
        name: "Save artifact relationships"
      })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save relationships" }));

    await waitFor(() => {
      expect(replaceArtifactEntityLinks).toHaveBeenCalledWith("artifact_123", [
        {
          entityType: "project",
          entityId: "project_thesis",
          relationship: "evidence",
          anchorKey: ""
        },
        {
          entityType: "note",
          entityId: "note:with:colons",
          relationship: "source",
          anchorKey: "methods"
        }
      ]);
    });
  });

  it("filters the bounded artifact list by one exact linked record", async () => {
    renderArtifactsPage();

    fireEvent.change(
      await screen.findByLabelText("Filter by linked entity type"),
      { target: { value: "project" } }
    );
    expect(
      await screen.findByText("Enter both fields to filter by a linked record.")
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter by linked entity ID"), {
      target: { value: "project_thesis" }
    });

    await waitFor(() => {
      expect(listArtifacts).toHaveBeenLastCalledWith(
        expect.objectContaining({
          linkedEntityType: "project",
          linkedEntityId: "project_thesis",
          limit: 50,
          offset: 0
        })
      );
    });
  });

  it("validates guided upload encryption fields and applies one password to selected files", async () => {
    vi.mocked(uploadArtifact).mockResolvedValue({
      artifact: {
        ...mockArtifact,
        id: "artifact_encrypted",
        title: "Encrypted evidence",
        originalFileName: "encrypted.csv",
        detectedExtension: "csv",
        declaredMimeType: "text/csv",
        detectedMimeType: "text/csv",
        formatFamily: "spreadsheet",
        contentProtection: {
          mode: "password_encrypted",
          encryptedAt: "2026-07-01T00:00:00.000Z",
          algorithm: "libsodium-secretstream-xchacha20poly1305",
          kdf: "argon2id",
          kdfParams: { memlimit: 19922944, opslimit: 2, parallelism: 1 },
          passwordHint: "shared hint"
        }
      }
    });
    renderArtifactsPage();

    fireEvent.click(
      await screen.findByRole("button", { name: /add artifacts/i })
    );
    const file = new File(["a,b\n1,2\n"], "encrypted.csv", {
      type: "text/csv"
    });
    fireEvent.change(screen.getByLabelText("Artifact files"), {
      target: { files: [file] }
    });
    fireEvent.click(
      screen.getByLabelText("Encrypt file content with a password")
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(
      await screen.findByRole("heading", {
        name: "Review each file before upload"
      })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    fireEvent.click(
      await screen.findByLabelText(
        "Use configured LLM to fill missing metadata for this file"
      )
    );
    expect(
      await screen.findByText(
        "For encrypted uploads, LLM enrichment uses metadata and scanner findings only, not decrypted file text."
      )
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /back to file queue/i })
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /upload artifacts/i }));

    expect(
      await screen.findByText(
        "Password is required when encryption is enabled."
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(
      await screen.findByRole("heading", {
        name: "Review each file before upload"
      })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(
      await screen.findByRole("heading", {
        name: "Choose the files to preserve"
      })
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "sample passphrase" }
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "different passphrase" }
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /upload artifacts/i }));

    expect(
      await screen.findByText("Password confirmation must match.")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(
      await screen.findByRole("heading", {
        name: "Review each file before upload"
      })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(
      await screen.findByRole("heading", {
        name: "Choose the files to preserve"
      })
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "sample passphrase" }
    });
    fireEvent.change(screen.getByLabelText("Password hint"), {
      target: { value: "shared hint" }
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /upload artifacts/i }));

    await waitFor(() => {
      expect(uploadArtifact).toHaveBeenCalledWith(
        expect.objectContaining({
          originalFileName: "encrypted.csv",
          contentProtection: {
            mode: "password_encrypted",
            password: "sample passphrase",
            passwordHint: "shared hint"
          }
        }),
        expect.objectContaining({
          idempotencyKey: expect.stringMatching(/^artifact-ui-/),
          onProgress: expect.any(Function),
          signal: expect.objectContaining({ aborted: false })
        })
      );
    });
  }, 20_000);

  it("shows encrypted artifact state and downloads through the password modal", async () => {
    const encryptedArtifact: Artifact = {
      ...mockArtifact,
      contentProtection: {
        mode: "password_encrypted",
        encryptedAt: "2026-07-01T00:00:00.000Z",
        algorithm: "libsodium-secretstream-xchacha20poly1305",
        kdf: "argon2id",
        kdfParams: { memlimit: 19922944, opslimit: 2, parallelism: 1 },
        passwordHint: "budget hint"
      },
      storedContentSha256: "cipherhash",
      storedByteSize: 2100
    };
    vi.mocked(listArtifacts).mockResolvedValue({
      artifacts: [encryptedArtifact],
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false
    });
    vi.mocked(getArtifact).mockResolvedValue({ artifact: encryptedArtifact });
    vi.mocked(downloadArtifactWithPassword)
      .mockRejectedValueOnce(
        new Error("The password did not decrypt this artifact.")
      )
      .mockResolvedValueOnce({
        blob: new Blob(["plain"]),
        fileName: "budget.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });

    renderArtifactsPage();

    expect(await screen.findByText("Encrypted content")).toBeInTheDocument();
    expect(screen.getByText(/Hint: budget hint/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^download$/i }));

    expect(
      await screen.findByRole("heading", { name: "Enter artifact password" })
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getAllByRole("button", { name: /^download$/i }).at(-1)!
    );
    expect(
      await screen.findByText("Password is required.")
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong" }
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: /^download$/i }).at(-1)!
    );
    expect(
      await screen.findByText("The password did not decrypt this artifact.")
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct" }
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: /^download$/i }).at(-1)!
    );

    await waitFor(() => {
      expect(downloadArtifactWithPassword).toHaveBeenLastCalledWith(
        "artifact_123",
        "correct"
      );
    });
    expect(downloadArtifact).not.toHaveBeenCalled();
  });

  it("uses paginated artifact list controls for large stores", async () => {
    vi.mocked(listArtifacts).mockImplementation(async (options = {}) => {
      const offset = options.offset ?? 0;
      const limit = options.limit ?? 50;
      const count = 50;
      return {
        artifacts: Array.from({ length: count }, (_, index) => ({
          ...mockArtifact,
          id: `artifact_${offset + index}`,
          title: `Artifact ${offset + index}`,
          originalFileName: `artifact-${offset + index}.xlsx`
        })),
        total: 10_000,
        limit,
        offset,
        hasMore: offset + count < 10_000
      };
    });
    renderArtifactsPage();

    expect(
      await screen.findByText("Showing 1-50 of 10000")
    ).toBeInTheDocument();
    expect(screen.getAllByText(/^Artifact \d+$/)).toHaveLength(50);
    await waitFor(() => {
      expect(listArtifacts).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50, offset: 0 })
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: /next artifact page/i })
    );

    expect(
      await screen.findByText("Showing 51-100 of 10000")
    ).toBeInTheDocument();
    expect(screen.getAllByText(/^Artifact \d+$/)).toHaveLength(50);
    await waitFor(() => {
      expect(listArtifacts).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50, offset: 50 })
      );
    });
  });

  it("archives artifacts through shared soft-delete entity CRUD", async () => {
    renderArtifactsPage();

    fireEvent.click(await screen.findByRole("button", { name: /^delete$/i }));
    expect(
      await screen.findByRole("heading", {
        name: "Delete this artifact record?"
      })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /delete artifact/i }));

    await waitFor(() => {
      expect(deleteEntities).toHaveBeenCalledWith({
        atomic: true,
        operations: [
          {
            entityType: "artifact",
            id: "artifact_123",
            mode: "soft",
            reason: "Archived from the Artifact Store web app."
          }
        ]
      });
    });
  });

  it("keeps blocked artifact bytes unavailable and explains the disabled action", async () => {
    const blockedArtifact: Artifact = {
      ...mockArtifact,
      artifactState: "blocked",
      dangerLevel: "blocked",
      dangerScore: 100
    };
    vi.mocked(listArtifacts).mockResolvedValue({
      artifacts: [blockedArtifact],
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false
    });
    vi.mocked(getArtifact).mockResolvedValue({ artifact: blockedArtifact });

    renderArtifactsPage();

    expect(
      await screen.findByText(
        "Download is blocked by the artifact safety state."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^download$/i })).toBeDisabled();
    expect(downloadArtifact).not.toHaveBeenCalled();
    expect(downloadArtifactWithPassword).not.toHaveBeenCalled();
  });

  it("ART-05 states when no static scan evidence is available", async () => {
    const missingScanArtifact: Artifact = {
      ...mockArtifact,
      scanResults: {}
    };
    vi.mocked(listArtifacts).mockResolvedValue({
      artifacts: [missingScanArtifact],
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false
    });
    vi.mocked(getArtifact).mockResolvedValue({
      artifact: missingScanArtifact
    });

    renderArtifactsPage();

    expect(
      await screen.findByText("No static scan result is available.")
    ).toBeInTheDocument();
  });

  it("ART-05 states when a static scan completed without findings", async () => {
    const cleanScanArtifact: Artifact = {
      ...mockArtifact,
      scanResults: {
        ...mockArtifact.scanResults,
        findings: []
      }
    };
    vi.mocked(listArtifacts).mockResolvedValue({
      artifacts: [cleanScanArtifact],
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false
    });
    vi.mocked(getArtifact).mockResolvedValue({ artifact: cleanScanArtifact });

    renderArtifactsPage();

    expect(
      await screen.findByText("Static scan completed with no findings.")
    ).toBeInTheDocument();
  });

  it("ART-05 keeps prior scan evidence visible after a rescan fails", async () => {
    vi.mocked(listArtifacts).mockResolvedValue({
      artifacts: [mockArtifact],
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false
    });
    vi.mocked(getArtifact).mockResolvedValue({ artifact: mockArtifact });
    vi.mocked(rescanArtifact).mockRejectedValueOnce(
      new Error("Stored bytes failed their integrity check.")
    );

    renderArtifactsPage();

    expect(
      await screen.findByText("office_external_relationship")
    ).toBeInTheDocument();
    const scanButton = screen.getByRole("button", { name: /^scan$/i });
    expect(scanButton).toHaveClass("min-h-11");
    fireEvent.click(scanButton);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Latest scan failed. Existing scan evidence remains available. Stored bytes failed their integrity check."
    );
    expect(rescanArtifact).toHaveBeenCalledWith("artifact_123");
    expect(
      screen.getAllByText(/Stored bytes failed their integrity check/)
    ).toHaveLength(1);
    expect(
      screen.getByText("office_external_relationship")
    ).toBeInTheDocument();
  });

  it("ART-05 does not carry a failed scan alert to another artifact", async () => {
    const secondArtifact: Artifact = {
      ...mockArtifact,
      id: "artifact_456",
      title: "Second artifact",
      shortDescription: "A different artifact with its own scan state.",
      originalFileName: "second-artifact.xlsx"
    };
    vi.mocked(listArtifacts).mockResolvedValue({
      artifacts: [mockArtifact, secondArtifact],
      total: 2,
      limit: 50,
      offset: 0,
      hasMore: false
    });
    vi.mocked(getArtifact).mockImplementation(async (artifactId) => ({
      artifact: artifactId === secondArtifact.id ? secondArtifact : mockArtifact
    }));
    vi.mocked(rescanArtifact).mockRejectedValueOnce(
      new Error("Artifact 123 scan failed.")
    );

    renderArtifactsPage();

    fireEvent.click(await screen.findByRole("button", { name: /^scan$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Artifact 123 scan failed."
    );
    fireEvent.click(screen.getByRole("button", { name: /Second artifact/ }));

    expect(
      await screen.findByText("A different artifact with its own scan state.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ART-05 does not claim retained evidence after a first scan fails", async () => {
    const missingScanArtifact: Artifact = {
      ...mockArtifact,
      scanResults: {}
    };
    vi.mocked(listArtifacts).mockResolvedValue({
      artifacts: [missingScanArtifact],
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false
    });
    vi.mocked(getArtifact).mockResolvedValue({
      artifact: missingScanArtifact
    });
    vi.mocked(rescanArtifact).mockRejectedValueOnce(
      new Error("Scanner process unavailable.")
    );

    renderArtifactsPage();

    expect(
      await screen.findByText("No static scan result is available.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^scan$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Latest scan failed. No prior static scan evidence is available. Scanner process unavailable."
    );
    expect(alert).not.toHaveTextContent(
      "Existing scan evidence remains available."
    );
  });

  it("paginates Artifact history deliberately and retries a failed page only on request", async () => {
    let secondVersionPageAttempts = 0;
    let secondAuditPageAttempts = 0;
    vi.mocked(listArtifactVersions).mockImplementation(
      async (_artifactId, options = {}) => {
        if ((options.offset ?? 0) === 0) {
          return {
            versions: [
              {
                id: "version_11",
                artifactId: "artifact_123",
                versionNumber: 11,
                contentSha256: "hash-11",
                byteSize: 2048,
                storedContentSha256: "hash-11",
                storedByteSize: 2048,
                contentProtection: mockArtifact.contentProtection,
                originalFileName: "budget-11.xlsx",
                scanResults: {},
                enrichmentResults: {},
                createdByActor: "Artifact operator",
                createdAt: "2026-07-16T10:00:00.000Z"
              }
            ],
            total: 11,
            limit: 10,
            offset: 0,
            hasMore: true
          };
        }
        secondVersionPageAttempts += 1;
        if (secondVersionPageAttempts === 1) {
          throw new Error("Version history page is temporarily unavailable.");
        }
        return {
          versions: [
            {
              id: "version_1",
              artifactId: "artifact_123",
              versionNumber: 1,
              contentSha256: "hash-1",
              byteSize: 1024,
              storedContentSha256: "hash-1",
              storedByteSize: 1024,
              contentProtection: mockArtifact.contentProtection,
              originalFileName: "budget-1.xlsx",
              scanResults: {},
              enrichmentResults: {},
              createdByActor: "Artifact operator",
              createdAt: "2026-07-01T10:00:00.000Z"
            }
          ],
          total: 11,
          limit: 10,
          offset: 10,
          hasMore: false
        };
      }
    );
    vi.mocked(listArtifactAuditEvents).mockImplementation(
      async (_artifactId, options = {}) => {
        const offset = options.offset ?? 0;
        if (offset > 0) {
          secondAuditPageAttempts += 1;
          if (secondAuditPageAttempts === 1) {
            throw new Error("Audit history page is temporarily unavailable.");
          }
        }
        return {
          events: [
            {
              id: offset === 0 ? "audit_11" : "audit_1",
              artifactId: "artifact_123",
              eventType: offset === 0 ? "artifact.latest" : "artifact.oldest",
              actor: "Artifact operator",
              source: "ui",
              metadata: {},
              createdAt: "2026-07-16T10:00:00.000Z"
            }
          ],
          total: 11,
          limit: 10,
          offset,
          hasMore: offset === 0
        };
      }
    );
    vi.mocked(listArtifacts).mockResolvedValue({
      artifacts: [mockArtifact],
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false
    });
    vi.mocked(getArtifact).mockResolvedValue({ artifact: mockArtifact });

    renderArtifactsPage();
    expect(await screen.findByText("Version 11")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Next artifact version page"
      })
    );
    expect(
      await screen.findByText(
        "Version history page is temporarily unavailable."
      )
    ).toBeInTheDocument();
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    expect(secondVersionPageAttempts).toBe(1);
    expect(
      screen.getByRole("button", { name: "Previous page" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry versions" }));
    expect(await screen.findByText("Version 1")).toBeInTheDocument();
    expect(listArtifactVersions).toHaveBeenLastCalledWith("artifact_123", {
      limit: 10,
      offset: 10
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Next artifact audit page" })
    );
    expect(
      await screen.findByText("Audit history page is temporarily unavailable.")
    ).toBeInTheDocument();
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    expect(secondAuditPageAttempts).toBe(1);
    expect(
      screen.getByRole("button", { name: "Previous page" })
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry audit history" })
    );
    expect(await screen.findByText("artifact.oldest")).toBeInTheDocument();
    expect(listArtifactAuditEvents).toHaveBeenLastCalledWith("artifact_123", {
      limit: 10,
      offset: 10
    });
  });
});
