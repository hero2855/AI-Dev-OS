export type { ProjectRiskLevel, ProjectSelectionResult, ProjectType, WorkspaceProject } from "./types";
export {
  assertWorkspaceProjectExists,
  getDefaultWorkspaceProjects,
  getWorkspaceProjectById,
  listWorkspaceProjects,
} from "./projects";
export {
  assertNotSensitiveProjectPath,
  assertPathInsideProject,
  assertWorkspacePathAllowed,
  normalizeProjectPath,
} from "./pathGuard";
export { selectProjectForGoal } from "./selector";
export { createWorkspaceManager } from "./workspaceManager";
export { runProjectHealthCheck } from "../project-health";
export type { ProjectHealthCheckResult, ProjectHealthStatus, ProjectRuntime } from "../project-health";
