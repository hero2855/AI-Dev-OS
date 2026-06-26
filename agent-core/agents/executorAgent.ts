import executePlan, { type ExecutionOutput } from "../executor";
import type { AgentControllerOutput } from "../agent";
import type { MemoryEntry } from "../memory/memory";

export type ExecutorAgentInput = {
  plan: AgentControllerOutput;
  memoryHistory: MemoryEntry[];
};

export async function executorAgent(input: ExecutorAgentInput): Promise<ExecutionOutput> {
  const plan = input.plan;
  const memoryHistory = Array.isArray(input.memoryHistory) ? input.memoryHistory : [];

  void memoryHistory;

  return executePlan({
    goal: plan.goal,
    steps: Array.isArray(plan.steps) ? plan.steps : [],
  });
}

export default executorAgent;
