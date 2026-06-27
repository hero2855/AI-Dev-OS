import type { GitHubSkillManifest } from "../github/manifest";
import { assessDryRunRisk } from "./risk";
import type { DryRunExecutionPlan } from "./types";

export type DryRunSkillMetadata = Pick<GitHubSkillManifest, "name" | "capabilities" | "permissions">;

export type CreateDryRunExecutionPlanParams = {
  goal: string;
  skill: DryRunSkillMetadata;
  targetProjectPath?: string;
  plannedReads?: string[];
  plannedWrites?: string[];
};

const knownSkillPlans: Record<string, { plannedReads: string[]; plannedWrites: string[] }> = {
  "github-search-skill": {
    plannedReads: [],
    plannedWrites: [],
  },
  "auto-readme-generator": {
    plannedReads: ["README.md", "package.json"],
    plannedWrites: ["README.md"],
  },
  "code-refactor-skill": {
    plannedReads: ["src/**"],
    plannedWrites: ["src/**"],
  },
};

function inferPlannedReads(skillName: string): string[] {
  return knownSkillPlans[skillName]?.plannedReads ?? [];
}

function inferPlannedWrites(skillName: string): string[] {
  return knownSkillPlans[skillName]?.plannedWrites ?? [];
}

export function createDryRunExecutionPlan(params: CreateDryRunExecutionPlanParams): DryRunExecutionPlan {
  const skillName = params.skill.name;
  const permissions = [...params.skill.permissions];
  const capabilities = [...params.skill.capabilities];
  const unknownSkill = !Object.prototype.hasOwnProperty.call(knownSkillPlans, skillName);
  const plannedReads = params.plannedReads ? [...params.plannedReads] : inferPlannedReads(skillName);
  const plannedWrites = params.plannedWrites ? [...params.plannedWrites] : inferPlannedWrites(skillName);
  const risk = assessDryRunRisk({
    permissions,
    unknownSkill,
  });

  return {
    mode: "dry-run",
    goal: params.goal,
    skill: skillName,
    capabilities,
    permissions,
    plannedReads,
    plannedWrites,
    networkAccess: permissions.some((permission) => permission.startsWith("network:")),
    shellAccess: permissions.some((permission) => permission.startsWith("shell:")),
    browserAccess: permissions.some((permission) => permission.startsWith("browser:")),
    riskLevel: risk.riskLevel,
    requiresApproval: risk.requiresApproval,
    blockedReasons: risk.blockedReasons,
    summary: "Dry run only. No files were modified. Review and approve before execution.",
  };
}
