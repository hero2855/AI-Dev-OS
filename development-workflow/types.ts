export type DevelopmentWorkflowStage =
  | "project-selection"
  | "health-check"
  | "dry-run-plan"
  | "sandbox-check"
  | "approval-gate"
  | "ready"
  | "blocked";

export type DevelopmentWorkflowStatus = "ready" | "needs-approval" | "needs-clarification" | "blocked";

export type WorkflowApprovalStatus = "pending" | "approved" | "rejected" | "not_required" | "blocked";

export type WorkflowApprovalDecision = {
  status: "approved" | "rejected";
  decidedBy?: string;
  decidedAt?: string;
};

export type WorkflowApprovalRecord = {
  approvalId: string;
  status: WorkflowApprovalStatus;
  approvedBy?: string;
  requestedBy?: string;
  requestedAt: string;
  decidedAt?: string;
  goal: string;
  projectId?: string;
  projectType?: string;
  riskLevel?: string;
  requiresApproval: boolean;
  approvedPlannedReads: string[];
  approvedPlannedWrites: string[];
  approvedPermissions: string[];
  approvedCapabilities: string[];
  blockedReasons: string[];
  approvalSummary: string;
};

export type CreateSafeDevelopmentWorkflowOptions = {
  approvalDecision?: WorkflowApprovalDecision;
  requestedBy?: string;
  requestedAt?: string;
};

export type DevelopmentWorkflowResult = {
  goal: string;
  status: DevelopmentWorkflowStatus;
  currentStage: DevelopmentWorkflowStage;
  selectedProjectId?: string;
  selectedProjectName?: string;
  projectRiskLevel?: string;
  projectHealthStatus?: string;
  dryRunSummary?: string;
  plannedReads: string[];
  plannedWrites: string[];
  requiresApproval: boolean;
  blockedReasons: string[];
  warnings: string[];
  recommendedNextSteps: string[];
  safetySummary: string;
  approvalRecord: WorkflowApprovalRecord;
};
