export type DevelopmentWorkflowStage =
  | "project-selection"
  | "health-check"
  | "dry-run-plan"
  | "sandbox-check"
  | "approval-gate"
  | "ready"
  | "blocked";

export type DevelopmentWorkflowStatus = "ready" | "needs-approval" | "needs-clarification" | "blocked";

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
};
