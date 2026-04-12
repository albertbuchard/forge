import { z } from "zod";

export const dataBackupModeSchema = z.enum([
  "manual",
  "automatic",
  "pre_restore",
  "pre_switch_root"
]);

export const dataRootSwitchModeSchema = z.enum([
  "migrate_current",
  "adopt_existing"
]);

export const dataExportFormatSchema = z.enum([
  "sqlite",
  "json",
  "csv_bundle",
  "schema_sql",
  "schema_json"
]);

export const dataLayoutSchema = z.enum(["flat", "legacy", "missing"]);

export const dataEntityCountSummarySchema = z.object({
  notes: z.number().int().nonnegative(),
  goals: z.number().int().nonnegative(),
  projects: z.number().int().nonnegative(),
  tasks: z.number().int().nonnegative(),
  taskRuns: z.number().int().nonnegative(),
  tags: z.number().int().nonnegative()
});

export const dataBackupEntrySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  mode: dataBackupModeSchema,
  note: z.string(),
  sourceDataRoot: z.string(),
  backupDirectory: z.string(),
  archivePath: z.string(),
  manifestPath: z.string(),
  databasePath: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  includesWiki: z.boolean(),
  includesSecretsKey: z.boolean(),
  counts: dataEntityCountSummarySchema
});

export const dataRuntimeSnapshotSchema = z.object({
  dataRoot: z.string(),
  databasePath: z.string(),
  layout: dataLayoutSchema,
  databaseSizeBytes: z.number().int().nonnegative(),
  databaseLastModifiedAt: z.string().nullable(),
  integrityOk: z.boolean(),
  integrityMessage: z.string(),
  counts: dataEntityCountSummarySchema
});

export const dataRecoveryCandidateSchema = z.object({
  id: z.string(),
  dataRoot: z.string(),
  databasePath: z.string(),
  layout: dataLayoutSchema,
  sourceHint: z.string(),
  databaseSizeBytes: z.number().int().nonnegative(),
  databaseLastModifiedAt: z.string().nullable(),
  integrityOk: z.boolean(),
  integrityMessage: z.string(),
  counts: dataEntityCountSummarySchema,
  newerThanCurrent: z.boolean(),
  sameAsCurrent: z.boolean()
});

export const dataExportOptionSchema = z.object({
  format: dataExportFormatSchema,
  label: z.string(),
  description: z.string(),
  mimeType: z.string(),
  extension: z.string()
});

export const dataManagementSettingsSchema = z.object({
  preferredDataRoot: z.string(),
  backupDirectory: z.string(),
  backupFrequencyHours: z.number().int().positive().nullable(),
  autoRepairEnabled: z.boolean(),
  lastAutoBackupAt: z.string().nullable(),
  lastManualBackupAt: z.string().nullable()
});

export const dataManagementStateSchema = z.object({
  generatedAt: z.string(),
  current: dataRuntimeSnapshotSchema,
  settings: dataManagementSettingsSchema,
  backups: z.array(dataBackupEntrySchema),
  exportOptions: z.array(dataExportOptionSchema)
});

export const updateDataManagementSettingsSchema = z.object({
  backupDirectory: z.string().trim().optional(),
  backupFrequencyHours: z.number().int().positive().nullable().optional(),
  autoRepairEnabled: z.boolean().optional()
});

export const createDataBackupSchema = z.object({
  note: z.string().trim().default("")
});

export const switchDataRootSchema = z.object({
  targetDataRoot: z.string().trim().min(1),
  mode: dataRootSwitchModeSchema.default("migrate_current"),
  createSafetyBackup: z.boolean().default(true)
});

export const restoreDataBackupSchema = z.object({
  createSafetyBackup: z.boolean().default(true)
});

export const dataExportQuerySchema = z.object({
  format: dataExportFormatSchema
});

export type DataBackupMode = z.infer<typeof dataBackupModeSchema>;
export type DataRootSwitchMode = z.infer<typeof dataRootSwitchModeSchema>;
export type DataExportFormat = z.infer<typeof dataExportFormatSchema>;
export type DataBackupEntry = z.infer<typeof dataBackupEntrySchema>;
export type DataRuntimeSnapshot = z.infer<typeof dataRuntimeSnapshotSchema>;
export type DataRecoveryCandidate = z.infer<typeof dataRecoveryCandidateSchema>;
export type DataExportOption = z.infer<typeof dataExportOptionSchema>;
export type DataManagementSettings = z.infer<typeof dataManagementSettingsSchema>;
export type DataManagementState = z.infer<typeof dataManagementStateSchema>;
export type UpdateDataManagementSettingsInput = z.infer<
  typeof updateDataManagementSettingsSchema
>;
export type CreateDataBackupInput = z.infer<typeof createDataBackupSchema>;
export type SwitchDataRootInput = z.infer<typeof switchDataRootSchema>;
export type RestoreDataBackupInput = z.infer<typeof restoreDataBackupSchema>;
