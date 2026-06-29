import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ArtifactsPage } from "./artifacts-page";
import { uploadArtifact } from "@/lib/api";
import type { Artifact } from "@/lib/types";

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
  listArtifacts: vi.fn(async () => ({ artifacts: [mockArtifact] })),
  listArtifactVersions: vi.fn(async () => ({
    versions: [
      {
        id: "version_1",
        artifactId: "artifact_123",
        versionNumber: 1,
        contentSha256: "hash",
        storageKey: "sha256/aa/bb/hash.bin",
        byteSize: 2048,
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
  downloadArtifact: vi.fn(),
  enrichArtifact: vi.fn(),
  patchArtifact: vi.fn(),
  replaceArtifactEntityLinks: vi.fn(),
  rescanArtifact: vi.fn(),
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
          <Route path="/artifacts/:artifactId" element={<ArtifactsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ArtifactsPage", () => {
  it("renders artifact metadata, safety findings, and generic entity links", async () => {
    renderArtifactsPage();

    expect(await screen.findByRole("heading", { name: "Artifacts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add artifacts/i })).toBeInTheDocument();
    expect(screen.queryByText("Add File")).not.toBeInTheDocument();
    expect((await screen.findAllByText("Thesis budget workbook")).length).toBeGreaterThan(0);
    expect(screen.getByText("Budget workbook for thesis planning.")).toBeInTheDocument();
    expect(screen.getByText("office_external_relationship")).toBeInTheDocument();
    expect(screen.getByText("Project")).toBeInTheDocument();
    expect(screen.getByText("project_thesis")).toBeInTheDocument();
    expect(screen.getByText("Evidence")).toBeInTheDocument();

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

    fireEvent.click(await screen.findByRole("button", { name: /add artifacts/i }));
    expect(
      await screen.findByRole("heading", { name: "Choose the files to preserve" })
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
      await screen.findByRole("heading", { name: "Review each file before upload" })
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Short description for evidence.png"), {
      target: { value: "Photo from the whiteboard." }
    });
    fireEvent.click(screen.getAllByRole("button", { name: /details/i })[1]);
    fireEvent.change(await screen.findByLabelText("Title"), {
      target: { value: "Protocol notes" }
    });
    fireEvent.change(screen.getByLabelText("Source label or provenance note"), {
      target: { value: "Meeting folder" }
    });
    fireEvent.click(screen.getByRole("button", { name: /back to file queue/i }));

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByRole("heading", { name: "Upload artifacts" })).toBeInTheDocument();
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
      sourceLabel: "Meeting folder"
    });
    expect(await screen.findByText("2 uploaded · 0 failed")).toBeInTheDocument();
  });
});
