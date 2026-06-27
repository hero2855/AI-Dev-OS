import type { DryRunRiskLevel } from "./types";

export type AssessDryRunRiskInput = {
  permissions: string[];
  unknownSkill?: boolean;
};

export type DryRunRiskAssessment = {
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
  blockedReasons: string[];
};

const riskRank: Record<DryRunRiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  blocked: 4,
};

function maxRisk(current: DryRunRiskLevel, next: DryRunRiskLevel): DryRunRiskLevel {
  return riskRank[next] > riskRank[current] ? next : current;
}

export function assessDryRunRisk(input: AssessDryRunRiskInput): DryRunRiskAssessment {
  const permissionSet = new Set(input.permissions);
  const blockedReasons: string[] = [];
  let riskLevel: DryRunRiskLevel = "low";
  let requiresApproval = false;

  if (permissionSet.has("shell:execute")) {
    riskLevel = "blocked";
    requiresApproval = true;
    blockedReasons.push("shell:execute is disabled before sandbox execution");
  }

  if (permissionSet.has("browser:write")) {
    riskLevel = "blocked";
    requiresApproval = true;
    blockedReasons.push("browser:write is disabled before browser sandbox");
  }

  if (riskLevel !== "blocked") {
    if (permissionSet.has("file:write:src")) {
      riskLevel = maxRisk(riskLevel, "medium");
      requiresApproval = true;
    }

    if (permissionSet.has("file:write:docs")) {
      riskLevel = maxRisk(riskLevel, "low");
      requiresApproval = true;
    }

    if (permissionSet.has("network:github")) {
      riskLevel = maxRisk(riskLevel, "low");
    }

    if (input.unknownSkill) {
      riskLevel = maxRisk(riskLevel, "medium");
      requiresApproval = true;
    }
  }

  return {
    riskLevel,
    requiresApproval,
    blockedReasons,
  };
}
