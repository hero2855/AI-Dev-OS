import { createDryRunExecutionPlan } from "../skill-system/execution-plan";
import type { CreateDryRunExecutionPlanParams } from "../skill-system/execution-plan";
import { runProjectHealthCheck } from "../project-health";
import { getWorkspaceProjectById, selectProjectForGoal } from "../workspace";
import { createWorkflowApprovalRecord } from "./approval";
import { shouldBlockWorkflow } from "./guards";
import type { CreateSafeDevelopmentWorkflowOptions, DevelopmentWorkflowResult } from "./types";

type WorkflowSkillMetadata = CreateDryRunExecutionPlanParams["skill"];

const safetySummary = [
  "no files modified",
  "no env files read",
  "no remote code executed",
  "no shell/network/browser execution",
].join("; ");

function includesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function selectWorkflowSkill(goal: string): WorkflowSkillMetadata {
  const normalizedGoal = goal.toLowerCase();

  if (includesAny(normalizedGoal, ["search", "github", "repo", "repository", "find", "look up", "查找"])) {
    return {
      name: "github-search-skill",
      capabilities: ["github_search", "repo_discovery"],
      permissions: ["network:github"],
    };
  }

  if (includesAny(normalizedGoal, ["refactor", "重构", "performance", "性能"])) {
    return {
      name: "code-refactor-skill",
      capabilities: ["code_refactor", "source_editing"],
      permissions: ["file:read", "file:write:src"],
    };
  }

  return {
    name: "auto-readme-generator",
    capabilities: ["readme_generation", "docs_generation"],
    permissions: ["file:read", "file:write:docs"],
  };
}

function baseRecommendedNextSteps(): string[] {
  return [
    "Review workflow result before making changes.",
    "Confirm target project before execution.",
    "Run project-specific tests after modifications.",
  ];
}

export function createSafeDevelopmentWorkflow(
  goal: string,
  options: CreateSafeDevelopmentWorkflowOptions = {},
): DevelopmentWorkflowResult {
  const projectSelection = selectProjectForGoal(goal);
  const selectedProject = projectSelection.selectedProject
    ? getWorkspaceProjectById(projectSelection.selectedProject.id)
    : undefined;

  if (!selectedProject) {
    const approvalRecord = createWorkflowApprovalRecord({
      goal,
      riskLevel: projectSelection.riskLevel,
      requiresApproval: true,
      plannedReads: [],
      plannedWrites: [],
      permissions: [],
      capabilities: [],
      blockedReasons: [],
      requestedBy: options.requestedBy,
      requestedAt: options.requestedAt,
      decision: options.approvalDecision,
    });

    return {
      goal,
      status: "needs-clarification",
      currentStage: "project-selection",
      projectRiskLevel: projectSelection.riskLevel,
      plannedReads: [],
      plannedWrites: [],
      requiresApproval: true,
      blockedReasons: [],
      warnings: [projectSelection.reason],
      recommendedNextSteps: ["Clarify which project should be modified."],
      safetySummary,
      approvalRecord,
    };
  }

  const healthCheck = runProjectHealthCheck(selectedProject);
  const skill = selectWorkflowSkill(goal);
  const dryRunPlan = createDryRunExecutionPlan({
    goal,
    skill,
    targetProjectPath: selectedProject.rootPath,
  });
  const guard = shouldBlockWorkflow({
    selectedProject,
    projectSelection,
    healthCheck,
    dryRunPlan,
  });
  const warnings = [...healthCheck.warnings];
  const recommendedNextSteps = [...baseRecommendedNextSteps(), ...healthCheck.recommendedNextSteps];

  if (projectSelection.requiresClarification) {
    warnings.push(projectSelection.reason);
    recommendedNextSteps.push("Clarify protected project intent before execution.");
  }

  if (dryRunPlan.requiresApproval) {
    recommendedNextSteps.push("Approve dry-run plan before sandbox execution.");
  }

  const initiallyRequiresApproval = guard.requiresApproval || dryRunPlan.requiresApproval || projectSelection.requiresClarification;
  const rejectedReasons = options.approvalDecision?.status === "rejected" ? ["Workflow approval rejected"] : [];
  const effectiveBlockedReasons = [...guard.blockedReasons, ...rejectedReasons];
  const approvalRecord = createWorkflowApprovalRecord({
    goal,
    project: selectedProject,
    riskLevel: projectSelection.riskLevel,
    requiresApproval: initiallyRequiresApproval,
    plannedReads: dryRunPlan.plannedReads,
    plannedWrites: dryRunPlan.plannedWrites,
    permissions: dryRunPlan.permissions,
    capabilities: dryRunPlan.capabilities,
    blockedReasons: effectiveBlockedReasons,
    requestedBy: options.requestedBy,
    requestedAt: options.requestedAt,
    decision: options.approvalDecision,
  });

  if (approvalRecord.status === "rejected") {
    return {
      goal,
      status: "blocked",
      currentStage: "blocked",
      selectedProjectId: selectedProject.id,
      selectedProjectName: selectedProject.name,
      projectRiskLevel: projectSelection.riskLevel,
      projectHealthStatus: healthCheck.status,
      dryRunSummary: dryRunPlan.summary,
      plannedReads: dryRunPlan.plannedReads,
      plannedWrites: dryRunPlan.plannedWrites,
      requiresApproval: true,
      blockedReasons: approvalRecord.blockedReasons,
      warnings,
      recommendedNextSteps,
      safetySummary,
      approvalRecord,
    };
  }

  if (guard.blocked) {
    return {
      goal,
      status: "blocked",
      currentStage: "blocked",
      selectedProjectId: selectedProject.id,
      selectedProjectName: selectedProject.name,
      projectRiskLevel: projectSelection.riskLevel,
      projectHealthStatus: healthCheck.status,
      dryRunSummary: dryRunPlan.summary,
      plannedReads: dryRunPlan.plannedReads,
      plannedWrites: dryRunPlan.plannedWrites,
      requiresApproval: true,
      blockedReasons: guard.blockedReasons,
      warnings,
      recommendedNextSteps,
      safetySummary,
      approvalRecord,
    };
  }

  if (projectSelection.requiresClarification && approvalRecord.status !== "approved") {
    return {
      goal,
      status: "needs-clarification",
      currentStage: "approval-gate",
      selectedProjectId: selectedProject.id,
      selectedProjectName: selectedProject.name,
      projectRiskLevel: projectSelection.riskLevel,
      projectHealthStatus: healthCheck.status,
      dryRunSummary: dryRunPlan.summary,
      plannedReads: dryRunPlan.plannedReads,
      plannedWrites: dryRunPlan.plannedWrites,
      requiresApproval: true,
      blockedReasons: [],
      warnings,
      recommendedNextSteps,
      safetySummary,
      approvalRecord,
    };
  }

  if ((guard.requiresApproval || dryRunPlan.requiresApproval) && approvalRecord.status !== "approved") {
    return {
      goal,
      status: "needs-approval",
      currentStage: "approval-gate",
      selectedProjectId: selectedProject.id,
      selectedProjectName: selectedProject.name,
      projectRiskLevel: projectSelection.riskLevel,
      projectHealthStatus: healthCheck.status,
      dryRunSummary: dryRunPlan.summary,
      plannedReads: dryRunPlan.plannedReads,
      plannedWrites: dryRunPlan.plannedWrites,
      requiresApproval: true,
      blockedReasons: [],
      warnings,
      recommendedNextSteps,
      safetySummary,
      approvalRecord,
    };
  }

  return {
    goal,
    status: "ready",
    currentStage: "ready",
    selectedProjectId: selectedProject.id,
    selectedProjectName: selectedProject.name,
    projectRiskLevel: projectSelection.riskLevel,
    projectHealthStatus: healthCheck.status,
    dryRunSummary: dryRunPlan.summary,
    plannedReads: dryRunPlan.plannedReads,
    plannedWrites: dryRunPlan.plannedWrites,
    requiresApproval: false,
    blockedReasons: [],
    warnings,
    recommendedNextSteps,
    safetySummary,
    approvalRecord,
  };
}
