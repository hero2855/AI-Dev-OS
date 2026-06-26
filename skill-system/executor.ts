import { getSkill } from "./registry";
import type { SkillName } from "./types";

export async function executeSkill(name: SkillName | string, input: any): Promise<any> {
  const skill = getSkill(name);

  if (!skill) {
    throw new Error(`Skill not found: ${name}`);
  }

  return skill.execute(input);
}

export default executeSkill;
