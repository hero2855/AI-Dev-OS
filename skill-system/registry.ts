import type { Skill, SkillName } from "./types";
import type { GitHubSkillManifest } from "./github/manifest";

const registry = new Map<string, Skill>();

export function registerSkill(skill: Skill): Skill {
  if (!skill.name || typeof skill.execute !== "function") {
    throw new Error("Invalid skill");
  }

  registry.set(skill.name, skill);
  return skill;
}

export function registerSkills(skills: Skill[]): Skill[] {
  return skills.map((skill) => registerSkill(skill));
}

export function registerGitHubSkillFromManifest(manifest: GitHubSkillManifest): Skill {
  return registerSkill({
    name: manifest.name,
    description: manifest.description,
    execute: async (input: any): Promise<{
      type: "github_skill_manifest_placeholder";
      skill: string;
      input: any;
      message: string;
    }> => {
      return {
        type: "github_skill_manifest_placeholder",
        skill: manifest.name,
        input,
        message: "GitHub skill manifest loaded but remote execution is disabled in V4.4.4",
      };
    },
  });
}

export function registerGitHubSkillsFromManifestIndex(manifests: GitHubSkillManifest[]): Skill[] {
  return manifests.map((manifest) => registerGitHubSkillFromManifest(manifest));
}

export function getSkill(name: SkillName | string): Skill | undefined {
  return registry.get(name);
}

export function listSkills(): Skill[] {
  return Array.from(registry.values());
}

export default registry;
