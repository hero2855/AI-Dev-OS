export type ProjectType = "system-core" | "skill-manifest-repo" | "product-app";

export type ProjectRiskLevel = "low" | "medium" | "high";

export type WorkspaceProject = {
  id: string;
  name: string;
  type: ProjectType;
  rootPath: string;
  description: string;
  protected: boolean;
  defaultBranch?: string;
  tags: string[];
};

export type ProjectSelectionResult = {
  selectedProject?: WorkspaceProject;
  confidence: number;
  requiresClarification: boolean;
  reason: string;
  riskLevel: ProjectRiskLevel;
};
