import type { WorkspaceProject } from "./types";

const defaultWorkspaceProjects: WorkspaceProject[] = [
  {
    id: "ai-dev-os",
    name: "AI Dev OS",
    type: "system-core",
    rootPath: "D:\\Atlas-OS\\Projects\\AI-Dev-OS",
    description: "AI Dev OS system core. Protected from ordinary business-task edits.",
    protected: true,
    defaultBranch: "main",
    tags: ["system", "agent", "core", "ai-dev-os"],
  },
  {
    id: "ai-dev-os-skills",
    name: "AI Dev OS Skills",
    type: "skill-manifest-repo",
    rootPath: "D:\\Atlas-OS\\Projects\\AI-Dev-OS-skills",
    description: "Trusted skill manifest repository. Stores skill manifests only and does not execute remote code.",
    protected: true,
    defaultBranch: "main",
    tags: ["skills", "manifest", "github", "trusted-repo"],
  },
  {
    id: "project-001-resume-ai",
    name: "Project 001 Resume AI",
    type: "product-app",
    rootPath: "D:\\Atlas-OS\\Projects\\Project-001-Resume-AI",
    description: "First monetizable product app for Resume AI, deployed to Vercel.",
    protected: false,
    defaultBranch: "main",
    tags: ["resume", "cv", "jianli", "product", "vercel", "monetizable-product"],
  },
];

export function getDefaultWorkspaceProjects(): WorkspaceProject[] {
  return defaultWorkspaceProjects.map((project) => ({
    ...project,
    tags: [...project.tags],
  }));
}

export function listWorkspaceProjects(): WorkspaceProject[] {
  return getDefaultWorkspaceProjects();
}

export function getWorkspaceProjectById(projectId: string): WorkspaceProject | undefined {
  return getDefaultWorkspaceProjects().find((project) => project.id === projectId);
}

export function assertWorkspaceProjectExists(projectId: string): WorkspaceProject {
  const project = getWorkspaceProjectById(projectId);

  if (!project) {
    throw new Error(`Workspace project not found: ${projectId}`);
  }

  return project;
}
