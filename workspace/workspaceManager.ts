import { assertWorkspacePathAllowed } from "./pathGuard";
import { assertWorkspaceProjectExists, getWorkspaceProjectById, listWorkspaceProjects } from "./projects";
import { selectProjectForGoal } from "./selector";
import { runProjectHealthCheck } from "../project-health";

export function createWorkspaceManager() {
  return {
    listProjects: listWorkspaceProjects,
    getProject: getWorkspaceProjectById,
    selectProject: selectProjectForGoal,
    resolvePath(projectId: string, targetPath: string): string {
      const project = assertWorkspaceProjectExists(projectId);
      return assertWorkspacePathAllowed(project, targetPath);
    },
    checkHealth(projectId: string) {
      const project = assertWorkspaceProjectExists(projectId);
      return runProjectHealthCheck(project);
    },
  };
}
