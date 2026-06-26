import type { Skill } from "../types";
import { createMockGitHubSkill } from "./loader";
import type { GitHubSkill } from "./types";

export const mockGitHubSkillConfigs: GitHubSkill[] = [
  {
    name: "github-search-skill",
    repo: "https://github.com/ai-dev-os/github-search-skill",
    entry: "index.ts",
    description: "Mock skill for searching GitHub repositories.",
  },
  {
    name: "auto-readme-generator",
    repo: "https://github.com/ai-dev-os/auto-readme-generator",
    entry: "index.ts",
    description: "Mock skill for generating README content.",
  },
  {
    name: "code-refactor-skill",
    repo: "https://github.com/ai-dev-os/code-refactor-skill",
    entry: "index.ts",
    description: "Mock skill for refactoring code.",
  },
];

export const mockGitHubSkills: Skill[] = mockGitHubSkillConfigs.map((config) => {
  if (config.name === "github-search-skill") {
    return {
      ...createMockGitHubSkill(config),
      execute: async (input: any): Promise<string> => {
        const query = typeof input === "string" ? input : JSON.stringify(input);
        return `Mock GitHub repo search result for: ${query}`;
      },
    };
  }

  if (config.name === "auto-readme-generator") {
    return {
      ...createMockGitHubSkill(config),
      execute: async (input: any): Promise<string> => {
        const topic = typeof input === "string" ? input : JSON.stringify(input);
        return `Mock README generated for: ${topic}`;
      },
    };
  }

  if (config.name === "code-refactor-skill") {
    return {
      ...createMockGitHubSkill(config),
      execute: async (input: any): Promise<string> => {
        const task = typeof input === "string" ? input : JSON.stringify(input);
        return `Mock code refactor completed for: ${task}`;
      },
    };
  }

  return createMockGitHubSkill(config);
});

export function selectMockGitHubSkill(goal: string): Skill | undefined {
  const normalizedGoal = typeof goal === "string" ? goal.toLowerCase() : "";

  if (
    normalizedGoal.includes("github") &&
    (normalizedGoal.includes("search") ||
      normalizedGoal.includes("find") ||
      normalizedGoal.includes("repo") ||
      normalizedGoal.includes("repository"))
  ) {
    return mockGitHubSkills.find((skill) => skill.name === "github-search-skill");
  }

  if (normalizedGoal.includes("readme")) {
    return mockGitHubSkills.find((skill) => skill.name === "auto-readme-generator");
  }

  if (normalizedGoal.includes("refactor")) {
    return mockGitHubSkills.find((skill) => skill.name === "code-refactor-skill");
  }

  return undefined;
}
