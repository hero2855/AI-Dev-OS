import routeSkillStep from "./skillRouter";
import type { AgentStep } from "./agent";

export type ExecutionInput = {
  goal: string;
  steps: AgentStep[];
};

export type ExecutionResult = {
  stepId: number;
  skill: string;
  input: any;
  output: any;
};

export type ExecutionOutput = {
  goal: string;
  results: ExecutionResult[];
};

function normalizeStep(step: AgentStep, index: number): AgentStep {
  return {
    id: typeof step.id === "number" && Number.isFinite(step.id) ? step.id : index + 1,
    action: typeof step.action === "string" ? step.action : String(step.action ?? ""),
    skill: step.skill,
    input: step.input,
  };
}

export async function executePlan(plan: ExecutionInput): Promise<ExecutionOutput> {
  const goal = typeof plan?.goal === "string" ? plan.goal : "";
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  const results: ExecutionResult[] = [];

  for (let index = 0; index < steps.length; index += 1) {
    const step = normalizeStep(steps[index], index);

    try {
      const routed = await routeSkillStep(step);

      results.push({
        stepId: step.id,
        skill: routed.skill,
        input: routed.input,
        output: routed.output,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown skill execution error";

      results.push({
        stepId: step.id,
        skill: step.skill,
        input: step.input !== undefined ? step.input : step.action,
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
