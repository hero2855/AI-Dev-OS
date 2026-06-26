import { executeSkill } from "../skill system";

export type ExecutionStep = {
  id: number;
  action: string;
  skill: string;
};

export type ExecutionInput = {
  goal: string;
  steps: ExecutionStep[];
};

export type ExecutionResult = {
  stepId: number;
  skill: string;
  input: string;
  output: string;
};

export type ExecutionOutput = {
  goal: string;
  results: ExecutionResult[];
};

function normalizeStep(step: ExecutionStep, index: number): ExecutionStep {
  return {
    id: typeof step.id === "number" && Number.isFinite(step.id) ? step.id : index + 1,
    action: typeof step.action === "string" ? step.action : String(step.action ?? ""),
    skill: typeof step.skill === "string" ? step.skill : String(step.skill ?? ""),
  };
}

export async function executePlan(plan: ExecutionInput): Promise<ExecutionOutput> {
  const goal = typeof plan?.goal === "string" ? plan.goal : "";
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  const results: ExecutionResult[] = [];

  for (let index = 0; index < steps.length; index += 1) {
    const step = normalizeStep(steps[index], index);

    try {
      const output = await executeSkill(step.skill, step.action);

      results.push({
        stepId: step.id,
        skill: step.skill,
        input: step.action,
        output,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown execution error";

      results.push({
        stepId: step.id,
        skill: step.skill,
        input: step.action,
        output: `Error: ${message}`,
      });
    }
  }

  return {
    goal,
    results,
  };
}

export default executePlan;
