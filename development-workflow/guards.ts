import { basename, isAbsolute, relative, resolve } from "node:path";
import type { DryRunExecutionPlan } from "../skill-system/execution-plan";
import type { ProjectHealthCheckResult } from "../project-health";
import type { ProjectSelectionResult, WorkspaceProject } from "../workspace";

export type DevelopmentWorkflowGuardInput = {
  selectedProject?: WorkspaceProject;
  projectSelection?: ProjectSelectionResult;
  healthCheck?: ProjectHealthCheckResult;
  dryRunPlan?: Pick<DryRunExecutionPlan, "riskLevel" | "blockedReasons" | "plannedWrites">;
};

export type DevelopmentWorkflowGuardResult = {
  blocked: boolean;
  blockedReasons: string[];
  requiresApproval: boolean;
};

function isSensitiveEnvWrite(path: string): boolean {
  const fileName = basename(path).toLowerCase();
  return fileName === ".env" || fileName === ".env.local";
}

function isPathEscape(project: WorkspaceProject, path: string): boolean {
  const rootPath = resolve(project.rootPath);
  const targetPath = isAbsolute(path) ? resolve(path) : resolve(rootPath, path);
  const relativePath = relative(rootPath, targetPath);

  return relativePath.startsWith("..") || isAbsolute(relativePath);
}

export function shouldBlockWorkflow(input: DevelopmentWorkflowGuardInput): DevelopmentWorkflowGuardResult {
  const blockedReasons: string[] = [];
  let requiresApproval = false;

  if (!input.selectedProject) {
    blockedReasons.push("No project selected");
  }

  if (input.selectedProject?.protected) {
    requiresApproval = true;
  }

  if (input.projectSelection?.requiresClarification) {
    requiresApproval = true;
  }

  if (input.healthCheck?.status === "blocked") {
    blockedReasons.push(...input.healthCheck.blockingIssues);
  }

  if (input.dryRunPlan?.riskLevel === "blocked") {
    blockedReasons.push(...input.dryRunPlan.blockedReasons);
  }

  for (const plannedWrite of input.dryRunPlan?.plannedWrites || []) {
    if (isSensitiveEnvWrite(plannedWrite)) {
      blockedReasons.push("Workflow cannot write sensitive env files");
    }

    if (input.selectedProject && isPathEscape(input.selectedProject, plannedWrite)) {
      blockedReasons.push("Workflow path escape detected");
    }
  }

  return {
    blocked: blockedReasons.length > 0,
    blockedReasons: Array.from(new Set(blockedReasons)),
    requiresApproval,
  };
}
