import { getWorkspaceProjectById } from "./projects";
import type { ProjectRiskLevel, ProjectSelectionResult, WorkspaceProject } from "./types";

const selectionRules: Array<{ projectId: string; keywords: string[]; confidence: number }> = [
  {
    projectId: "project-001-resume-ai",
    confidence: 0.86,
    keywords: [
      "product",
      "product-app",
      "next.js",
      "nextjs",
      "homepage",
      "landing page",
      "copy",
      "src",
      "code",
      "产品",
      "首页",
      "文案",
      "代码",
    ],
  },
  {
    projectId: "project-001-resume-ai",
    confidence: 0.9,
    keywords: ["resume", "cv", "jianli", "简历", "求职", "vercel", "付费版", "赚钱版"],
  },
  {
    projectId: "ai-dev-os-skills",
    confidence: 0.88,
    keywords: ["skill manifest", "ai-dev-os-skills", "trusted skill", "manifest repo", "技能仓库"],
  },
  {
    projectId: "ai-dev-os",
    confidence: 0.88,
    keywords: [
      "ai dev os",
      "agent core",
      "sandbox",
      "workspace manager",
      "permission policy",
      "dry run",
      "系统本体",
    ],
  },
];

const destructiveKeywords = ["delete", "remove", "删除", "清空"];

function containsKeyword(goal: string, keywords: string[]): boolean {
  const normalizedGoal = goal.toLowerCase();
  return keywords.some((keyword) => normalizedGoal.includes(keyword.toLowerCase()));
}

function buildSelection(project: WorkspaceProject, confidence: number, goal: string): ProjectSelectionResult {
  if (project.protected) {
    return {
      selectedProject: project,
      confidence,
      requiresClarification: true,
      reason: `Selected ${project.name}, but it is a protected project and requires explicit confirmation before changes.`,
      riskLevel: "high",
    };
  }

  const destructiveGoal = containsKeyword(goal, destructiveKeywords);
  const riskLevel: ProjectRiskLevel = destructiveGoal ? "high" : "medium";

  return {
    selectedProject: project,
    confidence,
    requiresClarification: destructiveGoal,
    reason: destructiveGoal
      ? `Selected ${project.name}, but the goal contains destructive wording and requires clarification.`
      : `Selected ${project.name} from product-app goal keywords.`,
    riskLevel,
  };
}

export function selectProjectForGoal(goal: string): ProjectSelectionResult {
  for (const rule of selectionRules) {
    if (!containsKeyword(goal, rule.keywords)) {
      continue;
    }

    const project = getWorkspaceProjectById(rule.projectId);

    if (!project) {
      break;
    }

    return buildSelection(project, rule.confidence, goal);
  }

  return {
    confidence: 0,
    requiresClarification: true,
    reason: "Unable to confidently select a project from the goal.",
    riskLevel: "medium",
  };
}
