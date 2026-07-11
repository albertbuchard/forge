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
  deleteEntities,
  downloadArtifact,
  downloadArtifactWithPassword,
  getArtifact,
  listArtifacts,
  replaceArtifactEntityLinks,
  uploadArtifact
} from "@/lib/api";
import type { Artifact } from "@/lib/types";

const createObjectURLMock = vi.fn(() => "blob:artifact-download");
const revokeObjectURLMock = vi.fn();
const anchorClickMock = vi.fn();

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
  storageKey: "sha256/aa/bb/hash.bin",
  storagePath: "/tmp/forge/artifacts/blobs/aa/bb/hash.bin",
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
    extractedTextSample: "",
    extractedTextTruncated: false
  },
  enrichmentResults: {},
  metadata: {},
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
        storageKey: "sha256/aa/bb/hash.bin",
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
    ]
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
    ]
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
  patchArtifact: vi.fn(),
  replaceArtifactEntityLinks: vi.fn(),
  rescanArtifact: vi.fn(),
  deleteEntities: vi.fn(async () => ({ results: [{ ok: true }] })),
  uploadArtifact: vi.fn()
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderArtifactsPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/artifacts/artifact_123"]}>
        <Routes>
          <Route path="/artifacts" element={<ArtifactsPage />} />
          <Route path="/artifacts/:artifactId" element={<ArtifactsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ArtifactsPage", () => {
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
      await screen.findByText("2 uploaded · 0 failed")
    ).toBeInTheDocument();
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
        })
      );
    });
  });

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
});
