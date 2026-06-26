import { executeSkill } from "../skill-system";

export type SkillRouterStep = {
  action: string;
  skill?: string;
  input?: any;
};

export type SkillRouterResult = {
  action: string;
  skill: string;
  input: any;
  output: any;
};

export async function routeSkillStep(step: SkillRouterStep): Promise<SkillRouterResult> {
  const action = typeof step.action === "string" ? step.action : String(step.action ?? "");
  const skill = typeof step.skill === "string" ? step.skill : "";
  const input = step.input !== undefined ? step.input : action;

  if (!skill) {
    throw new Error(`Missing skill for action: ${action}`);
  }

  const output = await executeSkill(skill, input);

  return {
    action,
    skill,
    input,
    output,
  };
}

export default routeSkillStep;
