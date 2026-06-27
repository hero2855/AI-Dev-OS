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
