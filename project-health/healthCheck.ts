import { join } from "node:path";
import type { WorkspaceProject } from "../workspace/types";
import {
  detectDeploymentHints,
  detectEnvExample,
  detectLockfiles,
  detectPackageManager,
  detectRuntime,
  detectScripts,
  fileExists,
  readJsonFileSafe,
} from "./detectors";
import type { ProjectHealthCheckResult, ProjectHealthStatus } from "./types";

function buildRecommendedNextSteps(project: WorkspaceProject): string[] {
  const steps = [
    "Review project health before making changes.",
    "Confirm target project before execution.",
    "Run project-specific tests after modifications.",
  ];

  if (project.protected) {
    steps.push("Require explicit confirmation before modifying protected project.");
  }

  return steps;
}

function deriveStatus(exists: boolean, warnings: string[], blockingIssues: string[]): ProjectHealthStatus {
  if (!exists || blockingIssues.length > 0) {
    return "blocked";
  }

  if (warnings.length > 0) {
    return "warning";
  }

  return "healthy";
}

export function runProjectHealthCheck(project: WorkspaceProject): ProjectHealthCheckResult {
  const exists = fileExists(project.rootPath);
  const warnings: string[] = [];
  const blockingIssues: string[] = [];
  const packageJsonPath = join(project.rootPath, "package.json");
  const packageJsonExists = exists && fileExists(packageJsonPath);
  const packageJson = packageJsonExists ? readJsonFileSafe(packageJsonPath) : undefined;
  const packageManager = exists ? detectPackageManager(project.rootPath) : "unknown";
  const scripts = detectScripts(packageJson);
  const envExampleExists = exists && detectEnvExample(project.rootPath);

  if (!exists) {
    blockingIssues.push("Project root path does not exist");
  }

  if (!packageJsonExists) {
    warnings.push("package.json not found");
  }

  if (packageManager === "unknown") {
    warnings.push("No lockfile detected");
  }

  if (!scripts.build) {
    warnings.push("build script not found");
  }

  if (!envExampleExists) {
    warnings.push(".env.example not found");
  }

  if (project.protected) {
    warnings.push("Protected project requires explicit confirmation before modification");
  }

  return {
    projectId: project.id,
    projectName: project.name,
    rootPath: project.rootPath,
    exists,
    runtime: exists ? detectRuntime(project.rootPath, packageJson) : "unknown",
    packageJsonExists,
    packageManager,
    scripts,
    lockfiles: exists ? detectLockfiles(project.rootPath) : [],
    deploymentHints: exists ? detectDeploymentHints(project.rootPath, packageJson) : [],
    envExampleExists,
    envFilesWereRead: false,
    status: deriveStatus(exists, warnings, blockingIssues),
    warnings,
    blockingIssues,
    recommendedNextSteps: buildRecommendedNextSteps(project),
  };
}
