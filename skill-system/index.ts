import { registerSkill } from "./registry";
import { defaultSkills } from "./skills";
import { mockGitHubSkills, selectMockGitHubSkill } from "./github/mockRegistry";

for (const skill of [...defaultSkills, ...mockGitHubSkills]) {
  registerSkill(skill);
}

export type { Skill, SkillName } from "./types";
export type { GitHubSkill } from "./github/types";
export { registerSkill, registerSkills, getSkill, listSkills } from "./registry";
export { executeSkill } from "./executor";
export { defaultSkills } from "./skills";
export { loadGitHubSkill } from "./github/loader";
export { mockGitHubSkills, selectMockGitHubSkill };
