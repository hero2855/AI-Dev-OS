import { registerSkill } from "./registry";
import { defaultSkills } from "./skills";
import { mockGitHubSkills, selectMockGitHubSkill } from "./github/mockRegistry";

for (const skill of [...defaultSkills, ...mockGitHubSkills]) {
  registerSkill(skill);
}

export type { Skill, SkillName } from "./types";
export type { GitHubSkill } from "./github/types";
export type { GitHubSkillManifest } from "./github/manifest";
export { registerSkill, registerSkills, registerGitHubSkillFromManifest, getSkill, listSkills } from "./registry";
export { executeSkill } from "./executor";
export { defaultSkills } from "./skills";
export { loadGitHubSkill } from "./github/loader";
export { loadGitHubSkillManifest } from "./github/manifestLoader";
export { TRUSTED_GITHUB_SKILL_REPOS, isTrustedRepo } from "./github/trustedRepos";
export { mockGitHubSkills, selectMockGitHubSkill };
