export type DryRunRiskLevel = "low" | "medium" | "high" | "blocked";

export type DryRunGuidance = {
  source: string;
  appliesTo: "coding";
  advisoryOnly: boolean;
  instructions: string[];
};

export type DryRunExecutionPlan = {
  mode: "dry-run";
  goal: string;
  skill: string;
  capabilities: string[];
  permissions: string[];
  guidance: DryRunGuidance[];
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
