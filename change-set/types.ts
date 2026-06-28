import type { DryRunRiskLevel } from "../skill-system/execution-plan";
import type { ProjectType, WorkspaceProject } from "../workspace";

export type ChangeSetPreviewStatus = "preview_ready" | "blocked" | "pending_approval";

export type PlannedChangeOperation = "create" | "update" | "delete" | "rename";

export type PlannedFileOperation = {
  operation: PlannedChangeOperation;
  path: string;
  targetPath?: string;
  changeSummary: string;
};

export type PlannedChangePreview = {
  operation: PlannedChangeOperation;
  path: string;
  normalizedPath: string;
  targetPath?: string;
  targetNormalizedPath?: string;
  targetProjectId: string;
  isProtectedPath: boolean;
  isEnvFile: boolean;
  isPathEscape: boolean;
  requiresApproval: boolean;
  changeSummary: string;
};

export type CreateChangeSetPreviewInput = {
  goal: string;
  project: WorkspaceProject;
  plannedChanges: PlannedFileOperation[];
  plannedReads?: string[];
  approvalRecordId?: string;
  allowDeletes?: boolean;
};

export type ChangeSetPreview = {
  changeSetId: string;
  goal: string;
  projectId: string;
  projectType: ProjectType;
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
  status: ChangeSetPreviewStatus;
  plannedChanges: PlannedChangePreview[];
  plannedReads: string[];
  plannedWrites: string[];
  blockedReasons: string[];
  approvalRecordId?: string;
  summary: string;
};
