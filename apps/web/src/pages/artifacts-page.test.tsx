import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ArtifactsPage } from "./artifacts-page";

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    title,
    description
  }: {
    title: string;
    description: string;
  }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  )
}));

const mockArtifact = {
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
} as const;

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
});
