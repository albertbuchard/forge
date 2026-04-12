import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SettingsDataPage } from "@/pages/settings-data-page";
import type {
  DataBackupEntry,
  DataManagementState,
  DataRecoveryCandidate
} from "@/lib/data-management-types";

const {
  ensureOperatorSessionMock,
  getDataManagementStateMock,
  patchDataManagementSettingsMock,
  createRuntimeDataBackupMock,
  scanDataRecoveryCandidatesMock,
  switchRuntimeDataRootMock,
  restoreRuntimeDataBackupMock,
  downloadDataExportMock
} = vi.hoisted(() => ({
  ensureOperatorSessionMock: vi.fn(),
  getDataManagementStateMock: vi.fn(),
  patchDataManagementSettingsMock: vi.fn(),
  createRuntimeDataBackupMock: vi.fn(),
  scanDataRecoveryCandidatesMock: vi.fn(),
  switchRuntimeDataRootMock: vi.fn(),
  restoreRuntimeDataBackupMock: vi.fn(),
  downloadDataExportMock: vi.fn()
}));

const anchorClickMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
      <div>{actions}</div>
    </div>
  )
}));

vi.mock("@/components/settings/settings-section-nav", () => ({
  SettingsSectionNav: () => <div>Settings nav</div>
}));

vi.mock("@/components/experience/surface-skeleton", () => ({
  SurfaceSkeleton: ({ title }: { title: string }) => <div>{title}</div>
}));

vi.mock("@/components/flows/question-flow-dialog", () => ({
  FlowChoiceGrid: ({
    options,
    value,
    onChange
  }: {
    options: Array<{ value: string; label: string }>;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <div>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
  FlowField: ({
    label,
    children,
    description
  }: {
    label: string;
    children: React.ReactNode;
    description?: string;
  }) => (
    <label>
      <span>{label}</span>
      {description ? <span>{description}</span> : null}
      {children}
    </label>
  ),
  QuestionFlowDialog: ({
    open,
    title,
    description,
    value,
    onChange,
    steps,
    onSubmit,
    submitLabel
  }: {
    open: boolean;
    title: string;
    description: string;
    value: Record<string, unknown>;
    onChange: (value: Record<string, unknown>) => void;
    steps: Array<{
      id: string;
      title: string;
      render: (
        value: Record<string, unknown>,
        setValue: (patch: Record<string, unknown>) => void
      ) => React.ReactNode;
    }>;
    onSubmit: () => Promise<void>;
    submitLabel: string;
  }) =>
    open ? (
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
        {steps.map((step) => (
          <section key={step.id}>
            <h3>{step.title}</h3>
            {step.render(value, (patch) => onChange({ ...value, ...patch }))}
          </section>
        ))}
        <button type="button" onClick={() => void onSubmit()}>
          {submitLabel}
        </button>
      </div>
    ) : null
}));

vi.mock("@/lib/api", () => ({
  ensureOperatorSession: ensureOperatorSessionMock,
  getDataManagementState: getDataManagementStateMock,
  patchDataManagementSettings: patchDataManagementSettingsMock,
  createRuntimeDataBackup: createRuntimeDataBackupMock,
  scanDataRecoveryCandidates: scanDataRecoveryCandidatesMock,
  switchRuntimeDataRoot: switchRuntimeDataRootMock,
  restoreRuntimeDataBackup: restoreRuntimeDataBackupMock,
  downloadDataExport: downloadDataExportMock
}));

function makeBackup(overrides: Partial<DataBackupEntry> = {}): DataBackupEntry {
  return {
    id: "bkp_1",
    createdAt: "2026-04-11T12:00:00.000Z",
    mode: "manual",
    note: "Golden state",
    sourceDataRoot: "/Users/omarclaw/Documents/aurel-monorepo/data/forge",
    backupDirectory: "/Users/omarclaw/Documents/aurel-monorepo/data/forge/backups",
    archivePath:
      "/Users/omarclaw/Documents/aurel-monorepo/data/forge/backups/forge-backup.zip",
    manifestPath:
      "/Users/omarclaw/Documents/aurel-monorepo/data/forge/backups/forge-backup.manifest.json",
    databasePath: "/Users/omarclaw/Documents/aurel-monorepo/data/forge/forge.sqlite",
    sizeBytes: 2048,
    includesWiki: true,
    includesSecretsKey: true,
    counts: {
      notes: 12,
      goals: 3,
      projects: 2,
      tasks: 8,
      taskRuns: 1,
      tags: 4
    },
    ...overrides
  };
}

function makeCandidate(
  overrides: Partial<DataRecoveryCandidate> = {}
): DataRecoveryCandidate {
  return {
    id: "candidate_1",
    dataRoot: "/Users/omarclaw/Documents/aurel-monorepo/data/forge-recovered",
    databasePath:
      "/Users/omarclaw/Documents/aurel-monorepo/data/forge-recovered/forge.sqlite",
    layout: "flat",
    sourceHint: "Shared data",
    databaseSizeBytes: 4096,
    databaseLastModifiedAt: "2026-04-11T13:00:00.000Z",
    integrityOk: true,
    integrityMessage: "ok",
    counts: {
      notes: 18,
      goals: 4,
      projects: 3,
      tasks: 12,
      taskRuns: 2,
      tags: 6
    },
    newerThanCurrent: true,
    sameAsCurrent: false,
    ...overrides
  };
}

function makeDataState(overrides: Partial<DataManagementState> = {}): DataManagementState {
  return {
    generatedAt: "2026-04-11T12:30:00.000Z",
    current: {
      dataRoot: "/Users/omarclaw/Documents/aurel-monorepo/data/forge",
      databasePath: "/Users/omarclaw/Documents/aurel-monorepo/data/forge/forge.sqlite",
      layout: "flat",
      databaseSizeBytes: 8192,
      databaseLastModifiedAt: "2026-04-11T12:29:00.000Z",
      integrityOk: true,
      integrityMessage: "ok",
      counts: {
        notes: 12,
        goals: 3,
        projects: 2,
        tasks: 8,
        taskRuns: 1,
        tags: 4
      }
    },
    settings: {
      preferredDataRoot: "/Users/omarclaw/Documents/aurel-monorepo/data/forge",
      backupDirectory: "/Users/omarclaw/Documents/aurel-monorepo/data/forge/backups",
      backupFrequencyHours: 24,
      autoRepairEnabled: true,
      lastAutoBackupAt: "2026-04-11T08:00:00.000Z",
      lastManualBackupAt: "2026-04-11T11:00:00.000Z"
    },
    backups: [makeBackup()],
    exportOptions: [
      {
        format: "sqlite",
        label: "SQLite snapshot",
        description: "A portable SQLite snapshot of the live Forge database.",
        mimeType: "application/vnd.sqlite3",
        extension: "sqlite"
      },
      {
        format: "schema_sql",
        label: "Schema SQL",
        description: "SQL DDL for the current database structure.",
        mimeType: "application/sql",
        extension: "sql"
      }
    ],
    ...overrides
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SettingsDataPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SettingsDataPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    anchorClickMock.mockReset();

    ensureOperatorSessionMock.mockResolvedValue({
      session: {
        actorLabel: "Albert"
      }
    });

    getDataManagementStateMock.mockResolvedValue({
      data: makeDataState()
    });

    patchDataManagementSettingsMock.mockResolvedValue({
      settings: makeDataState().settings,
      data: makeDataState()
    });

    createRuntimeDataBackupMock.mockResolvedValue({
      backup: makeBackup(),
      data: makeDataState()
    });

    scanDataRecoveryCandidatesMock.mockResolvedValue({
      candidates: [makeCandidate()]
    });

    switchRuntimeDataRootMock.mockResolvedValue({
      data: makeDataState({
        current: {
          ...makeDataState().current,
          dataRoot:
            "/Users/omarclaw/Documents/aurel-monorepo/data/forge-recovered",
          databasePath:
            "/Users/omarclaw/Documents/aurel-monorepo/data/forge-recovered/forge.sqlite"
        }
      })
    });

    restoreRuntimeDataBackupMock.mockResolvedValue({
      data: makeDataState()
    });

    downloadDataExportMock.mockResolvedValue({
      blob: new Blob(["schema"], { type: "application/sql" }),
      fileName: "forge-schema.sql",
      mimeType: "application/sql"
    });

    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:forge"),
      revokeObjectURL: vi.fn()
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(anchorClickMock);
  });

  it("renders the live data view after the operator session resolves", async () => {
    renderPage();

    expect(await screen.findByText("Data")).toBeInTheDocument();
    expect(
      (
        await screen.findAllByText(
          "/Users/omarclaw/Documents/aurel-monorepo/data/forge"
        )
      ).length
    ).toBeGreaterThan(0);
    expect(screen.getByText("Settings nav")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("saves the backup settings with the edited values", async () => {
    renderPage();

    const backupFolderInput = (await screen.findByDisplayValue(
      "/Users/omarclaw/Documents/aurel-monorepo/data/forge/backups"
    )) as HTMLInputElement;
    fireEvent.change(backupFolderInput, {
      target: { value: "/Users/omarclaw/Documents/aurel-monorepo/data/forge/custom-backups" }
    });

    fireEvent.change(screen.getAllByRole("combobox")[0], {
      target: { value: "168" }
    });

    const checkboxes = await screen.findAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole("button", { name: "Save backup settings" }));

    await waitFor(() =>
      expect(patchDataManagementSettingsMock).toHaveBeenCalledWith({
        backupDirectory:
          "/Users/omarclaw/Documents/aurel-monorepo/data/forge/custom-backups",
        backupFrequencyHours: 168,
        autoRepairEnabled: false
      })
    );
  });

  it("runs the guided root-switch flow and submits the selected folder", async () => {
    renderPage();

    fireEvent.click(
      (await screen.findAllByRole("button", {
        name: "Use existing data folder"
      }))[0]
    );
    expect(
      await screen.findByText("Use an existing Forge data folder")
    ).toBeInTheDocument();

    const dataFolderInput = screen.getByPlaceholderText(
      "/absolute/path/to/forge-data"
    );
    fireEvent.change(dataFolderInput, {
      target: {
        value: "/Users/omarclaw/Documents/aurel-monorepo/data/forge-restored"
      }
    });

    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));

    await waitFor(() =>
      expect(switchRuntimeDataRootMock).toHaveBeenCalledWith({
        targetDataRoot:
          "/Users/omarclaw/Documents/aurel-monorepo/data/forge-restored",
        mode: "adopt_existing",
        createSafetyBackup: true
      })
    );
  });

  it("opens the restore flow from backup history and restores the selected backup", async () => {
    renderPage();

    fireEvent.click((await screen.findAllByRole("button", { name: "Restore" }))[0]);

    expect(await screen.findByText("Restore Forge backup")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore this backup" }));

    await waitFor(() =>
      expect(restoreRuntimeDataBackupMock).toHaveBeenCalledWith("bkp_1", true)
    );
  });

  it("scans for other copies and downloads an export", async () => {
    renderPage();

    fireEvent.click(
      (await screen.findAllByRole("button", {
        name: "Look for other Forge copies"
      }))[0]
    );

    expect(
      await screen.findByText(
        "/Users/omarclaw/Documents/aurel-monorepo/data/forge-recovered"
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Download" })[1]);

    await waitFor(() =>
      expect(downloadDataExportMock).toHaveBeenCalledWith("schema_sql")
    );
  });
});
