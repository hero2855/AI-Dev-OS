import type { Skill } from "../types";
import type { GitHubSkill } from "./types";

function getRepoName(repoUrl: string): string {
  const normalized = repoUrl.trim().replace(/\/$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || "github-skill";
}

export async function loadGitHubSkill(repoUrl: string): Promise<Skill> {
  const repoName = getRepoName(repoUrl);

  return {
    name: repoName,
    description: `Mock GitHub-loaded skill from ${repoUrl}`,
    execute: async (input: any): Promise<string> => {
      const payload = typeof input === "string" ? input : JSON.stringify(input);
      return `Mock GitHub skill (${repoName}) executed with input: ${payload}`;
    },
  };
}

export function createMockGitHubSkill(config: GitHubSkill): Skill {
  return {
    name: config.name,
    description: config.description,
    execute: async (input: any): Promise<string> => {
      const payload = typeof input === "string" ? input : JSON.stringify(input);
      return `Mock GitHub skill ${config.name} from ${config.repo} executed with input: ${payload}`;
    },
  };
}

export default loadGitHubSkill;
