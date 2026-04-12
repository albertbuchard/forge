export type DataBackupMode =
  | "manual"
  | "automatic"
  | "pre_restore"
  | "pre_switch_root";

export type DataRootSwitchMode = "migrate_current" | "adopt_existing";

export type DataExportFormat =
  | "sqlite"
  | "json"
  | "csv_bundle"
  | "schema_sql"
  | "schema_json";

export type DataLayout = "flat" | "legacy" | "missing";

export interface DataEntityCountSummary {
  notes: number;
  goals: number;
  projects: number;
  tasks: number;
  taskRuns: number;
  tags: number;
}

export interface DataBackupEntry {
  id: string;
  createdAt: string;
  mode: DataBackupMode;
  note: string;
  sourceDataRoot: string;
  backupDirectory: string;
  archivePath: string;
  manifestPath: string;
  databasePath: string;
  sizeBytes: number;
  includesWiki: boolean;
  includesSecretsKey: boolean;
  counts: DataEntityCountSummary;
}

export interface DataRuntimeSnapshot {
  dataRoot: string;
  databasePath: string;
  layout: DataLayout;
  databaseSizeBytes: number;
  databaseLastModifiedAt: string | null;
  integrityOk: boolean;
  integrityMessage: string;
  counts: DataEntityCountSummary;
}

export interface DataRecoveryCandidate {
  id: string;
  dataRoot: string;
  databasePath: string;
  layout: DataLayout;
  sourceHint: string;
  databaseSizeBytes: number;
  databaseLastModifiedAt: string | null;
  integrityOk: boolean;
  integrityMessage: string;
  counts: DataEntityCountSummary;
  newerThanCurrent: boolean;
  sameAsCurrent: boolean;
}

export interface DataExportOption {
  format: DataExportFormat;
  label: string;
  description: string;
  mimeType: string;
  extension: string;
}

export interface DataManagementSettings {
  preferredDataRoot: string;
  backupDirectory: string;
  backupFrequencyHours: number | null;
  autoRepairEnabled: boolean;
  lastAutoBackupAt: string | null;
  lastManualBackupAt: string | null;
}

export interface DataManagementState {
  generatedAt: string;
  current: DataRuntimeSnapshot;
  settings: DataManagementSettings;
  backups: DataBackupEntry[];
  exportOptions: DataExportOption[];
}
