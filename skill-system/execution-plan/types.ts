export type DryRunRiskLevel = "low" | "medium" | "high" | "blocked";

export type DryRunExecutionPlan = {
  mode: "dry-run";
  goal: string;
  skill: string;
  capabilities: string[];
  permissions: string[];
  plannedReads: string[];
  plannedWrites: string[];
  networkAccess: boolean;
  shellAccess: boolean;
  browserAccess: boolean;
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
  blockedReasons: string[];
  summary: string;
};
